import { openAsBlob } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { VideoPost } from "../publish";

/**
 * Facebook Page and Instagram posting with no server and no app secret: Facebook Login's
 * desktop flow (response_type=token in a sign-in window, redirect to login_success.html),
 * Page video upload through the Resumable Upload API, and Instagram Reels with a resumable
 * upload of the local file. https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
 *
 * Without the secret Meta only issues short-lived tokens (about 1–2 hours), so an expired
 * sign-in is renewed by reopening the sign-in window, which finishes by itself while the
 * customer is still signed in to Facebook there.
 */
type Fetch = typeof fetch;
const VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;
export const META_REDIRECT = "https://www.facebook.com/connect/login_success.html";
export const META_SCOPES = [
	"pages_show_list",
	"pages_read_engagement",
	"pages_manage_posts",
	"instagram_basic",
	"instagram_content_publish",
];

export function metaLoginUrl(appId: string, state: string) {
	const url = new URL(`https://www.facebook.com/${VERSION}/dialog/oauth`);
	url.search = new URLSearchParams({
		client_id: appId,
		redirect_uri: META_REDIRECT,
		response_type: "token",
		state,
		scope: META_SCOPES.join(","),
	}).toString();
	return url.toString();
}

/** Reads the token from the redirect's #fragment, after checking the state. */
export function parseMetaRedirect(redirect: string, state: string, now = Date.now()) {
	const url = new URL(redirect);
	const fields = new URLSearchParams(url.hash.slice(1) || url.search.slice(1));
	if (fields.get("error") || fields.get("error_reason"))
		throw new Error(
			fields.get("error_reason") === "user_denied"
				? "Sign-in was cancelled."
				: "Facebook sign-in failed. Try again.",
		);
	const token = fields.get("access_token");
	if (!token || fields.get("state") !== state)
		throw new Error("Facebook sign-in failed. Try again.");
	const seconds = Number(fields.get("expires_in"));
	return {
		token,
		expiresAt: now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
	};
}

/** What is stored per connected Page or Instagram account. */
export type MetaCredential = { token: string; expiresAt: number; pageId: string };
export const metaExpired = (credential: MetaCredential, now = Date.now()) =>
	credential.expiresAt - 5 * 60_000 < now;

async function graph<T>(url: string, init: RequestInit, fetchImpl: Fetch): Promise<T> {
	const response = await fetchImpl(url.startsWith("http") ? url : `${GRAPH}${url}`, init);
	const body = (await response.json().catch(() => ({}))) as T & {
		error?: { message?: string; code?: number; error_subcode?: number };
	};
	if (!response.ok || body.error) {
		const error = body.error;
		if (error?.code === 190) throw new Error("Facebook sign-in has expired. Connect again.");
		if (error?.code === 10 || error?.code === 200)
			throw new Error(
				"Facebook did not give Recordly permission to post here. Connect again and allow it.",
			);
		throw new Error(
			`Facebook rejected the request${error?.message ? `: ${error.message}` : ` (${response.status}).`}`,
		);
	}
	return body;
}

type PageRow = {
	id: string;
	name: string;
	category?: string;
	picture?: { data?: { url?: string } };
	instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
};

/** The Pages this person manages, and the Instagram professional accounts linked to them. */
export async function metaAccounts(token: string, fetchImpl: Fetch = fetch) {
	const fields =
		"id,name,category,picture{url},instagram_business_account{id,username,profile_picture_url}";
	const reply = await graph<{ data?: PageRow[] }>(
		`/me/accounts?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(token)}`,
		{ method: "GET" },
		fetchImpl,
	);
	return reply.data ?? [];
}

async function pageToken(token: string, pageId: string, fetchImpl: Fetch) {
	const page = await graph<{ access_token?: string }>(
		`/${encodeURIComponent(pageId)}?fields=access_token&access_token=${encodeURIComponent(token)}`,
		{ method: "GET" },
		fetchImpl,
	);
	if (!page.access_token) throw new Error("Facebook did not allow posting to this Page.");
	return page.access_token;
}

/** Page video: upload session, file bytes, then the Page post. */
export async function postToFacebookPage(
	appId: string,
	credential: MetaCredential,
	video: VideoPost,
	{ signal, fetchImpl = fetch }: { signal?: AbortSignal; fetchImpl?: Fetch } = {},
) {
	const { size } = await fs.stat(video.videoPath);
	const session = await graph<{ id?: string }>(
		`/${encodeURIComponent(appId)}/uploads?${new URLSearchParams({
			file_name: path.basename(video.videoPath),
			file_length: String(size),
			file_type: "video/mp4",
			access_token: credential.token,
		})}`,
		{ method: "POST", signal },
		fetchImpl,
	);
	if (!session.id) throw new Error("Facebook did not start the upload.");
	const uploaded = await graph<{ h?: string }>(
		`/${session.id}`,
		{
			method: "POST",
			headers: { Authorization: `OAuth ${credential.token}`, file_offset: "0" },
			body: await openAsBlob(video.videoPath, { type: "video/mp4" }),
			signal,
		},
		fetchImpl,
	);
	if (!uploaded.h) throw new Error("Facebook did not accept the video upload.");
	const post = await graph<{ id?: string }>(
		`https://graph-video.facebook.com/${VERSION}/${encodeURIComponent(credential.pageId)}/videos`,
		{
			method: "POST",
			body: new URLSearchParams({
				access_token: await pageToken(credential.token, credential.pageId, fetchImpl),
				title: video.title,
				description: video.text,
				fbuploader_video_file_chunk: uploaded.h,
			}),
			signal,
		},
		fetchImpl,
	);
	if (!post.id) throw new Error("Facebook did not create the post.");
	return { id: post.id, url: `https://www.facebook.com/watch/?v=${post.id}` };
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

/** Instagram Reel from the local file: resumable container, upload, wait, publish. */
export async function postToInstagram(
	instagramId: string,
	credential: MetaCredential,
	video: VideoPost,
	{
		signal,
		fetchImpl = fetch,
		pollMs = 15_000,
		maxWaitMs = 5 * 60_000,
	}: { signal?: AbortSignal; fetchImpl?: Fetch; pollMs?: number; maxWaitMs?: number } = {},
) {
	const { size } = await fs.stat(video.videoPath);
	const token = credential.token;
	const id = encodeURIComponent(instagramId);
	const container = await graph<{ id?: string; uri?: string }>(
		`/${id}/media`,
		{
			method: "POST",
			body: new URLSearchParams({
				media_type: "REELS",
				upload_type: "resumable",
				caption: video.text.slice(0, 2200),
				access_token: token,
			}),
			signal,
		},
		fetchImpl,
	);
	if (!container.id || !container.uri?.startsWith("https://rupload.facebook.com/"))
		throw new Error("Instagram did not start the upload.");
	await graph(
		container.uri,
		{
			method: "POST",
			headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(size) },
			body: await openAsBlob(video.videoPath, { type: "video/mp4" }),
			signal,
		},
		fetchImpl,
	);
	const deadline = Date.now() + maxWaitMs;
	for (;;) {
		const status = await graph<{ status_code?: string }>(
			`/${container.id}?fields=status_code&access_token=${encodeURIComponent(token)}`,
			{ method: "GET", signal },
			fetchImpl,
		);
		if (status.status_code === "FINISHED") break;
		if (status.status_code === "ERROR" || status.status_code === "EXPIRED")
			throw new Error(
				"Instagram could not process the video. Reels must be MP4, 3 seconds to 15 minutes.",
			);
		if (Date.now() > deadline)
			throw new Error("Instagram is still processing the video. Try again later.");
		await sleep(pollMs, signal);
	}
	const published = await graph<{ id?: string }>(
		`/${id}/media_publish`,
		{
			method: "POST",
			body: new URLSearchParams({ creation_id: container.id, access_token: token }),
			signal,
		},
		fetchImpl,
	);
	if (!published.id) throw new Error("Instagram did not publish the Reel.");
	const media = await graph<{ permalink?: string }>(
		`/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`,
		{ method: "GET", signal },
		fetchImpl,
	).catch(() => ({ permalink: undefined }));
	return { id: published.id, url: media.permalink };
}
