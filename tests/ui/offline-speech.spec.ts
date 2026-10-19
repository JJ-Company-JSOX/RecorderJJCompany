import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

// UI contracts use explicit fixtures. Real ASR/model quality is validated separately.
test.beforeEach(() => test.setTimeout(150000));

async function setup(
	page: Page,
	options: { speechAvailable: boolean; deferred: boolean; labels?: boolean } = {
		speechAvailable: true,
		deferred: false,
	},
) {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(
		page,
		(options) => {
			window.electronAPI.getBundledAiStatus = async () => ({
				available: true,
				modelName: "Bundled fixture",
				modelBytes: 100,
				freeMemoryBytes: 8e9,
				requiredMemoryBytes: 3e9,
			});
			window.electronAPI.getBundledSpeechStatus = async () => ({
				available: options.speechAvailable,
				modelName: "Speech fixture",
				...(!options.speechAvailable ? { reason: "missing" } : {}),
			});
			let progress: ((stage: string) => void) | undefined;
			window.electronAPI.onCompleteAutoEditProgress = (callback) => {
				progress = callback;
				return () => {
					progress = undefined;
				};
			};
			window.electronAPI.analyzeAutoEdit = async () => {
				throw Error("Complete mode must use one IPC call");
			};
			window.electronAPI.analyzeAutoEditFrames = async () => {
				throw Error("Complete mode already includes vision");
			};
			window.electronAPI.analyzeCompleteAutoEdit = async () => {
				document.documentElement.dataset.speechCalls = String(
					Number(document.documentElement.dataset.speechCalls || 0) + 1,
				);
				progress?.("transcribe");
				if (options.deferred)
					await new Promise<void>((resolve) =>
						window.addEventListener("test-finish-speech", () => resolve(), {
							once: true,
						}),
					);
				progress?.("understand");
				document.documentElement.dataset.speechResolved = "true";
				return {
					success: true,
					evidence: {
						durationMs: 6000,
						staticRanges: [],
						silentRanges: [],
						audioVerified: true,
						warnings: [],
					},
					speech: {
						version: 1,
						transcript: {
							version: 1,
							durationMs: 6000,
							audioVerified: true,
							alignmentVerified: true,
							cues: [
								{
									id: "first",
									startMs: 500,
									endMs: 1500,
									text: "Open file",
									confidence: 0.98,
									vadBoundaryVerified: true,
								},
								{
									id: "last",
									startMs: 3000,
									endMs: 4000,
									text: "Open file",
									confidence: 0.98,
									vadBoundaryVerified: true,
								},
							],
						},
						cuts: [
							{
								kind: "repeat",
								removeCueIds: ["first"],
								keepCueIds: ["last"],
								rationale: "Fixture repeated take",
							},
						],
						warnings: ["speech-review-required"],
					},
					analysis: {
						durationMs: 6000,
						sampledTimesMs: [],
						observations: options.labels
							? [
									{
										timeMs: 2000,
										focus: null,
										caption: "Save",
										rationale: "Fixture label",
									},
								]
							: [],
						model: "Fixture",
						elapsedMs: 1,
					},
				};
			};
			window.electronAPI.cancelAutoEditAnalysis = async () => {
				document.documentElement.dataset.speechCancelled = "true";
			};
		},
		options,
	);
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 60000,
	});
	await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
	const panel = page.locator("[data-auto-edit-panel]");
	await expect(
		panel.getByRole("button", { name: "Automatically edit speech and video", exact: true }),
	).toBeEnabled();
	return panel;
}

test("offline scene tool previews source boundaries and Sherpa never auto-applies captions", async ({
	page,
}) => {
	const panel = await setup(page);
	await page.evaluate(() => {
		window.electronAPI.getOfflineToolsStatus = async () => ({
			rnnoise: { available: true },
			scene: { available: true },
			sherpa: { available: true },
		});
		window.electronAPI.runOfflineTool = async (input) =>
			input.kind === "scene"
				? {
						success: true,
						kind: "scene",
						analysis: {
							version: 1,
							engine: "PySceneDetect",
							engineVersion: "0.7.2",
							durationMs: 6000,
							timing: "sampled-frame-boundary",
							frameSkip: 2,
							scenes: [
								{ startMs: 0, endMs: 3000 },
								{ startMs: 3000, endMs: 6000 },
							],
						},
					}
				: {
						success: true,
						kind: "sherpa",
						transcript: {
							engine: "sherpa-onnx",
							model: "fixture",
							durationMs: 6000,
							elapsedMs: 10,
							warning: "comparison",
							cues: [
								{
									startMs: 500,
									endMs: 1500,
									text: "Reviewed offline transcript",
									alignment: "audio-chunk",
								},
							],
						},
					};
	});
	const tools = panel.locator("[data-offline-tools]");
	await tools.locator("summary").click();
	await tools.getByRole("button", { name: "Detect scenes", exact: true }).click();
	await expect(tools.getByText("2 scenes, sampled frame timing", { exact: true })).toBeVisible();
	await tools.getByRole("button", { name: "2: 3.00–6.00s", exact: true }).click();
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000");
	await tools
		.getByRole("button", { name: "Generate comparison transcript", exact: true })
		.click();
	await expect(tools.getByText(/Reviewed offline transcript/)).toBeVisible();
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(0);
	await tools.getByRole("button", { name: "Apply reviewed result", exact: true }).click();
	await expect(
		tools.getByText("Edits changed. Generate a fresh result before applying.", { exact: true }),
	).toBeVisible();
});

test("one click automatically applies grounded subtitles and trim in one undoable transaction", async ({
	page,
}) => {
	const panel = await setup(page, { speechAvailable: true, deferred: false, labels: true });
	await expect(
		panel.getByRole("checkbox", { name: /Apply the automatic draft when ready/ }),
	).toBeChecked();
	await panel
		.getByRole("button", { name: "Automatically edit speech and video", exact: true })
		.click();
	await expect(
		panel.getByText("Applied. Use Undo to restore the previous timeline.", { exact: true }),
	).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-speech-calls", "1");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(2);
	await expect(page.locator('[data-variant="clip"]').last()).toHaveAttribute(
		"data-end-ms",
		"5000",
	);
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(1);
	await expect(page.locator('[data-variant="annotation"]')).toHaveCount(0);
	await panel.getByRole("button", { name: "Close", exact: true }).click();
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000");
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(0);
});

test("cancel ignores a late completed model reply without applying any edits", async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 640 });
	const panel = await setup(page, { speechAvailable: true, deferred: true });
	await panel
		.getByRole("button", { name: "Automatically edit speech and video", exact: true })
		.click();
	await expect(
		panel.getByRole("status").filter({ hasText: "Recognizing speech locally" }),
	).toBeVisible();
	await expect(panel.locator("[data-analysis-progress]")).toBeInViewport();
	await expect(
		panel.getByRole("button", { name: "Cancel analysis", exact: true }),
	).toBeInViewport();
	await panel.getByRole("button", { name: "Cancel analysis", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-speech-cancelled", "true");
	await page.evaluate(() => window.dispatchEvent(new Event("test-finish-speech")));
	await expect(page.locator("html")).toHaveAttribute("data-speech-resolved", "true");
	await expect(
		panel.getByRole("button", { name: "Automatically edit speech and video", exact: true }),
	).toBeEnabled();
	await expect(panel.locator("[data-suggestion-id]")).toHaveCount(0);
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000");
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(0);
	await expect(
		panel.getByText("Applied. Use Undo to restore the previous timeline.", { exact: true }),
	).toHaveCount(0);
});

test("new signed-out projects export locally without opening a sign-in flow", async ({ page }) => {
	const panel = await setup(page);
	await panel.getByRole("button", { name: "Back to editor", exact: true }).click();
	await page.getByRole("button", { name: "Export", exact: true }).click();
	await expect(page.getByRole("row", { name: "Local", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByRole("button", { name: "Export Video", exact: true })).toBeVisible();
	await expect(page.locator('input[type="email"]')).toHaveCount(0);
});

test("review mode shows speech proposals and leaves the timeline unchanged until Apply", async ({
	page,
}) => {
	const panel = await setup(page);
	await panel.getByRole("checkbox", { name: /Apply the automatic draft when ready/ }).uncheck();
	await panel
		.getByRole("button", { name: "Automatically edit speech and video", exact: true })
		.click();
	await expect(panel.locator("[data-suggestion-id]")).toHaveCount(3);
	await expect(panel.getByText("Speech subtitle", { exact: true })).toHaveCount(2);
	await expect(
		panel.getByRole("button", { name: "Apply accepted edits", exact: true }),
	).toBeDisabled();
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000");
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(0);
});

test("a missing speech bundle disables complete editing and explains the full edition", async ({
	page,
}) => {
	// The visual bundle is present; missing speech alone must disable the complete action.
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getBundledAiStatus = async () => ({
			available: true,
			modelName: "Visual fixture",
			modelBytes: 100,
			freeMemoryBytes: 8e9,
			requiredMemoryBytes: 3e9,
		});
		window.electronAPI.getBundledSpeechStatus = async () => ({
			available: false,
			reason: "missing",
		});
		window.electronAPI.onCompleteAutoEditProgress = () => () => undefined;
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toBeVisible({ timeout: 60000 });
	await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
	const panel = page.locator("[data-auto-edit-panel]");
	await expect(
		panel.getByRole("button", { name: "Automatically edit speech and video", exact: true }),
	).toBeDisabled();
	await expect(
		panel.getByText(
			"Speech editing requires the full offline speech edition, with its included model.",
			{ exact: true },
		),
	).toBeVisible();
	await panel.locator("[data-analysis-options] > summary").click();
	await expect(
		panel.getByRole("button", { name: "Generate offline AI plan", exact: true }),
	).toBeEnabled();
});

test("small screens keep the main workflow and footer usable in Chinese and English", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1024, height: 640 });
	const panel = await setup(page);
	await expect(panel.locator("[data-edit-workflow]")).toBeVisible();
	await expect(panel.locator("[data-analysis-options]")).not.toHaveAttribute("open");
	const footer = panel.locator("[data-auto-edit-footer]");
	for (const language of ["en", "zh"]) {
		await panel.getByLabel("Plan language").selectOption(language);
		await expect(footer).toBeInViewport();
		const bounds = await panel.boundingBox();
		expect(bounds).not.toBeNull();
		expect(bounds!.x).toBeGreaterThanOrEqual(0);
		expect(bounds!.y).toBeGreaterThanOrEqual(0);
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1024);
		expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
		await expect(
			panel.getByRole("button", {
				name:
					language === "zh"
						? "一键自动剪辑语音和视频"
						: "Automatically edit speech and video",
				exact: true,
			}),
		).toBeInViewport();
		await panel.screenshot({ path: `test-results/ai-workflow-${language}-1024.png` });
	}
	await panel.locator("[data-hardware-guide] > summary").click();
	await expect(panel.getByText(/16GB/)).toBeVisible();
	await expect(footer).toBeInViewport();
	await panel.locator("[data-auto-edit-scroll]").evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await expect(footer).toBeInViewport();
	await panel.getByRole("button", { name: "返回编辑器", exact: true }).click();
	await expect(panel).toHaveCount(0);
});
