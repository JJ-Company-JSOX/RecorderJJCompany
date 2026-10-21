import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { SocialConfigStore } from "./config";
import {
	checkVideoFile,
	createPostBody,
	normalizeBaseUrl,
	PostizClient,
	platformSettings,
	publishProblems,
	type PublishRequest,
} from "./postiz";

const dir = mkdtempSync(path.join(tmpdir(), "recordly-social-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const video = path.join(dir, "export.mp4");
writeFileSync(video, Buffer.from("fake mp4 bytes"));

const request = (overrides: Partial<PublishRequest> = {}): PublishRequest => ({
	videoPath: video,
	channels: [
		{ id: "yt-1", identifier: "youtube" },
		{ id: "tt-1", identifier: "tiktok" },
	],
	text: "How to export a video #tutorial",
	title: "Export a video",
	visibility: "public",
	when: "now",
	madeWithAi: true,
	...overrides,
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Postiz address", () => {
	it("accepts Postiz Cloud and self-hosted servers", () => {
		expect(normalizeBaseUrl("https://api.postiz.com/public/v1/")).toBe(
			"https://api.postiz.com/public/v1",
		);
		expect(normalizeBaseUrl("https://api.postiz.com")).toBe("https://api.postiz.com/public/v1");
		expect(normalizeBaseUrl(" https://postiz.example.com ")).toBe(
			"https://postiz.example.com/api/public/v1",
		);
		expect(normalizeBaseUrl("http://192.168.1.5:5000/api/public/v1")).toBe(
			"http://192.168.1.5:5000/api/public/v1",
		);
	});
	it("rejects other schemes, logins and queries", () => {
		expect(() => normalizeBaseUrl("file:///etc/passwd")).toThrow();
		expect(() => normalizeBaseUrl("https://user:pw@postiz.example.com")).toThrow();
		expect(() => normalizeBaseUrl("https://postiz.example.com/?x=1")).toThrow();
		expect(() => normalizeBaseUrl("not a url")).toThrow();
	});
});

describe("post settings per platform", () => {
	it("follows each provider's documented schema", () => {
		const options = {
			title: "Export a video",
			visibility: "private" as const,
			madeWithAi: true,
		};
		expect(platformSettings("youtube", options)).toEqual({
			__type: "youtube",
			title: "Export a video",
			type: "private",
			selfDeclaredMadeForKids: "no",
			tags: [],
		});
		expect(platformSettings("tiktok", options)).toMatchObject({
			__type: "tiktok",
			privacy_level: "SELF_ONLY",
			content_posting_method: "DIRECT_POST",
			video_made_with_ai: true,
		});
		expect(platformSettings("instagram", options)).toEqual({
			__type: "instagram",
			post_type: "post",
		});
		expect(platformSettings("x", options)).toMatchObject({
			__type: "x",
			who_can_reply_post: "everyone",
		});
		expect(platformSettings("threads", options)).toEqual({ __type: "threads" });
		expect(
			(platformSettings("tiktok", { ...options, title: "t".repeat(200) }).title as string)
				.length,
		).toBe(90);
	});
	it("builds one post per account with the uploaded video", () => {
		const body = createPostBody(request(), { id: "m1", path: "https://uploads/v.mp4" });
		expect(body.type).toBe("now");
		expect(body.posts).toHaveLength(2);
		expect(body.posts[0]).toMatchObject({
			integration: { id: "yt-1" },
			value: [
				{
					content: "How to export a video #tutorial",
					image: [{ id: "m1", path: "https://uploads/v.mp4" }],
				},
			],
			settings: { __type: "youtube" },
		});
	});
	it("explains what to fix before anything is uploaded", () => {
		expect(publishProblems(request())).toEqual([]);
		expect(publishProblems(request({ channels: [] }))).toHaveLength(1);
		expect(publishProblems(request({ title: "" }))[0]).toMatch(/YouTube/);
		expect(
			publishProblems(
				request({ channels: [{ id: "x", identifier: "x" }], text: "a".repeat(281) }),
			)[0],
		).toMatch(/280/);
		expect(
			publishProblems(request({ when: "schedule", date: "2000-01-01T00:00:00Z" })),
		).toHaveLength(1);
	});
});

describe("Postiz client", () => {
	it("sends the API key, lists accounts and keeps only well-formed ones", async () => {
		const fetch = vi.fn(async () =>
			json([
				{
					id: "a",
					name: "My Channel",
					identifier: "youtube",
					picture: "https://p",
					disabled: false,
				},
				{ broken: true },
			]),
		);
		const client = new PostizClient("https://api.postiz.com/public/v1", "secret", fetch);
		expect(await client.channels()).toEqual([
			{
				id: "a",
				name: "My Channel",
				identifier: "youtube",
				picture: "https://p",
				profile: undefined,
				disabled: false,
			},
		]);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://api.postiz.com/public/v1/integrations");
		expect((init.headers as Record<string, string>).Authorization).toBe("secret");
	});
	it("uploads the MP4 as multipart, waits for Postiz to adjust it, then posts", async () => {
		const calls: string[] = [];
		let uploaded: FormData | undefined;
		let polls = 0;
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			calls.push(
				`${init?.method ?? "GET"} ${url.replace("https://p.test/api/public/v1", "")}`,
			);
			if (url.endsWith("/upload")) {
				uploaded = init?.body as FormData;
				return json({ id: "m1", path: "https://p.test/v.mp4", status: "processing" });
			}
			if (url.endsWith("/status"))
				return json({ id: "m1", status: ++polls < 2 ? "processing" : "ready" });
			return json([{ postId: "p1", integration: "yt-1" }]);
		});
		const client = new PostizClient("https://p.test/api/public/v1", "k", fetch);
		const media = await client.upload(video);
		expect(media).toEqual({ id: "m1", path: "https://p.test/v.mp4", ready: false });
		const file = uploaded?.get("file") as File;
		expect(file.name).toBe("export.mp4");
		expect(file.type).toBe("video/mp4");
		expect(await file.text()).toBe("fake mp4 bytes");
		expect(uploaded?.get("adjust")).toBe("true");
		await client.waitUntilReady("m1", undefined, { intervalMs: 1 });
		const posts = await client.createPost(createPostBody(request(), media));
		expect(posts).toEqual([{ postId: "p1", integration: "yt-1" }]);
		expect(calls).toEqual([
			"POST /upload",
			"GET /media/m1/status",
			"GET /media/m1/status",
			"POST /posts",
		]);
	});
	it("turns Postiz errors into plain explanations", async () => {
		const client = (response: Response) =>
			new PostizClient("https://p.test/api/public/v1", "k", async () => response);
		await expect(client(json({ message: "Unauthorized" }, 401)).isConnected()).rejects.toThrow(
			/API key/,
		);
		await expect(
			client(json({ message: ["title too short"] }, 400)).channels(),
		).rejects.toThrow("title too short");
		await expect(client(new Response("", { status: 429 })).channels()).rejects.toThrow(
			/hourly posting limit/,
		);
		const offline = new PostizClient("https://p.test/api/public/v1", "k", async () => {
			throw new TypeError("fetch failed");
		});
		await expect(offline.channels()).rejects.toThrow(/Could not reach Postiz/);
	});
	it("only opens https sign-in pages for linking an account", async () => {
		const reply = (url: string) =>
			new PostizClient("https://p.test/api/public/v1", "k", async () => json({ url }));
		expect(
			await reply("https://www.tiktok.com/v2/auth/authorize?x=1").connectUrl("tiktok"),
		).toBe("https://www.tiktok.com/v2/auth/authorize?x=1");
		await expect(reply("javascript:alert(1)").connectUrl("tiktok")).rejects.toThrow();
	});
	it("only uploads an existing MP4 file", async () => {
		await expect(checkVideoFile(video)).resolves.toEqual({ path: video, bytes: 14 });
		await expect(checkVideoFile("relative.mp4")).rejects.toThrow();
		await expect(checkVideoFile(path.join(dir, "notes.txt"))).rejects.toThrow();
		await expect(checkVideoFile(path.join(dir, "missing.mp4"))).rejects.toThrow();
	});
});

describe("saved Postiz connection", () => {
	const encryption = {
		isEncryptionAvailable: () => true,
		encryptString: (text: string) => Buffer.from(`enc:${text}`),
		decryptString: (data: Buffer) => data.toString().replace(/^enc:/, ""),
	};
	it("stores the API key only encrypted, and never shows it to the page", async () => {
		const file = path.join(dir, "social.json");
		const store = new SocialConfigStore(file, encryption);
		expect(await store.summary()).toEqual({ baseUrl: null, hasKey: false });
		await store.save("https://api.postiz.com/public/v1", "secret-key");
		expect(readFileSync(file, "utf8")).not.toContain("secret-key");
		expect(await store.summary()).toEqual({
			baseUrl: "https://api.postiz.com/public/v1",
			hasKey: true,
		});
		expect(await store.credentials()).toEqual({
			baseUrl: "https://api.postiz.com/public/v1",
			apiKey: "secret-key",
		});
		await store.clear();
		expect(await store.credentials()).toBeNull();
	});
	it("refuses to save the key when the computer cannot encrypt it", async () => {
		const store = new SocialConfigStore(path.join(dir, "plain.json"), {
			...encryption,
			isEncryptionAvailable: () => false,
		});
		await expect(store.save("https://p.test/api/public/v1", "k")).rejects.toThrow(/securely/);
	});
});
