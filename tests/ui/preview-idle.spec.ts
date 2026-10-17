import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("paused preview stops GPU submissions and wakes for seeks and quality changes", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/tests/ui/paused-motion.html?cursor");
	const main = page.locator("main");
	await expect(main).toHaveAttribute("data-ready", "true", { timeout: 60000 });
	await expect(page.locator("canvas")).toHaveCount(1);
	const read = async () => {
		await page.getByRole("button", { name: "Read render count", exact: true }).click();
		return Number(await main.getAttribute("data-render-count"));
	};
	// Read through two idle intervals rather than assuming a settled first frame.
	await expect.poll(read).toBeGreaterThanOrEqual(0);
	await page.waitForTimeout(300);
	const before = await read();
	await page.waitForTimeout(500);
	expect(await read()).toBe(before);
	await page.getByRole("button", { name: "Seek elsewhere", exact: true }).click();
	await expect.poll(read).toBeGreaterThan(before);
	await page.getByRole("button", { name: "Full preview", exact: true }).click();
	await expect(main).toHaveAttribute("data-ready", "true");
	await expect(page.locator("canvas")).toHaveCount(1);
	await page.getByRole("button", { name: "Balanced preview", exact: true }).click();
	await expect(main).toHaveAttribute("data-ready", "true");
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect
		.poll(() =>
			page
				.locator("video")
				.first()
				.evaluate((v) => v.currentTime),
		)
		.toBeGreaterThan(3.1);
});
