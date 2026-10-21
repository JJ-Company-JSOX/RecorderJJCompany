import path from "node:path";
import { BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { USER_DATA_PATH } from "../../appPaths";
import { SocialConfigStore } from "../social/config";
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
		channels: channels.map((c) => ({ id: c.id, identifier: c.identifier })),
		text: value.text,
		title: value.title,
		visibility: value.visibility,
		when: value.when,
		date: typeof value.date === "string" ? value.date : undefined,
		madeWithAi: value.madeWithAi === true,
	};
}

/**
 * Social publishing through Postiz. Every network call here starts from an explicit click
 * in the Social page; recording, editing and the offline AI never use it.
 */
export function registerSocialHandlers() {
	const store = new SocialConfigStore(
		path.join(USER_DATA_PATH, "social-publisher.json"),
		safeStorage,
	);
	let publishing: AbortController | null = null;
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
		const progress = (stage: "uploading" | "processing" | "posting") => {
			if (!event.sender.isDestroyed()) event.sender.send("social-publish-progress", stage);
		};
		try {
			const request = parsePublishRequest(input);
			const problems = publishProblems(request);
			if (problems.length) throw new Error(problems.join(" "));
			await checkVideoFile(request.videoPath);
			const postiz = await client();
			progress("uploading");
			const media = await postiz.upload(request.videoPath, controller.signal);
			let warning: string | undefined;
			if (!media.ready) {
				progress("processing");
				({ warning } = await postiz.waitUntilReady(media.id, controller.signal));
			}
			progress("posting");
			const posts = await postiz.createPost(
				createPostBody(request, media),
				controller.signal,
			);
			return { success: true as const, posts, warning };
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
