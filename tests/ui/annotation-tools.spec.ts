import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("sidebar annotation tools create editable layers with undo and project persistence", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.onMenuSaveProject = (callback) => {
			const handler = () => void callback();
			window.addEventListener("test-save-project", handler);
			return () => window.removeEventListener("test-save-project", handler);
		};
		window.electronAPI.saveProjectFile = async (project) => {
			sessionStorage.setItem(
				"saved-annotations",
				JSON.stringify(project.editor.annotationRegions),
			);
			return { success: true, path: "/test.recordly" };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
	const tools = page.getByRole("radio", { name: "Annotation tools", exact: true });
	await tools.click();
	await page.getByRole("button", { name: "Arrow", exact: true }).click();
	const layers = page.locator('[data-variant="annotation"]');
	await expect(layers).toHaveCount(1);
	await tools.click();
	await page.getByRole("button", { name: "Blur mask", exact: true }).click();
	await expect(layers).toHaveCount(2);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(layers).toHaveCount(1);
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect(layers).toHaveCount(2);
	await page.evaluate(() => window.dispatchEvent(new Event("test-save-project")));
	await expect
		.poll(() =>
			page.evaluate(() => JSON.parse(sessionStorage.getItem("saved-annotations") || "[]")),
		)
		.toMatchObject([
			{ type: "figure", figureData: { arrowDirection: "right" } },
			{ type: "blur" },
		]);
	await tools.click();
	await page.screenshot({
		path: "test-results/editor-annotation-tools.png",
		animations: "disabled",
	});
});
