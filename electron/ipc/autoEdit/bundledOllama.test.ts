import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
	chmod,
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BundledOllamaManager, verifyBundledOllama } from "./bundledOllama";

const roots: string[] = [];
const managers: BundledOllamaManager[] = [];
const digest = (data: string) => createHash("sha256").update(data).digest("hex");
async function fixture() {
	const directory = await mkdtemp(path.join(os.tmpdir(), "recordly-ollama-unit-"));
	roots.push(directory);
	const root = path.join(directory, "offline-ollama");
	const blob = "Small synthetic model fixture, never executed";
	const registry = JSON.stringify({
		schemaVersion: 2,
		config: { digest: `sha256:${digest(blob)}`, size: Buffer.byteLength(blob) },
		layers: [
			{
				mediaType: "application/vnd.ollama.image.model",
				digest: `sha256:${digest(blob)}`,
				size: Buffer.byteLength(blob),
			},
		],
	});
	const content = {
		"runtime/ollama.exe": "Synthetic executable fixture, process launch is mocked",
		"models/manifests/registry.ollama.ai/library/qwen3/1.7b": registry,
		[`models/blobs/sha256-${digest(blob)}`]: blob,
		"OLLAMA-LICENSE.txt": "MIT synthetic fixture",
	};
	for (const [name, value] of Object.entries(content)) {
		await mkdir(path.dirname(path.join(root, name)), { recursive: true });
		await writeFile(path.join(root, name), value);
	}
	const manifest = {
		version: 1,
		modelName: "qwen3:1.7b",
		runtimeVersion: "unit-fixture",
		files: Object.entries(content).map(([file, value]) => ({
			file,
			size: Buffer.byteLength(value),
			sha256: digest(value),
		})),
	};
	await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
	return { root, directory, manifest, workDir: path.join(directory, "user-data") };
}
function processStub() {
	return Object.assign(new EventEmitter(), {
		pid: 43210,
		stderr: new EventEmitter(),
		kill: vi.fn(() => true),
		unref: vi.fn(),
	}) as unknown as ChildProcess;
}
async function harness(
	options: {
		probe?: (port: number, signal: AbortSignal) => Promise<boolean>;
		platform?: NodeJS.Platform;
		startupTimeoutMs?: number;
		idleTimeoutMs?: number;
	} = {},
) {
	const files = await fixture();
	const children: ChildProcess[] = [];
	const launch = vi.fn(() => {
		const child = processStub();
		children.push(child);
		return child;
	});
	const port = vi.fn(async () => 34123);
	const manager = new BundledOllamaManager(
		{ root: files.root, workDir: files.workDir, enabled: true, required: true },
		{
			launch: launch as unknown as typeof spawn,
			port,
			probe: options.probe ?? (async () => true),
			platform: options.platform ?? "linux",
			startupTimeoutMs: options.startupTimeoutMs ?? 500,
			idleTimeoutMs: options.idleTimeoutMs ?? 20,
		},
	);
	managers.push(manager);
	return { ...files, manager, launch, port, children };
}
afterEach(async () => {
	for (const manager of managers.splice(0)) manager.stop();
	vi.useRealTimers();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("bundled Ollama assets (real small files, no model inference)", () => {
	it("verifies every asset and the content-addressed model blob", async () => {
		const { root, manifest } = await fixture();
		expect(await verifyBundledOllama(root)).toEqual(manifest);
		await writeFile(path.join(root, "runtime/ollama.exe"), "changed");
		await expect(verifyBundledOllama(root)).rejects.toThrow(/missing or corrupt/);
	});
	it("rejects traversal and extra executable/library files", async () => {
		const { root, manifest } = await fixture();
		manifest.files.push({ file: "../outside.exe", size: 1, sha256: digest("x") });
		await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
		await expect(verifyBundledOllama(root)).rejects.toThrow(/missing or corrupt/);
		manifest.files.pop();
		await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
		await writeFile(path.join(root, "runtime", "unexpected.dll"), "not manifested");
		await expect(verifyBundledOllama(root)).rejects.toThrow(/missing or corrupt/);
	});
	it("rejects symbolic-link replacement and an already canceled hash scan", async () => {
		const { root, directory } = await fixture();
		const runtime = path.join(root, "runtime", "ollama.exe");
		const bytes = await readFile(runtime);
		const outside = path.join(directory, "outside-runtime");
		await mkdir(outside);
		await writeFile(path.join(outside, "ollama.exe"), bytes);
		await rm(path.dirname(runtime), { recursive: true });
		await symlink(
			outside,
			path.dirname(runtime),
			process.platform === "win32" ? "junction" : "dir",
		);
		await expect(verifyBundledOllama(root)).rejects.toThrow(/missing or corrupt/);
		const controller = new AbortController();
		controller.abort();
		await expect(verifyBundledOllama(root, controller.signal)).rejects.toThrow();
	});
	it("rejects an incompatible manifest model and missing license entry", async () => {
		const { root, manifest } = await fixture();
		manifest.modelName = "qwen3:4b";
		await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
		await expect(verifyBundledOllama(root)).rejects.toThrow(/missing or corrupt/);
		manifest.modelName = "qwen3:1.7b";
		manifest.files = manifest.files.filter((file) => !/license/i.test(file.file));
		await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
		await expect(verifyBundledOllama(root)).rejects.toThrow(/missing or corrupt/);
	});
	it("requires every model registry layer, even if all listed files have matching hashes", async () => {
		const { root, manifest } = await fixture();
		const entry = manifest.files.find((asset) => asset.file.includes("/manifests/"))!;
		const registry = JSON.parse(await readFile(path.join(root, entry.file), "utf8"));
		registry.layers[0].digest = `sha256:${digest("a missing model layer")}`;
		const content = JSON.stringify(registry);
		await writeFile(path.join(root, entry.file), content);
		entry.size = Buffer.byteLength(content);
		entry.sha256 = digest(content);
		await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
		await expect(verifyBundledOllama(root)).rejects.toThrow(/missing or corrupt/);
	});
});

describe("private Ollama lifecycle (spawn and readiness mocked)", () => {
	it("does nothing for a different selected model or an optional absent bundle", async () => {
		const h = await harness();
		expect(await h.manager.acquire("qwen3:4b")).toBeNull();
		expect(h.launch).not.toHaveBeenCalled();
		const optional = new BundledOllamaManager({
			root: path.join(h.directory, "not-installed"),
			workDir: h.workDir,
			enabled: true,
			required: false,
		});
		managers.push(optional);
		expect(await optional.acquire("qwen3:1.7b")).toBeNull();
	});
	it("the offline edition fails explicitly instead of using a separate user installation", async () => {
		const h = await harness();
		await rm(path.join(h.root, "manifest.json"));
		await expect(h.manager.acquire("qwen3:1.7b")).rejects.toThrow(/Reinstall/);
		expect(h.launch).not.toHaveBeenCalled();
	});
	it("serializes concurrent startup and isolates port, models and Windows user-home files", async () => {
		const h = await harness({ platform: "win32" });
		const [first, second] = await Promise.all([
			h.manager.acquire("qwen3:1.7b"),
			h.manager.acquire("qwen3:1.7b"),
		]);
		expect(h.launch).toHaveBeenCalledTimes(1);
		expect(first!.port).toBe(34123);
		expect(second!.port).toBe(34123);
		const call = h.launch.mock.calls[0] as unknown as [string, string[], { env: object }];
		expect(call[0]).toBe(path.join(h.root, "runtime", "ollama.exe"));
		expect(call[1]).toEqual(["serve"]);
		expect(call[2]).toMatchObject({
			cwd: h.workDir,
			shell: false,
			windowsHide: true,
			env: {
				OLLAMA_HOST: "127.0.0.1:34123",
				OLLAMA_MODELS: path.join(h.root, "models"),
				OLLAMA_NO_CLOUD: "1",
				USERPROFILE: h.workDir,
				OLLAMA_NUM_PARALLEL: "1",
				OLLAMA_MAX_LOADED_MODELS: "1",
			},
		});
		first!.release();
		second!.release();
		h.manager.stop();
		const stop = h.launch.mock.calls[1] as unknown as [string, string[]];
		expect(stop[0]).toMatch(/taskkill\.exe$/);
		expect(stop[1]).toEqual(["/PID", "43210", "/T", "/F"]);
	});
	it("falls back to a direct kill when the Windows taskkill helper fails to spawn", async () => {
		const h = await harness({ platform: "win32" });
		const lease = await h.manager.acquire("qwen3:1.7b");
		lease!.release();
		h.manager.stop();
		expect(h.children).toHaveLength(2);
		const [ollama, killer] = h.children;
		expect(ollama.kill).not.toHaveBeenCalled();
		killer.emit("error", new Error("spawn taskkill.exe ENOENT"));
		expect(ollama.kill).toHaveBeenCalledTimes(1);
	});
	it("creates writable runtime state outside a read-only installation directory", async () => {
		const h = await harness({ platform: "win32" });
		const before = await readdir(h.root);
		await chmod(h.root, 0o555);
		try {
			const lease = await h.manager.acquire("qwen3:1.7b");
			expect((await stat(h.workDir)).isDirectory()).toBe(true);
			expect(await readdir(h.root)).toEqual(before);
			const call = h.launch.mock.calls[0] as unknown as [string, string[], { cwd: string }];
			expect(call[2].cwd).toBe(h.workDir);
			lease!.release();
		} finally {
			await chmod(h.root, 0o755);
		}
	});
	it("one caller's cancellation does not interrupt another caller's startup", async () => {
		let reportReady!: (value: boolean) => void;
		const startup = new Promise<boolean>((resolve) => {
			reportReady = resolve;
		});
		const h = await harness({ probe: async () => startup });
		const controller = new AbortController();
		const first = h.manager.acquire("qwen3:1.7b", controller.signal);
		const second = h.manager.acquire("qwen3:1.7b");
		const cancelled = expect(first).rejects.toThrow();
		await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
		controller.abort();
		await cancelled;
		expect(h.children[0].kill).not.toHaveBeenCalled();
		reportReady(true);
		const lease = await second;
		expect(lease!.port).toBe(34123);
		lease!.release();
	});
	it("cancels a startup when its last waiter leaves and kills only its own process", async () => {
		const h = await harness({
			probe: async (_port, signal) =>
				new Promise<boolean>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				}),
		});
		const controller = new AbortController();
		const request = h.manager.acquire("qwen3:1.7b", controller.signal);
		const cancelled = expect(request).rejects.toThrow();
		await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
		controller.abort();
		await cancelled;
		await vi.waitFor(() => expect(h.children[0].kill).toHaveBeenCalledTimes(1));
	});
	it("stopping mid-startup discards a probe that later resolves ready", async () => {
		let reportReady!: (value: boolean) => void;
		const startup = new Promise<boolean>((resolve) => {
			reportReady = resolve;
		});
		const h = await harness({ probe: async () => startup });
		const request = h.manager.acquire("qwen3:1.7b");
		await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(1));
		h.manager.stop();
		expect(h.children[0].kill).toHaveBeenCalledTimes(1);
		const rejected = expect(request).rejects.toThrow();
		reportReady(true);
		await rejected;
		await expect(h.manager.acquire("qwen3:1.7b")).rejects.toThrow(/shutting down/);
		expect(h.launch).toHaveBeenCalledTimes(1);
	});
	it("times out startup, cleans the failed process and permits retry", async () => {
		let available = false;
		const h = await harness({ probe: async () => available, startupTimeoutMs: 20 });
		await expect(h.manager.acquire("qwen3:1.7b")).rejects.toThrow(/timed out/);
		expect(h.children[0].kill).toHaveBeenCalledTimes(1);
		available = true;
		const retry = await h.manager.acquire("qwen3:1.7b");
		expect(h.launch).toHaveBeenCalledTimes(2);
		retry!.release();
	});
	it("keeps a live request's server and stops an idle server after all leases release", async () => {
		const h = await harness();
		const first = await h.manager.acquire("qwen3:1.7b");
		const second = await h.manager.acquire("qwen3:1.7b");
		vi.useFakeTimers();
		first!.release();
		await vi.advanceTimersByTimeAsync(100);
		expect(h.children[0].kill).not.toHaveBeenCalled();
		second!.release();
		second!.release();
		await vi.advanceTimersByTimeAsync(25);
		expect(h.children[0].kill).toHaveBeenCalledTimes(1);
	});
	it("rechecks installed assets before starting a replacement process", async () => {
		const h = await harness();
		const lease = await h.manager.acquire("qwen3:1.7b");
		lease!.release();
		await vi.waitFor(() => expect(h.children[0].kill).toHaveBeenCalledTimes(1));
		await writeFile(path.join(h.root, "runtime", "ollama.exe"), "changed installed bytes");
		await expect(h.manager.acquire("qwen3:1.7b")).rejects.toThrow(/missing or corrupt/);
		expect(h.launch).toHaveBeenCalledTimes(1);
	});
});
