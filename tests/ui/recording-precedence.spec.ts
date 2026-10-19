import { test, expect } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
test("a finalized recording takes precedence over a stale demo query on editor reload", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.setCurrentVideoPath = async () => {
			document.documentElement.dataset.demoOverwroteRecording = "true";
			return { success: true };
		};
	});
	await page.goto("/?windowType=editor&devOpenInput=C%3A%5Cmissing-demo.mp4");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 60000,
	});
	await expect(page.locator("html")).not.toHaveAttribute("data-demo-overwrote-recording");
});
