import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.beforeEach(() => test.setTimeout(120000));

async function openEditor(page: Page) {
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 60000,
	});
	const panel = page.locator("[data-auto-edit-panel]");
	await expect(panel).toBeVisible();
	return panel;
}

test("missing AI assets explain the disabled action immediately and local analysis remains usable", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
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
		window.electronAPI.getBundledSpeechStatus = async () => ({
			available: false,
			reason: "missing",
		});
		window.electronAPI.getCursorTelemetry = async () => ({
			success: true,
			samples: [{ timeMs: 500, cx: 0.7, cy: 0.3, interactionType: "click" }],
		});
		window.electronAPI.analyzeAutoEdit = async () => {
			document.documentElement.dataset.localRuleCalls = "1";
			return {
				success: true,
				evidence: {
					durationMs: 6000,
					staticRanges: [{ startMs: 2000, endMs: 6000 }],
					silentRanges: [{ startMs: 2000, endMs: 6000 }],
					audioVerified: true,
					warnings: [],
				},
			};
		};
		window.electronAPI.analyzeCompleteAutoEdit = async () => {
			throw Error("No speech model should load");
		};
		window.electronAPI.analyzeAutoEditFrames = async () => {
			throw Error("No vision model should load");
		};
	});
	await page.setViewportSize({ width: 1024, height: 700 });
	const panel = await openEditor(page);
	const notice = panel.locator("[data-auto-edit-readiness]");
	await expect(notice).toContainText("Source builds do not include the large AI models");
	await expect(
		panel.getByRole("button", { name: "Automatically edit speech and video", exact: true }),
	).toBeDisabled();
	await expect(
		panel.getByText(
			"No account, internet or extra installation needed. Your original video is preserved.",
			{ exact: true },
		),
	).toHaveCount(0);
	await panel.getByLabel("Plan language").selectOption("zh");
	await expect(notice).toContainText("缺少语音识别模型");
	await expect(notice).toContainText("源码开发版");
	await page.screenshot({
		path: "test-results/auto-edit-missing-models-zh.png",
		animations: "disabled",
	});
	await panel.getByLabel("Plan language").selectOption("ms");
	await expect(notice).toContainText("model AI besar");
	await panel.getByLabel("Plan language").selectOption("en");
	await notice
		.getByRole("button", { name: "Use local analysis without AI", exact: true })
		.click();
	await expect(panel.locator("[data-suggestion-id]")).toHaveCount(2);
	await expect(page.locator("html")).toHaveAttribute("data-local-rule-calls", "1");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	expect(errors).toEqual([]);
});

test("rechecking prepared resources enables AI without closing or reopening the panel", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getBundledAiStatus = async () => ({
			available: document.documentElement.dataset.modelsReady === "true",
			reason: document.documentElement.dataset.modelsReady === "true" ? undefined : "missing",
			modelName: "fixture",
			modelBytes: 100,
			freeMemoryBytes: 8e9,
			requiredMemoryBytes: 3e9,
		});
		window.electronAPI.getBundledSpeechStatus = async () => ({
			available: document.documentElement.dataset.modelsReady === "true",
			reason: "missing",
		});
	});
	const panel = await openEditor(page);
	const start = panel.getByRole("button", {
		name: "Automatically edit speech and video",
		exact: true,
	});
	await expect(start).toBeDisabled();
	await expect(panel.locator("[data-auto-edit-readiness]")).toContainText("Source builds");
	await page.evaluate(() => {
		document.documentElement.dataset.modelsReady = "true";
	});
	await panel.getByRole("button", { name: "Check again", exact: true }).click();
	await expect(start).toBeEnabled();
	await expect(panel.locator("[data-auto-edit-readiness]")).toHaveCount(0);
	await expect(panel.getByText("Ready to edit", { exact: false })).toBeVisible();
});

test("failed status IPC is explained, preserves the independent visual capability, and can recover", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getBundledAiStatus = async () => ({
			available: true,
			modelName: "fixture",
			modelBytes: 100,
			freeMemoryBytes: 8e9,
			requiredMemoryBytes: 3e9,
		});
		window.electronAPI.getBundledSpeechStatus = async () => {
			if (document.documentElement.dataset.retryStatus !== "true")
				throw Error("IPC disconnected");
			return { available: true };
		};
	});
	const panel = await openEditor(page);
	await expect(panel.locator("[data-auto-edit-readiness]")).toContainText("Could not check");
	await panel.locator("[data-analysis-options] > summary").click();
	await expect(
		panel.getByRole("button", { name: "Generate offline AI plan", exact: true }),
	).toBeEnabled();
	await page.evaluate(() => {
		document.documentElement.dataset.retryStatus = "true";
	});
	await panel.getByRole("button", { name: "Check again", exact: true }).click();
	await expect(
		panel.getByRole("button", { name: "Automatically edit speech and video", exact: true }),
	).toBeEnabled();
});

for (const blocked of ["unsupported", "memory"] as const) {
	test(`explains ${blocked} separately from missing models`, async ({ page }) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await installDesktopBridgeOverrides(
			page,
			(blocked) => {
				window.electronAPI.getBundledAiStatus = async () => ({
					available: blocked !== "unsupported",
					reason: blocked === "unsupported" ? "unsupported" : undefined,
					modelName: "fixture",
					modelBytes: 100,
					freeMemoryBytes: blocked === "memory" ? 1e9 : 8e9,
					requiredMemoryBytes: 3 * 1024 ** 3,
				});
				window.electronAPI.getBundledSpeechStatus = async () => ({ available: true });
			},
			blocked,
		);
		const panel = await openEditor(page);
		await expect(panel.locator("[data-auto-edit-readiness]")).toContainText(
			blocked === "memory" ? "3 GiB of available RAM" : "require Windows x64",
		);
		await expect(
			panel.getByRole("button", { name: "Automatically edit speech and video", exact: true }),
		).toBeDisabled();
		await expect(
			panel.getByRole("button", { name: "Use local analysis without AI", exact: true }),
		).toBeEnabled();
	});
}
