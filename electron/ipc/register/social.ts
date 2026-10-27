import path from "node:path";
import { BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { USER_DATA_PATH } from "../../appPaths";
import { DirectAccountStore } from "../social/direct/accounts";
import { ADAPTERS, type ConnectContext } from "../social/direct/platforms";
import {
	checkVideoFile,
	isPlatform,
	PLATFORMS,
	type Platform,
	parsePublishRequest,
	publishProblems,
} from "../social/publish";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const failure = (error: unknown) => ({ success: false as const, error: message(error) });

/**
 * Social publishing straight to each platform, through the developer's own registered
 * apps: customers sign in with their own accounts in their browser and Recordly posts the
 * video directly. No server. Every network call here starts from a click on the Social
 * page; recording, editing and the offline AI never use it.
 */
export function registerSocialHandlers() {
	// safeStorage is only touched when an account is saved or used, not at startup.
	const accounts = new DirectAccountStore(path.join(USER_DATA_PATH, "social-accounts.json"), {
		isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
		encryptString: (text) => safeStorage.encryptString(text),
		decryptString: (data) => safeStorage.decryptString(data),
	});
	let publishing: AbortController | null = null;
	let signingIn: AbortController | null = null;

	/**
	 * A small Recordly window for sign-in flows that cannot redirect to 127.0.0.1 (Facebook).
	 * Its own persistent session keeps the customer signed in to that platform only.
	 */
	const signInWindow: ConnectContext["signInWindow"] = (url, redirectPrefix, signal) =>
		new Promise((resolve, reject) => {
			const window = new BrowserWindow({
				width: 520,
				height: 720,
				title: "Sign in",
				autoHideMenuBar: true,
				webPreferences: { partition: "persist:recordly-social-signin", sandbox: true },
			});
			let done = false;
			const finish = (error: Error | null, result?: string) => {
				if (done) return;
				done = true;
				signal.removeEventListener("abort", abort);
				if (!window.isDestroyed()) window.close();
				if (error) reject(error);
				else resolve(result as string);
			};
			const abort = () => finish(new Error("Sign-in was cancelled."));
			const check = (target: string) => {
				if (target.startsWith(redirectPrefix)) finish(null, target);
			};
			signal.addEventListener("abort", abort, { once: true });
			window.webContents.on("will-redirect", (_, target) => check(target));
			window.webContents.on("did-navigate", (_, target) => check(target));
			window.webContents.setWindowOpenHandler(({ url: popup }) => {
				void shell.openExternal(popup);
				return { action: "deny" };
			});
			window.on("closed", () => finish(new Error("Sign-in was cancelled.")));
			void window.loadURL(url);
		});
	const available = () =>
		Object.fromEntries(PLATFORMS.map((p) => [p, ADAPTERS[p].available()])) as Record<
			Platform,
			boolean
		>;

	ipcMain.handle("social-status", async () => ({
		platforms: available(),
		accounts: await accounts.list(),
	}));

	ipcMain.handle("social-connect", async (_, platform: unknown) => {
		try {
			const adapter = isPlatform(platform) ? ADAPTERS[platform] : undefined;
			if (!adapter?.available())
				throw new Error("This platform is not set up in this build.");
			signingIn?.abort();
			const controller = new AbortController();
			signingIn = controller;
			// Customers sign in on the platform's own page in their browser, never inside Recordly.
			const connected = await adapter.connect({
				openExternal: (url) => shell.openExternal(url),
				signInWindow,
				signal: controller.signal,
			});
			if (!connected.length) throw new Error("No account was found to post to.");
			await accounts.save(connected);
			return { success: true as const, accounts: await accounts.list() };
		} catch (error) {
			return failure(error);
		} finally {
			signingIn = null;
		}
	});

	ipcMain.handle("social-cancel-connect", () => {
		signingIn?.abort();
	});

	ipcMain.handle("social-remove", async (_, platform: unknown, id: unknown) => {
		if (isPlatform(platform) && typeof id === "string") await accounts.remove(platform, id);
		return { success: true as const, accounts: await accounts.list() };
	});

	/** What the platform allows this account right now (e.g. TikTok's privacy choices). */
	ipcMain.handle("social-account-options", async (_, platform: unknown, id: unknown) => {
		try {
			const adapter = isPlatform(platform) ? ADAPTERS[platform] : undefined;
			const credential =
				isPlatform(platform) && typeof id === "string"
					? await accounts.credential(platform, id)
					: null;
			if (!adapter?.options || !credential) throw new Error("Connect this account again.");
			const result = await adapter.options(credential, AbortSignal.timeout(30_000));
			if (result.credential) {
				const account = (await accounts.list()).find(
					(a) => a.platform === platform && a.id === id,
				);
				if (account) await accounts.save([{ account, credential: result.credential }]);
			}
			return { success: true as const, options: result.options };
		} catch (error) {
			return failure(error);
		}
	});

	ipcMain.handle("social-pick-video", async (event) => {
		const window = BrowserWindow.fromWebContents(event.sender);
		const options = {
			title: "Choose a video to post",
			properties: ["openFile" as const],
			filters: [{ name: "MP4 video", extensions: ["mp4"] }],
		};
		const result = window
			? await dialog.showOpenDialog(window, options)
			: await dialog.showOpenDialog(options);
		return result.canceled ? null : (result.filePaths[0] ?? null);
	});

	ipcMain.handle("social-check-video", async (_, videoPath: unknown) => {
		try {
			return { success: true as const, ...(await checkVideoFile(videoPath)) };
		} catch (error) {
			return failure(error);
		}
	});

	ipcMain.handle("social-publish", async (event, input: unknown) => {
		if (publishing) return failure(new Error("A post is already being published."));
		const controller = new AbortController();
		publishing = controller;
		const progress = (account: string) => {
			if (!event.sender.isDestroyed()) event.sender.send("social-publish-progress", account);
		};
		const posts: Array<{ platform: Platform; account: string; id: string; url?: string }> = [];
		const failed: Array<{ account: string; error: string }> = [];
		try {
			const request = parsePublishRequest(input);
			const problems = publishProblems(request);
			if (problems.length) throw new Error(problems.join(" "));
			await checkVideoFile(request.videoPath);
			const { accounts: _chosen, ...video } = request;
			const known = await accounts.list();
			for (const target of request.accounts) {
				const account = known.find(
					(a) => a.platform === target.platform && a.id === target.id,
				);
				const name = account ? `${account.name} (${target.platform})` : target.platform;
				try {
					const adapter = ADAPTERS[target.platform];
					const credential = await accounts.credential(target.platform, target.id);
					if (!adapter || !account || !credential)
						throw new Error("Connect this account again.");
					progress(name);
					const posted = await adapter
						.publish(credential, video, {
							signal: controller.signal,
							signInWindow,
							accountId: target.id,
						})
						.catch(async (error) => {
							// A refresh token used before the failure was already replaced.
							const rotated = (error as { rotatedCredential?: string })
								.rotatedCredential;
							if (rotated) await accounts.save([{ account, credential: rotated }]);
							throw error;
						});
					if (posted.credential)
						await accounts.save([{ account, credential: posted.credential }]);
					posts.push({
						platform: target.platform,
						account: name,
						id: posted.id,
						url: posted.url,
					});
				} catch (error) {
					if (controller.signal.aborted) throw error;
					failed.push({ account: name, error: message(error) });
				}
			}
			if (!posts.length)
				return {
					...failure(new Error(failed.map((f) => `${f.account}: ${f.error}`).join(" "))),
					failed,
				};
			return { success: true as const, posts, failed };
		} catch (error) {
			if (controller.signal.aborted) return failure(new Error("Publishing was cancelled."));
			return failure(error);
		} finally {
			publishing = null;
		}
	});

	ipcMain.handle("social-cancel-publish", () => {
		publishing?.abort();
	});
}
