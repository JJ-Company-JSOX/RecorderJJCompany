import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("cursor visibility and sound are available without advanced settings and support undo", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	const show = page.getByRole("switch", { name: "Show Cursor", exact: true });
	const sound = page.getByRole("switch", { name: "Click sound", exact: true });
	await expect(page.getByRole("switch", { name: "Advanced settings" })).not.toBeChecked();
	await expect(show).toBeVisible();
	await expect(sound).toBeVisible();
	const original = await show.isChecked();
	await show.press("Space");
	expect(await show.isChecked()).toBe(!original);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	expect(await show.isChecked()).toBe(original);
	await sound.press("Space");
	await expect(sound).toBeChecked();
	await expect(
		page.getByRole("slider", { name: "Click sound volume", exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: "test-results/editor-cursor-reference.png",
		animations: "disabled",
	});
	const inspector = (await page.locator("aside").boundingBox())!;
	const preview = (await page.locator(".editor-preview-stage").boundingBox())!;
	expect(inspector.x + inspector.width).toBeLessThanOrEqual(preview.x);
});
