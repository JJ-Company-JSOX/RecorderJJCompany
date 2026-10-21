import path from "node:path";
import { BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { USER_DATA_PATH } from "../../appPaths";
import { SocialConfigStore } from "../social/config";
import { DirectAccountStore } from "../social/direct/accounts";
import { youtubeClient } from "../social/direct/apps";
import { pkcePair, startLoopback } from "../social/direct/oauth";
import {
	exchangeYoutubeCode,
	uploadToYoutube,
	youtubeAccessToken,
	youtubeAuthUrl,
} from "../social/direct/youtube";
import {
	type Channel,
	checkVideoFile,
	CONNECTABLE_PLATFORMS,
	createPostBody,
	isVideoPlatform,
	normalizeBaseUrl,
	PostizClient,
	publishProblems,
	type PublishRequest,
} from "../social/postiz";

const failure = (error: unknown) => ({
	success: false as const,
	error: error instanceof Error ? error.message : String(error),
});

function parsePublishRequest(input: unknown): PublishRequest {
	const value = (input ?? {}) as Record<string, unknown>;
	const channels = Array.isArray(value.channels) ? value.channels : [];
	if (
		channels.length > 20 ||
		!channels.every(
			(c) =>
				c &&
				typeof c.id === "string" &&
				c.id.length <= 200 &&
				isVideoPlatform(c.identifier),
		)
	)
		throw new Error("Invalid accounts");
	if (typeof value.text !== "string" || value.text.length > 5000) throw new Error("Invalid text");
	if (typeof value.title !== "string" || value.title.length > 200)
		throw new Error("Invalid title");
	if (value.visibility !== "public" && value.visibility !== "private")
		throw new Error("Invalid visibility");
	if (value.when !== "now" && value.when !== "schedule" && value.when !== "draft")
		throw new Error("Invalid publish time");
	return {
		videoPath: String(value.videoPath),
		channels: channels.map((c) => ({
			id: c.id,
			identifier: c.identifier,
			...(c.via === "direct" ? { via: "direct" as const } : {}),
		})),
		text: value.text,
		title: value.title,
		visibility: value.visibility,
		when: value.when,
		date: typeof value.date === "string" ? value.date : undefined,
		madeWithAi: value.madeWithAi === true,
	};
}

type Stage = "uploading" | "processing" | "posting";

/**
 * Social publishing, straight to the platform with the developer's built-in app
 * (YouTube) or through Postiz. Every network call here starts from an explicit click
 * in the Social page; recording, editing and the offline AI never use it.
 */
export function registerSocialHandlers() {
	const store = new SocialConfigStore(
		path.join(USER_DATA_PATH, "social-publisher.json"),
		safeStorage,
	);
	const direct = new DirectAccountStore(
		path.join(USER_DATA_PATH, "social-accounts.json"),
		safeStorage,
	);
	let publishing: AbortController | null = null;
	let signingIn: AbortController | null = null;
	const client = async () => {
		const credentials = await store.credentials();
		if (!credentials) throw new Error("Connect Postiz first.");
		return new PostizClient(credentials.baseUrl, credentials.apiKey);
	};

	ipcMain.handle("social-get-config", () => store.summary());

	ipcMain.handle("social-save-config", async (_, baseUrl: unknown, apiKey: unknown) => {
		try {
			if (typeof baseUrl !== "string" || baseUrl.length > 500)
				throw new Error("Invalid address");
			const normalized = normalizeBaseUrl(baseUrl);
			let key = typeof apiKey === "string" ? apiKey.trim() : "";
			if (!key) {
				// Changing only the address keeps the saved key.
				key = (await store.credentials())?.apiKey ?? "";
				if (!key) throw new Error("Paste your Postiz API key.");
			}
			if (key.length > 500) throw new Error("Invalid API key");
			if (!(await new PostizClient(normalized, key).isConnected()))
				throw new Error("Postiz did not accept the API key.");
			await store.save(normalized, key);
			return { success: true as const, baseUrl: normalized };
		} catch (error) {
			return failure(error);
		}
	});

	ipcMain.handle("social-clear-config", async () => {
		await store.clear();
		return { success: true as const };
	});

	ipcMain.handle("social-list-channels", async () => {
		try {
			const channels: Channel[] = await (await client()).channels();
			return { success: true as const, channels };
		} catch (error) {
			return failure(error);
		}
	});

	ipcMain.handle("social-connect-channel", async (_, identifier: unknown) => {
		try {
			if (
				!CONNECTABLE_PLATFORMS.includes(
					identifier as (typeof CONNECTABLE_PLATFORMS)[number],
				)
			)
				throw new Error("Unsupported platform");
			// The user signs in on the platform's own page in their browser, never inside Recordly.
			await shell.openExternal(await (await client()).connectUrl(identifier as string));
			return { success: true as const };
		} catch (error) {
			return failure(error);
		}
	});

	ipcMain.handle("social-direct-status", async () => ({
		platforms: { youtube: Boolean(youtubeClient()) },
		accounts: await direct.list(),
	}));

	ipcMain.handle("social-direct-connect", async (_, platform: unknown) => {
		try {
			if (platform !== "youtube") throw new Error("Unsupported platform");
			const app = youtubeClient();
			if (!app) throw new Error("YouTube posting is not set up in this build.");
			signingIn?.abort();
			const controller = new AbortController();
			signingIn = controller;
			const pkce = pkcePair();
			const loopback = await startLoopback(pkce.state, { signal: controller.signal });
			// The customer signs in on Google's own page in their browser, never inside Recordly.
			await shell.openExternal(youtubeAuthUrl(app, loopback.redirectUri, pkce));
			const code = await loopback.code;
			const { account, refreshToken } = await exchangeYoutubeCode(
				app,
				code,
				pkce.verifier,
				loopback.redirectUri,
			);
			await direct.add({ platform: "youtube", ...account }, refreshToken);
			return { success: true as const, accounts: await direct.list() };
		} catch (error) {
			return failure(error);
		} finally {
			signingIn = null;
		}
	});

	ipcMain.handle("social-direct-cancel-connect", () => {
		signingIn?.abort();
	});

	ipcMain.handle("social-direct-remove", async (_, platform: unknown, id: unknown) => {
		if (platform === "youtube" && typeof id === "string") await direct.remove(platform, id);
		return { success: true as const, accounts: await direct.list() };
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
		const progress = (stage: Stage, account?: string) => {
			if (!event.sender.isDestroyed())
				event.sender.send("social-publish-progress", stage, account);
		};
		const posts: Array<{ postId: string; integration: string; url?: string }> = [];
		const failed: Array<{ account: string; error: string }> = [];
		let warning: string | undefined;
		try {
			const request = parsePublishRequest(input);
			const problems = publishProblems(request);
			if (problems.length) throw new Error(problems.join(" "));
			await checkVideoFile(request.videoPath);
			const accounts = await direct.list();
			for (const channel of request.channels.filter((c) => c.via === "direct")) {
				const account = accounts.find(
					(a) => a.platform === channel.identifier && a.id === channel.id,
				);
				const name = account?.name ?? channel.identifier;
				try {
					const app = youtubeClient();
					const token = await direct.refreshToken("youtube", channel.id);
					if (!app || !token) throw new Error("Connect this YouTube account again.");
					progress("uploading", name);
					const video = await uploadToYoutube(
						await youtubeAccessToken(app, token),
						{
							videoPath: request.videoPath,
							title: request.title,
							description: request.text,
							// YouTube has no drafts: a draft is kept as a private video.
							visibility: request.when === "draft" ? "private" : request.visibility,
							publishAt:
								request.when === "schedule"
									? new Date(request.date as string).toISOString()
									: undefined,
							madeWithAi: request.madeWithAi,
						},
						{ signal: controller.signal },
					);
					posts.push({ postId: video.id, integration: channel.id, url: video.url });
				} catch (error) {
					if (controller.signal.aborted) throw error;
					failed.push({ account: name, error: failure(error).error });
				}
			}
			const viaPostiz = request.channels.filter((c) => c.via !== "direct");
			if (viaPostiz.length) {
				try {
					const postiz = await client();
					progress("uploading", "Postiz");
					const media = await postiz.upload(request.videoPath, controller.signal);
					if (!media.ready) {
						progress("processing");
						({ warning } = await postiz.waitUntilReady(media.id, controller.signal));
					}
					progress("posting");
					posts.push(
						...(await postiz.createPost(
							createPostBody({ ...request, channels: viaPostiz }, media),
							controller.signal,
						)),
					);
				} catch (error) {
					if (controller.signal.aborted) throw error;
					failed.push({ account: "Postiz", error: failure(error).error });
				}
			}
			if (!posts.length && failed.length)
				return {
					...failure(new Error(failed.map((f) => `${f.account}: ${f.error}`).join(" "))),
					failed,
				};
			return { success: true as const, posts, failed, warning };
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
