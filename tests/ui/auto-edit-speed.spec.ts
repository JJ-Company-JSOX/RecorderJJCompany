import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.beforeEach(() => test.setTimeout(120000));

async function setup(page: Parameters<typeof installDesktopBridge>[0]) {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getBundledAiStatus = async () => ({
			available: false,
			reason: "missing",
			modelName: "fixture",
			modelBytes: 0,
			freeMemoryBytes: 1e9,
			requiredMemoryBytes: 3e9,
		});
		window.electronAPI.getBundledSpeechStatus = async () => ({ available: true });
		window.electronAPI.analyzeAutoEditFrames = async () => {
			throw Error("Unexpected vision inference");
		};
		window.electronAPI.analyzeAutoEdit = async () => {
			document.documentElement.dataset.fastCalls = "1";
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
		window.electronAPI.analyzeCompleteAutoEdit = async (input) => {
			if (input.mode !== "speech") throw Error("Expected speech-only mode");
			document.documentElement.dataset.requestedMode = input.mode;
			document.documentElement.dataset.spokenLanguage = input.language;
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
								id: "spoken",
								text: "Hello",
								startMs: 500,
								endMs: 1500,
								confidence: 0.99,
								vadBoundaryVerified: true,
							},
						],
					},
					cuts: [],
					warnings: [],
				},
			};
		};
		window.electronAPI.onMenuSaveProject = (callback) => {
			const handler = () => void callback();
			window.addEventListener("test-save-fast-project", handler);
			return () => window.removeEventListener("test-save-fast-project", handler);
		};
		window.electronAPI.saveProjectFile = async (project) => {
			sessionStorage.setItem("fast-project", JSON.stringify(project));
			return { success: true, path: "/saved.recordly" };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 60000,
	});
	return page.locator("[data-auto-edit-panel]");
}

test("fast is the default, applies local edits without models, saves the timeline and undoes the run", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.setViewportSize({ width: 1024, height: 640 });
	const panel = await setup(page);
	await expect(panel.getByLabel("Editing mode", { exact: true })).toHaveValue("fast");
	await expect(panel.getByLabel("Recognition language")).toHaveCount(0);
	await expect(
		panel.getByRole("button", { name: "Start fast editing", exact: true }),
	).toBeInViewport({ ratio: 1 });
	await panel.getByRole("button", { name: "Start fast editing", exact: true }).click();
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveCount(2);
	await expect(page.locator("html")).toHaveAttribute("data-fast-calls", "1");
	await expect(page.locator("html")).not.toHaveAttribute("data-requested-mode");
	await page.evaluate(() => window.dispatchEvent(new Event("test-save-fast-project")));
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(sessionStorage.getItem("fast-project") || "{}").editor?.clipRegions
						?.length,
			),
		)
		.toBe(2);
	await panel.getByRole("button", { name: "Undo these changes", exact: true }).click();
	await expect(clips).toHaveCount(1);
	await expect(clips).toHaveAttribute("data-end-ms", "6000");
	expect(errors).toEqual([]);
});

test("speech-only editing works without visual AI, forwards language and persists subtitles", async ({
	page,
}) => {
	const panel = await setup(page);
	await panel.getByLabel("Editing mode", { exact: true }).selectOption("speech");
	await panel.getByLabel("Recognition language", { exact: true }).selectOption("ms");
	await panel.getByRole("button", { name: "Start editing with subtitles", exact: true }).click();
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(1);
	await expect(page.locator("html")).toHaveAttribute("data-requested-mode", "speech");
	await expect(page.locator("html")).toHaveAttribute("data-spoken-language", "ms");
	await expect(page.locator("html")).not.toHaveAttribute("data-fast-calls");
	await page.evaluate(() => window.dispatchEvent(new Event("test-save-fast-project")));
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(sessionStorage.getItem("fast-project") || "{}").editor?.autoCaptions,
			),
		)
		.toMatchObject([{ text: "Hello", startMs: 500, endMs: 1500 }]);
	await panel.getByRole("button", { name: "Undo these changes", exact: true }).click();
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(0);
});

test("full mode still requires AI resources, and mode labels follow the selected language", async ({
	page,
}) => {
	const panel = await setup(page);
	await panel.getByLabel("Editing mode", { exact: true }).selectOption("full");
	await expect(
		panel.getByRole("button", { name: "Automatically edit speech and video", exact: true }),
	).toBeDisabled();
	await panel.getByLabel("Plan language").selectOption("zh");
	await panel.getByLabel("剪辑模式", { exact: true }).selectOption("fast");
	await expect(panel.getByRole("button", { name: "开始快速剪辑", exact: true })).toBeEnabled();
	await panel.getByLabel("Plan language").selectOption("ms");
	await expect(
		panel.getByRole("button", { name: "Mulakan suntingan pantas", exact: true }),
	).toBeEnabled();
});
