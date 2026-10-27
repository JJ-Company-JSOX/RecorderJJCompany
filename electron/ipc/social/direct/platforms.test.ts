import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { parsePublishRequest, publishProblems, type VideoPost } from "../publish";
import {
	metaExpired,
	metaLoginUrl,
	parseMetaRedirect,
	postToFacebookPage,
	postToInstagram,
} from "./meta";
import { pkcePair, startLoopback } from "./oauth";
import { exchangeTiktokCode, postToTiktok, tiktokAuthUrl, tiktokChunks } from "./tiktok";
import { postToX, X_REDIRECT_PATH, xAuthUrl } from "./x";

const dir = mkdtempSync(path.join(tmpdir(), "recordly-platforms-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const videoPath = path.join(dir, "export.mp4");
writeFileSync(videoPath, Buffer.from("fake mp4 bytes"));
const video = (overrides: Partial<VideoPost> = {}): VideoPost => ({
	videoPath,
	text: "How to export #tutorial",
	title: "Export a video",
	visibility: "public",
	when: "now",
	madeWithAi: true,
	...overrides,
});
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Call = { url: string; init: RequestInit };
const recorder = (reply: (url: string, init: RequestInit) => Response) => {
	const calls: Call[] = [];
	const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
		calls.push({ url, init });
		return reply(url, init);
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
};
const body = (call: Call) => JSON.parse(call.init.body as string);

describe("what can be posted", () => {
	const request = (overrides: Record<string, unknown> = {}) =>
		parsePublishRequest({
			videoPath,
			accounts: [{ platform: "youtube", id: "g-1" }],
			text: "Hello",
			title: "Title",
			visibility: "public",
			when: "now",
			madeWithAi: true,
			...overrides,
		});
	it("accepts only known platforms and well-formed choices", () => {
		expect(() => request({ accounts: [{ platform: "myspace", id: "1" }] })).toThrow();
		expect(() => request({ when: "draft" })).toThrow();
		expect(request({ tiktok: { privacy: "drop table" } }).tiktok).toBeUndefined();
	});
	it("explains each platform's rules before uploading", () => {
		expect(publishProblems(request())).toEqual([]);
		expect(publishProblems(request({ title: "" }))[0]).toMatch(/YouTube/);
		expect(
			publishProblems(request({ accounts: [{ platform: "tiktok", id: "t" }] }))[0],
		).toMatch(/TikTok/);
		expect(
			publishProblems(
				request({
					accounts: [{ platform: "tiktok", id: "t" }],
					tiktok: { privacy: "SELF_ONLY", brandedContent: true },
				}),
			)[0],
		).toMatch(/Branded content/);
		expect(
			publishProblems(
				request({ accounts: [{ platform: "x", id: "x" }], text: "a".repeat(281) }),
			)[0],
		).toMatch(/280/);
		expect(
			publishProblems(
				request({ accounts: [{ platform: "instagram", id: "i" }], visibility: "private" }),
			)[0],
		).toMatch(/always public/);
		expect(
			publishProblems(
				request({
					accounts: [{ platform: "x", id: "x" }],
					when: "schedule",
					date: new Date(Date.now() + 3600_000).toISOString(),
				}),
			)[0],
		).toMatch(/Scheduling is not available for: x/);
	});
});

describe("loopback for platforms with fixed redirect URIs", () => {
	it("uses the registered path and falls back to the next registered port", async () => {
		const blocker = await startLoopback("other", { ports: [0] });
		const blockedPort = Number(new URL(blocker.redirectUri).port);
		const loopback = await startLoopback("s", {
			path: X_REDIRECT_PATH,
			ports: [blockedPort, 0],
		});
		expect(loopback.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
		expect(loopback.redirectUri).not.toContain(`:${blockedPort}/`);
		await fetch(`${loopback.redirectUri}?state=s&code=c`);
		await expect(loopback.code).resolves.toBe("c");
		await fetch(`${blocker.redirectUri}/?state=other&code=x`);
		await blocker.code;
	});
});

describe("TikTok", () => {
	const client = { key: "awkey", secret: "sec" };
	it("signs in with a hex SHA-256 PKCE challenge", () => {
		const pkce = pkcePair("hex");
		expect(pkce.challenge).toBe(createHash("sha256").update(pkce.verifier).digest("hex"));
		const url = new URL(tiktokAuthUrl(client, "http://127.0.0.1:5000/callback/", pkce));
		expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			client_key: "awkey",
			scope: "user.info.basic,video.publish",
			code_challenge_method: "S256",
			redirect_uri: "http://127.0.0.1:5000/callback/",
		});
	});
	it("needs posting permission from the sign-in", async () => {
		const { fetchImpl } = recorder(() =>
			json({ access_token: "a", refresh_token: "r", open_id: "o", scope: "user.info.basic" }),
		);
		await expect(exchangeTiktokCode(client, "c", "v", "r", fetchImpl)).rejects.toThrow(
			/post videos/,
		);
	});
	it("follows TikTok's chunk rules", () => {
		const MB = 1024 * 1024;
		expect(tiktokChunks(3 * MB)).toEqual({ chunkSize: 3 * MB, count: 1 });
		expect(tiktokChunks(64 * MB)).toEqual({ chunkSize: 64 * MB, count: 1 });
		// 100 MB: three 32 MB chunks, the last one carrying the 4 MB remainder.
		expect(tiktokChunks(100 * MB)).toEqual({ chunkSize: 32 * MB, count: 3 });
	});
	it("checks the creator, uploads the file and waits for the post", async () => {
		const { calls, fetchImpl } = recorder((url) => {
			if (url.endsWith("/creator_info/query/"))
				return json({
					data: {
						creator_username: "jsox",
						privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
						duet_disabled: true,
					},
					error: { code: "ok" },
				});
			if (url.endsWith("/video/init/"))
				return json({
					data: { publish_id: "pub1", upload_url: "https://upload.tiktok/u?x=1" },
					error: { code: "ok" },
				});
			if (url.startsWith("https://upload.tiktok")) return new Response(null, { status: 201 });
			return json({
				data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7123] },
				error: { code: "ok" },
			});
		});
		const posted = await postToTiktok(
			"at",
			video({
				tiktok: {
					privacy: "PUBLIC_TO_EVERYONE",
					allowComment: true,
					allowDuet: true,
					allowStitch: false,
					yourBrand: true,
					brandedContent: false,
				},
			}),
			{ fetchImpl, pollMs: 1 },
		);
		expect(posted).toEqual({ id: "7123", url: "https://www.tiktok.com/@jsox/video/7123" });
		const init = body(calls[1]);
		expect(init.post_info).toEqual({
			title: "How to export #tutorial",
			privacy_level: "PUBLIC_TO_EVERYONE",
			disable_comment: false,
			// The creator turned Duet off, whatever was ticked.
			disable_duet: true,
			disable_stitch: true,
			brand_content_toggle: false,
			brand_organic_toggle: true,
			is_aigc: true,
		});
		expect(init.source_info).toEqual({
			source: "FILE_UPLOAD",
			video_size: 14,
			chunk_size: 14,
			total_chunk_count: 1,
		});
		expect(calls[2].init.headers).toMatchObject({ "Content-Range": "bytes 0-13/14" });
		expect(await (calls[2].init.body as Blob).text()).toBe("fake mp4 bytes");
	});
	it("refuses a privacy choice TikTok no longer offers, and explains unaudited limits", async () => {
		const choices = {
			privacy: "PUBLIC_TO_EVERYONE",
			allowComment: false,
			allowDuet: false,
			allowStitch: false,
			yourBrand: false,
			brandedContent: false,
		};
		const onlyPrivate = recorder(() =>
			json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } }),
		);
		await expect(
			postToTiktok("at", video({ tiktok: choices }), { fetchImpl: onlyPrivate.fetchImpl }),
		).rejects.toThrow(/no longer available/);
		const unaudited = recorder((url) =>
			url.endsWith("/creator_info/query/")
				? json({
						data: { privacy_level_options: ["PUBLIC_TO_EVERYONE"] },
						error: { code: "ok" },
					})
				: json(
						{ error: { code: "unaudited_client_can_only_post_to_private_accounts" } },
						403,
					),
		);
		await expect(
			postToTiktok("at", video({ tiktok: choices }), { fetchImpl: unaudited.fetchImpl }),
		).rejects.toThrow(/approves this app/);
	});
});

describe("X", () => {
	it("signs in as a public client with PKCE", () => {
		const url = new URL(
			xAuthUrl("cid", "http://127.0.0.1:43827/callback", { challenge: "ch", state: "st" }),
		);
		expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
		expect(url.searchParams.get("scope")).toBe(
			"tweet.read tweet.write users.read media.write offline.access",
		);
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
	});
	it("uploads in chunks, waits for processing and posts with the media", async () => {
		let polls = 0;
		const { calls, fetchImpl } = recorder((url) => {
			if (url.endsWith("/initialize")) return json({ data: { id: "m1" } });
			if (url.endsWith("/append")) return json({});
			if (url.endsWith("/finalize"))
				return json({
					data: { processing_info: { state: "pending", check_after_secs: 0 } },
				});
			if (url.includes("command=STATUS"))
				return json({
					data: { processing_info: { state: ++polls < 2 ? "in_progress" : "succeeded" } },
				});
			return json({ data: { id: "1880" } });
		});
		const posted = await postToX("at", video(), { fetchImpl, secondMs: 1 });
		expect(posted).toEqual({ id: "1880", url: "https://x.com/i/web/status/1880" });
		expect(body(calls[0])).toEqual({
			media_type: "video/mp4",
			total_bytes: 14,
			media_category: "tweet_video",
		});
		const append = calls[1].init.body as FormData;
		expect(append.get("segment_index")).toBe("0");
		expect(await (append.get("media") as Blob).text()).toBe("fake mp4 bytes");
		expect(body(calls.at(-1) as Call)).toEqual({
			text: "How to export #tutorial",
			media: { media_ids: ["m1"] },
		});
	});
	it("says when the developer account has no posting credit", async () => {
		const { fetchImpl } = recorder(() => json({ title: "CreditsDepleted" }, 402));
		await expect(postToX("at", video(), { fetchImpl })).rejects.toThrow(/no posting credit/);
	});
});

describe("Facebook Pages and Instagram", () => {
	it("signs in with the desktop flow and reads the token from the redirect", () => {
		const url = new URL(metaLoginUrl("1234567", "st"));
		expect(url.searchParams.get("redirect_uri")).toBe(
			"https://www.facebook.com/connect/login_success.html",
		);
		expect(url.searchParams.get("response_type")).toBe("token");
		expect(url.searchParams.get("scope")).toContain("instagram_content_publish");
		const now = 1_000_000;
		expect(
			parseMetaRedirect(
				"https://www.facebook.com/connect/login_success.html#access_token=T&expires_in=3600&state=st",
				"st",
				now,
			),
		).toEqual({ token: "T", expiresAt: now + 3_600_000 });
		expect(() =>
			parseMetaRedirect(
				"https://www.facebook.com/connect/login_success.html#access_token=T&state=evil",
				"st",
			),
		).toThrow();
		expect(() =>
			parseMetaRedirect(
				"https://www.facebook.com/connect/login_success.html?error=access_denied&error_reason=user_denied&state=st",
				"st",
			),
		).toThrow(/cancelled/);
		expect(metaExpired({ token: "T", pageId: "p", expiresAt: now + 60_000 }, now)).toBe(true);
	});
	const credential = { token: "UT", expiresAt: Date.now() + 3_600_000, pageId: "page1" };
	it("uploads the file to the Page and posts it with the Page token", async () => {
		const { calls, fetchImpl } = recorder((url) => {
			if (url.includes("/uploads?")) return json({ id: "upload:abc" });
			if (url.endsWith("/upload:abc")) return json({ h: "handle" });
			if (url.includes("fields=access_token")) return json({ access_token: "PT" });
			return json({ id: "v9" });
		});
		const posted = await postToFacebookPage("1234567", credential, video(), { fetchImpl });
		expect(posted).toEqual({ id: "v9", url: "https://www.facebook.com/watch/?v=v9" });
		expect(calls[0].url).toContain("/1234567/uploads?");
		expect(calls[1].init.headers).toMatchObject({
			Authorization: "OAuth UT",
			file_offset: "0",
		});
		expect(await (calls[1].init.body as Blob).text()).toBe("fake mp4 bytes");
		const post = calls.at(-1) as Call;
		expect(post.url).toBe("https://graph-video.facebook.com/v26.0/page1/videos");
		expect(Object.fromEntries(post.init.body as URLSearchParams)).toEqual({
			access_token: "PT",
			title: "Export a video",
			description: "How to export #tutorial",
			fbuploader_video_file_chunk: "handle",
		});
	});
	it("posts an Instagram Reel from the local file", async () => {
		const { calls, fetchImpl } = recorder((url) => {
			if (url.endsWith("/ig1/media"))
				return json({
					id: "c1",
					uri: "https://rupload.facebook.com/ig-api-upload/v26.0/c1",
				});
			if (url.startsWith("https://rupload")) return json({ success: true });
			if (url.includes("fields=status_code")) return json({ status_code: "FINISHED" });
			if (url.endsWith("/media_publish")) return json({ id: "m1" });
			return json({ permalink: "https://www.instagram.com/reel/abc/" });
		});
		const posted = await postToInstagram("ig1", credential, video(), { fetchImpl, pollMs: 1 });
		expect(posted).toEqual({ id: "m1", url: "https://www.instagram.com/reel/abc/" });
		expect(Object.fromEntries(calls[0].init.body as URLSearchParams)).toMatchObject({
			media_type: "REELS",
			upload_type: "resumable",
			caption: "How to export #tutorial",
		});
		expect(calls[1].init.headers).toMatchObject({
			Authorization: "OAuth UT",
			offset: "0",
			file_size: "14",
		});
	});
	it("explains an expired sign-in", async () => {
		const { fetchImpl } = recorder(() =>
			json({ error: { code: 190, message: "expired" } }, 400),
		);
		await expect(postToInstagram("ig1", credential, video(), { fetchImpl })).rejects.toThrow(
			/expired/,
		);
	});
});
