// Local-only native-helper smoke test. Default is inspection; --run records only
// this script's fixed synthetic window. Never select/fall back to a display.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyNativeHelperManifest } from "./native-helper-manifest.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index < 0 ? fallback : args[index + 1];
};
const fps = Number(option("--fps", 60));
const seconds = Number(option("--seconds", 6));
const run = args.includes("--run");
if (args.includes("--help")) {
	console.log("node scripts/smoke-windows-capture.mjs [--run] [--fps 60] [--seconds 6]");
	console.log(
		"Default: inspect helper only. --run: show and record a synthetic window plus a quiet 997 Hz tone; microphone disabled; output under .tmp/capture-smoke.",
	);
	process.exit(0);
}
if (process.platform !== "win32") throw new Error("This smoke test requires Windows.");
if (!Number.isInteger(fps) || fps < 1 || fps > 120)
	throw new Error("--fps must be an integer between 1 and 120.");
if (!Number.isFinite(seconds) || seconds < 2 || seconds > 30)
	throw new Error("--seconds must be between 2 and 30.");

const archDir = process.arch === "arm64" ? "win32-arm64" : "win32-x64";
const binaryPath = path.join(projectRoot, "electron/native/bin", archDir, "wgc-capture.exe");
const sourceDir = path.join(projectRoot, "electron/native/wgc-capture");
const manifestPath = path.join(path.dirname(binaryPath), "helpers-manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const helperEntry = manifest.helpers?.["wgc-capture"];
if (!helperEntry) throw new Error("Capture helper manifest entry is missing.");
const bytes = await fs.readFile(binaryPath);
const binarySha256 = createHash("sha256").update(bytes).digest("hex");
const verification = verifyNativeHelperManifest({
	projectRoot,
	helperId: "wgc-capture",
	sourceDir,
	binaryPath,
	binaryName: "wgc-capture.exe",
});
const protocolMarkers = [
	"windowHandle",
	"Invalid window handle",
	"Recording started",
	"Recording stopped",
	"captureSystemAudio",
	"audioOutputPath",
];
const missingMarkers = protocolMarkers.filter((marker) => !bytes.includes(Buffer.from(marker)));
const provenance = {
	binarySha256,
	expectedBinarySha256: helperEntry.binarySha256,
	binaryHashMatches: binarySha256 === helperEntry.binarySha256,
	sourceFingerprintMatches: !verification.reasons.includes("source fingerprint mismatch"),
	manifestUpdatedAt: helperEntry.updatedAt,
	verification,
	missingProtocolMarkers: missingMarkers,
};
if (!run) {
	console.log(
		JSON.stringify(
			{
				mode: "inspect-only",
				provenance,
				command: `node scripts/smoke-windows-capture.mjs --run --fps ${fps} --seconds ${seconds}`,
			},
			null,
			2,
		),
	);
	if (!provenance.binaryHashMatches || missingMarkers.length) process.exitCode = 1;
	process.exit();
}
if (
	!provenance.binaryHashMatches ||
	missingMarkers.length ||
	helperEntry.binaryName !== "wgc-capture.exe"
) {
	throw new Error(
		"Refusing capture: helper hash/name or window-only protocol markers do not match the expected bundled helper.",
	);
}

const root = path.join(
	projectRoot,
	".tmp",
	"capture-smoke",
	new Date().toISOString().replaceAll(/[:.]/g, "-"),
);
await fs.mkdir(root, { recursive: true });
const report = {
	reportVersion: 2,
	requestedFps: fps,
	requestedSeconds: seconds,
	provenance,
	limits: [
		"This tests the bundled binary, whose source fingerprint may be stale; it does not validate unbuilt native source changes.",
		"Current native source obtains a monitor surface and crops to HWND. The synthetic window stays fixed and on top; no display target or desktop fallback is allowed.",
		"WASAPI captures the default system output; synthetic tone detection proves loopback received this test signal, not microphone capture or every audio route.",
		"Microphone is disabled. The auxiliary FFmpeg mux is not Jsox editor/export validation.",
		"r_frame_rate is preserved as a probe field, not treated as proof of the requested fps. Decoded sample cadence includes any repeated frames and does not measure unique captured updates.",
		"The tone starts after Recording started is observed. Companion startDelayMs is an audio start offset relative to video, not a measurement of missing sound or device startup latency.",
	],
	assertions: {},
	errors: [],
};
const helperLogs = [];
let app;
let helper;
let helperExit;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function withTimeout(promise, ms, message) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
const videoPath = path.join(root, "synthetic-window.mp4");
const audioPath = path.join(root, "synthetic-system.wav");
const muxedPath = path.join(root, "synthetic-av.mp4");

async function command(
	executable,
	commandArgs,
	{ timeout = 30000, maxBytes = 16 * 1024 * 1024 } = {},
) {
	return await new Promise((resolve, reject) => {
		const child = spawn(executable, commandArgs, {
			cwd: projectRoot,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const out = [];
		const err = [];
		let outputBytes = 0;
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`Command timed out: ${path.basename(executable)}`));
		}, timeout);
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.stdout.on("data", (chunk) => {
			outputBytes += chunk.length;
			if (outputBytes > maxBytes) {
				child.kill();
				reject(new Error("Diagnostic output exceeded its bounded buffer."));
			} else out.push(chunk);
		});
		child.stderr.on("data", (chunk) => {
			if (err.reduce((n, item) => n + item.length, 0) < 512 * 1024) err.push(chunk);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0)
				reject(
					new Error(
						`${path.basename(executable)} exited ${code}: ${Buffer.concat(err).toString().slice(-3000)}`,
					),
				);
			else resolve({ stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() });
		});
	});
}

async function waitForStarted(timeout = 20000) {
	const start = performance.now();
	while (performance.now() - start < timeout) {
		if (helperLogs.join("").includes("Recording started"))
			return Math.round(performance.now() - start);
		if (helper.exitCode !== null || helper.signalCode)
			throw new Error("Capture helper exited before Recording started.");
		await delay(50);
	}
	throw new Error("Capture helper did not announce Recording started within 20 seconds.");
}

function audioMetrics(buffer, sampleRate) {
	const samples = new Float32Array(
		buffer.buffer,
		buffer.byteOffset,
		Math.floor(buffer.length / 4),
	);
	let squareSum = 0;
	let peak = 0;
	for (const sample of samples) {
		squareSum += sample * sample;
		peak = Math.max(peak, Math.abs(sample));
	}
	const rms = Math.sqrt(squareSum / samples.length);
	let strongest = { hz: null, rms: 0 };
	for (let hz = 995; hz <= 999; hz += 0.25) {
		const omega = (2 * Math.PI * hz) / sampleRate;
		let real = 0;
		let imaginary = 0;
		for (let index = 0; index < samples.length; index++) {
			real += samples[index] * Math.cos(omega * index);
			imaginary += samples[index] * Math.sin(omega * index);
		}
		const toneRms = (Math.SQRT2 * Math.hypot(real, imaginary)) / samples.length;
		if (toneRms > strongest.rms) strongest = { hz, rms: toneRms };
	}
	return {
		sampleRate,
		decodedSamples: samples.length,
		durationSeconds: samples.length / sampleRate,
		rms,
		peak,
		strongestToneHz: strongest.hz,
		toneRms: strongest.rms,
		toneToTotalRms: strongest.rms / rms,
	};
}

function parseProbeRatio(value) {
	if (typeof value !== "string") return null;
	const parts = value.split("/").map(Number);
	if (parts.length !== 2 || !parts.every(Number.isFinite) || parts[1] <= 0) return null;
	return parts[0] / parts[1];
}

try {
	const [{ _electron }, { default: ffmpegPath }, { default: ffprobeInfo }] = await Promise.all([
		import("@playwright/test"),
		import("ffmpeg-static"),
		import("ffprobe-static"),
	]);
	const ffprobePath = ffprobeInfo.path;
	const mainPath = path.join(root, "synthetic-main.cjs");
	const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#df214d}canvas{width:100%;height:100%;display:block}</style></head><body><canvas></canvas><script>
	const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');canvas.width=Math.round(innerWidth*devicePixelRatio);canvas.height=Math.round(innerHeight*devicePixelRatio);let frames=0;const started=performance.now();
	function draw(now){const w=canvas.width,h=canvas.height;
	ctx.fillStyle='#df214d';ctx.fillRect(0,0,w/2,h/2);ctx.fillStyle='#20c997';ctx.fillRect(w/2,0,w/2,h/2);ctx.fillStyle='#3a60ed';ctx.fillRect(0,h/2,w/2,h/2);ctx.fillStyle='#f5b841';ctx.fillRect(w/2,h/2,w/2,h/2);
	ctx.fillStyle='white';ctx.fillRect(w*.2+(w*.5)*((now%1800)/1800),h*.46,w*.08,h*.08);ctx.fillStyle='black';ctx.font=Math.round(h*.055)+'px sans-serif';ctx.fillText('JSOX SYNTHETIC '+frames++,w*.25,h*.38);requestAnimationFrame(draw)}requestAnimationFrame(draw);
	window.syntheticStats=()=>({frames,elapsedMs:performance.now()-started,dpr:devicePixelRatio,width:canvas.width,height:canvas.height});
	window.startSyntheticTone=async()=>{const requestedAtMs=performance.now();const audio=new AudioContext();await audio.resume();const gain=audio.createGain();gain.gain.value=.03;const oscillator=audio.createOscillator();oscillator.frequency.value=997;oscillator.connect(gain).connect(audio.destination);oscillator.start();const oscillatorScheduledAtMs=performance.now();window.stopSyntheticTone=async()=>{oscillator.stop();await audio.close()};return {state:audio.state,timing:{clock:'synthetic window performance.now',requestedAtMs,oscillatorScheduledAtMs,audioContextTimeSeconds:audio.currentTime,baseLatencySeconds:audio.baseLatency??null,outputLatencySeconds:audio.outputLatency??null}}};
	</script></body></html>`;
	await fs.writeFile(
		mainPath,
		`const {app,BrowserWindow,screen}=require('electron');app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');app.setPath('userData',${JSON.stringify(path.join(root, "profile"))});app.whenReady().then(async()=>{const area=screen.getPrimaryDisplay().workArea;const width=Math.min(960,Math.floor((area.width-64)/2)*2),height=Math.min(540,Math.floor((area.height-64)/2)*2);if(width<320||height<180)throw Error('Synthetic test window will not fit');const win=new BrowserWindow({x:area.x+32,y:area.y+32,width,height,frame:false,roundedCorners:false,hasShadow:false,transparent:false,backgroundColor:'#df214d',resizable:false,movable:false,alwaysOnTop:true,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});win.setAlwaysOnTop(true,'screen-saver');await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(${JSON.stringify(html)}));win.show();win.focus();});app.on('window-all-closed',()=>app.quit());`,
	);
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	app = await _electron.launch({
		args: [
			mainPath,
			"--disable-features=CalculateNativeWinOcclusion",
			"--disable-backgrounding-occluded-windows",
		],
		env,
		timeout: 30000,
	});
	const page = await app.firstWindow();
	await page.waitForFunction(() => window.syntheticStats?.().frames > 10);
	report.syntheticWindow = await app.evaluate(({ BrowserWindow, screen }) => {
		const win = BrowserWindow.getAllWindows()[0];
		const handle = win.getNativeWindowHandle();
		return {
			handle: Number(handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()),
			bounds: win.getBounds(),
			scaleFactor: screen.getDisplayMatching(win.getBounds()).scaleFactor,
			alwaysOnTop: win.isAlwaysOnTop(),
			visible: win.isVisible(),
		};
	});
	if (
		!Number.isSafeInteger(report.syntheticWindow.handle) ||
		report.syntheticWindow.handle <= 0 ||
		!report.syntheticWindow.visible ||
		!report.syntheticWindow.alwaysOnTop
	)
		throw new Error("Synthetic HWND is invalid or not visible/on top.");
	report.syntheticBefore = await page.evaluate(() => window.syntheticStats());
	const config = {
		outputPath: videoPath,
		windowHandle: report.syntheticWindow.handle,
		fps,
		captureSystemAudio: true,
		audioOutputPath: audioPath,
		captureMic: false,
	};
	// Intentionally no displayId/display bounds; never add a desktop fallback.
	await fs.writeFile(path.join(root, "helper-config.json"), JSON.stringify(config, null, 2));
	const helperSpawnedAtMs = performance.now();
	helper = spawn(binaryPath, [JSON.stringify(config)], {
		cwd: root,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
	helperExit = new Promise((resolve, reject) => {
		helper.once("error", reject);
		helper.once("close", (code, signal) => resolve({ code, signal }));
	});
	helperExit.catch(() => undefined);
	helper.stdout.on("data", (chunk) => helperLogs.push(chunk.toString()));
	helper.stderr.on("data", (chunk) => helperLogs.push(chunk.toString()));
	report.startSignalMs = await waitForStarted();
	const recordingStartedObservedMs = performance.now() - helperSpawnedAtMs;
	const toneRequestedAtMs = performance.now() - helperSpawnedAtMs;
	const tone = await page.evaluate(() => window.startSyntheticTone());
	report.toneState = tone.state;
	report.toneTiming = {
		clock: "script performance.now, relative to helper spawn",
		recordingStartedObservedMs,
		requestedAtMs: toneRequestedAtMs,
		acknowledgedAtMs: performance.now() - helperSpawnedAtMs,
		renderer: tone.timing,
		limit: "Renderer and script clocks have different origins. Scheduling/acknowledgement times do not establish when the tone became audible at the output device.",
	};
	await delay(seconds * 1000);
	report.syntheticAfter = await page.evaluate(() => window.syntheticStats());
	report.syntheticFramesPerSecond =
		((report.syntheticAfter.frames - report.syntheticBefore.frames) * 1000) /
		(report.syntheticAfter.elapsedMs - report.syntheticBefore.elapsedMs);
	// Do not blame capture for missed updates if the test's animation is slow.
	report.assertions.syntheticCadence = report.syntheticFramesPerSecond >= fps * 0.9;
	helper.stdin.end("stop\n");
	report.helperExit = await withTimeout(
		helperExit,
		15000,
		"Helper did not stop/finalize within 15 seconds.",
	);
	await page.evaluate(() => window.stopSyntheticTone?.());
	await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
	await app.close().catch(() => undefined);
	app = null;
	console.error("Synthetic capture finished and test window closed; analyzing local files.");
	if (report.helperExit.code !== 0)
		throw new Error(`Capture helper exited ${report.helperExit.code}.`);
	const probe = async (input, extra = []) =>
		JSON.parse(
			(
				await command(ffprobePath, [
					"-v",
					"error",
					...extra,
					"-show_streams",
					"-show_format",
					"-of",
					"json",
					input,
				])
			).stdout.toString(),
		);
	report.video = await probe(videoPath, ["-count_frames"]);
	const videoStream = report.video.streams.find((stream) => stream.codec_type === "video");
	if (!videoStream) throw new Error("Recorded MP4 contains no video stream.");
	const rFrameRate = parseProbeRatio(videoStream.r_frame_rate);
	const averageFrameRate = parseProbeRatio(videoStream.avg_frame_rate);
	const timeBaseSeconds = parseProbeRatio(videoStream.time_base);
	const frameInfo = JSON.parse(
		(
			await command(ffprobePath, [
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_frames",
				"-show_entries",
				"frame=best_effort_timestamp_time",
				"-of",
				"json",
				videoPath,
			])
		).stdout.toString(),
	);
	const times = frameInfo.frames
		.map((frame) => Number(frame.best_effort_timestamp_time))
		.filter(Number.isFinite);
	const orderedDeltas = times.slice(1).map((time, index) => (time - times[index]) * 1000);
	const deltas = orderedDeltas.filter((delta) => delta > 0).sort((a, b) => a - b);
	const duration = Number(videoStream.duration || report.video.format.duration);
	const effectiveFramesPerSecond = times.length / duration;
	const timestampToleranceMs = Math.max(0.1, (timeBaseSeconds || 0) * 2000);
	const intervalSpreadMs = deltas.length > 0 ? deltas[deltas.length - 1] - deltas[0] : null;
	const nonIncreasingTimestampCount = orderedDeltas.filter((delta) => delta <= 0).length;
	const variableFrameIntervalsObserved =
		deltas.length > 1 && intervalSpreadMs > timestampToleranceMs;
	report.cadence = {
		requestedFps: fps,
		probeFields: {
			r_frame_rate: videoStream.r_frame_rate ?? null,
			avg_frame_rate: videoStream.avg_frame_rate ?? null,
			time_base: videoStream.time_base ?? null,
			codec_time_base: videoStream.codec_time_base ?? null,
		},
		rFrameRate,
		averageFrameRate,
		timeBaseSeconds,
		decodedFrames: times.length,
		durationSeconds: duration,
		effectiveFramesPerSecond,
		nonIncreasingTimestampCount,
		variableFrameIntervalsObserved,
		timestampCadence:
			deltas.length < 2
				? "insufficient timestamps"
				: nonIncreasingTimestampCount > 0
					? "non-increasing timestamps"
					: variableFrameIntervalsObserved
						? "VFR observed (variable presentation intervals)"
						: "CFR-like observed (within timestamp precision)",
		minFrameIntervalMs: deltas[0] ?? null,
		maxFrameIntervalMs: deltas[deltas.length - 1] ?? null,
		timestampToleranceMs,
		p95FrameIntervalMs: deltas[Math.floor(deltas.length * 0.95)],
	};
	const expectedWidth = Math.floor(report.syntheticBefore.width / 2) * 2;
	const expectedHeight = Math.floor(report.syntheticBefore.height / 2) * 2;
	report.assertions.windowDimensions =
		Math.abs(videoStream.width - expectedWidth) <= 2 &&
		Math.abs(videoStream.height - expectedHeight) <= 2;
	report.assertions.frameTimingFields =
		timeBaseSeconds !== null &&
		timeBaseSeconds > 0 &&
		deltas.length > 0 &&
		nonIncreasingTimestampCount === 0;
	report.assertions.averageRateMatchesDecodedCadence =
		averageFrameRate !== null &&
		averageFrameRate > 0 &&
		Math.abs(averageFrameRate - effectiveFramesPerSecond) <=
			Math.max(0.1, averageFrameRate * 0.01);
	report.assertions.actualCadence =
		effectiveFramesPerSecond >= fps * 0.9 && effectiveFramesPerSecond <= fps * 1.1;
	report.assertions.duration = duration >= seconds * 0.85 && duration <= seconds + 3;
	const expectedColors = [
		[223, 33, 77],
		[32, 201, 151],
		[58, 96, 237],
		[245, 184, 65],
	];
	report.syntheticFrameChecks = [];
	for (const at of [0.2, duration / 2, Math.max(0.2, duration - 0.3)]) {
		const frame = (
			await command(ffmpegPath, [
				"-v",
				"error",
				"-ss",
				String(at),
				"-i",
				videoPath,
				"-frames:v",
				"1",
				"-vf",
				"scale=64:64",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"pipe:1",
			])
		).stdout;
		const points = [
			[10, 10],
			[54, 10],
			[10, 54],
			[54, 54],
		];
		const actualColors = points.map(([x, y]) => [
			...frame.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3),
		]);
		// The capture/encoder/display path can change luminance. Validate the
		// distinct synthetic quadrant hues as well as dimensions, and report
		// luminance differences separately instead of hiding them in tolerance.
		const brightnessMatches = actualColors.every(
			(color, index) =>
				color.length === 3 &&
				color.every(
					(value, channel) => Math.abs(value - expectedColors[index][channel]) < 65,
				),
		);
		const matches =
			frame.length === 64 * 64 * 3 &&
			actualColors.every((color, index) => {
				const max = Math.max(...color);
				const expectedMax = Math.max(...expectedColors[index]);
				return (
					max > 40 &&
					color.length === 3 &&
					color.every(
						(value, channel) =>
							Math.abs(value / max - expectedColors[index][channel] / expectedMax) <
							0.12,
					)
				);
			});
		report.syntheticFrameChecks.push({
			atSeconds: at,
			actualColors,
			matches,
			brightnessMatches,
		});
	}
	report.assertions.syntheticPixelsOnly = report.syntheticFrameChecks.every(
		(check) => check.matches,
	);
	report.syntheticColorBrightnessMatches = report.syntheticFrameChecks.every(
		(check) => check.brightnessMatches,
	);
	report.audio = await probe(audioPath);
	const audioStream = report.audio.streams.find((stream) => stream.codec_type === "audio");
	report.assertions.systemAudioTrack = Boolean(audioStream);
	if (!audioStream) throw new Error("System audio WAV contains no audio stream.");
	const decodedAudio = (
		await command(ffmpegPath, [
			"-v",
			"error",
			"-i",
			audioPath,
			"-map",
			"0:a:0",
			"-ac",
			"1",
			"-ar",
			"48000",
			"-f",
			"f32le",
			"pipe:1",
		])
	).stdout;
	report.audioSignal = audioMetrics(decodedAudio, 48000);
	report.assertions.systemAudioNonSilent = report.audioSignal.rms > 0.00001;
	report.assertions.syntheticToneDetected =
		report.audioSignal.toneToTotalRms > 0.1 && report.audioSignal.toneRms > 0.00001;
	try {
		report.audioTiming = JSON.parse(await fs.readFile(`${audioPath}.json`, "utf8"));
	} catch {
		report.audioTiming = null;
	}
	const rawAudioStartOffsetMs = report.audioTiming?.startDelayMs;
	const audioStartOffsetAvailable =
		rawAudioStartOffsetMs !== null && rawAudioStartOffsetMs !== undefined;
	const audioStartOffsetMs = audioStartOffsetAvailable ? Number(rawAudioStartOffsetMs) : 0;
	if (
		!Number.isFinite(audioStartOffsetMs) ||
		audioStartOffsetMs < 0 ||
		audioStartOffsetMs > duration * 1000
	)
		throw new Error("Invalid companion audio timing metadata.");
	report.audioAlignment = {
		metadataPresent: report.audioTiming !== null,
		startOffsetAvailable: audioStartOffsetAvailable,
		startOffsetMs: audioStartOffsetAvailable ? audioStartOffsetMs : null,
		capturedDurationMs: report.audioSignal.durationSeconds * 1000,
		alignedEndRelativeToVideoMs: audioStartOffsetAvailable
			? audioStartOffsetMs + report.audioSignal.durationSeconds * 1000
			: null,
		videoDurationMs: duration * 1000,
		interpretation:
			"startDelayMs is the first reliable WASAPI packet timestamp minus the first video timestamp. The test starts its tone later; this offset alone does not prove missing audio or device startup latency.",
	};
	report.auxiliaryMuxAudioOffsetMs = audioStartOffsetMs;
	await command(ffmpegPath, [
		"-v",
		"error",
		"-n",
		"-i",
		videoPath,
		"-itsoffset",
		String(audioStartOffsetMs / 1000),
		"-i",
		audioPath,
		"-map",
		"0:v:0",
		"-map",
		"1:a:0",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		"-t",
		String(duration),
		muxedPath,
	]);
	report.auxiliaryMux = await probe(muxedPath);
	report.assertions.muxedAudioTrack = report.auxiliaryMux.streams.some(
		(stream) => stream.codec_type === "audio",
	);
	report.artifacts = {
		video: path.relative(projectRoot, videoPath),
		systemAudio: path.relative(projectRoot, audioPath),
		auxiliaryMux: path.relative(projectRoot, muxedPath),
	};
} catch (error) {
	report.errors.push(String(error.stack || error));
} finally {
	if (helper && helper.exitCode === null && !helper.signalCode) {
		try {
			helper.stdin.end("stop\n");
		} catch {
			// The helper may already have closed its input.
		}
		await withTimeout(
			helperExit?.catch(() => undefined),
			3000,
			"Helper cleanup timeout",
		).catch(() => undefined);
		if (helper.exitCode === null && !helper.signalCode) helper.kill();
	}
	if (app) {
		await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
		await app.close().catch(() => undefined);
	}
	report.passed =
		report.errors.length === 0 &&
		Object.keys(report.assertions).length >= 9 &&
		Object.values(report.assertions).every(Boolean);
	await fs.writeFile(path.join(root, "helper.log"), helperLogs.join(""));
	await fs.writeFile(path.join(root, "report.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify({ output: path.relative(projectRoot, root), ...report }, null, 2));
	if (!report.passed) process.exitCode = 1;
}
