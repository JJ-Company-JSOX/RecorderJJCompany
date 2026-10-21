import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DirectAccountStore } from "./accounts";
import { idTokenClaims, pkcePair, startLoopback } from "./oauth";
import {
	exchangeYoutubeCode,
	uploadToYoutube,
	youtubeAccessToken,
	youtubeAuthUrl,
	youtubeMetadata,
} from "./youtube";

const dir = mkdtempSync(path.join(tmpdir(), "recordly-direct-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const video = path.join(dir, "export.mp4");
writeFileSync(video, Buffer.from("fake mp4 bytes"));
const client = { id: "123-abc.apps.googleusercontent.com", secret: "desktop-secret" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
const idToken = (claims: object) =>
	`x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

describe("desktop sign-in without a server", () => {
	it("makes a PKCE S256 challenge from the verifier", () => {
		const { verifier, challenge, state } = pkcePair();
		expect(verifier.length).toBeGreaterThanOrEqual(43);
		expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
		expect(state).not.toBe(pkcePair().state);
	});
	it("receives the code on 127.0.0.1 only with the matching state", async () => {
		const loopback = await startLoopback("good-state");
		expect(loopback.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		const page = await fetch(`${loopback.redirectUri}/?state=good-state&code=the-code`);
		expect(await page.text()).toContain("Account connected");
		await expect(loopback.code).resolves.toBe("the-code");

		const forged = await startLoopback("good-state");
		const reply = await fetch(`${forged.redirectUri}/?state=other&code=x`);
		expect(reply.status).toBe(400);
		await expect(forged.code).rejects.toThrow(/Sign-in failed/);
	});
	it("gives up when the user cancels or never finishes", async () => {
		const controller = new AbortController();
		const cancelled = await startLoopback("s", { signal: controller.signal });
		controller.abort();
		await expect(cancelled.code).rejects.toThrow(/cancelled/);
		const slow = await startLoopback("s", { timeoutMs: 10 });
		await expect(slow.code).rejects.toThrow(/timed out/);
	});
	it("reads the account from the ID token", () => {
		expect(idTokenClaims(idToken({ sub: "42", email: "a@b.c" }))).toEqual({
			sub: "42",
			email: "a@b.c",
		});
		expect(idTokenClaims("garbage")).toEqual({});
	});
});

describe("YouTube", () => {
	it("asks Google for upload access with PKCE and a loopback redirect", () => {
		const url = new URL(
			youtubeAuthUrl(client, "http://127.0.0.1:5555", { challenge: "ch", state: "st" }),
		);
		expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			client_id: client.id,
			redirect_uri: "http://127.0.0.1:5555",
			response_type: "code",
			code_challenge: "ch",
			code_challenge_method: "S256",
			state: "st",
			access_type: "offline",
		});
		expect(url.searchParams.get("scope")).toContain(
			"https://www.googleapis.com/auth/youtube.upload",
		);
	});
	it("exchanges the code for the account and a refresh token", async () => {
		const fetchImpl = vi.fn(async () =>
			json({
				access_token: "at",
				refresh_token: "rt",
				scope: "openid https://www.googleapis.com/auth/youtube.upload",
				id_token: idToken({ sub: "g-1", name: "Jsox Studio", email: "j@x.com" }),
			}),
		);
		const result = await exchangeYoutubeCode(
			client,
			"code",
			"verifier",
			"http://127.0.0.1:1",
			fetchImpl,
		);
		expect(result).toEqual({
			account: { id: "g-1", name: "Jsox Studio", email: "j@x.com", picture: undefined },
			refreshToken: "rt",
		});
		const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
			client_id: client.id,
			client_secret: "desktop-secret",
			code: "code",
			code_verifier: "verifier",
			grant_type: "authorization_code",
			redirect_uri: "http://127.0.0.1:1",
		});
	});
	it("refuses a sign-in that did not grant upload access", async () => {
		const fetchImpl = async () =>
			json({
				access_token: "at",
				refresh_token: "rt",
				scope: "openid",
				id_token: idToken({ sub: "1" }),
			});
		await expect(
			exchangeYoutubeCode(client, "c", "v", "http://127.0.0.1:1", fetchImpl),
		).rejects.toThrow(/upload videos/);
		const expired = async () => json({ error: "invalid_grant" }, 400);
		await expect(youtubeAccessToken(client, "rt", expired)).rejects.toThrow(
			/Connect the account again/,
		);
	});
	it("describes the video, with AI disclosure and hashtags as tags", () => {
		expect(
			youtubeMetadata({
				videoPath: video,
				title: "Export a video",
				description: "How to export #tutorial #Recordly #tutorial",
				visibility: "public",
				madeWithAi: true,
			}),
		).toEqual({
			snippet: {
				title: "Export a video",
				description: "How to export #tutorial #Recordly #tutorial",
				categoryId: "27",
				tags: ["tutorial", "Recordly"],
			},
			status: {
				privacyStatus: "public",
				selfDeclaredMadeForKids: false,
				containsSyntheticMedia: true,
			},
		});
		// Scheduled videos stay private until publishAt.
		expect(
			youtubeMetadata({
				videoPath: video,
				title: "t",
				description: "",
				visibility: "public",
				publishAt: "2030-01-01T10:00:00.000Z",
				madeWithAi: false,
			}).status,
		).toMatchObject({ privacyStatus: "private", publishAt: "2030-01-01T10:00:00.000Z" });
	});
	it("uploads with the resumable protocol and returns the video link", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return url.includes("upload_id")
				? json({ id: "VID123" })
				: json({}, 200, {
						Location:
							"https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc",
					});
		});
		const result = await uploadToYoutube(
			"access",
			{
				videoPath: video,
				title: "T",
				description: "",
				visibility: "private",
				madeWithAi: false,
			},
			{ fetchImpl: fetchImpl as unknown as typeof fetch },
		);
		expect(result).toEqual({ id: "VID123", url: "https://youtu.be/VID123" });
		expect(calls[0].url).toContain("uploadType=resumable");
		expect(calls[0].init.headers).toMatchObject({
			Authorization: "Bearer access",
			"X-Upload-Content-Length": "14",
			"X-Upload-Content-Type": "video/mp4",
		});
		expect(calls[1].init.method).toBe("PUT");
		expect(await (calls[1].init.body as Blob).text()).toBe("fake mp4 bytes");
	});
	it("explains YouTube's refusals", async () => {
		const reply = (status: number, reason: string) => async () =>
			json({ error: { message: "x", errors: [{ reason }] } }, status);
		const upload = (fetchImpl: () => Promise<Response>) =>
			uploadToYoutube(
				"a",
				{
					videoPath: video,
					title: "T",
					description: "",
					visibility: "public",
					madeWithAi: false,
				},
				{ fetchImpl: fetchImpl as unknown as typeof fetch },
			);
		await expect(upload(reply(403, "quotaExceeded"))).rejects.toThrow(/daily upload limit/);
		await expect(upload(reply(401, "authError"))).rejects.toThrow(/expired/);
		await expect(upload(reply(401, "youtubeSignupRequired"))).rejects.toThrow(/expired/);
		await expect(upload(reply(403, "youtubeSignupRequired"))).rejects.toThrow(
			/no YouTube channel/,
		);
	});
});

describe("connected accounts", () => {
	const encryption = {
		isEncryptionAvailable: () => true,
		encryptString: (text: string) => Buffer.from(`enc:${text}`),
		decryptString: (data: Buffer) => data.toString().replace(/^enc:/, ""),
	};
	it("keeps refresh tokens encrypted and never lists them", async () => {
		const file = path.join(dir, "accounts.json");
		const store = new DirectAccountStore(file, encryption);
		await store.add({ platform: "youtube", id: "g-1", name: "Jsox Studio" }, "secret-refresh");
		await store.add({ platform: "youtube", id: "g-1", name: "Jsox Studio 2" }, "newer");
		expect(readFileSync(file, "utf8")).not.toContain("secret-refresh");
		expect(await store.list()).toEqual([
			{ platform: "youtube", id: "g-1", name: "Jsox Studio 2" },
		]);
		expect(await store.refreshToken("youtube", "g-1")).toBe("newer");
		await store.remove("youtube", "g-1");
		expect(await store.list()).toEqual([]);
	});
	it("refuses to save a sign-in it cannot encrypt", async () => {
		const store = new DirectAccountStore(path.join(dir, "plain.json"), {
			...encryption,
			isEncryptionAvailable: () => false,
		});
		await expect(store.add({ platform: "youtube", id: "1", name: "n" }, "rt")).rejects.toThrow(
			/securely/,
		);
	});
});
