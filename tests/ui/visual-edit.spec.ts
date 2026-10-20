import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.use({ viewport: { width: 1440, height: 1000 } });

test("visual suggestions require image consent, per-item acceptance and support undo", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.analyzeAutoEdit = async () => ({
			success: true,
			evidence: {
				durationMs: 6000,
				staticRanges: [],
				silentRanges: [],
				audioVerified: false,
				warnings: [],
			},
		});
		window.electronAPI.cancelAutoEditAnalysis = async () => undefined;
		window.electronAPI.inspectAutoEditLocalModel = async () => ({
			success: true,
			info: {
				name: "vision-fixture",
				sizeBytes: 123456,
				license: "Test fixture only",
				capabilities: ["vision"],
			},
		});
		window.electronAPI.analyzeAutoEditFrames = async () => ({
			success: true,
			analysis: {
				durationMs: 6000,
				sampledTimesMs: [1000],
				model: "vision-fixture",
				elapsedMs: 100,
				observations: [
					{
						timeMs: 1000,
						focus: { cx: 0.7, cy: 0.3 },
						caption: "Save",
						rationale: "Visible save button",
					},
				],
			},
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
	await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
	await page.locator("[data-analysis-options] > summary").click();
	const dialog = page.getByRole("dialog", { name: "Auto edit plan", exact: true });
	await dialog.getByRole("button", { name: "Generate local plan" }).click();
	await dialog.getByText("Optional local AI review", { exact: true }).click();
	await dialog
		.getByRole("textbox", { name: "Name of an already installed Ollama model" })
		.fill("vision-fixture");
	await dialog.getByRole("button", { name: "Inspect installed model" }).click();
	const analyze = dialog.getByRole("button", { name: "Analyze video frames", exact: true });
	await expect(analyze).toBeDisabled();
	await dialog
		.getByRole("checkbox", {
			name: "I have reviewed the displayed license and local processing limits.",
		})
		.check();
	await expect(analyze).toBeDisabled();
	await dialog
		.getByRole("checkbox", {
			name: "I agree to send these sampled images to my local Ollama service.",
		})
		.check();
	await analyze.click();
	await expect(dialog.locator("[data-suggestion-id]")).toHaveCount(1);
	const apply = dialog.getByRole("button", { name: "Apply accepted edits" });
	await expect(apply).toBeDisabled();
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
	await dialog.getByRole("radio", { name: "Accept", exact: true }).nth(0).check();
	await apply.click();
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(0);
	await expect(dialog.getByRole("status").filter({ hasText: "Applied" })).toBeVisible();
	await page.screenshot({ path: "test-results/visual-ai-review.png" });
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(1);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
});
