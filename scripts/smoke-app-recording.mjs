// Explicit local app-UI capture. Never starts without --run; no upload.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { _electron, expect as pwExpect } from "@playwright/test";
import ffprobe from "ffprobe-static";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(projectRoot, "release/offline-ai-test/win-unpacked/Recordly.exe");
const args = process.argv.slice(2);
if (args.some((arg) => !["--run", "--help"].includes(arg)))
	throw new Error("Only --run and --help are supported.");
if (!args.includes("--run") || args.includes("--help")) {
	console.log(
		JSON.stringify(
			{
				command: "node scripts/smoke-app-recording.mjs --run",
				capture:
					"Five seconds of the primary monitor using the actual app UI. Synthetic work-area animation; taskbar remains visible; no microphone, webcam or system audio. All files remain local.",
				application: executable,
			},
			null,
			2,
		),
	);
	process.exit(0);
}
if (process.platform !== "win32") throw new Error("Windows is required.");
const inside = (base, file) => {
	const rel = path.relative(base, file);
	return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};
const runRoot = path.join(
	projectRoot,
	".tmp/app-recording",
	new Date().toISOString().replaceAll(/[:.]/g, "-"),
);
const profile = path.join(runRoot, "profile");
if (!inside(path.join(projectRoot, ".tmp"), runRoot) || !inside(runRoot, profile))
	throw new Error("Unsafe output path.");
await fs.mkdir(profile, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env))
	if (
		key === "ELECTRON_RUN_AS_NODE" ||
		key === "VITE_DEV_SERVER_URL" ||
		key.startsWith("RECORDLY_DEV_OPEN_") ||
		key.startsWith("RECORDLY_SMOKE_")
	)
		delete env[key];
Object.assign(env, { RECORDLY_DIAGNOSTICS_USER_DATA: profile, RECORDLY_DISABLE_AUTO_UPDATES: "1" });
const report = {
	success: false,
	application: executable,
	capture: { seconds: 5, microphone: false, systemAudio: false, webcam: false },
	checks: {},
	errors: [],
	limits: [
		"Actual monitor capture includes the existing taskbar and stays local in ignored .tmp.",
		"A synthetic window covers the work area; existing user windows and profiles are untouched.",
		"No real microphone or system audio is tested. A single local run does not establish a performance improvement.",
		"Decoded presentation timestamps can be variable-rate or contain duplicate pictures; calculated FPS and timestamp gaps do not prove unique visual motion.",
		"Synthetic cursor telemetry may be added by a later editor regression; it is not real-cursor capture proof.",
	],
};
const expect = pwExpect.configure({ timeout: 30000 });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, ms, label) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		const result = await fn();
		if (result) return result;
		await pause(150);
	}
	throw new Error(`${label} timed out after ${ms} ms.`);
}
let app;
let hud;
let editor;
let recordingStarted = false;
const logs = [];
function stage(name) {
	console.log(`[app-recording] ${new Date().toISOString()} ${name}`);
}
try {
	stage("Launching own isolated app");
	await fs.access(executable);
	app = await _electron.launch({
		executablePath: executable,
		args: [],
		cwd: projectRoot,
		env,
		timeout: 120000,
	});
	for (const stream of [app.process().stdout, app.process().stderr])
		stream?.on("data", (chunk) => {
			if (logs.join("").length < 4 * 1024 * 1024) logs.push(String(chunk));
		});
	const actualProfile = await app.evaluate(({ app }) => app.getPath("userData"));
	if (path.resolve(actualProfile).toLowerCase() !== profile.toLowerCase())
		throw new Error("App did not use isolated profile.");
	report.checks.isolatedProfile = true;
	const first = await app.firstWindow();
	stage(`First window ${first.url()}`);
	await first.waitForFunction(
		() => typeof window.electronAPI?.showRecordingHud === "function",
		null,
		{ timeout: 90000 },
	);
	await first.evaluate(async () => {
		localStorage.setItem("recordly.locale", "en");
		const prefs = await window.electronAPI.getRecordingPreferences();
		if (
			!prefs.success ||
			prefs.microphoneEnabled ||
			prefs.systemAudioEnabled ||
			prefs.webcamEnabled
		)
			throw new Error("Fresh test profile unexpectedly enables capture devices.");
		// Calling this from the HUD would register the HUD as the return editor.
		// Real dashboard entry registers its editor; initial HUD needs no call.
		if (new URLSearchParams(location.search).get("windowType") !== "hud-overlay")
			await window.electronAPI.showRecordingHud();
	});
	hud = await until(
		async () => {
			for (const page of app.windows())
				if (
					!page.isClosed() &&
					(await page
						.getByRole("button", { name: "Choose recording source", exact: true })
						.count()
						.catch(() => 0))
				)
					return page;
		},
		60000,
		"Recording HUD",
	);
	stage("HUD found");
	await hud.evaluate(() => localStorage.setItem("recordly.locale", "en"));
	await hud.reload();
	await expect(
		hud.getByRole("button", { name: "Choose recording source", exact: true }),
	).toBeEnabled();
	await hud.getByRole("button", { name: "Choose recording source", exact: true }).click();
	stage("Picker requested");
	const picker = await until(
		async () =>
			app
				.windows()
				.find(
					(page) => !page.isClosed() && page.url().includes("windowType=capture-picker"),
				),
		45000,
		"Real capture picker",
	);
	await picker
		.getByRole("button", { name: "Entire screen", exact: true })
		.click({ timeout: 30000 });
	const source = await until(
		async () => {
			const selected = await hud.evaluate(() => window.electronAPI.getSelectedSource());
			return selected?.id?.startsWith("screen:") ? selected : null;
		},
		15000,
		"Selected screen",
	);
	report.checks.entireScreenSelected = true;
	stage("Entire screen selected");
	report.source = { kind: "screen", displayId: source.display_id, sourceType: source.sourceType };
	// Leave the fresh profile's three-second countdown intact. HeroUI forwards
	// this wrapper's aria-label but may filter its native title attribute.
	// Start/stop must use accessible names, not getByTitle.
	report.capture.countdown = await hud.evaluate(() => window.electronAPI.getCountdownDelay());
	report.hudButtons = await hud.locator("button").evaluateAll((buttons) =>
		buttons.map((button) => ({
			text: button.textContent,
			ariaLabel: button.getAttribute("aria-label"),
			title: button.getAttribute("title"),
		})),
	);
	const preferences = await hud.evaluate(() => window.electronAPI.getRecordingPreferences());
	if (
		preferences.microphoneEnabled ||
		preferences.systemAudioEnabled ||
		preferences.webcamEnabled
	)
		throw new Error("Capture devices unexpectedly enabled.");
	report.checks.devicesDisabled = true;
	stage("Creating synthetic fixture");
	// Own app window only. Chromium input to the HUD still reaches the real React controls.
	report.fixture = await app.evaluate(async ({ BrowserWindow, screen }) => {
		const primary = screen.getPrimaryDisplay();
		const fixture = new BrowserWindow({
			...primary.workArea,
			frame: false,
			thickFrame: false,
			roundedCorners: false,
			hasShadow: false,
			resizable: false,
			movable: false,
			minimizable: false,
			maximizable: false,
			focusable: false,
			skipTaskbar: true,
			show: false,
			backgroundColor: "#df214d",
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				backgroundThrottling: false,
			},
		});
		globalThis.__jsoxRecordingFixture = fixture;
		const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#df214d}canvas{width:100%;height:100%;display:block}</style><canvas></canvas><script>const c=document.querySelector('canvas'),x=c.getContext('2d');c.width=Math.round(innerWidth*devicePixelRatio);c.height=Math.round(innerHeight*devicePixelRatio);let frames=0;function draw(t){let w=c.width,h=c.height;['#df214d','#20c997','#3a60ed','#f5b841'].forEach((v,i)=>{x.fillStyle=v;x.fillRect((i%2)*w/2,Math.floor(i/2)*h/2,w/2,h/2)});x.fillStyle='white';x.fillRect(w*.1+w*.75*((t%2000)/2000),h*.6,w*.08,h*.08);x.fillStyle='black';x.font=Math.round(h*.045)+'px sans-serif';x.fillText('JSOX LOCAL TEST — SYNTHETIC SCENE',w*.1,h*.25);x.fillText('Motion frame '+frames++,w*.1,h*.35);requestAnimationFrame(draw)}requestAnimationFrame(draw);window.fixtureFrames=()=>frames;</script>`;
		fixture.setAlwaysOnTop(true, "screen-saver");
		await fixture.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
		fixture.setBounds(primary.workArea, false);
		fixture.showInactive();
		return {
			primary: primary.bounds,
			workArea: primary.workArea,
			physicalBounds: screen.dipToScreenRect(null, primary.bounds),
			physicalWorkArea: screen.dipToScreenRect(null, primary.workArea),
			scaleFactor: primary.scaleFactor,
			focused: fixture.isFocused(),
			visible: fixture.isVisible(),
		};
	});
	if (!report.fixture.visible || report.fixture.focused)
		throw new Error("Synthetic fixture was not visible without taking focus.");
	await pause(700);
	report.fixture.beforeRecord = await app.evaluate(async () => ({
		frames:
			await globalThis.__jsoxRecordingFixture.webContents.executeJavaScript(
				"window.fixtureFrames()",
			),
		mainMonotonicMs: performance.now(),
	}));
	const recordClickedAt = performance.now();
	stage("Clicking Record");
	await hud.getByRole("button", { name: "Record", exact: true }).click();
	await expect(hud.getByRole("group", { name: "Recording controls", exact: true })).toBeVisible({
		timeout: 45000,
	});
	recordingStarted = true;
	stage("Capture started; five seconds");
	report.fixture.atCaptureStart = await app.evaluate(async () => ({
		frames:
			await globalThis.__jsoxRecordingFixture.webContents.executeJavaScript(
				"window.fixtureFrames()",
			),
		mainMonotonicMs: performance.now(),
	}));
	const started = performance.now();
	report.capture.monotonicMs = { recordClicked: recordClickedAt, controlsVisible: started };
	await pause(5000);
	report.capture.wallMsBeforeStop = performance.now() - started;
	report.fixture.afterCapture = await app.evaluate(async () => ({
		frames:
			await globalThis.__jsoxRecordingFixture.webContents.executeJavaScript(
				"window.fixtureFrames()",
			),
		mainMonotonicMs: performance.now(),
	}));
	report.fixture.generatedFrames =
		report.fixture.afterCapture.frames - report.fixture.atCaptureStart.frames;
	report.fixture.measuredWallMs =
		report.fixture.afterCapture.mainMonotonicMs - report.fixture.atCaptureStart.mainMonotonicMs;
	report.fixture.generatedFps =
		report.fixture.generatedFrames / (report.fixture.measuredWallMs / 1000);
	report.capture.monotonicMs.stopClicked = performance.now();
	await hud.getByRole("button", { name: "Stop", exact: true }).click();
	report.capture.monotonicMs.stopClickReturned = performance.now();
	recordingStarted = false;
	report.checks.recordStopUi = true;
	stage("Capture stopped");
	await app.evaluate(() => {
		globalThis.__jsoxRecordingFixture?.destroy();
		globalThis.__jsoxRecordingFixture = undefined;
	});
	editor = await until(
		async () =>
			app
				.windows()
				.find((page) => !page.isClosed() && page.url().includes("windowType=editor")),
		120000,
		"Recorded editor",
	);
	await editor.locator(".editor-preview-frame canvas").first().waitFor({ timeout: 90000 });
	await editor.waitForFunction(
		() =>
			[...document.querySelectorAll("video")].some(
				(v) => v.videoWidth > 0 && v.readyState >= 2,
			),
		null,
		{ timeout: 60000 },
	);
	report.checks.editorPreview = true;
	const recordings = path.join(profile, "recordings");
	const recording = await until(
		async () => {
			const candidates = (await fs.readdir(recordings).catch(() => [])).filter((name) =>
				/^recording-.*\.mp4$/i.test(name),
			);
			if (candidates.length !== 1) return null;
			const file = path.join(recordings, candidates[0]);
			return (await fs.stat(file)).size > 1000 ? file : null;
		},
		30000,
		"App-produced MP4",
	);
	const realRecording = await fs.realpath(recording);
	if (!inside(await fs.realpath(profile), realRecording))
		throw new Error("Recording escaped isolated profile.");
	const { stdout } = await promisify(execFile)(
		ffprobe.path,
		["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", recording],
		{ encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
	);
	const probe = JSON.parse(stdout);
	const video = probe.streams.find((stream) => stream.codec_type === "video");
	const duration = Number(probe.format.duration);
	const full = report.fixture.physicalBounds;
	if (
		!video ||
		video.width !== full.width ||
		video.height !== full.height ||
		duration < 3 ||
		duration > 15
	)
		throw new Error("Recording dimensions or duration do not match full-monitor test.");
	report.checks.fullMonitorVideo = true;
	report.checks.noAudioTracks = !probe.streams.some((stream) => stream.codec_type === "audio");
	if (!report.checks.noAudioTracks) throw new Error("Unexpected audio was recorded.");
	report.recordingPath = recording;
	report.video = {
		width: video.width,
		height: video.height,
		durationSeconds: duration,
		frames: Number(video.nb_read_frames),
		bytes: Number(probe.format.size),
		codec: video.codec_name,
	};
	const { stdout: frameJson } = await promisify(execFile)(
		ffprobe.path,
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_frames",
			"-show_entries",
			"frame=best_effort_timestamp_time",
			"-of",
			"json",
			recording,
		],
		{ encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
	);
	const timestamps = JSON.parse(frameJson)
		.frames.map((frame) => Number(frame.best_effort_timestamp_time))
		.filter(Number.isFinite);
	await fs.writeFile(
		path.join(runRoot, "frame-timestamps.json"),
		JSON.stringify(timestamps, null, 2),
	);
	const gaps = timestamps.slice(1).map((time, index) => (time - timestamps[index]) * 1000);
	const sortedGaps = [...gaps].sort((a, b) => a - b);
	const percentile = (fraction) =>
		sortedGaps.length
			? sortedGaps[
					Math.min(sortedGaps.length - 1, Math.ceil(sortedGaps.length * fraction) - 1)
				]
			: null;
	const timestampSpan = timestamps.length > 1 ? timestamps.at(-1) - timestamps[0] : 0;
	report.video.timestamps = {
		decodedFrames: timestamps.length,
		firstSeconds: timestamps[0] ?? null,
		lastSeconds: timestamps.at(-1) ?? null,
		spanSeconds: timestampSpan,
		adjacentGapMs: {
			p50: percentile(0.5),
			p95: percentile(0.95),
			max: sortedGaps.at(-1) ?? null,
			zeroOrNegative: gaps.filter((value) => value <= 0).length,
		},
		calculatedFps: timestampSpan > 0 ? (timestamps.length - 1) / timestampSpan : null,
		frameCountOverContainerDurationFps: duration > 0 ? timestamps.length / duration : null,
		caveat: "Presentation timestamps only; VFR and repeated pictures are possible. Does not establish unique motion or UI preview performance.",
	};
	await editor.screenshot({ path: path.join(runRoot, "recorded-editor.png") });
	report.success = true;
} catch (error) {
	report.errors.push(String(error.stack || error));
	process.exitCode = 1;
	const page = editor || hud;
	if (page && !page.isClosed()) {
		await page.screenshot({ path: path.join(runRoot, "failure.png") }).catch(() => undefined);
		await fs.writeFile(
			path.join(runRoot, "failure-ui.txt"),
			await page
				.locator("body")
				.innerText()
				.catch(() => "unavailable"),
		);
	}
} finally {
	if (app) {
		if (recordingStarted && hud && !hud.isClosed()) {
			await hud
				.getByRole("button", { name: "Stop", exact: true })
				.click({ timeout: 10000 })
				.catch(() => undefined);
			await pause(1500);
		}
		await app
			.evaluate(({ app }) => {
				globalThis.__jsoxRecordingFixture?.destroy();
				app.exit(0);
			})
			.catch(() => undefined);
		await app.close().catch(() => undefined);
	}
	await fs.writeFile(path.join(runRoot, "app.log"), logs.join(""));
	await fs.writeFile(path.join(runRoot, "report.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify({ ...report, artifacts: runRoot }, null, 2));
}
