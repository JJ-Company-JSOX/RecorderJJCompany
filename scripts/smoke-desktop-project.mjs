// Real Electron integration smoke. Only native file dialogs are automated;
// recording hardware and screen/audio capture are outside this test's scope.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect as playwrightExpect } from "@playwright/test";

const expect = playwrightExpect.configure({ timeout: 30000 });

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(projectRoot, process.argv[2] || "tests/ui/fixtures/filmstrip.mp4");
const allowedInputRoots = [
	path.join(projectRoot, "tests/ui/fixtures"),
	path.join(projectRoot, ".tmp"),
];
const inside = (root, file) => {
	const relative = path.relative(root, file);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
if (!allowedInputRoots.some((root) => inside(root, source))) {
	throw new Error(
		"Use a synthetic MP4 in tests/ui/fixtures or .tmp; this smoke does not use personal videos.",
	);
}
const runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
const outputRoot = path.join(projectRoot, ".tmp", "project-smoke", runId);
const profile = path.join(outputRoot, "profile");
const input = path.join(outputRoot, "synthetic-input.mp4");
const output = path.join(outputRoot, "application-export.mp4");
await fs.mkdir(profile, { recursive: true });
await fs.copyFile(source, input);

const ffprobe = require("ffprobe-static").path;
function probe(file) {
	return JSON.parse(
		execFileSync(
			ffprobe,
			["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
			{
				encoding: "utf8",
				timeout: 30000,
				windowsHide: true,
			},
		),
	);
}
const inputProbe = probe(input);
const durationMs = Math.round(Number(inputProbe.format.duration) * 1000);
if (!(durationMs > 1000 && durationMs <= 20000))
	throw new Error("Use a synthetic clip lasting 1–20 seconds.");
const telemetry = Array.from({ length: Math.ceil(durationMs / 50) + 1 }, (_, index) => ({
	timeMs: Math.min(durationMs, index * 50),
	cx: 0.25 + 0.5 * ((index * 50) / durationMs),
	cy: 0.5 + 0.15 * Math.sin(index / 10),
	cursorType: "arrow",
	interactionType: index % 20 === 0 ? "click" : "move",
}));
await fs.writeFile(`${input}.cursor.json`, JSON.stringify({ version: 1, samples: telemetry }));

const executablePath = process.env.RECORDLY_TEST_EXECUTABLE;
const baseEnv = { ...process.env };
for (const key of Object.keys(baseEnv)) {
	if (
		key.startsWith("RECORDLY_SMOKE_") ||
		key.startsWith("RECORDLY_DEV_OPEN_") ||
		key === "ELECTRON_RUN_AS_NODE" ||
		key === "VITE_DEV_SERVER_URL"
	)
		delete baseEnv[key];
}
const env = {
	...baseEnv,
	RECORDLY_DIAGNOSTICS_USER_DATA: profile,
	RECORDLY_DISABLE_AUTO_UPDATES: "1",
};
const report = {
	success: false,
	input: path.basename(source),
	application: executablePath ? path.basename(executablePath) : "built app via local Electron",
	checks: {},
	errors: [],
	limits: [
		"Native file dialogs are automated, not electronAPI handlers.",
		"Cursor samples are synthetic.",
		"No real screen, microphone or system-audio recording is performed.",
		"This is a functional smoke, not a performance measurement.",
	],
};
const logs = [];
let activeApp;
let activePage;

async function launch(extraEnv = {}) {
	const app = await electron.launch({
		...(executablePath ? { executablePath, args: [] } : { args: [projectRoot] }),
		cwd: projectRoot,
		env: { ...env, ...extraEnv },
		timeout: 120000,
	});
	activeApp = app;
	for (const stream of [app.process().stdout, app.process().stderr]) {
		stream?.on("data", (chunk) => logs.push(String(chunk)));
	}
	app.context().on("page", (page) =>
		page.on("pageerror", (error) => report.errors.push(error.message)),
	);
	return app;
}

async function close(app) {
	await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
	await app.close().catch(() => undefined);
	if (activeApp === app) activeApp = undefined;
}

async function editorPage(app) {
	await expect
		.poll(() => app.windows().some((page) => page.url().includes("windowType=editor")), {
			timeout: 120000,
		})
		.toBe(true);
	const page = app.windows().find((page) => page.url().includes("windowType=editor"));
	activePage = page;
	page.setDefaultTimeout(30000);
	page.on("pageerror", (error) => report.errors.push(error.stack || error.message));
	return page;
}

async function ready(page) {
	await page.locator(".editor-preview-frame canvas").first().waitFor({ timeout: 90000 });
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll("video")].some(
				(v) => v.videoWidth > 0 && v.readyState >= 2,
			),
		null,
		{ timeout: 60000 },
	);
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
}

async function chooseNativeFile(app, filePath) {
	if (!inside(outputRoot, filePath))
		throw new Error("Dialog paths must stay inside this smoke run.");
	await app.evaluate(({ dialog }, selectedPath) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
	}, filePath);
}

async function importViaUi(app, page, filePath) {
	await chooseNativeFile(app, filePath);
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const home = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(home).toBeVisible();
	await home
		.getByRole("complementary", { name: "Library navigation" })
		.getByRole("button", { name: "Import video", exact: true })
		.click();
	await expect(home).not.toBeVisible();
	await ready(page);
}

async function setSwitch(locator, checked) {
	// React Aria's visible label overlays its hidden input. Exercise the
	// accessible keyboard control instead of clicking that input's center.
	if ((await locator.isChecked()) !== checked) {
		await locator.focus();
		await locator.press("Space");
	}
	await expect(locator).toBeChecked({ checked });
}

try {
	console.log("[desktop-smoke] Launching the built app with an isolated profile.");
	const app = await launch({ RECORDLY_DEV_OPEN_RECORDING_INPUT: input });
	const page = await editorPage(app);
	await page.addInitScript(() => localStorage.setItem("recordly.locale", "en"));
	await page.waitForLoadState("load");
	const language = await page.evaluate(() => {
		localStorage.setItem("recordly.locale", "en");
		return document.documentElement.lang;
	});
	if (language !== "en") await page.reload();
	await ready(page);
	const actualProfile = await app.evaluate(({ app }) => app.getPath("userData"));
	if (path.resolve(actualProfile) !== profile)
		throw new Error("App did not use the isolated smoke profile.");

	console.log("[desktop-smoke] Importing synthetic media through the editor UI and real IPC.");
	await importViaUi(app, page, input);
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveCount(1);
	const initialEnd = Number(await clips.first().getAttribute("data-end-ms"));
	if (Math.abs(initialEnd - durationMs) > 100)
		throw new Error("Imported timeline duration did not match the input.");
	report.checks.import = { via: "UI + native-dialog stub + real IPC", durationMs: initialEnd };

	const block = await clips.first().locator(".timeline-block").boundingBox();
	const row = await page.locator('[data-timeline-row="row-clip"]').boundingBox();
	if (!block || !row) throw new Error("Imported timeline was not laid out.");
	await page.mouse.click(block.x + block.width / 2, row.y - 8);
	await page.getByRole("button", { name: "Split Clip (C)", exact: true }).click();
	await expect(clips).toHaveCount(2);
	report.checks.edit = { via: "timeline UI", clipCount: 2 };

	console.log("[desktop-smoke] Checking cursor settings and rendered cursor pixels.");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await page.getByRole("row", { name: "Dot", exact: true }).click();
	await page.getByRole("row", { name: "Ripple", exact: true }).click();
	await setSwitch(page.getByRole("switch", { name: "Advanced settings", exact: true }), true);
	const showCursor = page.getByRole("switch", { name: "Show Cursor", exact: true });
	await setSwitch(showCursor, true);
	const cursorData = await page.evaluate(
		(file) => window.electronAPI.getCursorTelemetry(file),
		input,
	);
	if (!cursorData.success || cursorData.samples.length < 10)
		throw new Error("Synthetic cursor telemetry did not load through IPC.");
	const canvas = page.locator(".editor-preview-frame canvas").first();
	await page.waitForTimeout(400);
	const withCursor = await canvas.screenshot({
		path: path.join(outputRoot, "preview-cursor-on.png"),
	});
	await setSwitch(showCursor, false);
	await page.waitForTimeout(400);
	const withoutCursor = await canvas.screenshot({
		path: path.join(outputRoot, "preview-cursor-off.png"),
	});
	const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
	if (hash(withCursor) === hash(withoutCursor))
		throw new Error("Cursor visibility did not change preview pixels.");
	await setSwitch(showCursor, true);
	report.checks.cursor = {
		style: "dot",
		effect: "ripple",
		samples: cursorData.samples.length,
		previewPixelsChanged: true,
	};

	console.log(
		"[desktop-smoke] Saving a real .recordly project and reopening it through the import UI.",
	);
	await app.evaluate(({ BrowserWindow }) => {
		const editor = BrowserWindow.getAllWindows().find((window) =>
			window.webContents.getURL().includes("windowType=editor"),
		);
		editor?.webContents.send("menu-save-project");
	});
	const directory = await page.evaluate(() => window.electronAPI.getProjectsDirectory());
	if (!directory.success || !inside(profile, directory.path))
		throw new Error("Projects directory escaped the smoke profile.");
	let projectPath;
	let savedProject;
	await expect
		.poll(
			async () => {
				for (const name of await fs.readdir(directory.path)) {
					if (!name.endsWith(".recordly")) continue;
					const file = path.join(directory.path, name);
					const candidate = JSON.parse(
						await fs.readFile(file, "utf8").catch(() => "null"),
					);
					if (
						candidate?.editor?.clipRegions?.length === 2 &&
						candidate.editor.cursorStyle === "dot" &&
						candidate.editor.cursorClickEffect === "ripple" &&
						candidate.editor.showCursor
					) {
						projectPath = file;
						savedProject = candidate;
						return true;
					}
				}
				return false;
			},
			{ timeout: 60000 },
		)
		.toBe(true);
	if (path.resolve(savedProject.videoPath) !== input || !savedProject.projectId)
		throw new Error("Saved project media path or project ID was invalid.");
	await fs.copyFile(projectPath, path.join(outputRoot, "saved-project.recordly"));
	await importViaUi(app, page, projectPath);
	await expect(clips).toHaveCount(2);
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await expect(page.getByRole("row", { name: "Dot", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByRole("row", { name: "Ripple", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	report.checks.project = {
		version: savedProject.version,
		projectIdPresent: true,
		clipCount: 2,
		cursorSettingsReopened: true,
		file: path.relative(outputRoot, projectPath),
	};
	await page.screenshot({ path: path.join(outputRoot, "reopened-editor.png") });
	await close(app);

	console.log(
		"[desktop-smoke] Exporting the saved project through the application's MP4 exporter.",
	);
	const exportApp = await launch({
		RECORDLY_SMOKE_EXPORT: "1",
		RECORDLY_SMOKE_EXPORT_PROJECT: projectPath,
		RECORDLY_SMOKE_EXPORT_OUTPUT: output,
		RECORDLY_SMOKE_EXPORT_QUALITY: "source",
		RECORDLY_SMOKE_EXPORT_FPS: "30",
		RECORDLY_SMOKE_EXPORT_PIPELINE: "modern",
		RECORDLY_SMOKE_EXPORT_BACKEND: "webcodecs",
		RECORDLY_SMOKE_EXPORT_RENDER_BACKEND: "webgl",
	});
	let exportReport;
	await expect
		.poll(
			async () => {
				try {
					exportReport = JSON.parse(await fs.readFile(`${output}.report.json`, "utf8"));
					return true;
				} catch {
					return false;
				}
			},
			{ timeout: 180000, intervals: [500, 1000, 2000] },
		)
		.toBe(true);
	if (!exportReport.success || exportReport.phase !== "saved")
		throw new Error(`Application export failed: ${JSON.stringify(exportReport)}`);
	const exported = probe(output);
	const video = exported.streams.find((stream) => stream.codec_type === "video");
	const exportedDuration = Number(exported.format.duration);
	const inputVideo = inputProbe.streams.find((stream) => stream.codec_type === "video");
	const audioStreams = exported.streams.filter((stream) => stream.codec_type === "audio").length;
	if (
		!video ||
		video.codec_name !== "h264" ||
		!(video.width > 0 && video.height > 0) ||
		Math.abs(exportedDuration * 1000 - durationMs) > 500
	)
		throw new Error("Exported MP4 did not have the expected H.264 video/duration.");
	if (inputVideo.width !== video.width || inputVideo.height !== video.height)
		throw new Error("Source-quality export dimensions changed with preview quality.");
	if (inputProbe.streams.some((stream) => stream.codec_type === "audio") && audioStreams === 0)
		throw new Error("Source audio was missing from the exported MP4.");
	report.checks.export = {
		via: "application smoke-export controller + actual renderer/encoder",
		...exportReport,
		probe: {
			codec: video.codec_name,
			width: video.width,
			height: video.height,
			duration: exportedDuration,
			bytes: Number(exported.format.size),
			audioStreams: exported.streams.filter((s) => s.codec_type === "audio").length,
		},
	};
	await close(exportApp);
	if (report.errors.length > 0)
		throw new Error("Renderer errors were captured; inspect report.json.");
	report.success = true;
} catch (error) {
	report.errors.push(String(error));
	process.exitCode = 1;
	if (activePage && !activePage.isClosed()) {
		await activePage
			.screenshot({ path: path.join(outputRoot, "failure.png") })
			.catch(() => undefined);
		await fs.writeFile(
			path.join(outputRoot, "failure-ui.txt"),
			await activePage
				.locator("body")
				.innerText()
				.catch(() => "page unavailable"),
		);
	}
} finally {
	if (activeApp) await close(activeApp);
	await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
	await fs.writeFile(path.join(outputRoot, "app.log"), logs.join(""));
	console.log(
		JSON.stringify({ ...report, artifacts: path.relative(projectRoot, outputRoot) }, null, 2),
	);
}
