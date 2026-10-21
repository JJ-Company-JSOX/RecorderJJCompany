import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { BundledAiStatus } from "../../../src/components/video-editor/auto-edit/bundledTypes";

const requiredMemoryBytes = 2.5 * 1024 ** 3;
type Manifest = {
	version: number;
	modelName: string;
	files: { file: string; size: number; sha256: string }[];
};

async function manifestAt(root: string): Promise<Manifest> {
	const file = path.join(root, "manifest.json");
	if ((await stat(file)).size > 64_000) throw Error("Invalid offline AI manifest");
	const manifest = JSON.parse(await readFile(file, "utf8")) as Manifest;
	if (
		manifest.version !== 1 ||
		typeof manifest.modelName !== "string" ||
		!Array.isArray(manifest.files) ||
		manifest.files.length > 128 ||
		!manifest.files.some((f) => f.file === "runtime-static/llama-server.exe") ||
		!["model.gguf", "vision.gguf"].every((name) => manifest.files.some((f) => f.file === name))
	)
		throw Error("Invalid offline AI manifest");
	const canonicalRoot = await realpath(root);
	for (const entry of manifest.files) {
		if (
			!/^(?:runtime-static\/[a-zA-Z0-9_.-]+|model\.gguf|vision\.gguf|MODEL-LICENSE\.txt|NOTICE\.txt)$/.test(
				entry.file,
			) ||
			!Number.isSafeInteger(entry.size) ||
			entry.size <= 0 ||
			!/^[a-f0-9]{64}$/.test(entry.sha256)
		)
			throw Error("Invalid offline AI asset");
		const file = await realpath(path.join(root, entry.file));
		const relative = path.relative(canonicalRoot, file);
		if (
			relative.startsWith("..") ||
			path.isAbsolute(relative) ||
			(await stat(file)).size !== entry.size
		)
			throw Error(
				"Offline AI assets are missing or corrupt; reinstall the complete application",
			);
	}
	return manifest;
}

export async function bundledAiStatus(root: string): Promise<BundledAiStatus> {
	const base = {
		modelName: "Qwen3-VL-2B-Instruct",
		modelBytes: 0,
		freeMemoryBytes: os.freemem(),
		requiredMemoryBytes,
	};
	if (process.platform !== "win32" || process.arch !== "x64")
		return { ...base, available: false, reason: "unsupported" };
	try {
		const manifest = await manifestAt(root);
		return {
			...base,
			available: true,
			modelName: manifest.modelName,
			modelBytes: manifest.files
				.filter((f) => f.file.endsWith(".gguf"))
				.reduce((sum, f) => sum + f.size, 0),
		};
	} catch {
		return { ...base, available: false, reason: "missing" };
	}
}

// No HTTP listener, model load, hash scan or background process exists until the user starts AI.
export async function verifyBundledAi(root: string, signal: AbortSignal): Promise<void> {
	const manifest = await manifestAt(root);
	for (const entry of manifest.files) {
		signal.throwIfAborted();
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(path.join(root, entry.file), { signal }))
			hash.update(chunk);
		if (hash.digest("hex") !== entry.sha256)
			throw Error("Offline AI integrity check failed; reinstall the complete application");
	}
}

function request(
	port: number,
	token: string,
	route: string,
	body: object | null,
	signal: AbortSignal,
	timeout = 180_000,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const payload = body ? JSON.stringify(body) : "";
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				path: route,
				method: body ? "POST" : "GET",
				signal,
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload),
				},
			},
			(res) => {
				if (res.statusCode !== 200) {
					res.resume();
					reject(Error("Offline AI is not ready"));
					return;
				}
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					text += chunk;
					if (text.length > 1_000_000)
						req.destroy(Error("Offline AI response too large"));
				});
				res.on("error", reject);
				res.on("end", () => {
					try {
						resolve(JSON.parse(text));
					} catch {
						reject(Error("Invalid offline AI response"));
					}
				});
			},
		);
		const timer = setTimeout(() => req.destroy(Error("Offline AI request timed out")), timeout);
		req.on("close", () => clearTimeout(timer));
		req.on("error", reject);
		req.end(payload);
	});
}

async function freePort(): Promise<number> {
	const server = net.createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address() as net.AddressInfo;
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

const children = new Set<ChildProcess>();
export function stopBundledAi(): void {
	for (const child of children) child.kill();
}

async function createBundledSession(root: string, signal: AbortSignal) {
	signal.throwIfAborted();
	if (os.freemem() < requiredMemoryBytes)
		throw Error(
			"Offline AI needs at least 2.5 GiB of available memory. Close other applications and try again.",
		);
	await verifyBundledAi(root, signal);
	const port = await freePort(),
		token = randomBytes(32).toString("hex");
	signal.throwIfAborted();
	const child = spawn(
		path.join(root, "runtime-static/llama-server.exe"),
		[
			"--model",
			path.join(root, "model.gguf"),
			"--mmproj",
			path.join(root, "vision.gguf"),
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
			"--api-key",
			token,
			"--ctx-size",
			"4096",
			"--threads",
			"4",
			"--threads-batch",
			"4",
			"--parallel",
			"1",
			"--batch-size",
			"128",
			"--ubatch-size",
			"64",
			"--n-gpu-layers",
			"0",
			"--no-mmproj-offload",
			"--no-warmup",
			"--offline",
			"--no-webui",
			"--log-disable",
		],
		{
			windowsHide: true,
			cwd: path.join(root, "runtime-static"),
			stdio: "ignore",
			env: { ...process.env, HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1" },
		},
	);
	children.add(child);
	let failed = false;
	const closed = new Promise<void>((resolve) => {
		child.once("error", () => {
			failed = true;
			children.delete(child);
			resolve();
		});
		child.once("exit", () => {
			children.delete(child);
			resolve();
		});
	});
	const abort = () => child.kill();
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	const close = async () => {
		signal.removeEventListener("abort", abort);
		child.kill();
		await closed;
	};
	try {
		const deadline = Date.now() + 180_000;
		while (true) {
			signal.throwIfAborted();
			if (failed || child.exitCode !== null || child.signalCode !== null)
				throw Error("The bundled offline AI could not start");
			try {
				await request(port, token, "/health", null, signal, 1000);
				break;
			} catch {
				signal.throwIfAborted();
			}
			if (Date.now() >= deadline) throw Error("Offline AI startup timed out");
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		/** Asks the vision model one question about one JPEG, with a JSON-schema reply. */
		const look = async (
			image: Buffer,
			instruction: string,
			question: string,
			schema: object,
		): Promise<string> => {
			const raw = (await request(
				port,
				token,
				"/v1/chat/completions",
				{
					temperature: 0,
					max_tokens: 256,
					response_format: { type: "json_object", schema },
					messages: [
						{ role: "system", content: instruction },
						{
							role: "user",
							content: [
								{ type: "text", text: question },
								{
									type: "image_url",
									image_url: {
										url: `data:image/jpeg;base64,${image.toString("base64")}`,
									},
								},
							],
						},
					],
				},
				signal,
			)) as { choices?: { message?: { content?: string } }[] };
			const content = raw.choices?.[0]?.message?.content;
			if (typeof content !== "string") throw Error("Missing offline AI reply");
			return content;
		};
		return {
			pid: child.pid,
			close,
			async complete(
				instruction: string,
				question: string,
				schema: object,
				maxTokens = 768,
			): Promise<string> {
				if (instruction.length + question.length > 12_000)
					throw Error("Speech analysis window is too large");
				const raw = (await request(
					port,
					token,
					"/v1/chat/completions",
					{
						temperature: 0,
						max_tokens: maxTokens,
						response_format: { type: "json_object", schema },
						messages: [
							{ role: "system", content: instruction },
							{ role: "user", content: question },
						],
					},
					signal,
					300_000,
				)) as { choices?: { message?: { content?: string } }[] };
				const content = raw.choices?.[0]?.message?.content;
				if (typeof content !== "string")
					throw Error("Missing offline speech analysis reply");
				return content;
			},
			describe(image: Buffer, instruction: string, question: string): Promise<string> {
				return look(
					image,
					`${instruction} Caption must be ONE exact short contiguous phrase visible in the image (one to four words, at most 40 characters), or empty if uncertain. Copy a label, never describe the scene. For a button labelled Save, caption is "Save", never "a Save button". Keep rationale brief.`,
					question,
					{
						type: "object",
						additionalProperties: false,
						properties: {
							focus: {
								anyOf: [
									{ type: "null" },
									{
										type: "object",
										additionalProperties: false,
										properties: {
											cx: { type: "number", minimum: 0, maximum: 1 },
											cy: { type: "number", minimum: 0, maximum: 1 },
										},
										required: ["cx", "cy"],
									},
								],
							},
							caption: { type: "string", maxLength: 40 },
							rationale: { type: "string", maxLength: 80 },
						},
						required: ["focus", "caption", "rationale"],
					},
				);
			},
			look,
		};
	} catch (error) {
		await close();
		throw error;
	}
}

let active = false;
export async function startBundledAi(root: string, signal: AbortSignal) {
	if (active) throw Error("Offline AI is already analyzing another recording");
	active = true;
	try {
		const session = await createBundledSession(root, signal);
		let closed = false;
		return {
			...session,
			close: async () => {
				if (closed) return;
				closed = true;
				try {
					await session.close();
				} finally {
					active = false;
				}
			},
		};
	} catch (error) {
		active = false;
		throw error;
	}
}
