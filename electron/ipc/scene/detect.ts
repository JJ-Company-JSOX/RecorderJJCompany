import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export interface SceneAnalysis {
	version: 1;
	engine: "PySceneDetect";
	engineVersion: string;
	durationMs: number;
	timing: "sampled-frame-boundary";
	frameSkip: number;
	scenes: { startMs: number; endMs: number }[];
}

export function parseSceneAnalysis(json: string): SceneAnalysis {
	const data = JSON.parse(json);
	if (
		!data ||
		data.version !== 1 ||
		data.engine !== "PySceneDetect" ||
		data.engineVersion !== "0.7.2" ||
		data.timing !== "sampled-frame-boundary" ||
		data.frameSkip !== 2 ||
		!Number.isFinite(data.durationMs) ||
		data.durationMs <= 0 ||
		data.durationMs > 600000 ||
		!Array.isArray(data.scenes) ||
		!data.scenes.length ||
		data.scenes.length > 2000
	)
		throw Error("Invalid scene analysis result");
	let previousEnd = 0;
	const scenes = data.scenes.map((scene: { startMs: number; endMs: number }) => {
		if (
			!scene ||
			!Number.isFinite(scene.startMs) ||
			!Number.isFinite(scene.endMs) ||
			scene.startMs < previousEnd ||
			scene.endMs <= scene.startMs ||
			scene.endMs > data.durationMs + 1
		)
			throw Error("Invalid or overlapping scene boundaries");
		previousEnd = scene.endMs;
		return { startMs: scene.startMs, endMs: scene.endMs };
	});
	return {
		version: 1,
		engine: "PySceneDetect",
		engineVersion: data.engineVersion,
		durationMs: data.durationMs,
		timing: "sampled-frame-boundary",
		frameSkip: 2,
		scenes,
	};
}

export async function getSceneStatus(root: string) {
	try {
		const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
		if (
			manifest.version !== 1 ||
			manifest.engineVersion !== "0.7.2" ||
			!Array.isArray(manifest.files) ||
			!manifest.files.some((f: { file: string }) => f.file === "runtime/python.exe")
		)
			throw Error("Scene bundle missing");
		await fs.access(path.join(root, "runtime/python.exe"));
		await fs.access(path.join(root, "scene-worker.py"));
		return { available: true as const, engine: "PySceneDetect", version: "0.7.2" };
	} catch {
		return { available: false as const, engine: "PySceneDetect", version: "0.7.2" };
	}
}

async function verifySceneAssets(root: string, signal: AbortSignal) {
	const canonical = await fs.realpath(root),
		manifestPath = path.join(canonical, "manifest.json");
	if ((await fs.stat(manifestPath)).size > 2_000_000) throw Error("Invalid scene manifest");
	const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
	if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 10000)
		throw Error("Invalid scene manifest");
	for (const entry of manifest.files) {
		signal.throwIfAborted();
		if (
			typeof entry.file !== "string" ||
			/(^|\/)\.\.(\/|$)|[:\\]/.test(entry.file) ||
			entry.file.startsWith("/") ||
			!Number.isSafeInteger(entry.size) ||
			entry.size < 0 ||
			!/^[a-f0-9]{64}$/.test(entry.sha256)
		)
			throw Error("Invalid scene asset");
		const file = await fs.realpath(path.join(canonical, entry.file)),
			relative = path.relative(canonical, file);
		if (
			relative.startsWith("..") ||
			path.isAbsolute(relative) ||
			(await fs.stat(file)).size !== entry.size
		)
			throw Error("Scene asset missing or corrupt");
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
		if (hash.digest("hex") !== entry.sha256) throw Error("Scene asset checksum mismatch");
	}
	signal.throwIfAborted();
}

/** The IPC caller must approve videoPath; this worker only reads the source. */
export async function detectScenes({
	root,
	videoPath,
	signal,
}: {
	root: string;
	videoPath: string;
	signal: AbortSignal;
}): Promise<SceneAnalysis> {
	await verifySceneAssets(root, signal);
	const { stdout } = await run(
		path.join(root, "runtime/python.exe"),
		["-I", "-B", path.join(root, "scene-worker.py"), "--input", videoPath],
		{
			windowsHide: true,
			timeout: 5 * 60 * 1000,
			maxBuffer: 1024 * 1024,
			signal,
			env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" },
		},
	);
	signal.throwIfAborted();
	return parseSceneAnalysis(stdout);
}
