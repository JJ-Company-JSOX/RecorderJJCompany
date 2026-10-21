import { openAsBlob } from "node:fs";
import fs from "node:fs/promises";
import type { VideoPost } from "../publish";

/**
 * X posting straight from the desktop: OAuth 2.0 with PKCE as a public "Native App" client
 * (no secret), chunked media upload v2, then POST /2/tweets. https://docs.x.com
 */
type Fetch = typeof fetch;
const API = "https://api.x.com";
export const X_SCOPES = "tweet.read tweet.write users.read media.write offline.access";
/** X matches redirect URIs exactly: register http://127.0.0.1:<port>/callback for each. */
export const X_REDIRECT_PORTS = [43827, 43828, 43829];
export const X_REDIRECT_PATH = "/callback";

export function xAuthUrl(
	clientId: string,
	redirectUri: string,
	pkce: { challenge: string; state: string },
) {
	const url = new URL("https://x.com/i/oauth2/authorize");
	url.search = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: X_SCOPES,
		state: pkce.state,
		code_challenge: pkce.challenge,
		code_challenge_method: "S256",
	}).toString();
	return url.toString();
}

async function tokenRequest(fields: Record<string, string>, fetchImpl: Fetch) {
	const response = await fetchImpl(`${API}/2/oauth2/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(fields).toString(),
		signal: AbortSignal.timeout(30_000),
	});
	const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	if (!response.ok || typeof body.access_token !== "string")
		throw new Error(
			body.error === "invalid_request" || body.error === "invalid_grant"
				? "X sign-in has expired. Connect the account again."
				: `X sign-in failed${typeof body.error_description === "string" ? `: ${body.error_description}` : "."}`,
		);
	if (typeof body.refresh_token !== "string")
		throw new Error("X did not allow staying connected. Connect the account again.");
	return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

export const exchangeXCode = (
	clientId: string,
	code: string,
	verifier: string,
	redirectUri: string,
	fetchImpl: Fetch = fetch,
) =>
	tokenRequest(
		{
			code,
			grant_type: "authorization_code",
			client_id: clientId,
			redirect_uri: redirectUri,
			code_verifier: verifier,
		},
		fetchImpl,
	);

/** X refresh tokens are single-use: the caller must store the new one. */
export const refreshX = (clientId: string, refreshToken: string, fetchImpl: Fetch = fetch) =>
	tokenRequest(
		{ refresh_token: refreshToken, grant_type: "refresh_token", client_id: clientId },
		fetchImpl,
	);

async function api<T>(route: string, accessToken: string, init: RequestInit, fetchImpl: Fetch) {
	const response = await fetchImpl(`${API}${route}`, {
		...init,
		headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
	});
	const body = (await response.json().catch(() => ({}))) as {
		data?: T;
		detail?: string;
		title?: string;
		errors?: Array<{ message?: string }>;
	};
	if (!response.ok) {
		if (response.status === 401)
			throw new Error("X sign-in has expired. Connect the account again.");
		if (response.status === 402 || response.status === 429)
			throw new Error(
				"The X developer account has no posting credit or hit its limit right now.",
			);
		throw new Error(
			`X rejected the post (${response.status})${body.detail ? `: ${body.detail}` : body.errors?.[0]?.message ? `: ${body.errors[0].message}` : "."}`,
		);
	}
	return body.data as T;
}

export async function xUser(accessToken: string, fetchImpl: Fetch = fetch) {
	const user = await api<Record<string, unknown>>(
		"/2/users/me?user.fields=profile_image_url",
		accessToken,
		{ method: "GET" },
		fetchImpl,
	);
	return {
		id: String(user.id ?? ""),
		name: String(user.name ?? user.username ?? "X"),
		username: typeof user.username === "string" ? user.username : undefined,
		picture: typeof user.profile_image_url === "string" ? user.profile_image_url : undefined,
	};
}

const SEGMENT = 4 * 1024 * 1024;
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

/** Chunked upload (initialize, append, finalize, wait), then the post itself. */
export async function postToX(
	accessToken: string,
	video: VideoPost,
	{
		signal,
		fetchImpl = fetch,
		maxWaitMs = 10 * 60_000,
		secondMs = 1000,
	}: { signal?: AbortSignal; fetchImpl?: Fetch; maxWaitMs?: number; secondMs?: number } = {},
) {
	const { size } = await fs.stat(video.videoPath);
	const media = await api<{ id?: string }>(
		"/2/media/upload/initialize",
		accessToken,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				media_type: "video/mp4",
				total_bytes: size,
				media_category: "tweet_video",
			}),
			signal,
		},
		fetchImpl,
	);
	if (!media.id) throw new Error("X did not start the upload.");
	const file = await openAsBlob(video.videoPath, { type: "video/mp4" });
	for (let index = 0; index * SEGMENT < size; index++) {
		const form = new FormData();
		form.append("segment_index", String(index));
		form.append("media", file.slice(index * SEGMENT, (index + 1) * SEGMENT), "chunk.mp4");
		await api(
			`/2/media/upload/${media.id}/append`,
			accessToken,
			{ method: "POST", body: form, signal },
			fetchImpl,
		);
	}
	let info = (
		await api<{ processing_info?: { state?: string; check_after_secs?: number } }>(
			`/2/media/upload/${media.id}/finalize`,
			accessToken,
			{ method: "POST", signal },
			fetchImpl,
		)
	)?.processing_info;
	const deadline = Date.now() + maxWaitMs;
	while (info && info.state !== "succeeded") {
		if (info.state === "failed") throw new Error("X could not process the video.");
		if (Date.now() > deadline)
			throw new Error("X is still processing the video. Try again later.");
		await sleep(Math.max(1, info.check_after_secs ?? 5) * secondMs, signal);
		info = (
			await api<{ processing_info?: { state?: string; check_after_secs?: number } }>(
				`/2/media/upload?command=STATUS&media_id=${encodeURIComponent(media.id)}`,
				accessToken,
				{ method: "GET", signal },
				fetchImpl,
			)
		)?.processing_info;
	}
	const post = await api<{ id?: string }>(
		"/2/tweets",
		accessToken,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: video.text, media: { media_ids: [media.id] } }),
			signal,
		},
		fetchImpl,
	);
	if (!post.id) throw new Error("X did not create the post.");
	return { id: post.id, url: `https://x.com/i/web/status/${post.id}` };
}
