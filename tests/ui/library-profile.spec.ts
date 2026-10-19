import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

// Diagnostic only: the profiling Vite transform must inject __libraryRenders.
// Ordinary UI runs have neither that transform nor an output report path.
test("count library work during real video playback", async ({ page }) => {
	const reportPath = process.env.LIBRARY_PROFILE_REPORT;
	test.skip(!reportPath, "Requires the instrumented profiling server and LIBRARY_PROFILE_REPORT");
	if (!reportPath) return;
	test.setTimeout(120000);
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.listRecordings = async () => ({ success: true, value: [] });
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 90000,
	});
	await expect(page.getByLabel("Loading preview")).toHaveCount(0);
	await page.getByRole("button", { name: "Clips", exact: true }).click();
	await expect(page.locator("[data-recording-library]")).toBeVisible();
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
	await page.waitForTimeout(1000);
	const before = await page.evaluate(
		() => (window as Window & { __libraryRenders?: number }).__libraryRenders,
	);
	expect(before, "Use the instrumented profiling Vite server").toBeGreaterThan(0);
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await page.waitForTimeout(3000);
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	const after = await page.evaluate(
		() => (window as Window & { __libraryRenders?: number }).__libraryRenders,
	);
	expect(after).toBeDefined();
	if (before === undefined || after === undefined)
		throw Error("Missing profiling instrumentation");
	const report = {
		variant: process.env.LIBRARY_PROFILE_VARIANT,
		renders: after - before,
		windowMs: 3000,
		before,
		after,
	};
	await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report));
});
