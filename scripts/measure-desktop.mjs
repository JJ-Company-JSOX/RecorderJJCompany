// Local-only diagnostics: synthetic/explicit inputs, isolated user data, no uploads.
import fs from "node:fs/promises";
import path from "node:path";
import { _electron as electron } from "@playwright/test";

const label = process.argv[2] || "measurement";
const input = path.resolve(process.argv[3] || "tests/ui/fixtures/filmstrip.mp4");
const executablePath = process.env.RECORDLY_TEST_EXECUTABLE;
const profilePlaying = process.env.RECORDLY_CPU_PROFILE === "1";
const disableOcclusion = process.env.RECORDLY_BENCHMARK_NO_OCCLUSION === "1";
const root = path.resolve(".tmp", label);
await fs.mkdir(root, { recursive: true });
const env = {
	...process.env,
	RECORDLY_DIAGNOSTICS_USER_DATA: path.join(root, "profile"),
	RECORDLY_DISABLE_AUTO_UPDATES: "1",
	RECORDLY_DEV_OPEN_RECORDING_INPUT: input,
};
delete env.ELECTRON_RUN_AS_NODE;
const start = performance.now();
const app = await electron.launch({
	...(executablePath ? { executablePath } : {}),
	args: [
		...(executablePath ? [] : ["."]),
		...(disableOcclusion
			? [
					"--disable-features=CalculateNativeWinOcclusion",
					"--disable-backgrounding-occluded-windows",
				]
			: []),
	],
	env,
	timeout: 120000,
});
const logs = [];
app.process().stdout?.on("data", (chunk) =>
	logs.push(`${Math.round(performance.now() - start)} ${chunk}`),
);
app.process().stderr?.on("data", (chunk) =>
	logs.push(`${Math.round(performance.now() - start)} ${chunk}`),
);
const report = {
	label,
	input: path.basename(input),
	profilePlaying,
	disableOcclusion,
	stages: {},
	samples: [],
	errors: [],
	warnings: [],
};
try {
	const page = await app.firstWindow();
	report.stages.windowMs = Math.round(performance.now() - start);
	// Occluded Windows windows can receive only one RAF per second. Keep this
	// diagnostic window visible so a covered preview is not counted as slow code.
	report.runtime = await app.evaluate(({ BrowserWindow, app, powerSaveBlocker }) => {
		powerSaveBlocker.start("prevent-display-sleep");
		const window = BrowserWindow.getAllWindows()[0];
		window.show();
		window.setAlwaysOnTop(true);
		window.focus();
		return {
			visible: window.isVisible(),
			backgroundThrottling: window.webContents.getBackgroundThrottling(),
			gpuFeatures: app.getGPUFeatureStatus(),
		};
	});
	page.on("pageerror", (error) => report.errors.push(error.message));
	await page.waitForSelector("canvas", { timeout: 120000 });
	await page.waitForFunction(
		() => [...document.querySelectorAll("video")].some((v) => v.readyState >= 2),
		null,
		{ timeout: 60000 },
	);
	report.stages.previewMs = Math.round(performance.now() - start);
	report.navigation = await page.evaluate(() =>
		performance.getEntriesByType("navigation")[0]?.toJSON(),
	);
	report.display = await page.evaluate(() => ({
		visibility: document.visibilityState,
		focused: document.hasFocus(),
		dpr: devicePixelRatio,
		width: innerWidth,
		height: innerHeight,
		canvas: [...document.querySelectorAll("canvas")].map((c) => ({
			width: c.width,
			height: c.height,
			cssWidth: c.clientWidth,
			cssHeight: c.clientHeight,
		})),
	}));
	for (const phase of ["idle", "playing"]) {
		const profiler =
			profilePlaying && phase === "playing" ? await page.context().newCDPSession(page) : null;
		if (profiler) {
			await profiler.send("Profiler.enable");
			await profiler.send("Profiler.start");
		}
		if (phase === "playing")
			await page.getByRole("button", { name: "Play", exact: true }).click();
		await app.evaluate(({ app }) => app.getAppMetrics());
		report[phase] = await page.evaluate(async () => {
			const video = [...document.querySelectorAll("video")].find((v) => v.videoWidth > 0);
			const before = video?.getVideoPlaybackQuality();
			const gaps = [];
			let last = performance.now();
			let raf;
			const frame = (now) => {
				gaps.push(now - last);
				last = now;
				raf = requestAnimationFrame(frame);
			};
			raf = requestAnimationFrame(frame);
			await new Promise((resolve) => setTimeout(resolve, 4000));
			cancelAnimationFrame(raf);
			const after = video?.getVideoPlaybackQuality();
			gaps.sort((a, b) => a - b);
			return {
				frames: gaps.length,
				p95FrameMs: gaps[Math.floor(gaps.length * 0.95)],
				videoFrames: (after?.totalVideoFrames || 0) - (before?.totalVideoFrames || 0),
				droppedFrames: (after?.droppedVideoFrames || 0) - (before?.droppedVideoFrames || 0),
				currentTime: video?.currentTime,
				paused: video?.paused,
			};
		});
		if (profiler) {
			const { profile } = await profiler.send("Profiler.stop");
			await fs.writeFile(path.join(root, "playing.cpuprofile"), JSON.stringify(profile));
			await profiler.detach();
		}
		if (report[phase].frames < 20)
			report.warnings.push(
				`${phase}: very low RAF cadence; check native window throttling before attributing this result to editor CPU.`,
			);
		report.samples.push({
			phase,
			processes: await app.evaluate(({ app }) =>
				app.getAppMetrics().map((p) => ({
					type: p.type,
					name: p.name,
					cpu: p.cpu.percentCPUUsage,
					workingSetKB: p.memory.workingSetSize,
					peakWorkingSetKB: p.memory.peakWorkingSetSize,
				})),
			),
		});
	}
	const mediaUrl = await page
		.locator("video")
		.first()
		.evaluate((v) => v.currentSrc);
	await page.goto(mediaUrl);
	report.raw = await page.locator("video").evaluate(async (video) => {
		video.currentTime = 0;
		await video.play();
		const before = video.getVideoPlaybackQuality();
		await new Promise((resolve) => setTimeout(resolve, 4000));
		const after = video.getVideoPlaybackQuality();
		return {
			videoFrames: after.totalVideoFrames - before.totalVideoFrames,
			droppedFrames: after.droppedVideoFrames - before.droppedVideoFrames,
		};
	});
} catch (error) {
	report.errors.push(String(error));
	process.exitCode = 1;
} finally {
	await fs.writeFile(path.join(root, "report.json"), JSON.stringify(report, null, 2));
	await fs.writeFile(path.join(root, "app.log"), logs.join(""));
	console.log(JSON.stringify(report, null, 2));
	await app
		.evaluate(({ app }) => app.exit(0))
		.catch(() => {
			/* Process exit closes the connection. */
		});
	await app.close().catch(() => {
		/* App already exited. */
	});
}
