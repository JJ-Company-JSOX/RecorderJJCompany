import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("fresh signed-out install opens editor without email or authentication requests", async ({
	page,
}) => {
	// Match the existing 60s readiness assertion plus cold Vite navigation/setup.
	test.setTimeout(90000);
	const authRequests: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/auth/v1/")) authRequests.push(request.url());
	});
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAppSetting = () => null;
	});
	await page.goto("/?windowType=editor");
	// Windows cold Vite compilation can outlast the default assertion budget.
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 60000,
	});
	await expect(page.locator('input[type="email"]')).toHaveCount(0);
	await expect(page.locator('[data-onboarding-state="login"]')).toHaveCount(0);
	await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Auto edit plan", exact: true })).toBeVisible();
	expect(authRequests).toEqual([]);
});

test("recording permissions remain available to signed-out users", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAppSetting = (key) =>
			key === "recordly.onboarding.permissionsRequested" ? true : null;
		window.electronAPI.getPlatform = async () => "win32";
	});
	await page.goto("/?windowType=editor");
	const permissions = page.getByRole("dialog", { name: "Recording permissions", exact: true });
	await expect(permissions).toBeVisible({ timeout: 60000 });
	await expect(page.locator('input[type="email"]')).toHaveCount(0);
	await permissions.getByRole("button", { name: "Start recording" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-hud-opened", "true");
	await expect(permissions).toHaveCount(0);
});

for (const platform of ["win32", "linux", "darwin"] as const) {
	test(`signed-out ${platform} HUD opens the real source-picker path without an account redirect`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
		await installDesktopBridgeOverrides(page, () => {
			window.electronAPI.pickCaptureTarget = async () => {
				document.documentElement.dataset.pickerOpened = "true";
				return { success: true, canceled: true };
			};
		});
		await page.addInitScript((value) => {
			window.electronAPI.getPlatform = async () => value;
		}, platform);
		await page.goto("/?windowType=hud-overlay");
		const source = page.getByRole("button", { name: "Choose recording source", exact: true });
		await expect(source).toBeVisible({ timeout: 15000 });
		await expect(source).toBeEnabled({ timeout: 15000 });
		await source.click();
		await expect(page.locator("html")).toHaveAttribute("data-picker-opened", "true");
		await expect(page.locator("html")).not.toHaveAttribute("data-permissions-opened", "true");
		await expect(page.locator('input[type="email"]')).toHaveCount(0);
	});
}

test("macOS still blocks capture selection when system permission is missing", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getPlatform = async () => "darwin";
		window.electronAPI.getScreenRecordingPermissionStatus = async () => ({
			success: true,
			status: "denied",
		});
		window.electronAPI.pickCaptureTarget = async () => {
			document.documentElement.dataset.pickerOpened = "true";
			return { success: true, canceled: true };
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await page.getByRole("button", { name: "Choose recording source", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-permissions-opened", "true");
	await expect(page.locator("html")).not.toHaveAttribute("data-picker-opened", "true");
});
