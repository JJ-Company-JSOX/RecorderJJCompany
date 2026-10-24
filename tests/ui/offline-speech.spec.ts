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
			window.electronAPI.analyzeCompleteAutoEdit = async (input) => {
				document.documentElement.dataset.recognitionLanguage = input.language ?? "auto";
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
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000");
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(0);
});

test("deleting a subtitle line cuts that part of the video and can be undone", async ({ page }) => {
	const panel = await setup(page);
	await panel
		.getByRole("button", { name: "Automatically edit speech and video", exact: true })
		.click();
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(1);
	await panel.getByRole("button", { name: "Edit or translate subtitles", exact: true }).click();
	const list = panel.locator("[data-text-edit]");
	await expect(list.getByText("Open file", { exact: true })).toBeVisible();
	await expect(list.getByRole("button", { name: "Cut 0 selected sentences" })).toBeDisabled();
	await list.getByRole("checkbox", { name: "Open file" }).check();
	await list.getByRole("button", { name: "Cut 1 selected sentences" }).click();
	await expect(panel.locator("[data-draft-result]")).toBeVisible();
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(0);
	const end = Number(
		await page.locator('[data-variant="clip"]').last().getAttribute("data-end-ms"),
	);
	expect(end).toBeLessThan(4200);
	await panel.getByRole("button", { name: "Undo these changes" }).click();
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(1);
	await expect(page.locator('[data-variant="clip"]').last()).toHaveAttribute(
		"data-end-ms",
		"5000",
	);
});

test("subtitles are translated offline with the same timing and can be undone", async ({
	page,
}) => {
	const panel = await setup(page);
	await page.evaluate(() => {
		window.electronAPI.translateAutoEditSubtitles = async (lines, target) => {
			document.documentElement.dataset.translateTarget = target;
			return {
				success: true,
				lines: lines.map((l) => ({
					id: l.id,
					text: l.text === "Open file" ? "打开文件" : l.text,
				})),
			};
		};
	});
	await panel
		.getByRole("button", { name: "Automatically edit speech and video", exact: true })
		.click();
	await panel.getByRole("button", { name: "Edit or translate subtitles", exact: true }).click();
	const translate = panel.locator("[data-translate-subtitles]");
	await translate.getByLabel("Translate into").selectOption("zh");
	await translate.getByRole("button", { name: "Translate", exact: true }).click();
	await expect(panel.getByText("1 subtitles translated.")).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-translate-target", "zh");
	await panel.getByRole("button", { name: "Edit or translate subtitles", exact: true }).click();
	await expect(
		panel.locator("[data-text-edit]").getByText("打开文件", { exact: true }),
	).toBeVisible();
	await panel.getByRole("button", { name: "Back", exact: true }).click();
	await panel.getByRole("button", { name: "Undo these changes" }).click();
	await panel.getByRole("button", { name: "Edit or translate subtitles", exact: true }).click();
	await expect(
		panel.locator("[data-text-edit]").getByText("Open file", { exact: true }),
	).toBeVisible();
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(1);
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
	await setup(page);
	await page.getByRole("button", { name: "Export", exact: true }).click();
	await expect(page.getByRole("row", { name: "Local", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByRole("button", { name: "Export Video", exact: true })).toBeVisible();
	await expect(page.locator('input[type="email"]')).toHaveCount(0);
});

test("review mode shows speech proposals and leaves the timeline unchanged until a change is accepted", async ({
	page,
}) => {
	const panel = await setup(page);
	await panel.getByRole("checkbox", { name: /Apply the automatic draft when ready/ }).uncheck();
	await panel
		.getByRole("button", { name: "Automatically edit speech and video", exact: true })
		.click();
	await expect(panel.locator("[data-suggestion-id]")).toHaveCount(3);
	await expect(panel.getByText("Speech subtitle", { exact: true })).toHaveCount(2);
	await expect(panel.getByRole("button", { name: "Done", exact: true })).toBeVisible();
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
			"The speech model or runtime is missing. Speech editing requires the full offline speech edition or prepared source-build assets.",
			{ exact: true },
		),
	).toBeVisible();
	await panel.locator("[data-analysis-options] > summary").click();
	await expect(
		panel.getByRole("button", { name: "Generate offline AI plan", exact: true }),
	).toBeEnabled();
});

test("missing audio falls back to a visual-only plan on small screens without applying edits", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1024, height: 640 });
	const panel = await setup(page);
	await page.evaluate(() => {
		window.electronAPI.analyzeCompleteAutoEdit = async () => ({
			success: false,
			errorCode: "NO_AUDIO",
			error: "Technical extraction details",
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
		window.electronAPI.analyzeAutoEditFrames = async () => ({
			success: true,
			analysis: {
				durationMs: 6000,
				sampledTimesMs: [],
				observations: [],
				model: "Fixture",
				elapsedMs: 1,
			},
		});
	});
	await panel
		.getByRole("button", { name: "Automatically edit speech and video", exact: true })
		.click();
	await expect(panel.getByText("built from the picture only")).toBeVisible();
	await expect(panel.getByRole("alert")).toHaveCount(0);
	await expect(panel.getByText("Technical extraction details")).toHaveCount(0);
	await expect(panel.locator("[data-no-edits]")).toContainText("No safe automatic edits");
	// Even with nothing to cut, a silent video can still get AI voice-over and subtitles.
	await expect(
		panel.getByRole("button", { name: "Add AI voice-over and subtitles", exact: true }),
	).toBeVisible();
	await expect(panel.locator("[data-no-edits]")).toBeInViewport();
	await expect(panel.locator("[data-draft-result]")).toHaveCount(0);
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000");
});

test("small screens keep the sidebar workflow usable in Chinese and English", async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 640 });
	const panel = await setup(page);
	await expect(panel.locator("[data-edit-workflow]")).toBeVisible();
	await expect(panel.locator("[data-analysis-options]")).not.toHaveAttribute("open");
	for (const language of ["en", "zh"]) {
		await panel.getByLabel("Plan language").selectOption(language);
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
	// Other sidebar tabs swap the AI panel out; the AI tab brings it back.
	await page.getByRole("radio", { name: "Scene", exact: true }).click();
	await expect(panel).toBeHidden();
	await page.getByRole("radio", { name: "AI auto edit", exact: true }).click();
	await expect(panel).toBeVisible();
});

test("the result screen summarizes changes and undoes the whole run in one click", async ({
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
	await page.setViewportSize({ width: 1280, height: 800 });
	await panel.getByLabel("Plan language").selectOption("zh");
	await page.screenshot({ path: "test-results/wizard-done-zh.png" });
	await expect(panel.getByRole("button", { name: "下一步：加 AI 配音" })).toHaveCount(0);
	await panel.getByRole("button", { name: "撤销这次修改" }).click();
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(0);
	await page.screenshot({ path: "test-results/wizard-undone-zh.png" });
	await panel.getByLabel("Plan language").selectOption("en");
});

test("recognition language is independent from interface language and reaches local ASR", async ({
	page,
}) => {
	const panel = await setup(page);
	const recognition = panel.getByLabel("Recognition language", { exact: true });
	await expect(recognition).toHaveValue("auto");
	await recognition.selectOption("zh");
	await panel.getByLabel("Plan language").selectOption("ms");
	await expect(panel.getByLabel("Bahasa pengecaman suara", { exact: true })).toHaveValue("zh");
	await panel
		.getByRole("button", { name: "Sunting pertuturan dan video secara automatik", exact: true })
		.click();
	await expect(page.locator("html")).toHaveAttribute("data-recognition-language", "zh");
});
