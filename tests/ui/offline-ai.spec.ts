import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

// Cold Vite imports can be slow while the native runtime is compiled on this laptop.
test.beforeEach(() => test.setTimeout(150000));

test("included offline AI needs one click, no model setup, and keeps Apply and Undo explicit", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getBundledAiStatus = async () => ({
			available: true,
			modelName: "Bundled fixture",
			modelBytes: 100,
			freeMemoryBytes: 8e9,
			requiredMemoryBytes: 3e9,
		});
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
		window.electronAPI.inspectAutoEditLocalModel = async () => {
			throw Error("Customer must not configure a model");
		};
		window.electronAPI.analyzeAutoEditFrames = async (input) => {
			if (input.model !== "jsox-bundled-vision" || input.count !== 4)
				throw Error("Bundled model must be selected automatically");
			document.documentElement.dataset.offlineAiCalls = String(
				Number(document.documentElement.dataset.offlineAiCalls || 0) + 1,
			);
			return {
				success: true,
				analysis: {
					durationMs: 6000,
					sampledTimesMs: [1000],
					model: "Bundled fixture",
					elapsedMs: 100,
					observations: [
						{
							timeMs: 1000,
							focus: { cx: 0.6, cy: 0.4 },
							caption: "Save",
							rationale: "fixture",
						},
					],
				},
			};
		};
		window.electronAPI.cancelAutoEditAnalysis = async () => undefined;
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 60000,
	});
	await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
	const panel = page.locator("[data-auto-edit-panel]");
	await panel.getByRole("button", { name: "Generate offline AI plan" }).click();
	await expect(panel.locator("[data-suggestion-id]")).toHaveCount(1);
	await expect(page.locator("html")).toHaveAttribute("data-offline-ai-calls", "1");
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(0);
	await panel.getByRole("button", { name: "Accept remaining suggestions" }).click();
	await panel.getByRole("button", { name: "Apply accepted edits" }).click();
	await panel.getByRole("button", { name: "Close", exact: true }).click();
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(1);
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(0);
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
});

test("a build without model assets explains the full edition and does not prompt customer setup", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getBundledAiStatus = async () => ({
			available: false,
			reason: "missing",
			modelName: "fixture",
			modelBytes: 0,
			freeMemoryBytes: 8e9,
			requiredMemoryBytes: 3e9,
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toBeVisible({ timeout: 60000 });
	await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
	const panel = page.locator("[data-auto-edit-panel]");
	await expect(panel.getByRole("button", { name: "Generate offline AI plan" })).toBeDisabled();
	await expect(panel.getByText(/Use the full offline AI edition/)).toBeVisible();
	await page.getByLabel("Plan language").selectOption("zh");
	await expect(panel.getByText(/无需单独配置 AI/)).toBeVisible();
});
