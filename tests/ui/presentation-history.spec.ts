import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("canvas ratio and background effects can be undone and redone", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
	await expect(page.getByLabel("Loading preview")).toHaveCount(0);
	await page.getByRole("button", { name: "16:9", exact: true }).click();
	await page.getByRole("menuitem", { name: "1:1", exact: true }).click();
	await expect(page.getByRole("button", { name: "1:1", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.getByRole("button", { name: "16:9", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect(page.getByRole("button", { name: "1:1", exact: true })).toBeVisible();
	await page.getByRole("radio", { name: "Scene", exact: true }).click();
	const blur = page.getByRole("slider", { name: "Blur", exact: true });
	const before = await blur.inputValue();
	await blur.press("ArrowRight");
	const after = await blur.inputValue();
	expect(after).not.toBe(before);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(blur).toHaveValue(before);
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect(blur).toHaveValue(after);
});
