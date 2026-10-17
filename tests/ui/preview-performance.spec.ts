import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

// Opt-in local benchmark; reports observations instead of asserting machine-specific FPS.
test.skip(!process.env.RECORDLY_BENCHMARK, "Set RECORDLY_BENCHMARK to a report label");
for (const dpr of [1, 2]) {
	test(`preview performance at DPR ${dpr}`, async ({ browser }) => {
		const context = await browser.newContext({
			viewport: { width: 1440, height: 1000 },
			deviceScaleFactor: dpr,
		});
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await installDesktopBridge(page, "filmstrip.mp4");
		const started = performance.now();
		await page.goto("/tests/ui/paused-motion.html?cursor");
		await expect(page.locator("main")).toHaveAttribute("data-ready", "true", {
			timeout: 120000,
		});
		const readyMs = performance.now() - started;
		const dimensions = await page
			.locator("canvas")
			.first()
			.evaluate((c) => ({
				width: c.width,
				height: c.height,
				cssWidth: c.clientWidth,
				cssHeight: c.clientHeight,
			}));
		await page.getByRole("button", { name: "Play", exact: true }).click();
		const composed = await page.evaluate(async () => {
			const video = document.querySelector("video")!;
			const before = video.getVideoPlaybackQuality();
			const gaps: number[] = [];
			let last = performance.now();
			let raf: number;
			const frame = (now: number) => {
				gaps.push(now - last);
				last = now;
				raf = requestAnimationFrame(frame);
			};
			raf = requestAnimationFrame(frame);
			await new Promise((r) => setTimeout(r, 3000));
			cancelAnimationFrame(raf!);
			const after = video.getVideoPlaybackQuality();
			gaps.sort((a, b) => a - b);
			return {
				frames: gaps.length,
				p95FrameMs: gaps[Math.floor(gaps.length * 0.95)],
				videoFrames: after.totalVideoFrames - before.totalVideoFrames,
				droppedFrames: after.droppedVideoFrames - before.droppedVideoFrames,
			};
		});
		// Decode the identical source without the editor compositor for comparison.
		await page.goto("/tests/ui/fixtures/filmstrip.mp4");
		const raw = await page.locator("video").evaluate(async (video) => {
			video.currentTime = 0.8;
			await video.play();
			const before = video.getVideoPlaybackQuality();
			await new Promise((r) => setTimeout(r, 3000));
			const after = video.getVideoPlaybackQuality();
			return {
				videoFrames: after.totalVideoFrames - before.totalVideoFrames,
				droppedFrames: after.droppedVideoFrames - before.droppedVideoFrames,
			};
		});
		const report = { dpr, readyMs, dimensions, composed, raw, errors };
		const root = path.resolve(".tmp", process.env.RECORDLY_BENCHMARK!);
		await fs.mkdir(root, { recursive: true });
		await fs.writeFile(
			path.join(root, `preview-dpr-${dpr}.json`),
			JSON.stringify(report, null, 2),
		);
		console.log(JSON.stringify(report));
		expect(errors).toEqual([]);
		await context.close();
	});
}
