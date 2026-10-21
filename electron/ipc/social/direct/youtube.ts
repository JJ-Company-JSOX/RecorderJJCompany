import { openAsBlob } from "node:fs";
import fs from "node:fs/promises";
import { idTokenClaims } from "./oauth";

/**
 * YouTube posting straight from the desktop, with no server: Google's "Desktop app" OAuth
 * client (loopback redirect + PKCE, https://developers.google.com/identity/protocols/oauth2/native-app)
 * and the resumable upload protocol of videos.insert.
 */
export const YOUTUBE_SCOPES = [
	"openid",
	"email",
	"profile",
	"https://www.googleapis.com/auth/youtube.upload",
];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
	"https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

/** The developer's Google OAuth client, built into the app (a desktop client's secret is not confidential). */
export type GoogleClient = { id: string; secret?: string };

type Fetch = typeof fetch;

export function youtubeAuthUrl(
	client: GoogleClient,
	redirectUri: string,
	pkce: { challenge: string; state: string },
) {
	const url = new URL(AUTH_URL);
	url.search = new URLSearchParams({
		client_id: client.id,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: YOUTUBE_SCOPES.join(" "),
		code_challenge: pkce.challenge,
		code_challenge_method: "S256",
		state: pkce.state,
		access_type: "offline",
		// Always return a refresh token, even when the user connected this app before.
		prompt: "consent select_account",
	}).toString();
	return url.toString();
}

async function tokenRequest(fields: Record<string, string>, fetchImpl: Fetch) {
	const response = await fetchImpl(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(fields).toString(),
		signal: AbortSignal.timeout(30_000),
	});
	const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	if (!response.ok || typeof body.access_token !== "string") {
		throw new Error(
			body.error === "invalid_grant"
				? "YouTube sign-in has expired. Connect the account again."
				: `Google sign-in failed${typeof body.error_description === "string" ? `: ${body.error_description}` : "."}`,
		);
	}
	return body;
}

const clientFields = (client: GoogleClient) => ({
	client_id: client.id,
	...(client.secret ? { client_secret: client.secret } : {}),
});

/** Turns the code from the loopback redirect into the account and its refresh token. */
export async function exchangeYoutubeCode(
	client: GoogleClient,
	code: string,
	verifier: string,
	redirectUri: string,
	fetchImpl: Fetch = fetch,
) {
	const body = await tokenRequest(
		{
			...clientFields(client),
			code,
			code_verifier: verifier,
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
		},
		fetchImpl,
	);
	if (typeof body.refresh_token !== "string")
		throw new Error("Google did not allow offline access. Connect the account again.");
	const scopes = typeof body.scope === "string" ? body.scope.split(" ") : [];
	if (!scopes.includes("https://www.googleapis.com/auth/youtube.upload"))
		throw new Error("Allow Recordly to upload videos to YouTube when you sign in.");
	const claims = idTokenClaims(body.id_token);
	if (typeof claims.sub !== "string")
		throw new Error("Google did not say which account signed in.");
	return {
		account: {
			id: claims.sub,
			name: typeof claims.name === "string" ? claims.name : String(claims.email ?? "YouTube"),
			email: typeof claims.email === "string" ? claims.email : undefined,
			picture: typeof claims.picture === "string" ? claims.picture : undefined,
		},
		refreshToken: body.refresh_token,
	};
}

export async function youtubeAccessToken(
	client: GoogleClient,
	refreshToken: string,
	fetchImpl: Fetch = fetch,
) {
	const body = await tokenRequest(
		{ ...clientFields(client), grant_type: "refresh_token", refresh_token: refreshToken },
		fetchImpl,
	);
	return body.access_token as string;
}

export type YoutubeVideo = {
	videoPath: string;
	title: string;
	description: string;
	visibility: "public" | "private";
	/** ISO 8601; the video is published at that time (it stays private until then). */
	publishAt?: string;
	madeWithAi: boolean;
};

export function youtubeMetadata(video: YoutubeVideo) {
	const tags = [...new Set(video.description.match(/#[\p{L}\p{N}_]+/gu) ?? [])]
		.map((tag) => tag.slice(1))
		.slice(0, 15);
	return {
		snippet: {
			title: video.title.slice(0, 100),
			description: video.description.slice(0, 5000),
			// 27 = Education: screen-recording tutorials.
			categoryId: "27",
			...(tags.length ? { tags } : {}),
		},
		status: {
			privacyStatus: video.publishAt ? "private" : video.visibility,
			...(video.publishAt ? { publishAt: video.publishAt } : {}),
			selfDeclaredMadeForKids: false,
			containsSyntheticMedia: video.madeWithAi,
		},
	};
}

/** Uploads with the resumable protocol and returns the new video's link. */
export async function uploadToYoutube(
	accessToken: string,
	video: YoutubeVideo,
	{ signal, fetchImpl = fetch }: { signal?: AbortSignal; fetchImpl?: Fetch } = {},
) {
	const { size } = await fs.stat(video.videoPath);
	const start = await fetchImpl(UPLOAD_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json; charset=UTF-8",
			"X-Upload-Content-Length": String(size),
			"X-Upload-Content-Type": "video/mp4",
		},
		body: JSON.stringify(youtubeMetadata(video)),
		signal,
	});
	const session = start.headers.get("location");
	if (!start.ok || !session) throw new Error(await youtubeError(start));
	const upload = await fetchImpl(session, {
		method: "PUT",
		headers: { "Content-Type": "video/mp4" },
		body: await openAsBlob(video.videoPath, { type: "video/mp4" }),
		signal,
	});
	if (!upload.ok) throw new Error(await youtubeError(upload));
	const created = (await upload.json()) as { id?: unknown };
	if (typeof created.id !== "string") throw new Error("YouTube did not return the new video.");
	return { id: created.id, url: `https://youtu.be/${created.id}` };
}

async function youtubeError(response: Response) {
	const body = (await response.json().catch(() => ({}))) as {
		error?: { message?: string; errors?: Array<{ reason?: string }> };
	};
	const reason = body.error?.errors?.[0]?.reason;
	if (response.status === 401) return "YouTube sign-in has expired. Connect the account again.";
	if (reason === "quotaExceeded" || reason === "uploadLimitExceeded")
		return "YouTube's daily upload limit was reached. Try again tomorrow.";
	if (reason === "youtubeSignupRequired")
		return "This Google account has no YouTube channel yet. Create one on youtube.com first.";
	return `YouTube rejected the upload (${response.status})${body.error?.message ? `: ${body.error.message}` : "."}`;
}
