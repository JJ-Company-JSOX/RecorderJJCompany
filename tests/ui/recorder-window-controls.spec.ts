import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function setup(page: Page) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		localStorage.setItem("recordly.locale", "en");
		window.electronAPI.getPlatform = async () => "win32";
		window.electronAPI.selectSource = async (source) => source;
		window.electronAPI.hudOverlayHide = () => {
			document.documentElement.dataset.recorderMinimized = "true";
		};
		window.electronAPI.hudOverlayClose = () => {
			document.documentElement.dataset.recorderClosed = "true";
		};
		window.electronAPI.isNativeWindowsCaptureAvailable = async () => ({ available: false });
		let finish: ((value: { success: boolean; cancelled: boolean }) => void) | undefined;
		window.electronAPI.startCountdown = async () => {
			document.documentElement.dataset.countdownStarted = "true";
			return new Promise((resolve) => {
				finish = resolve;
			});
		};
		window.electronAPI.cancelCountdown = async () => {
			document.documentElement.dataset.countdownCanceled = "true";
			finish?.({ success: false, cancelled: true });
			return { success: true };
		};
	});
	await page.goto("/?windowType=hud-overlay");
}

test("setup close and minimize buttons stay outside native drag regions and invoke window actions", async ({
	page,
}) => {
	await setup(page);
	const close = page.getByRole("button", { name: "Close recorder", exact: true });
	const minimize = page.getByRole("button", { name: "Hide controls", exact: true });
	await expect(close).toBeVisible();
	await page.evaluate(async () => {
		const { toast } = await import("/src/components/ui/toast.tsx");
		toast.info("Notification must not cover window controls", { duration: Infinity });
	});
	await expect(page.getByRole("alertdialog")).toBeVisible();
	for (const width of [1440, 860, 560]) {
		await page.setViewportSize({ width, height: 540 });
		for (const button of [close, minimize]) {
			await expect
				.poll(() =>
					button.evaluate((element) => {
						const rect = element.getBoundingClientRect();
						return element.contains(
							document.elementFromPoint(
								rect.x + rect.width / 2,
								rect.y + rect.height / 2,
							),
						);
					}),
				)
				.toBe(true);
		}
	}
	expect(
		await close.evaluate((button) =>
			getComputedStyle(button).getPropertyValue("-webkit-app-region"),
		),
	).toBe("no-drag");
	await minimize.click();
	await expect(page.locator("html")).toHaveAttribute("data-recorder-minimized", "true");
	await close.click();
	await expect(page.locator("html")).toHaveAttribute("data-recorder-closed", "true");
});

test("ready-bar X cancels a pending countdown before closing the recorder", async ({ page }) => {
	await setup(page);
	await page.getByRole("button", { name: "Full screen Choose a display" }).click();
	await page.getByRole("button", { name: "Built-in Display", exact: true }).click();
	const ready = page.getByRole("group", { name: "Ready to record", exact: true });
	await ready.getByRole("button", { name: "Start recording", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-countdown-started", "true");
	await ready.getByRole("button", { name: "Close recorder", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-countdown-canceled", "true");
	await expect(page.locator("html")).toHaveAttribute("data-recorder-closed", "true");
});
