import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeEach(() => test.setTimeout(90000));

test("review is explicit, JSON is downloadable, accepted trim ripples and Undo restores", async ({
	page,
}) => {
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
	await page.locator("[data-analysis-options] > summary").click();
	const dialog = page.getByRole("dialog", { name: "Auto edit plan", exact: true });
	await dialog.getByRole("button", { name: "Generate local plan" }).click();
	await expect(dialog.locator("[data-suggestion-id]")).toHaveCount(2);
	const apply = dialog.getByRole("button", { name: "Apply accepted edits" });
	await expect(apply).toBeDisabled();
	await expect(clips).toHaveCount(1);
	const trim = dialog
		.locator("li")
		.filter({ has: page.getByText("Remove segment", { exact: true }) });
	const zoom = dialog
		.locator("li")
		.filter({ has: page.getByText("Zoom at click", { exact: true }) });
	await trim.getByRole("radio", { name: "Accept", exact: true }).check();
	await expect(apply).toBeDisabled();
	await dialog.getByRole("button", { name: "Reject remaining suggestions" }).click();
	await expect(trim.getByRole("radio", { name: "Accept", exact: true })).toBeChecked();
	await expect(zoom.getByRole("radio", { name: "Reject", exact: true })).toBeChecked();
	await expect(apply).toBeEnabled();
	const downloadEvent = page.waitForEvent("download");
	await dialog.getByText("Inspect JSON plan", { exact: true }).click();
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
	await page.locator("[data-analysis-options] > summary").click();
	await page.getByLabel("Plan language").selectOption("ms");
	await expect(page.getByRole("heading", { name: "Suntingan automatik AI" })).toBeVisible();
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
	await expect(page.getByRole("heading", { name: "AI 自动剪辑" })).toBeVisible();
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
	await page.locator("[data-analysis-options] > summary").click();
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
	await expect(page.getByRole("button", { name: "Accept remaining suggestions" })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Reject remaining suggestions" })).toBeDisabled();
});

for (const allProtected of [false, true]) {
	test(`batch review preserves choices and existing zooms (all protected: ${allProtected})`, async ({
		page,
	}) => {
		if (allProtected) await page.setViewportSize({ width: 1280, height: 720 });
		await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
		await installDesktopBridgeOverrides(
			page,
			(allProtected) => {
				window.electronAPI.loadCurrentProjectFile = async () => ({
					success: true,
					path: "/projects/protected.recordly",
					project: {
						version: 2,
						videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
						editor: {
							clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6000, speed: 1 }],
							zoomRegions: [
								{
									id: "existing",
									startMs: 0,
									endMs: allProtected ? 6000 : 1500,
									depth: 2,
									focus: { cx: 0.5, cy: 0.5 },
								},
							],
						},
					},
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
				window.electronAPI.getCursorTelemetry = async () => ({
					success: true,
					samples: [500, 2500, 5000].map((timeMs) => ({
						timeMs,
						cx: 0.7,
						cy: 0.3,
						interactionType: "click" as const,
					})),
				});
				window.electronAPI.cancelAutoEditAnalysis = async () => undefined;
			},
			allProtected,
		);
		await page.goto("/?windowType=editor");
		const zooms = page.locator('[data-variant="zoom"]');
		await expect(zooms).toHaveCount(1, { timeout: 20000 });
		await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
		await page.locator("[data-analysis-options] > summary").click();
		const dialog = page.locator("[data-auto-edit-panel]");
		expect(
			(await dialog.getByRole("button", { name: "Generate local plan" }).boundingBox())!
				.height,
		).toBeGreaterThanOrEqual(32);
		await dialog.getByRole("button", { name: "Generate local plan" }).click();
		const items = dialog.locator("[data-suggestion-id]");
		await expect(items).toHaveCount(3);
		await expect(items.first().getByRole("radio")).toHaveCount(0);
		await expect(dialog.getByText(/No AI model or JSON download is needed/)).toBeVisible();
		const apply = dialog.getByRole("button", { name: "Apply accepted edits" });
		if (allProtected) {
			await expect(dialog.locator("[data-plan-summary]")).toHaveText(
				"Available: 0 · Protected: 3 · Review required: 0 · Accept: 0",
			);
			await expect(dialog.locator("[data-plan-all-protected]")).toContainText(
				"nothing new to apply",
			);
			await expect(
				dialog.getByRole("button", { name: "Accept remaining suggestions" }),
			).toHaveCount(0);
			await expect(apply).toBeDisabled();
			await page.getByLabel("Plan language").selectOption("zh");
			await expect(dialog.locator("[data-plan-all-protected]")).toContainText(
				"没有新的修改可应用",
			);
			await page.screenshot({ path: "test-results/auto-edit-protected.png" });
		} else {
			await items.nth(1).getByRole("radio", { name: "Reject", exact: true }).check();
			await dialog.getByRole("button", { name: "Accept remaining suggestions" }).click();
			await expect(
				items.nth(1).getByRole("radio", { name: "Reject", exact: true }),
			).toBeChecked();
			await expect(
				items.nth(2).getByRole("radio", { name: "Accept", exact: true }),
			).toBeChecked();
			await expect(dialog.locator("[data-plan-summary]")).toHaveText(
				"Available: 2 · Protected: 1 · Review required: 0 · Accept: 1",
			);
			await expect(zooms).toHaveCount(1);
			await expect(
				dialog.getByRole("button", { name: "Accept remaining suggestions" }),
			).toBeDisabled();
			await expect(apply).toBeEnabled();
			await page.screenshot({ path: "test-results/auto-edit-batch.png" });
			await apply.click();
			await dialog.getByRole("button", { name: "Close", exact: true }).click();
			await expect(zooms).toHaveCount(2);
			await page.getByRole("button", { name: "Undo", exact: true }).click();
		}
		await expect(zooms).toHaveCount(1);
		await expect(zooms).toHaveAttribute("data-start-ms", "0");
		await expect(zooms).toHaveAttribute("data-end-ms", allProtected ? "6000" : "1500");
	});
}
