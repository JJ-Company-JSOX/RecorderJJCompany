import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	bundledClient,
	llamaServerArgs,
	llamaThreads,
	STORY_CONTEXT_TOKENS,
	verifyBundledAi,
} from "./bundled";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) {
		const target = path.resolve(root);
		if (
			path.dirname(target) !== path.resolve(os.tmpdir()) ||
			!path.basename(target).startsWith("jsox-bundled-test-")
		)
			throw Error("Refusing to remove a directory outside the test temporary root");
		await rm(target, { recursive: true, force: true });
	}
});
async function fixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), "jsox-bundled-test-"));
	roots.push(root);
	await mkdir(path.join(root, "runtime-static"));
	const files = [];
	for (const file of ["model.gguf", "vision.gguf", "runtime-static/llama-server.exe"]) {
		const bytes = Buffer.from(`Synthetic integrity-test fixture, never executed: ${file}`);
		await writeFile(path.join(root, file), bytes);
		files.push({
			file,
			size: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
	}
	await writeFile(
		path.join(root, "manifest.json"),
		JSON.stringify({ version: 1, modelName: "fixture", files }),
	);
	return root;
}
it("verifies streamed asset hashes and rejects changed weights of the same size", async () => {
	const root = await fixture();
	await expect(verifyBundledAi(root, new AbortController().signal)).resolves.toBeUndefined();
	const bytes = await readFile(path.join(root, "model.gguf"));
	bytes[0] ^= 1;
	await writeFile(path.join(root, "model.gguf"), bytes);
	await expect(verifyBundledAi(root, new AbortController().signal)).rejects.toThrow("integrity");
});
it("rejects missing assets, manifest path traversal and canceled verification", async () => {
	const root = await fixture();
	const controller = new AbortController();
	controller.abort();
	await expect(verifyBundledAi(root, controller.signal)).rejects.toThrow();
	const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
	manifest.files[0].file = "../outside.gguf";
	await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
	await expect(verifyBundledAi(root, new AbortController().signal)).rejects.toThrow("manifest");
	manifest.files[0].file = "model.gguf";
	await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
	await rm(path.join(root, "vision.gguf"));
	await expect(verifyBundledAi(root, new AbortController().signal)).rejects.toThrow();
});

it("starts llama-server with per-image token bounds, room for two images, and scaled threads", () => {
	const args = llamaServerArgs("/root", 4321, "token", 14);
	const flag = (name: string) => args[args.indexOf(name) + 1];
	expect(flag("--image-min-tokens")).toBe("256");
	expect(flag("--image-max-tokens")).toBe("1024");
	expect(flag("--ctx-size")).toBe("6144");
	expect(flag("--threads")).toBe("7");
	expect(flag("--threads-batch")).toBe("8");
	expect(flag("--host")).toBe("127.0.0.1");
	expect(args).toContain("--offline");
	// Clamped to 2..8 whatever the machine reports.
	expect(llamaThreads(1)).toEqual({ threads: 2, batch: 2 });
	expect(llamaThreads(4)).toEqual({ threads: 2, batch: 3 });
	expect(llamaThreads(8)).toEqual({ threads: 4, batch: 6 });
	expect(llamaThreads(64)).toEqual({ threads: 8, batch: 8 });
});

it("gives a story session a larger context without changing the default", () => {
	const story = llamaServerArgs("/root", 4321, "token", 14, STORY_CONTEXT_TOKENS);
	expect(story[story.indexOf("--ctx-size") + 1]).toBe("8192");
	const normal = llamaServerArgs("/root", 4321, "token", 14);
	expect(normal[normal.indexOf("--ctx-size") + 1]).toBe("6144");
});

/** A stand-in llama-server: records each request and answers with a fixed JSON reply. */
async function fakeServer(reply: string) {
	const requests: { url?: string; auth?: string; body: Record<string, unknown> }[] = [];
	const server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			requests.push({
				url: req.url,
				auth: req.headers.authorization,
				body: JSON.parse(body),
			});
			res.setHeader("Content-Type", "application/json");
			res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		requests,
		port: (server.address() as AddressInfo).port,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);

it("sends BEFORE and AFTER as two labelled images in one chat message with the reply schema", async () => {
	const server = await fakeServer('{"clicked":"Save"}');
	try {
		const client = bundledClient(server.port, "secret", new AbortController().signal);
		const schema = { type: "object", properties: { clicked: { enum: ["Save", "none"] } } };
		const reply = await client.look(
			[png, jpeg],
			"instruction",
			"Click point: (1, 2).",
			schema,
			{
				labels: ["Image 1 (BEFORE the click):", "Image 2 (AFTER the click):"],
				maxTokens: 160,
			},
		);
		expect(reply).toBe('{"clicked":"Save"}');
		const [request] = server.requests;
		expect(request.url).toBe("/v1/chat/completions");
		expect(request.auth).toBe("Bearer secret");
		expect(request.body).toEqual({
			temperature: 0,
			max_tokens: 160,
			response_format: { type: "json_object", schema },
			messages: [
				{ role: "system", content: "instruction" },
				{
					role: "user",
					content: [
						{ type: "text", text: "Image 1 (BEFORE the click):" },
						{
							type: "image_url",
							image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
						},
						{ type: "text", text: "Image 2 (AFTER the click):" },
						{
							type: "image_url",
							image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` },
						},
						{ type: "text", text: "Click point: (1, 2)." },
					],
				},
			],
		});
		await expect(client.look([], "i", "q", {})).rejects.toThrow("one to four images");
	} finally {
		await server.close();
	}
});

it("asks auto edit for integer 0-1000 focus and a caption only, with a short reply budget", async () => {
	const server = await fakeServer('{"focus":null,"caption":""}');
	try {
		const client = bundledClient(server.port, "secret", new AbortController().signal);
		await client.describe(png, "Suggest a zoom.", "Analyze this sample at 1.000 seconds.");
		const { body } = server.requests[0];
		expect(body.max_tokens).toBe(80);
		const schema = (body.response_format as { schema: Record<string, unknown> }).schema;
		expect(schema.required).toEqual(["focus", "caption"]);
		expect(JSON.stringify(schema)).not.toContain("rationale");
		expect(schema).toMatchObject({
			properties: {
				focus: {
					anyOf: [
						{ type: "null" },
						{
							properties: {
								x: { type: "integer", minimum: 0, maximum: 1000 },
								y: { type: "integer", minimum: 0, maximum: 1000 },
							},
						},
					],
				},
			},
		});
		const messages = body.messages as { content: unknown }[];
		expect(messages[0].content).not.toContain("rationale");
		expect((messages[1].content as object[]).length).toBe(2);
	} finally {
		await server.close();
	}
});

it("writes a story with the slot schema, the given reply budget and a little sampling freedom", async () => {
	const reply = '{"story-1":{"stage":"Hook","title":"Offline","text":"Edit offline."}}';
	const server = await fakeServer(reply);
	try {
		const client = bundledClient(server.port, "secret", new AbortController().signal);
		const schema = { type: "object", required: ["story-1"] };
		expect(await client.compose("story rules", '{"brief":{}}', schema, 1200)).toBe(reply);
		expect(server.requests[0].body).toEqual({
			temperature: 0.4,
			max_tokens: 1200,
			response_format: { type: "json_object", schema },
			messages: [
				{ role: "system", content: "story rules" },
				{ role: "user", content: '{"brief":{}}' },
			],
		});
		await expect(client.compose("x".repeat(24_001), "", schema, 768)).rejects.toThrow(
			"too large",
		);
	} finally {
		await server.close();
	}
});
