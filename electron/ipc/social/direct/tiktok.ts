import { openAsBlob } from "node:fs";
import fs from "node:fs/promises";
import type { VideoPost } from "../publish";

/**
 * TikTok posting straight from the desktop: Login Kit for Desktop (loopback redirect
 * `http://127.0.0.1:*\/callback/`, PKCE with a hex SHA-256 challenge) and the Content
 * Posting API's Direct Post with FILE_UPLOAD. https://developers.tiktok.com/doc/login-kit-desktop
 */
export type TikTokClient = { key: string; secret: string };
type Fetch = typeof fetch;

const API = "https://open.tiktokapis.com";
export const TIKTOK_SCOPES = "user.info.basic,video.publish";
export const TIKTOK_REDIRECT_PATH = "/callback/";

export function tiktokAuthUrl(
	client: TikTokClient,
	redirectUri: string,
	pkce: { challenge: string; state: string },
) {
	const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
	url.search = new URLSearchParams({
		client_key: client.key,
		response_type: "code",
		scope: TIKTOK_SCOPES,
		redirect_uri: redirectUri,
		state: pkce.state,
		code_challenge: pkce.challenge,
		code_challenge_method: "S256",
	}).toString();
	return url.toString();
}

type Tokens = { accessToken: string; refreshToken: string; openId: string };

async function tokenRequest(fields: Record<string, string>, fetchImpl: Fetch): Promise<Tokens> {
	const response = await fetchImpl(`${API}/v2/oauth/token/`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(fields).toString(),
		signal: AbortSignal.timeout(30_000),
	});
	const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	if (
		!response.ok ||
		typeof body.access_token !== "string" ||
		typeof body.refresh_token !== "string"
	)
		throw new Error(
			body.error === "invalid_grant"
				? "TikTok sign-in has expired. Connect the account again."
				: `TikTok sign-in failed${typeof body.error_description === "string" ? `: ${body.error_description}` : "."}`,
		);
	const scopes = typeof body.scope === "string" ? body.scope.split(",") : [];
	if (!scopes.includes("video.publish"))
		throw new Error("Allow Recordly to post videos to TikTok when you sign in.");
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token,
		openId: String(body.open_id ?? ""),
	};
}

export const exchangeTiktokCode = (
	client: TikTokClient,
	code: string,
	verifier: string,
	redirectUri: string,
	fetchImpl: Fetch = fetch,
) =>
	tokenRequest(
		{
			client_key: client.key,
			client_secret: client.secret,
			code,
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
			code_verifier: verifier,
		},
		fetchImpl,
	);

/** TikTok may return a new refresh token each time: the caller must store it. */
export const refreshTiktok = (
	client: TikTokClient,
	refreshToken: string,
	fetchImpl: Fetch = fetch,
) =>
	tokenRequest(
		{
			client_key: client.key,
			client_secret: client.secret,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		},
		fetchImpl,
	);

async function api<T>(
	route: string,
	accessToken: string,
	init: RequestInit,
	fetchImpl: Fetch,
): Promise<T> {
	const response = await fetchImpl(`${API}${route}`, {
		...init,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json; charset=UTF-8",
			...init.headers,
		},
	});
	const body = (await response.json().catch(() => ({}))) as {
		data?: T;
		error?: { code?: string; message?: string };
	};
	const code = body.error?.code;
	if (!response.ok || (code && code !== "ok"))
		throw new Error(tiktokError(code, body.error?.message));
	return body.data as T;
}

function tiktokError(code?: string, detail?: string) {
	switch (code) {
		case "unaudited_client_can_only_post_to_private_accounts":
			return "Until TikTok approves this app, it can only post to private TikTok accounts, as “Only me”.";
		case "spam_risk_too_many_posts":
		case "spam_risk_user_banned_from_posting":
			return "TikTok is not allowing more posts from this account right now. Try again later.";
		case "reached_active_user_cap":
			return "This app reached TikTok's daily limit of creators. Try again tomorrow.";
		case "access_token_invalid":
		case "scope_not_authorized":
			return "TikTok sign-in has expired. Connect the account again.";
		default:
			return `TikTok rejected the post${detail ? `: ${detail}` : code ? ` (${code})` : "."}`;
	}
}

export async function tiktokUser(accessToken: string, fetchImpl: Fetch = fetch) {
	const data = await api<{ user?: Record<string, unknown> }>(
		"/v2/user/info/?fields=open_id,avatar_url,display_name",
		accessToken,
		{ method: "GET" },
		fetchImpl,
	);
	return {
		name: typeof data.user?.display_name === "string" ? data.user.display_name : "TikTok",
		picture: typeof data.user?.avatar_url === "string" ? data.user.avatar_url : undefined,
	};
}

/** What TikTok lets this creator do now; required before every post by TikTok's guidelines. */
export type CreatorInfo = {
	nickname: string;
	username: string;
	privacyOptions: string[];
	commentDisabled: boolean;
	duetDisabled: boolean;
	stitchDisabled: boolean;
	maxDurationSec: number;
};

export async function tiktokCreatorInfo(accessToken: string, fetchImpl: Fetch = fetch) {
	const data = await api<Record<string, unknown>>(
		"/v2/post/publish/creator_info/query/",
		accessToken,
		{ method: "POST" },
		fetchImpl,
	);
	return {
		nickname: String(data.creator_nickname ?? ""),
		username: String(data.creator_username ?? ""),
		privacyOptions: Array.isArray(data.privacy_level_options)
			? data.privacy_level_options.filter((o): o is string => typeof o === "string")
			: [],
		commentDisabled: data.comment_disabled === true,
		duetDisabled: data.duet_disabled === true,
		stitchDisabled: data.stitch_disabled === true,
		maxDurationSec: Number(data.max_video_post_duration_sec) || 0,
	} satisfies CreatorInfo;
}

const MB = 1024 * 1024;
/**
 * TikTok's chunk rules: one chunk up to 64 MB; otherwise chunks of 5–64 MB, the count
 * rounded down, with the remainder added to the last chunk (at most 128 MB).
 */
export function tiktokChunks(size: number) {
	if (size <= 64 * MB) return { chunkSize: size, count: 1 };
	const chunkSize = 32 * MB;
	return { chunkSize, count: Math.floor(size / chunkSize) };
}

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});

/** Direct Post of a local MP4: init, upload the chunks, then follow the publish status. */
export async function postToTiktok(
	accessToken: string,
	video: VideoPost,
	{
		signal,
		fetchImpl = fetch,
		pollMs = 5000,
		maxWaitMs = 5 * 60_000,
	}: { signal?: AbortSignal; fetchImpl?: Fetch; pollMs?: number; maxWaitMs?: number } = {},
) {
	const choices = video.tiktok;
	if (!choices) throw new Error("Choose who can see the TikTok video.");
	const creator = await tiktokCreatorInfo(accessToken, fetchImpl);
	if (!creator.privacyOptions.includes(choices.privacy))
		throw new Error("That TikTok privacy choice is no longer available. Choose again.");
	const { size } = await fs.stat(video.videoPath);
	const { chunkSize, count } = tiktokChunks(size);
	const init = await api<{ publish_id?: string; upload_url?: string }>(
		"/v2/post/publish/video/init/",
		accessToken,
		{
			method: "POST",
			body: JSON.stringify({
				post_info: {
					title: (video.text || video.title).slice(0, 2200),
					privacy_level: choices.privacy,
					disable_comment: creator.commentDisabled || !choices.allowComment,
					disable_duet: creator.duetDisabled || !choices.allowDuet,
					disable_stitch: creator.stitchDisabled || !choices.allowStitch,
					brand_content_toggle: choices.brandedContent,
					brand_organic_toggle: choices.yourBrand,
					is_aigc: video.madeWithAi,
				},
				source_info: {
					source: "FILE_UPLOAD",
					video_size: size,
					chunk_size: chunkSize,
					total_chunk_count: count,
				},
			}),
			signal,
		},
		fetchImpl,
	);
	if (!init.publish_id || !init.upload_url) throw new Error("TikTok did not start the upload.");
	const file = await openAsBlob(video.videoPath, { type: "video/mp4" });
	for (let index = 0; index < count; index++) {
		const start = index * chunkSize;
		const end = index === count - 1 ? size : start + chunkSize;
		const response = await fetchImpl(init.upload_url, {
			method: "PUT",
			headers: {
				"Content-Type": "video/mp4",
				"Content-Range": `bytes ${start}-${end - 1}/${size}`,
			},
			body: file.slice(start, end),
			signal,
		});
		if (response.status !== 201 && response.status !== 206)
			throw new Error(`TikTok did not accept the video upload (${response.status}).`);
	}
	const deadline = Date.now() + maxWaitMs;
	while (Date.now() < deadline) {
		const status = await api<Record<string, unknown>>(
			"/v2/post/publish/status/fetch/",
			accessToken,
			{ method: "POST", body: JSON.stringify({ publish_id: init.publish_id }), signal },
			fetchImpl,
		);
		if (status.status === "FAILED")
			throw new Error(tiktokError(String(status.fail_reason ?? ""), undefined));
		if (status.status === "PUBLISH_COMPLETE") {
			const ids = status.publicaly_available_post_id;
			const postId = Array.isArray(ids) && ids.length ? String(ids[0]) : "";
			return {
				id: postId || init.publish_id,
				url:
					postId && creator.username
						? `https://www.tiktok.com/@${creator.username}/video/${postId}`
						: undefined,
			};
		}
		await sleep(pollMs, signal);
	}
	// Still processing: TikTok finishes on its side and notifies the creator.
	return { id: init.publish_id };
}
