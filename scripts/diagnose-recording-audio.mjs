// Read-only local diagnostics. Does not change preferences, media, or projects.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);
const args = process.argv.slice(2);
if (args.includes("--help")) {
	console.log(
		'Usage: node scripts/diagnose-recording-audio.mjs ["path/to/recording.mp4"]\nWithout a path, checks the latest recording in Recordly / Recordly-dev, including custom recording folders. No files are changed. Audio is sampled for up to 60 seconds per file.',
	);
	process.exit(0);
}
const readJson = async (file) => {
	try {
		return JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
	} catch {
		return null;
	}
};

async function findLatestRecording() {
	const appData = process.env.APPDATA ?? path.join(os.homedir(), ".config");
	const directories = new Set();
	for (const name of ["Recordly-dev", "Recordly", "recordly"]) {
		const root = path.join(appData, name);
		const settings = await readJson(path.join(root, "recordings-settings.json"));
		directories.add(
			typeof settings?.recordingsDir === "string" && settings.recordingsDir.trim()
				? path.resolve(settings.recordingsDir)
				: path.join(root, "recordings"),
		);
	}
	const candidates = [];
	for (const directory of directories) {
		const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (!entry.isFile() || !/^recording-\d+\.(mp4|webm)$/i.test(entry.name)) continue;
			const file = path.join(directory, entry.name);
			const stat = await fs.stat(file).catch(() => null);
			if (stat) candidates.push({ file, time: stat.mtimeMs });
		}
	}
	return candidates.sort((a, b) => b.time - a.time)[0]?.file;
}

async function inspectAudio(file, kind) {
	const stat = await fs.stat(file).catch(() => null);
	if (!stat?.isFile()) return { kind, path: file, status: "missing" };
	let stderr = "";
	let failed = false;
	try {
		({ stderr } = await run(
			ffmpegPath,
			[
				"-nostdin",
				"-hide_banner",
				"-threads",
				"1",
				"-i",
				file,
				"-t",
				"60",
				"-map",
				"0:a:0",
				"-vn",
				"-sn",
				"-dn",
				"-af",
				"volumedetect",
				"-f",
				"null",
				"-",
			],
			{ windowsHide: true, timeout: 90000, maxBuffer: 2 * 1024 * 1024 },
		));
	} catch (error) {
		stderr = String(error.stderr ?? "");
		failed = true;
		if (!stderr) return { kind, path: file, status: "error", error: error.message };
	}
	if (/matches no streams|does not contain any stream/i.test(stderr))
		return { kind, path: file, sizeBytes: stat.size, status: "no-audio-stream" };
	const maxMatch = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?|-inf) dB/i);
	const meanMatch = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?|-inf) dB/i);
	// FFmpeg may print an initial zero-sample filter before its final summary.
	const sampleCounts = [...stderr.matchAll(/n_samples:\s*(\d+)/g)];
	const samples = Number(sampleCounts[sampleCounts.length - 1]?.[1] ?? 0);
	if (failed || !maxMatch || !samples)
		return {
			kind,
			path: file,
			sizeBytes: stat.size,
			status: "error",
			error: stderr.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 500),
		};
	const maxDb = Number(maxMatch[1]);
	return {
		kind,
		path: file,
		sizeBytes: stat.size,
		status: maxDb > -70 ? "signal-detected" : "quiet-sample",
		maxDb: Number.isFinite(maxDb) ? maxDb : "-inf",
		meanDb: meanMatch?.[1],
		sampleLimitSeconds: 60,
	};
}

try {
	const videoPath = args[0] ? path.resolve(args[0]) : await findLatestRecording();
	if (!videoPath)
		throw new Error(
			'找不到录制文件。请指定视频路径：node scripts/diagnose-recording-audio.mjs "C:\\path\\recording.mp4"',
		);
	if (!ffmpegPath) throw new Error("FFmpeg 不可用，请先完成项目依赖安装。");
	const stem = videoPath.replace(/\.[^.]+$/, "");
	const diagnostics = await readJson(`${stem}.recording-diagnostics.json`);
	const results = [await inspectAudio(videoPath, "embedded")];
	if (results[0].status === "missing") throw new Error(`视频不存在：${videoPath}`);
	for (const kind of ["system", "mic"]) {
		for (const extension of ["wav", "m4a", "webm"]) {
			const result = await inspectAudio(`${stem}.${kind}.${extension}`, kind);
			if (result.status !== "missing") results.push(result);
		}
	}
	const events = Array.isArray(diagnostics?.events) ? diagnostics.events : [];
	const helperOutput = events.map((event) => event?.processOutput ?? "").join("\n");
	const systemRequested = events.length
		? events.some(
				(event) =>
					typeof event?.systemAudioPath === "string" && event.systemAudioPath.length > 0,
			)
		: "unknown";
	const report = {
		videoPath,
		systemRequested,
		systemStartupFailed:
			/SYSTEM_AUDIO_CAPTURE_UNAVAILABLE|Failed to initialize WASAPI loopback/.test(
				helperOutput,
			),
		results,
	};
	console.log(JSON.stringify(report, null, 2));
	if (results.some((result) => result.kind !== "mic" && result.status === "signal-detected")) {
		console.log(
			"检测到原声音频信号：请检查编辑器预览音量、片段静音，以及 Windows 音量混合器中的 Recordly 音量。独立 system 音轨也必须与视频一起保留。",
		);
	} else if (results.some((result) => result.status === "error")) {
		console.log("部分音频无法解码。请把上面的检测结果发回来继续定位。");
	} else if (
		results.some((result) => result.kind !== "mic" && result.status === "quiet-sample")
	) {
		console.log(
			"音轨存在，但前 60 秒样本很安静。此结果不能证明整段视频无声；请确认录制时播放声音的设备与 Windows 默认输出设备一致。",
		);
	} else {
		console.log(
			"未找到可播放的电脑原声音轨。请保留视频与所有同名文件；确认 System audio 开启，且播放声音使用 Windows 默认输出设备，再录制一次。",
		);
	}
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
