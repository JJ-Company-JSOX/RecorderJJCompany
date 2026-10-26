// Real renderer/encoder/muxer smoke without an Electron binary or AI models.
// Only Electron app.getPath and IPC transport are replaced; media processing is production code.
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const option = (name) => {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	if (!args[index + 1] || args[index + 1].startsWith("--")) throw Error(`Missing ${name} value`);
	return args[index + 1];
};
if (!args.includes("--run") || args.includes("--help")) {
	console.log(`Story MP4 export smoke (local synthetic media only)

node scripts/smoke-story-export.mjs --run [--browser <chromium>] [--out <directory>] [--port 5189]

Uses existing development dependencies, fixture video and the production exporter/muxer.
Does not download models or a browser, access recording devices, or use personal media.
Default output is a new temporary directory. Requires a local Chromium with software
H.264 WebCodecs support and FFmpeg/FFprobe (project binaries or PATH).
Set RECORDLY_CHROMIUM_PATH or --browser when Chromium is not found automatically.
Do not run this concurrently with the browser UI suite on a low-memory computer.`);
	process.exit(0);
}
const repository = path.resolve(
	option("--repository") ?? fileURLToPath(new URL("../", import.meta.url)),
);
const requestedOut = option("--out");
const output = requestedOut
	? path.resolve(requestedOut)
	: await fs.mkdtemp(path.join(os.tmpdir(), "recordly-story-export-"));
await fs.mkdir(output, { recursive: true });
const port = Number(option("--port") ?? "5189");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Invalid port");
if (existsSync(path.join(output, "story-final.mp4")))
	throw Error("Choose a new output directory; an earlier proof would be overwritten.");
const browserCandidates = [
	option("--browser"),
	process.env.RECORDLY_CHROMIUM_PATH,
	chromium.executablePath(),
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/usr/bin/google-chrome",
	process.env.PROGRAMFILES &&
		path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
	process.env.LOCALAPPDATA &&
		path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => existsSync(candidate));
if (!executablePath)
	throw Error(
		"No installed Chromium found. Pass --browser; this smoke never installs a browser.",
	);
const muxBundle = path.join(output, "actual-mux.mjs");
await build({
	stdin: {
		contents: `export {muxExportedVideoAudioBuffer} from ${JSON.stringify(path.join(repository, "electron/ipc/export/native-video.ts"))}; export {getFfmpegBinaryPath,getFfprobeBinaryPath} from ${JSON.stringify(path.join(repository, "electron/ipc/ffmpeg/binary.ts"))};`,
		resolveDir: repository,
		sourcefile: "story-smoke-mux-entry.ts",
	},
	bundle: true,
	platform: "node",
	format: "esm",
	outfile: muxBundle,
	plugins: [
		{
			name: "electron-test-transport",
			setup(bundler) {
				bundler.onResolve({ filter: /^electron$/ }, () => ({
					path: "electron",
					namespace: "smoke-electron",
				}));
				bundler.onLoad({ filter: /.*/, namespace: "smoke-electron" }, () => ({
					contents: `export const app={isPackaged:false,getPath:()=>${JSON.stringify(output)},getAppPath:()=>${JSON.stringify(repository)}}; export const powerSaveBlocker={start:()=>1,stop:()=>{},isStarted:()=>false};`,
					loader: "js",
				}));
				// Preserve original module resolution for ffmpeg-static/ffprobe-static in a temp bundle.
				bundler.onLoad(
					{ filter: /[\\/]electron[\\/]ipc[\\/]ffmpeg[\\/]binary\.ts$/ },
					async (entry) => ({
						contents: (await fs.readFile(entry.path, "utf8")).replaceAll(
							"import.meta.url",
							JSON.stringify(pathToFileURL(entry.path).href),
						),
						loader: "ts",
					}),
				);
			},
		},
	],
});
const { muxExportedVideoAudioBuffer, getFfmpegBinaryPath, getFfprobeBinaryPath } = await import(
	pathToFileURL(muxBundle).href
);
const ffmpeg = getFfmpegBinaryPath(),
	ffprobe = getFfprobeBinaryPath();
const wav = Buffer.alloc(44 + 48000 * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24);
wav.writeUInt32LE(96000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 48000; i++)
	wav.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / 48000) * 7000), 44 + i * 2);
await fs.writeFile(path.join(output, "narration-fixture.wav"), wav);
const origin = `http://127.0.0.1:${port}`;
const logs = [];
const server = spawn(
	process.execPath,
	[
		path.join(repository, "node_modules/vite/bin/vite.js"),
		"--host",
		"127.0.0.1",
		"--port",
		String(port),
		"--strictPort",
	],
	{
		cwd: repository,
		env: { ...process.env, RECORDLY_RENDERER_ONLY: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	},
);
const serverLog = createWriteStream(path.join(output, "vite.log"));
server.stdout.pipe(serverLog);
server.stderr.pipe(serverLog, { end: false });
let browser,
	timeout,
	ffmpegMuxUsed = false;
try {
	await new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(Error("Vite did not become ready within 30 seconds")),
			30000,
		);
		server.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		server.on("exit", (code) => {
			clearTimeout(timer);
			reject(Error(`Vite exited (${code}); choose an unused --port. See vite.log.`));
		});
		server.stdout.on("data", (data) => {
			if (data.toString().includes("Local:")) {
				clearTimeout(timer);
				resolve();
			}
		});
	});
	browser = await chromium.launch({
		executablePath,
		headless: true,
		args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
	});
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	page.on("console", (message) => logs.push(`${message.type()}: ${message.text()}`));
	page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));
	await page.route("**/proof-page", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><title>Actual exporter proof</title>",
		}),
	);
	await page.route("**/story-proof.wav", (route) => {
		const range = route.request().headers().range;
		if (!range)
			return route.fulfill({
				body: wav,
				contentType: "audio/wav",
				headers: { "Accept-Ranges": "bytes" },
			});
		const match = /bytes=(\d+)-(\d*)/.exec(range);
		const start = Number(match?.[1] ?? 0),
			end = match?.[2] ? Math.min(wav.length - 1, Number(match[2])) : wav.length - 1;
		if (start >= wav.length)
			return route.fulfill({
				status: 416,
				headers: { "Content-Range": `bytes */${wav.length}` },
			});
		return route.fulfill({
			status: 206,
			body: wav.subarray(start, end + 1),
			contentType: "audio/wav",
			headers: {
				"Accept-Ranges": "bytes",
				"Content-Range": `bytes ${start}-${end}/${wav.length}`,
			},
		});
	});
	await page.exposeFunction("actualFfmpegMux", async (videoBytes, options) => {
		ffmpegMuxUsed = true;
		if (
			videoBytes.length > 32 * 1024 * 1024 ||
			(options.editedAudioData?.length ?? 0) > 8 * 1024 * 1024 ||
			options.audioSourcePath
		)
			throw Error("Unexpected smoke mux payload");
		if (options.editedAudioData)
			options.editedAudioData = Uint8Array.from(options.editedAudioData).buffer;
		const result = await muxExportedVideoAudioBuffer(
			Uint8Array.from(videoBytes).buffer,
			options,
		);
		await fs.copyFile(result.outputPath, path.join(output, "story-final.mp4"));
		return { success: true, tempPath: result.outputPath, metrics: result.metrics };
	});
	await page.goto(`${origin}/proof-page`);
	const result = await Promise.race([
		page.evaluate(async (runtimePlatform) => {
			window.electronAPI = {
				getAppVersion: async () => "story-smoke",
				getPlatform: async () => runtimePlatform,
				muxExportedVideoAudio: async (data, options) =>
					window.actualFfmpegMux(Array.from(new Uint8Array(data)), {
						...options,
						editedAudioData: options.editedAudioData
							? Array.from(new Uint8Array(options.editedAudioData))
							: undefined,
					}),
			};
			const encoder = await VideoEncoder.isConfigSupported({
				codec: "avc1.42001f",
				width: 320,
				height: 180,
				framerate: 15,
				bitrate: 2000000,
				hardwareAcceleration: "prefer-software",
			});
			if (!encoder.supported)
				throw Error(
					"This Chromium has no software H.264 WebCodecs encoder; no alternative codec/pipeline is substituted.",
				);
			const { ModernVideoExporter } = await import(
				"/src/lib/exporter/modernVideoExporter.ts"
			);
			const {
				DEFAULT_ANNOTATION_STYLE,
				DEFAULT_WEBCAM_OVERLAY,
				DEFAULT_AUTO_CAPTION_SETTINGS,
			} = await import("/src/components/video-editor/types.ts");
			const exporter = new ModernVideoExporter({
				videoUrl: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
				width: 320,
				height: 180,
				frameRate: 15,
				previewWidth: 320,
				previewHeight: 180,
				bitrate: 2000000,
				codec: "avc1.42001f",
				preferredEncoderPath: {
					codec: "avc1.42001f",
					hardwareAcceleration: "prefer-software",
				},
				backendPreference: "webcodecs",
				experimentalNativeExport: false,
				encodingMode: "balanced",
				wallpaper: "#202020",
				zoomRegions: [],
				showShadow: false,
				shadowIntensity: 0,
				backgroundBlur: 0,
				borderRadius: 12,
				padding: 20,
				cropRegion: { x: 0, y: 0, width: 1, height: 1 },
				webcam: { ...DEFAULT_WEBCAM_OVERLAY, enabled: false },
				showCursor: false,
				clipRegions: [
					{ id: "first", startMs: 0, endMs: 3000, sourceStartMs: 0, speed: 1 },
					{ id: "second", startMs: 3000, endMs: 6000, sourceStartMs: 0, speed: 1 },
				],
				annotationRegions: [
					{
						id: "story-title-first",
						type: "text",
						content: "Product introduction",
						textContent: "Product introduction",
						position: { x: 10, y: 8 },
						size: { width: 80, height: 12 },
						style: { ...DEFAULT_ANNOTATION_STYLE, fontSize: 24 },
						startMs: 0,
						endMs: 3000,
						zIndex: 1,
						trackIndex: 0,
					},
					{
						id: "story-title-second",
						type: "text",
						content: "Try it today",
						textContent: "Try it today",
						position: { x: 10, y: 8 },
						size: { width: 80, height: 12 },
						style: { ...DEFAULT_ANNOTATION_STYLE, fontSize: 24 },
						startMs: 3000,
						endMs: 6000,
						zIndex: 1,
						trackIndex: 0,
					},
				],
				autoCaptions: [
					{
						id: "narration-first",
						clipId: "first",
						text: "First story line",
						startMs: 500,
						endMs: 1500,
					},
					{
						id: "narration-second",
						clipId: "second",
						text: "Second story line",
						startMs: 500,
						endMs: 1500,
					},
				],
				autoCaptionSettings: {
					...DEFAULT_AUTO_CAPTION_SETTINGS,
					enabled: true,
					fontSize: 24,
					maxWidth: 90,
					animationStyle: "none",
				},
				audioRegions: [
					{
						id: "narration-first",
						startMs: 500,
						endMs: 1500,
						audioPath: `${location.origin}/story-proof.wav`,
						volume: 1,
					},
					{
						id: "narration-second",
						startMs: 3500,
						endMs: 4500,
						audioPath: `${location.origin}/story-proof.wav`,
						volume: 1,
					},
				],
			});
			const exported = await exporter.export();
			if (exported.blob)
				return {
					...exported,
					blob: undefined,
					bytes: Array.from(new Uint8Array(await exported.blob.arrayBuffer())),
				};
			return exported;
		}, process.platform),
		new Promise((_, reject) => {
			timeout = setTimeout(() => reject(Error("Export exceeded 120 seconds")), 120000);
		}),
	]);
	clearTimeout(timeout);
	await fs.writeFile(
		path.join(output, "export-result.json"),
		JSON.stringify({ ...result, bytes: result.bytes?.length }, null, 2),
	);
	if (!result.success) throw Error(result.error ?? "Export failed");
	const finalPath = path.join(output, "story-final.mp4");
	if (result.bytes) await fs.writeFile(finalPath, Uint8Array.from(result.bytes));
	const probe = JSON.parse(
		execFileSync(
			ffprobe,
			["-v", "error", "-show_streams", "-show_format", "-of", "json", finalPath],
			{ encoding: "utf8", timeout: 30000 },
		),
	);
	const video = probe.streams.find((stream) => stream.codec_type === "video"),
		audio = probe.streams.find((stream) => stream.codec_type === "audio");
	if (
		video?.codec_name !== "h264" ||
		audio?.codec_name !== "aac" ||
		video.width !== 320 ||
		video.height !== 180 ||
		Math.abs(Number(probe.format.duration) - 6) > 0.1 ||
		Math.abs(Number(video.duration) - Number(audio.duration)) > 0.1
	)
		throw Error("Unexpected codecs, dimensions or audio/video duration");
	execFileSync(ffmpeg, ["-v", "error", "-i", finalPath, "-f", "null", "-"], { timeout: 30000 });
	const pcm = execFileSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-i",
			finalPath,
			"-vn",
			"-ac",
			"1",
			"-ar",
			"48000",
			"-f",
			"f32le",
			"pipe:1",
		],
		{ maxBuffer: 4000000, timeout: 30000 },
	);
	const audioWindows = [
		[0, 0.3],
		[0.7, 1.2],
		[2, 2.5],
		[3.7, 4.2],
		[5, 5.5],
	].map(([start, end]) => {
		let sum = 0,
			count = 0;
		for (
			let i = Math.round(start * 48000);
			i < Math.min(pcm.length / 4, Math.round(end * 48000));
			i++
		) {
			const value = pcm.readFloatLE(i * 4);
			sum += value * value;
			count++;
		}
		return { start, end, db: 20 * Math.log10(Math.max(1e-12, Math.sqrt(sum / count))) };
	});
	if (
		audioWindows[1].db < -35 ||
		audioWindows[3].db < -35 ||
		audioWindows[2].db > -70 ||
		audioWindows[4].db > -70
	)
		throw Error("Narration fixture is missing or incorrectly timed");
	for (const [time, name] of [
		[1, "scene-first.png"],
		[4, "scene-second.png"],
	])
		execFileSync(
			ffmpeg,
			[
				"-v",
				"error",
				"-ss",
				String(time),
				"-i",
				finalPath,
				"-frames:v",
				"1",
				"-vf",
				"scale=1280:720",
				path.join(output, name),
			],
			{ timeout: 30000 },
		);
	const report = {
		success: true,
		output,
		ffmpegMuxUsed,
		media: {
			width: video.width,
			height: video.height,
			fps: video.r_frame_rate,
			videoCodec: video.codec_name,
			audioCodec: audio.codec_name,
			videoDuration: video.duration,
			audioDuration: audio.duration,
			bytes: probe.format.size,
		},
		audioWindows,
		decode: "full FFmpeg video/audio decode passed",
		limits: "Synthetic media and WAV, not AI inference/TTS or Windows capture/GPU validation. Native Electron app.getPath/IPC transport are shims; renderer and software H264 encoder are real; ffmpegMuxUsed reports whether the production AAC fallback ran.",
	};
	await fs.writeFile(path.join(output, "ffprobe.json"), JSON.stringify(probe, null, 2));
	await fs.writeFile(path.join(output, "validation.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
} finally {
	clearTimeout(timeout);
	await fs.writeFile(path.join(output, "browser.log"), logs.join("\n"));
	await browser?.close().catch(() => undefined);
	server.stdout.unpipe(serverLog);
	server.stderr.unpipe(serverLog);
	server.kill("SIGTERM");
	serverLog.end();
}
