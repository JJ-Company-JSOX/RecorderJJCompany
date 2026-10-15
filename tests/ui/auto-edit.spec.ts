import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.use({ viewport: { width: 1440, height: 1000 } });

test("review is explicit, JSON is downloadable, accepted trim ripples and Undo restores", async ({
	page,
}) => {
	test.setTimeout(60000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
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
			samples: [{ timeMs: 500, cx: 0.75, cy: 0.25, interactionType: "click" as const }],
		});
		window.electronAPI.cancelAutoEditAnalysis = async () => undefined;
	});
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveAttribute("data-end-ms", "6000", { timeout: 20000 });
	await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Auto edit plan", exact: true });
	await dialog.getByRole("button", { name: "Generate local plan" }).click();
	await expect(dialog.locator("[data-suggestion-id]")).toHaveCount(2);
	const apply = dialog.getByRole("button", { name: "Apply accepted edits" });
	await expect(apply).toBeDisabled();
	await expect(clips).toHaveCount(1);
	const trim = dialog
		.locator("li")
		.filter({ has: page.getByText("Remove pause", { exact: true }) });
	const zoom = dialog
		.locator("li")
		.filter({ has: page.getByText("Zoom at click", { exact: true }) });
	await trim.getByRole("radio", { name: "Accept", exact: true }).check();
	await expect(apply).toBeDisabled();
	await zoom.getByRole("radio", { name: "Reject", exact: true }).check();
	await expect(apply).toBeEnabled();
	const downloadEvent = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Download JSON" }).click();
	const download = await downloadEvent;
	expect(download.suggestedFilename()).toBe("recordly-edit-plan.json");
	await page.screenshot({ path: "test-results/auto-edit-review.png" });
	await apply.click();
	await expect(dialog.getByRole("status")).toContainText("Applied");
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await expect(clips).toHaveCount(2);
	await expect(clips.first()).toHaveAttribute("data-end-ms", "2400");
	await expect(clips.last()).toHaveAttribute("data-start-ms", "2400");
	await expect(clips.last()).toHaveAttribute("data-end-ms", "2800");
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(clips).toHaveCount(1);
	await expect(clips).toHaveAttribute("data-end-ms", "6000");
	expect(errors).toEqual([]);
});

test("Malay and Chinese controls; local AI changes require another explicit decision", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
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
		window.electronAPI.getCursorTelemetry = async () => ({
			success: true,
			samples: [{ timeMs: 2000, cx: 0.7, cy: 0.3, interactionType: "click" as const }],
		});
		window.electronAPI.cancelAutoEditAnalysis = async () => undefined;
		window.electronAPI.reviewAutoEditLocally = async (plan) => ({
			success: true,
			plan: { ...plan, reviewer: "local-ai" },
		});
		window.electronAPI.inspectAutoEditLocalModel = async () => ({
			success: true,
			info: {
				name: "existing-test-model",
				sizeBytes: 1024 ** 3,
				license: "Test fixture license. Not an installed model.",
			},
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
	await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
	await page.getByLabel("Plan language").selectOption("ms");
	await expect(page.getByRole("heading", { name: "Pelan suntingan automatik" })).toBeVisible();
	await page.getByRole("button", { name: "Jana pelan setempat" }).click();
	await page.getByRole("radio", { name: "Terima", exact: true }).check();
	await expect(page.getByRole("button", { name: "Gunakan cadangan diterima" })).toBeEnabled();
	await page.getByText("Semakan AI setempat pilihan", { exact: true }).click();
	await page
		.getByRole("textbox", { name: "Nama model Ollama yang sudah dipasang" })
		.fill("existing-test-model");
	await page.getByRole("button", { name: "Periksa model dipasang" }).click();
	await page
		.getByRole("checkbox", {
			name: "Saya telah membaca lesen dan had pemprosesan setempat yang dipaparkan.",
		})
		.check();
	await page.getByRole("button", { name: "Semak setempat", exact: true }).click();
	await expect(page.getByRole("dialog").getByRole("status")).toContainText("AI setempat");
	await expect(page.getByRole("button", { name: "Gunakan cadangan diterima" })).toBeDisabled();
	await page.getByLabel("Plan language").selectOption("zh");
	await expect(page.getByRole("heading", { name: "自动剪辑方案" })).toBeVisible();
	await page.getByRole("radio", { name: "接受", exact: true }).check();
	await page.getByRole("button", { name: "应用已接受的建议" }).click();
	await expect(page.getByRole("dialog").getByRole("status")).toContainText("已应用");
});

test("a plan becomes stale when existing edits change", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.analyzeAutoEdit = async () => ({
			success: true,
			evidence: {
				durationMs: 6000,
				staticRanges: [{ startMs: 1000, endMs: 6000 }],
				silentRanges: [{ startMs: 1000, endMs: 6000 }],
				audioVerified: true,
				warnings: [],
			},
		});
		window.electronAPI.cancelAutoEditAnalysis = async () => undefined;
	});
	await page.goto("/?windowType=editor");
	const clip = page.locator('[data-variant="clip"]');
	await expect(clip).toHaveAttribute("data-end-ms", "6000", { timeout: 20000 });
	await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
	await page.getByRole("button", { name: "Generate local plan" }).click();
	await page.getByRole("radio", { name: "Accept", exact: true }).check();
	await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
	await clip.click({ position: { x: 80, y: 20 } });
	const speed = page.getByRole("slider", { name: "Speed", exact: true });
	await speed.focus();
	await speed.press("ArrowRight");
	await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("timeline changed");
	await expect(page.getByRole("button", { name: "Apply accepted edits" })).toBeDisabled();
});
