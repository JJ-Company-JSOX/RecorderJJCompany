import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";

export const BUNDLED_OLLAMA_MODEL = "qwen3:1.7b";
const MODEL_MANIFEST = "models/manifests/registry.ollama.ai/library/qwen3/1.7b";
const REINSTALL = "Bundled local AI is missing or corrupt. Reinstall the complete offline edition.";
type Asset = { file: string; size: number; sha256: string };
type Manifest = { version: number; modelName: string; runtimeVersion: string; files: Asset[] };
export type BundledOllamaConfig = {
	root: string;
	workDir: string;
	enabled: boolean;
	/** The complete offline edition must never silently depend on a separate installation. */
	required: boolean;
};
type Session = { port: number; child: ChildProcess; dead: boolean };
type Dependencies = {
	launch: typeof spawn;
	port: () => Promise<number>;
	probe: (port: number, signal: AbortSignal) => Promise<boolean>;
	startupTimeoutMs: number;
	idleTimeoutMs: number;
	platform: NodeJS.Platform;
};

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}
async function pause(ms: number, signal: AbortSignal) {
	signal.throwIfAborted();
	await new Promise<void>((resolve, reject) => {
		const abort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, ms);
		signal.addEventListener("abort", abort, { once: true });
	});
}
async function freePort(): Promise<number> {
	const server = net.createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const port = (server.address() as net.AddressInfo).port;
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return port;
}
function ready(port: number, signal: AbortSignal): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: "127.0.0.1", port, path: "/api/tags", method: "GET", signal },
			(res) => {
				if (res.statusCode !== 200) {
					res.resume();
					resolve(false);
					return;
				}
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					text += chunk;
					if (text.length > 100_000) req.destroy(Error("Invalid local AI metadata"));
				});
				res.on("error", reject);
				res.on("end", () => {
					try {
						const parsed = JSON.parse(text) as { models?: { name?: string }[] };
						resolve(
							Array.isArray(parsed.models) &&
								parsed.models.some((model) => model.name === BUNDLED_OLLAMA_MODEL),
						);
					} catch {
						resolve(false);
					}
				});
			},
		);
		const timeout = setTimeout(() => req.destroy(Error("Local AI not ready")), 750);
		req.on("close", () => clearTimeout(timeout));
		req.on("error", reject);
		req.end();
	});
}
function validRelative(file: string) {
	return (
		file.length < 512 &&
		!file.includes("\\") &&
		!file.split("/").some((part) => !part || part === "." || part === "..") &&
		/^(?:runtime\/[a-zA-Z0-9_./-]+|models\/blobs\/sha256-[a-f0-9]{64}|models\/manifests\/registry\.ollama\.ai\/library\/qwen3\/1\.7b|(?:licenses\/)?[a-zA-Z0-9_.-]+\.(?:txt|md))$/.test(
			file,
		)
	);
}
/** Reject path traversal, junction/symlink escapes, stale extra DLLs and mismatching model blobs. */
async function verifyBundle(root: string, signal?: AbortSignal): Promise<Manifest> {
	signal?.throwIfAborted();
	const manifestPath = path.join(root, "manifest.json");
	if ((await stat(manifestPath)).size > 1_000_000) throw Error(REINSTALL);
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
	if (
		manifest.version !== 1 ||
		manifest.modelName !== BUNDLED_OLLAMA_MODEL ||
		typeof manifest.runtimeVersion !== "string" ||
		!manifest.runtimeVersion ||
		!Array.isArray(manifest.files) ||
		manifest.files.length < 4 ||
		manifest.files.length > 4096 ||
		!["runtime/ollama.exe", MODEL_MANIFEST].every((name) =>
			manifest.files.some((entry) => entry.file === name),
		) ||
		!manifest.files.some((entry) => entry.file.startsWith("models/blobs/sha256-")) ||
		!manifest.files.some((entry) => /license/i.test(entry.file))
	)
		throw Error(REINSTALL);
	const names = new Set<string>();
	const canonicalRoot = await realpath(root);
	for (const asset of manifest.files) {
		signal?.throwIfAborted();
		if (
			!asset ||
			typeof asset.file !== "string" ||
			!validRelative(asset.file) ||
			names.has(asset.file.toLowerCase()) ||
			!Number.isSafeInteger(asset.size) ||
			asset.size <= 0 ||
			!/^[a-f0-9]{64}$/.test(asset.sha256)
		)
			throw Error(REINSTALL);
		names.add(asset.file.toLowerCase());
		const filename = path.join(root, asset.file);
		const canonical = await realpath(filename);
		const relative = path.relative(canonicalRoot, canonical);
		if (relative.startsWith("..") || path.isAbsolute(relative)) throw Error(REINSTALL);
		const info = await lstat(filename);
		if (!info.isFile() || info.isSymbolicLink() || info.size !== asset.size)
			throw Error(REINSTALL);
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(filename, { signal })) hash.update(chunk);
		if (hash.digest("hex") !== asset.sha256) throw Error(REINSTALL);
		if (
			asset.file.startsWith("models/blobs/sha256-") &&
			asset.file.slice("models/blobs/sha256-".length) !== asset.sha256
		)
			throw Error(REINSTALL);
	}
	const registry = JSON.parse(await readFile(path.join(root, MODEL_MANIFEST), "utf8")) as {
		schemaVersion?: number;
		config?: { digest?: string; size?: number };
		layers?: { digest?: string; size?: number; mediaType?: string }[];
	};
	if (
		registry.schemaVersion !== 2 ||
		!registry.config ||
		!Array.isArray(registry.layers) ||
		registry.layers.length > 32 ||
		!registry.layers.some((layer) => layer.mediaType === "application/vnd.ollama.image.model")
	)
		throw Error(REINSTALL);
	for (const descriptor of [registry.config, ...registry.layers]) {
		if (
			!descriptor ||
			typeof descriptor.digest !== "string" ||
			!/^sha256:[a-f0-9]{64}$/.test(descriptor.digest) ||
			!Number.isSafeInteger(descriptor.size)
		)
			throw Error(REINSTALL);
		const descriptorDigest = descriptor.digest;
		if (
			!manifest.files.some(
				(asset) =>
					asset.file === `models/blobs/${descriptorDigest.replace(":", "-")}` &&
					asset.size === descriptor.size &&
					asset.sha256 === descriptorDigest.slice(7),
			)
		)
			throw Error(REINSTALL);
	}
	let count = 0;
	const visit = async (directory: string, prefix = "") => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			signal?.throwIfAborted();
			const name = `${prefix}${entry.name}`;
			if (++count > 8192 || entry.isSymbolicLink()) throw Error(REINSTALL);
			if (entry.isDirectory()) await visit(path.join(directory, entry.name), `${name}/`);
			else if (name !== "manifest.json" && !names.has(name.toLowerCase()))
				throw Error(REINSTALL);
		}
	};
	await visit(root);
	return manifest;
}

export async function verifyBundledOllama(root: string, signal?: AbortSignal): Promise<Manifest> {
	try {
		return await verifyBundle(root, signal);
	} catch (error) {
		signal?.throwIfAborted();
		throw Object.assign(Error(REINSTALL), { cause: error });
	}
}

/** Owns only this application's process and isolated model directory, never a user Ollama service. */
export class BundledOllamaManager {
	private readonly deps: Dependencies;
	private session: Session | null = null;
	private starting: Promise<Session> | null = null;
	private startup: AbortController | null = null;
	private idle: ReturnType<typeof setTimeout> | null = null;
	private users = 0;
	private disposed = false;
	constructor(
		private readonly config: BundledOllamaConfig,
		dependencies: Partial<Dependencies> = {},
	) {
		this.deps = {
			launch: spawn,
			port: freePort,
			probe: ready,
			startupTimeoutMs: 20_000,
			idleTimeoutMs: 60_000,
			platform: process.platform,
			...dependencies,
		};
	}
	async acquire(model: string | undefined, signal?: AbortSignal) {
		signal?.throwIfAborted();
		if (model !== BUNDLED_OLLAMA_MODEL) return null;
		if (!this.config.enabled) {
			if (this.config.required) throw Error("This offline AI edition requires Windows x64.");
			return null;
		}
		if (this.disposed) throw Error("Local AI is shutting down");
		if (!(await stat(path.join(this.config.root, "manifest.json")).catch(() => null))) {
			if (this.config.required) throw Error(REINSTALL);
			return null;
		}
		signal?.throwIfAborted();
		this.users++;
		if (this.idle) clearTimeout(this.idle);
		this.idle = null;
		try {
			const session = await abortable(this.ensureStarted(), signal);
			signal?.throwIfAborted();
			let released = false;
			return {
				port: session.port,
				release: () => {
					if (released) return;
					released = true;
					this.release();
				},
			};
		} catch (error) {
			this.release();
			throw error;
		}
	}
	private release() {
		this.users = Math.max(0, this.users - 1);
		if (this.users || this.disposed) return;
		if (this.starting) this.startup?.abort();
		else {
			this.idle = setTimeout(() => this.stopSession(), this.deps.idleTimeoutMs);
			this.idle.unref?.();
		}
	}
	private ensureStarted(): Promise<Session> {
		if (this.session && !this.session.dead) return Promise.resolve(this.session);
		if (this.starting) return this.starting;
		const controller = new AbortController();
		this.startup = controller;
		this.starting = this.start(controller.signal).finally(() => {
			this.starting = null;
			this.startup = null;
		});
		void this.starting.catch(() => undefined);
		return this.starting;
	}
	private async start(signal: AbortSignal): Promise<Session> {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			// Hash once per private-server lifetime, not on every metadata/chat request.
			// Slow-disk verification is cancelable and is separate from server startup timeout.
			await verifyBundledOllama(this.config.root, signal);
			signal.throwIfAborted();
			timeout = setTimeout(
				() => this.startup?.abort(Error("Bundled Ollama startup timed out")),
				this.deps.startupTimeoutMs,
			);
			await mkdir(this.config.workDir, { recursive: true });
			const port = await this.deps.port();
			signal.throwIfAborted();
			const env = { ...process.env };
			for (const key of Object.keys(env))
				if (key.toUpperCase().startsWith("OLLAMA_")) delete env[key];
			Object.assign(env, {
				OLLAMA_HOST: `127.0.0.1:${port}`,
				OLLAMA_MODELS: path.join(this.config.root, "models"),
				OLLAMA_NO_CLOUD: "1",
				OLLAMA_NUM_PARALLEL: "1",
				OLLAMA_MAX_LOADED_MODELS: "1",
				OLLAMA_KEEP_ALIVE: "0",
				OLLAMA_NOPRUNE: "1",
				// Go's Windows user-home lookup uses USERPROFILE. Keep its generated key out of ~/.ollama.
				...(this.deps.platform === "win32" ? { USERPROFILE: this.config.workDir } : {}),
			});
			const child = this.deps.launch(
				path.join(this.config.root, "runtime", "ollama.exe"),
				["serve"],
				{
					cwd: this.config.workDir,
					env,
					shell: false,
					windowsHide: true,
					stdio: ["ignore", "ignore", "pipe"],
				},
			);
			const session = { port, child, dead: false };
			this.session = session;
			child.stderr?.on("data", () => undefined);
			child.once("error", () => {
				session.dead = true;
			});
			child.once("exit", () => {
				session.dead = true;
				if (this.session === session) this.session = null;
			});
			while (true) {
				signal.throwIfAborted();
				if (session.dead) throw Error("Bundled Ollama exited before it became ready");
				try {
					if (await this.deps.probe(port, signal)) {
						signal.throwIfAborted();
						if (session.dead) throw Error("Bundled Ollama stopped");
						return session;
					}
				} catch {
					signal.throwIfAborted();
				}
				await pause(100, signal);
			}
		} catch (error) {
			this.stopSession();
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	}
	private stopSession() {
		if (this.idle) clearTimeout(this.idle);
		this.idle = null;
		const session = this.session;
		this.session = null;
		if (!session || session.dead) return;
		session.dead = true;
		if (this.deps.platform === "win32" && session.child.pid) {
			const killer = this.deps.launch(
				path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
				["/PID", String(session.child.pid), "/T", "/F"],
				{ shell: false, windowsHide: true, stdio: "ignore" },
			);
			killer.once("error", () => session.child.kill());
			killer.unref();
		} else session.child.kill();
	}
	stop() {
		this.disposed = true;
		this.startup?.abort();
		this.stopSession();
	}
}

let manager: BundledOllamaManager | null = null;
export function configureBundledOllama(config: BundledOllamaConfig) {
	manager?.stop();
	manager = new BundledOllamaManager(config);
}
export function stopBundledOllama() {
	manager?.stop();
}
export function acquireBundledOllama(model: string | undefined, signal?: AbortSignal) {
	return manager?.acquire(model, signal) ?? Promise.resolve(null);
}
