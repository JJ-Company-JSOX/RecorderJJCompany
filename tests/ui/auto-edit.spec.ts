import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeEach(() => test.setTimeout(90000));

test("accepting a suggestion applies it at once and jumps to it; Reject takes it back", async ({
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
	// AI auto edit is the first sidebar tab and opens by default.
	const panel = page.locator("[data-auto-edit-panel]");
	await expect(panel).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await page.locator("[data-analysis-options] > summary").click();
	await panel.getByRole("button", { name: "Generate local plan" }).click();
	await expect(panel.locator("[data-suggestion-id]")).toHaveCount(2);
	await expect(panel.getByText("Inspect JSON plan")).toHaveCount(0);
	await expect(panel.getByText("Optional local AI review")).toHaveCount(0);
	await expect(clips).toHaveCount(1);
	const trim = panel
		.locator("li")
		.filter({ has: page.getByText("Remove segment", { exact: true }) });
	const zoom = panel
		.locator("li")
		.filter({ has: page.getByText("Zoom at click", { exact: true }) });
	await trim.getByRole("radio", { name: "Accept", exact: true }).check();
	// Applied straight away, with the playhead moved to the cut.
	await expect(clips).toHaveCount(2);
	await expect(clips.first()).toHaveAttribute("data-end-ms", "2400");
	await expect(clips.last()).toHaveAttribute("data-start-ms", "2400");
	await expect(clips.last()).toHaveAttribute("data-end-ms", "2800");
	await trim.getByRole("radio", { name: "Reject", exact: true }).check();
	await expect(clips).toHaveCount(1);
	await expect(clips).toHaveAttribute("data-end-ms", "6000");
	await trim.getByRole("radio", { name: "Accept", exact: true }).check();
	await panel.getByRole("button", { name: "Reject remaining suggestions" }).click();
	await expect(trim.getByRole("radio", { name: "Accept", exact: true })).toBeChecked();
	await expect(zoom.getByRole("radio", { name: "Reject", exact: true })).toBeChecked();
	await expect(clips).toHaveCount(2);
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(0);
	await page.screenshot({ path: "test-results/auto-edit-review.png" });
	await panel.getByRole("button", { name: "Done", exact: true }).click();
	await expect(panel.getByRole("status").first()).toContainText("Applied");
	await panel.getByRole("button", { name: "Undo these changes" }).click();
	await expect(clips).toHaveCount(1);
	await expect(clips).toHaveAttribute("data-end-ms", "6000");
	expect(errors).toEqual([]);
});

test("Malay and Chinese controls", async ({ page }) => {
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
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
	await page.locator("[data-analysis-options] > summary").click();
	await page.getByLabel("Plan language").selectOption("ms");
	await expect(page.getByRole("heading", { name: "Suntingan automatik AI" })).toBeVisible();
	await page.getByRole("button", { name: "Jana pelan setempat" }).click();
	await page.getByRole("radio", { name: "Terima", exact: true }).check();
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Selesai", exact: true })).toBeEnabled();
	await page.getByLabel("Plan language").selectOption("zh");
	await expect(page.getByRole("heading", { name: "AI 自动剪辑" })).toBeVisible();
	await page.getByRole("button", { name: "完成", exact: true }).click();
	await expect(page.locator("[data-auto-edit-panel]").getByRole("status").first()).toContainText(
		"已应用",
	);
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
	await page.locator("[data-analysis-options] > summary").click();
	await page.getByRole("button", { name: "Generate local plan" }).click();
	await page.getByRole("radio", { name: "Accept", exact: true }).check();
	await expect(clip).toHaveCount(2);
	await clip.first().click({ position: { x: 40, y: 20 } });
	const speed = page.getByRole("slider", { name: "Speed", exact: true });
	await speed.focus();
	await speed.press("ArrowRight");
	await page.getByRole("button", { name: "Auto edit plan", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("timeline changed");
	await expect(page.getByRole("button", { name: "Done", exact: true })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Accept remaining suggestions" })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Reject remaining suggestions" })).toBeDisabled();
});

for (const allProtected of [false, true]) {
	test(`batch review preserves choices and skips clicks that already have a zoom (every click zoomed: ${allProtected})`, async ({
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
		const apply = dialog.getByRole("button", { name: "Done", exact: true });
		if (allProtected) {
			// Every click already has a zoom, so there is nothing to suggest (not a wall of "protected").
			await expect(dialog.locator("[data-no-edits]")).toBeVisible();
			await expect(items).toHaveCount(0);
			await expect(dialog.locator("[data-plan-all-protected]")).toHaveCount(0);
			await page.screenshot({ path: "test-results/auto-edit-protected.png" });
		} else {
			// The click at 0.5 s already has a zoom; only the other two are suggested.
			await expect(items).toHaveCount(2);
			await expect(dialog.getByText(/No AI model or JSON download is needed/)).toBeVisible();
			await items.nth(0).getByRole("radio", { name: "Reject", exact: true }).check();
			await dialog.getByRole("button", { name: "Accept remaining suggestions" }).click();
			await expect(
				items.nth(0).getByRole("radio", { name: "Reject", exact: true }),
			).toBeChecked();
			await expect(
				items.nth(1).getByRole("radio", { name: "Accept", exact: true }),
			).toBeChecked();
			await expect(dialog.locator("[data-plan-summary]")).toHaveText(
				"Available: 2 · Review required: 0 · Accept: 1",
			);
			// Accepted zooms are already on the timeline.
			await expect(zooms).toHaveCount(2);
			await expect(
				dialog.getByRole("button", { name: "Accept remaining suggestions" }),
			).toBeDisabled();
			await expect(apply).toBeEnabled();
			await page.screenshot({ path: "test-results/auto-edit-batch.png" });
			await apply.click();
			await expect(zooms).toHaveCount(2);
			await dialog.getByRole("button", { name: "Undo these changes" }).click();
		}
		await expect(zooms).toHaveCount(1);
		await expect(zooms).toHaveAttribute("data-start-ms", "0");
		await expect(zooms).toHaveAttribute("data-end-ms", allProtected ? "6000" : "1500");
	});
}
