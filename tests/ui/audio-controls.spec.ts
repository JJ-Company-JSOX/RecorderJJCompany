import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("audio mute and fades participate in undo and project saving", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.onMenuSaveProject = (callback) => {
			const handler = () => void callback();
			window.addEventListener("test-save-project", handler);
			return () => window.removeEventListener("test-save-project", handler);
		};
		window.electronAPI.saveProjectFile = async (project) => {
			sessionStorage.setItem("saved-audio", JSON.stringify(project.editor.audioRegions));
			return { success: true, path: "/test.recordly" };
		};
		window.electronAPI.openAudioFilePicker = async () => ({
			success: true,
			path: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
	await page.getByRole("button", { name: "Add Layer", exact: true }).click();
	await page.getByRole("menuitem", { name: "Audio", exact: true }).click();
	await expect(page.locator('[data-variant="audio"]')).toHaveCount(1);
	const fadeIn = page.getByRole("slider", { name: "Fade in", exact: true });
	const fadeOut = page.getByRole("slider", { name: "Fade out", exact: true });
	const mute = page.getByRole("switch", { name: "Mute", exact: true });
	await expect(fadeIn).toHaveValue("0");
	await fadeIn.press("ArrowRight");
	await expect(fadeIn).toHaveValue("10");
	await fadeOut.press("ArrowRight");
	await expect(fadeOut).toHaveValue("10");
	await mute.press("Space");
	await expect(mute).toBeChecked();
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(mute).not.toBeChecked();
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect(mute).toBeChecked();
	await page.evaluate(() => window.dispatchEvent(new Event("test-save-project")));
	await expect
		.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("saved-audio") || "[]")))
		.toMatchObject([{ muted: true, fadeInMs: 10, fadeOutMs: 10 }]);
});

test("speech model download is explicit and discloses size and destination", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getWhisperSmallModelStatus = async () => ({
			success: true,
			exists: false,
			path: null,
			downloadPath: "C:\\Users\\Test\\AppData\\Roaming\\Recordly\\whisper\\ggml-small.bin",
		});
		let finishDownload: (() => void) | undefined;
		window.electronAPI.downloadWhisperSmallModel = async () => {
			document.documentElement.dataset.modelDownload = "started";
			return new Promise((resolve) => {
				finishDownload = () => resolve({ success: false, canceled: true });
			});
		};
		window.electronAPI.cancelWhisperModelDownload = async () => {
			document.documentElement.dataset.modelDownload = "canceled";
			finishDownload?.();
			return { success: true };
		};
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	await expect(page.getByText(/approximately 500 MB/)).toBeVisible();
	await expect(page.getByText(/Storage location.*ggml-small.bin/)).toBeVisible();
	await expect(page.locator("html")).not.toHaveAttribute("data-model-download");
	await page.getByRole("button", { name: "Download Model", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-model-download", "started");
	await page.getByRole("button", { name: "Cancel download", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-model-download", "canceled");
});
