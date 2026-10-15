import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("fresh signed-out install opens editor without email or authentication requests", async ({ page }) => {
 const authRequests: string[] = [];
 page.on("request", request => { if (request.url().includes('/auth/v1/')) authRequests.push(request.url()); });
 await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
 await installDesktopBridgeOverrides(page, () => { window.electronAPI.getAppSetting = () => null; });
 await page.goto('/?windowType=editor');
 await expect(page.locator('[data-variant="clip"]')).toHaveAttribute('data-end-ms', '6000');
 await expect(page.locator('input[type="email"]')).toHaveCount(0);
 await expect(page.locator('[data-onboarding-state="login"]')).toHaveCount(0);
 await page.getByRole('button', {name:'Auto edit plan',exact:true}).click();
 await expect(page.getByRole('dialog', {name:'Auto edit plan',exact:true})).toBeVisible();
 expect(authRequests).toEqual([]);
});

test("recording permissions remain available to signed-out users", async ({ page }) => {
 await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
 await installDesktopBridgeOverrides(page, () => {
  window.electronAPI.getAppSetting = key => key === 'recordly.onboarding.permissionsRequested' ? true : null;
  window.electronAPI.getPlatform = async () => 'win32';
 });
 await page.goto('/?windowType=editor');
 const permissions = page.getByRole('dialog',{name:'Recording permissions',exact:true});
 await expect(permissions).toBeVisible();
 await expect(page.locator('input[type="email"]')).toHaveCount(0);
 await permissions.getByRole('button',{name:'Start recording'}).click();
 await expect(page.locator('html')).toHaveAttribute('data-hud-opened','true');
 await expect(permissions).toHaveCount(0);
});
