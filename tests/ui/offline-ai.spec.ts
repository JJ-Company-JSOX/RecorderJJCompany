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
			if (input.model !== "jsox-bundled-vision" || input.count !== 8)
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
	await page.locator("[data-analysis-options] > summary").click();
	const panel = page.locator("[data-auto-edit-panel]");
	await panel.getByRole("button", { name: "Generate offline AI plan" }).click();
	await expect(panel.locator("[data-suggestion-id]")).toHaveCount(1);
	await expect(page.locator("html")).toHaveAttribute("data-offline-ai-calls", "1");
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(0);
	await panel.getByRole("button", { name: "Accept remaining suggestions" }).click();
	await panel.getByRole("button", { name: "Done", exact: true }).click();
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(0);
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(1);
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
	await page.locator("[data-analysis-options] > summary").click();
	const panel = page.locator("[data-auto-edit-panel]");
	await expect(panel.getByRole("button", { name: "Generate offline AI plan" })).toBeDisabled();
	await expect(panel.getByText(/Use the full offline AI edition/)).toBeVisible();
	await page.getByLabel("Plan language").selectOption("zh");
	await expect(panel.getByText(/无需单独配置 AI/)).toBeVisible();
});

test("after applying, AI voice-over drafts, waits for approval and adds an audio track", async ({
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
			if (input.model !== "jsox-bundled-vision" || input.count !== 8)
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
		window.electronAPI.narrateAutoEditBundled = async (plan, _language, screen) => {
			document.documentElement.dataset.narrationFrames = JSON.stringify(
				screen?.frames.map((f) => ({ id: f.id, focused: !!f.focus })),
			);
			document.documentElement.dataset.narrationStyle = screen?.style ?? "";
			return {
				success: true,
				draft: {
					cues: plan.suggestions.map((s) => ({
						id: s.id,
						startMs: s.startMs,
						endMs: s.endMs,
						text: "这里放大显示刚才点击的按钮。",
					})),
				},
			};
		};
		window.electronAPI.getBundledTtsStatus = async () => ({
			available: true,
			voices: { zh: true, en: true, ms: false },
		});
		window.electronAPI.synthesizeAutoEditNarration = async (cues) => ({
			success: true,
			clips: cues.map((c) => ({
				id: c.id,
				audioPath: "/tmp/narration.wav",
				durationMs: 1500,
			})),
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 60000,
	});
	await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
	await page.locator("[data-analysis-options] > summary").click();
	const panel = page.locator("[data-auto-edit-panel]");
	await panel.getByRole("button", { name: "Generate offline AI plan" }).click();
	await expect(panel.locator("[data-suggestion-id]")).toHaveCount(1);
	await expect(page.locator("html")).toHaveAttribute("data-offline-ai-calls", "1");
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(0);
	await panel.getByRole("button", { name: "Accept remaining suggestions" }).click();
	await panel.getByRole("button", { name: "Done", exact: true }).click();
	await panel.getByLabel("Plan language").selectOption("zh");
	await panel.getByRole("button", { name: "下一步：加 AI 配音" }).click();
	await panel.getByLabel("解说风格").selectOption("detailed");
	await panel.getByRole("button", { name: "生成解说稿草稿" }).click();
	await expect(panel.locator("textarea")).toHaveCount(1);
	// The AI is shown the zoomed spot of the recording before it writes the line.
	await expect(page.locator("html")).toHaveAttribute("data-narration-style", "detailed");
	await expect(page.locator("html")).toHaveAttribute(
		"data-narration-frames",
		JSON.stringify([{ id: "zoom-1", focused: true }]),
	);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.screenshot({ path: "test-results/wizard-voice-draft-zh.png" });
	await panel.getByRole("checkbox", { name: /我已逐句审阅/ }).check();
	await panel.getByRole("button", { name: "生成解说语音" }).click();
	await expect(
		panel.getByText("解说语音已添加为新的、可撤销的音轨，并自动加上了对应字幕。"),
	).toBeVisible();
	await page.screenshot({ path: "test-results/wizard-voice-done-zh.png" });
	await panel.getByLabel("Plan language").selectOption("ms");
	await expect(panel.getByText(/Belum ada suara Melayu terbina dalam/)).toBeVisible();
	await panel.getByLabel("Plan language").selectOption("en");
	await expect(panel.getByText(/Belum ada suara Melayu/)).toHaveCount(0);
	await panel.getByLabel("Plan language").selectOption("zh");
	await panel.getByRole("button", { name: "完成", exact: true }).click();
	await expect(page.locator('[data-variant="audio"]')).toHaveCount(1);
	// The approved narration line also becomes a subtitle for the silent recording.
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(1);
});
