import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function setup(page: Page, missing = false, deferred = false) {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(
		page,
		({ missing, deferred }) => {
			localStorage.setItem("recordly.locale", "en");
			const get = window.electronAPI.getAppSetting;
			window.electronAPI.getAppSetting = (key) => {
				const value = sessionStorage.getItem(`test-setting:${key}`);
				return value ? JSON.parse(value) : get(key);
			};
			window.electronAPI.setAppSetting = (key, value) => {
				sessionStorage.setItem(`test-setting:${key}`, JSON.stringify(value));
				return true;
			};
			window.electronAPI.inspectAutoEditLocalModel = async (model) => {
				document.documentElement.dataset.modelChecked = model;
				return missing
					? { success: false, error: "Ollama unavailable" }
					: {
							success: true,
							info: {
								name: model,
								sizeBytes: 2500000000,
								license: "Apache-2.0",
								capabilities: ["completion"],
							},
						};
			};
			window.electronAPI.analyzeAutoEdit = async () => ({
				success: true,
				evidence: {
					durationMs: 6000,
					staticRanges: [{ startMs: 2000, endMs: 6000 }],
					silentRanges: [{ startMs: 2000, endMs: 6000 }],
					audioVerified: true,
					warnings: [],
				},
			});
			window.electronAPI.getCursorTelemetry = async () => ({
				success: true,
				samples: [{ timeMs: 500, cx: 0.75, cy: 0.25, interactionType: "click" }],
			});
			window.electronAPI.reviewAutoEditLocally = async (plan, model) => {
				document.documentElement.dataset.reviewModel = model;
				if (deferred)
					await new Promise<void>((resolve) =>
						window.addEventListener("finish-ollama", () => resolve(), { once: true }),
					);
				return { success: true, plan: { ...plan, reviewer: "local-ai" } };
			};
			window.electronAPI.narrateAutoEditLocally = async (plan, model, language, style) => {
				if (deferred)
					await new Promise<void>((resolve) =>
						window.addEventListener("finish-narration", () => resolve(), {
							once: true,
						}),
					);
				document.documentElement.dataset.narrationRequest = JSON.stringify({
					model,
					language,
					style,
				});
				return {
					success: true,
					draft: {
						cues: plan.suggestions.slice(0, 1).map((s) => ({
							id: s.id,
							startMs: s.startMs,
							endMs: s.endMs,
							text: "Click the control.",
						})),
					},
				};
			};
			window.electronAPI.narrateAutoEditBundled = async () => {
				document.documentElement.dataset.bundledStarted = "true";
				throw new Error("Bundled must not run");
			};
			window.electronAPI.cancelAutoEditAnalysis = async () => {
				document.documentElement.dataset.aiCanceled = "true";
			};
			window.electronAPI.analyzeAutoEditFrames = async () => {
				document.documentElement.dataset.bundledStarted = "true";
				throw new Error("Bundled must not run");
			};
			window.electronAPI.analyzeCompleteAutoEdit = async () => {
				document.documentElement.dataset.bundledStarted = "true";
				throw new Error("Bundled must not run");
			};
			navigator.clipboard.writeText = async (text) => {
				document.documentElement.dataset.copiedCommand = text;
			};
		},
		{ missing, deferred },
	);
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
}

test("lightweight is the default and Ollama setup is explicit, with client installation commands", async ({
	page,
}) => {
	await setup(page, true);
	const mode = page.getByRole("combobox", { name: "AI mode", exact: true });
	await expect(mode).toHaveValue("builtin");
	await expect(page.locator("html")).not.toHaveAttribute("data-model-checked");
	await expect(
		page.getByRole("button", { name: "Start fast editing", exact: true }),
	).toBeEnabled();
	await mode.selectOption("ollama");
	const start = page.getByRole("button", { name: "Start Ollama editing", exact: true });
	await expect(start).toBeDisabled();
	await page.getByText("Install Ollama on Windows", { exact: true }).click();
	await expect(
		page.locator("code").filter({ hasText: "winget install --id Ollama.Ollama" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Copy command", exact: true }).first().click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-copied-command",
		"winget install --id Ollama.Ollama -e --source winget",
	);
	await page.getByRole("button", { name: "Check local model", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Ollama unavailable");
	await expect(start).toBeDisabled();
	await mode.selectOption("builtin");
	await expect(
		page.getByRole("button", { name: "Start fast editing", exact: true }),
	).toBeEnabled();
});

test("checked Ollama reviews the real plan through the existing timeline and restores mode without auto-starting models", async ({
	page,
}) => {
	await setup(page);
	await page.getByRole("combobox", { name: "AI mode", exact: true }).selectOption("ollama");
	await page
		.getByRole("textbox", { name: "Installed Ollama model", exact: true })
		.fill("custom-local:latest");
	await page.getByRole("button", { name: "Check local model", exact: true }).click();
	await expect(page.getByText(/Local model ready: custom-local/)).toBeVisible();
	await page.getByRole("button", { name: "Start Ollama editing", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-review-model", "custom-local:latest");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(2);
	await expect(page.locator("html")).not.toHaveAttribute("data-bundled-started");
	await page.getByRole("button", { name: "Undo these changes", exact: true }).click();
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	await page.reload();
	await expect(page.getByRole("combobox", { name: "AI mode", exact: true })).toHaveValue(
		"ollama",
	);
	await expect(
		page.getByRole("textbox", { name: "Installed Ollama model", exact: true }),
	).toHaveValue("custom-local:latest");
	await expect(
		page.getByRole("button", { name: "Start Ollama editing", exact: true }),
	).toBeDisabled();
	await expect(page.locator("html")).not.toHaveAttribute("data-model-checked");
});

test("cancelled Ollama review cannot apply its late result", async ({ page }) => {
	await setup(page, false, true);
	await page.getByRole("combobox", { name: "AI mode", exact: true }).selectOption("ollama");
	await page.getByRole("button", { name: "Check local model", exact: true }).click();
	await page.getByRole("button", { name: "Start Ollama editing", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-review-model", "qwen3:4b");
	await page
		.locator("[data-analysis-progress]")
		.getByRole("button", { name: "Cancel analysis", exact: true })
		.click();
	await page.evaluate(() => window.dispatchEvent(new Event("finish-ollama")));
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000");
	await expect(page.locator("html")).toHaveAttribute("data-ai-canceled", "true");
});

test("Ollama narration uses the selected local model and language without loading bundled AI", async ({
	page,
}) => {
	await setup(page);
	await page.getByRole("combobox", { name: "AI mode", exact: true }).selectOption("ollama");
	await page.getByRole("button", { name: "Check local model", exact: true }).click();
	await page
		.getByRole("button", { name: "Add AI voice-over and subtitles", exact: true })
		.click();
	await page.getByRole("button", { name: "Draft narration", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-narration-request",
		JSON.stringify({ model: "qwen3:4b", language: "en", style: "tutorial" }),
	);
	await expect(page.locator("textarea").first()).toHaveValue("Click the control.");
	await expect(page.locator("html")).not.toHaveAttribute("data-bundled-started");
});

test("narration wait shows elapsed time, learns successful runs and discards canceled results", async ({
	page,
}) => {
	await setup(page, false, true);
	await page.getByRole("combobox", { name: "AI mode", exact: true }).selectOption("ollama");
	await page.getByRole("button", { name: "Check local model", exact: true }).click();
	await page
		.getByRole("button", { name: "Add AI voice-over and subtitles", exact: true })
		.click();
	const draft = page.getByRole("button", { name: "Draft narration", exact: true });
	const wait = page.locator("[data-task-wait]");
	await draft.click();
	await expect(wait).toContainText("Estimating");
	await expect(wait).toContainText("Time elapsed: 0:02");
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(wait).toHaveCount(0);
	await page.evaluate(() => window.dispatchEvent(new Event("finish-narration")));
	await expect(page.locator("textarea")).toHaveCount(0);
	await draft.click();
	await expect(wait).toContainText("Estimating");
	await expect(wait).toContainText("Time elapsed: 0:02");
	await page.evaluate(() => window.dispatchEvent(new Event("finish-narration")));
	await expect(page.locator("textarea").first()).toHaveValue("Click the control.");
	await expect(wait).toHaveCount(0);
	await draft.click();
	await expect(wait).toContainText("Estimated remaining");
	await expect(wait).toContainText("Taking longer than estimated", { timeout: 10000 });
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(wait).toHaveCount(0);
});
