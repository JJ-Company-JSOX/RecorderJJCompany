import { openAsBlob } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Client for the Postiz Public API (https://docs.postiz.com/public-api/introduction).
 * Postiz holds the social accounts and talks to each platform; Recordly only uploads the
 * exported MP4 and creates the post. Runs in the main process so the API key never
 * reaches the renderer.
 */
export const POSTIZ_CLOUD_URL = "https://api.postiz.com/public/v1";

/** Channels Recordly can post a video to, by Postiz `identifier`. */
export const VIDEO_PLATFORMS = [
	"youtube",
	"tiktok",
	"instagram",
	"instagram-standalone",
	"facebook",
	"x",
	"threads",
	"linkedin",
	"linkedin-page",
	"bluesky",
] as const;
export type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];
export const isVideoPlatform = (value: unknown): value is VideoPlatform =>
	VIDEO_PLATFORMS.includes(value as VideoPlatform);

/** Platforms whose accounts can be linked from Recordly through Postiz's OAuth flow. */
export const CONNECTABLE_PLATFORMS = [
	"youtube",
	"tiktok",
	"instagram",
	"instagram-standalone",
	"facebook",
	"x",
	"threads",
	"linkedin",
	"linkedin-page",
] as const;

export type Channel = {
	id: string;
	name: string;
	identifier: string;
	picture?: string;
	profile?: string;
	disabled: boolean;
};

export type Visibility = "public" | "private";
export type PublishRequest = {
	videoPath: string;
	/** `via: "direct"` posts with Recordly's own app instead of Postiz. */
	channels: Array<{ id: string; identifier: VideoPlatform; via?: "direct" }>;
	text: string;
	title: string;
	visibility: Visibility;
	when: "now" | "schedule" | "draft";
	/** ISO 8601, required when scheduling. */
	date?: string;
	madeWithAi: boolean;
};

/**
 * Accepts the Postiz Cloud API URL or a self-hosted instance. A bare self-hosted address
 * ("https://postiz.example.com") gets the documented `/api/public/v1` path.
 */
export function normalizeBaseUrl(input: string) {
	const url = new URL(input.trim());
	if (url.protocol !== "https:" && url.protocol !== "http:")
		throw new Error("The Postiz address must start with https:// or http://");
	if (url.username || url.password || url.search || url.hash)
		throw new Error("The Postiz address must not contain a login, query or #");
	let pathname = url.pathname.replace(/\/+$/, "");
	if (!pathname) pathname = url.hostname === "api.postiz.com" ? "/public/v1" : "/api/public/v1";
	return `${url.origin}${pathname}`;
}

/** Per-platform settings for a single-video post, from the Postiz provider references. */
export function platformSettings(
	identifier: VideoPlatform,
	{ title, visibility, madeWithAi }: Pick<PublishRequest, "title" | "visibility" | "madeWithAi">,
): Record<string, unknown> {
	switch (identifier) {
		case "youtube":
			return {
				__type: "youtube",
				title: title.slice(0, 100),
				type: visibility === "public" ? "public" : "private",
				selfDeclaredMadeForKids: "no",
				tags: [],
			};
		case "tiktok":
			return {
				__type: "tiktok",
				title: title.slice(0, 90),
				privacy_level: visibility === "public" ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY",
				duet: false,
				stitch: false,
				comment: true,
				autoAddMusic: "no",
				brand_content_toggle: false,
				brand_organic_toggle: false,
				video_made_with_ai: madeWithAi,
				content_posting_method: "DIRECT_POST",
			};
		case "instagram":
		case "instagram-standalone":
			// A single video posted as "post" is published as a Reel.
			return { __type: identifier, post_type: "post" };
		case "facebook":
			return { __type: "facebook", post_type: "post", ...(title ? { title } : {}) };
		case "x":
			return { __type: "x", who_can_reply_post: "everyone", made_with_ai: madeWithAi };
		default:
			return { __type: identifier };
	}
}

/** Problems to fix before anything is uploaded. */
export function publishProblems(request: PublishRequest) {
	const problems: string[] = [];
	if (!request.channels.length) problems.push("Choose at least one account.");
	const platforms = new Set(request.channels.map((c) => c.identifier));
	if (platforms.has("youtube") && request.title.trim().length < 2)
		problems.push("YouTube needs a title of at least 2 characters.");
	if (platforms.has("x") && [...request.text].length > 280)
		problems.push("X allows at most 280 characters of text.");
	if (request.when === "schedule") {
		const time = Date.parse(request.date ?? "");
		if (!Number.isFinite(time) || time < Date.now() + 60_000)
			problems.push("Choose a schedule time at least one minute from now.");
	}
	return problems;
}

export function createPostBody(request: PublishRequest, media: { id: string; path: string }) {
	return {
		type: request.when,
		date:
			request.when === "schedule"
				? new Date(request.date as string).toISOString()
				: new Date().toISOString(),
		shortLink: false,
		tags: [],
		posts: request.channels.map((channel) => ({
			integration: { id: channel.id },
			value: [{ content: request.text, image: [{ id: media.id, path: media.path }] }],
			settings: platformSettings(channel.identifier, request),
		})),
	};
}

export class PostizError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
	}
}

type Fetch = typeof fetch;

export class PostizClient {
	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
		private readonly fetchImpl: Fetch = fetch,
	) {}

	private async request<T>(
		route: string,
		init: RequestInit = {},
		timeoutMs = 30_000,
	): Promise<T> {
		const signal = init.signal
			? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
			: AbortSignal.timeout(timeoutMs);
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.baseUrl}${route}`, {
				...init,
				signal,
				headers: {
					Authorization: this.apiKey,
					Accept: "application/json",
					...init.headers,
				},
			});
		} catch (error) {
			if (init.signal?.aborted) throw error;
			throw new PostizError(
				`Could not reach Postiz at ${this.baseUrl}. Check the address and your internet connection.`,
			);
		}
		const body = await response.text();
		if (!response.ok)
			throw new PostizError(errorMessage(response.status, body), response.status);
		try {
			return JSON.parse(body) as T;
		} catch {
			throw new PostizError("Postiz sent a reply Recordly could not read.", response.status);
		}
	}

	async isConnected() {
		const reply = await this.request<{ connected?: boolean }>("/is-connected");
		return reply.connected === true;
	}

	async channels(): Promise<Channel[]> {
		const reply = await this.request<unknown>("/integrations");
		if (!Array.isArray(reply)) throw new PostizError("Postiz sent an unexpected account list.");
		return reply.flatMap((item) =>
			item && typeof item.id === "string" && typeof item.identifier === "string"
				? [
						{
							id: item.id,
							name: typeof item.name === "string" ? item.name : item.identifier,
							identifier: item.identifier,
							picture: typeof item.picture === "string" ? item.picture : undefined,
							profile: typeof item.profile === "string" ? item.profile : undefined,
							disabled: item.disabled === true,
						},
					]
				: [],
		);
	}

	/** The platform's own sign-in page, where the user links an account to Postiz. */
	async connectUrl(identifier: string) {
		const reply = await this.request<{ url?: unknown }>(
			`/social/${encodeURIComponent(identifier)}`,
		);
		if (typeof reply.url !== "string")
			throw new PostizError("Postiz did not return a sign-in link.");
		const url = new URL(reply.url);
		if (url.protocol !== "https:")
			throw new PostizError("Postiz returned an unsafe sign-in link.");
		return url.toString();
	}

	/** Uploads the video; Postiz adjusts it to the platforms' limits when it can. */
	async upload(videoPath: string, signal?: AbortSignal) {
		const form = new FormData();
		form.append("adjust", "true");
		form.append(
			"file",
			await openAsBlob(videoPath, { type: "video/mp4" }),
			path.basename(videoPath),
		);
		const media = await this.request<{ id?: unknown; path?: unknown; status?: unknown }>(
			"/upload",
			{ method: "POST", body: form, signal },
			60 * 60_000,
		);
		if (typeof media.id !== "string" || typeof media.path !== "string")
			throw new PostizError("Postiz did not accept the video upload.");
		return { id: media.id, path: media.path, ready: media.status !== "processing" };
	}

	/** Waits until an adjusted upload is ready, so the post uses the adjusted file. */
	async waitUntilReady(
		id: string,
		signal?: AbortSignal,
		{ intervalMs = 3000, timeoutMs = 10 * 60_000 } = {},
	) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const status = await this.request<{ status?: unknown; warning?: unknown }>(
				`/media/${encodeURIComponent(id)}/status`,
				{ signal },
			);
			if (status.status !== "processing")
				return { warning: typeof status.warning === "string" ? status.warning : undefined };
			await new Promise((resolve) => setTimeout(resolve, intervalMs));
			signal?.throwIfAborted();
		}
		throw new PostizError(
			"Postiz is still preparing the video. Try publishing again in a few minutes.",
		);
	}

	async createPost(body: ReturnType<typeof createPostBody>, signal?: AbortSignal) {
		const reply = await this.request<unknown>("/posts", {
			method: "POST",
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
			signal,
		});
		return Array.isArray(reply)
			? reply.flatMap((item) =>
					item && typeof item.postId === "string"
						? [
								{
									postId: item.postId as string,
									integration: String(item.integration ?? ""),
								},
							]
						: [],
				)
			: [];
	}
}

function errorMessage(status: number, body: string) {
	let detail = "";
	try {
		const parsed = JSON.parse(body);
		const message = parsed?.message ?? parsed?.msg ?? parsed?.error;
		detail = Array.isArray(message)
			? message.join("; ")
			: typeof message === "string"
				? message
				: "";
	} catch {
		detail = body.slice(0, 200);
	}
	const reason =
		status === 401
			? "Postiz did not accept the API key. Copy it again from Postiz Settings → Developers."
			: status === 403
				? "This API key is not allowed to do that."
				: status === 404
					? "Postiz could not find that. Check the Postiz address."
					: status === 413
						? "The video is too large for this Postiz server."
						: status === 429
							? "Postiz's hourly posting limit was reached. Try again later."
							: `Postiz returned an error (${status}).`;
	return detail ? `${reason} ${detail}` : reason;
}

/** The exported video must be a real MP4 file on disk. */
export async function checkVideoFile(videoPath: unknown) {
	if (typeof videoPath !== "string" || !path.isAbsolute(videoPath) || !/\.mp4$/i.test(videoPath))
		throw new Error("Choose an exported MP4 video.");
	const stat = await fs.stat(videoPath).catch(() => null);
	if (!stat?.isFile() || stat.size === 0) throw new Error("The video file is missing or empty.");
	return { path: videoPath, bytes: stat.size };
}
