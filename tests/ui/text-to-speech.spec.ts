import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

// IPC voice synthesis is a fixture; actual WAV decoding, timeline editing and persistence run in Chromium.
async function setup(page: Page, options = { installed: true, deferred: false }) {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(
		page,
		(options) => {
			localStorage.setItem("recordly.locale", "en");
			window.electronAPI.getBundledTtsStatus = async () => ({
				available: options.installed,
				voices: { zh: options.installed, en: options.installed, ms: false },
				engine: "kokoro",
				voiceList: [
					{
						id: 3,
						language: "en",
						gender: "female",
						default: true,
						labels: { en: "Heart", zh: "Heart", ms: "Heart" },
					},
				],
			});
			window.electronAPI.synthesizeAutoEditNarration = async (cues, language, speakerId) => {
				document.documentElement.dataset.ttsRequest = JSON.stringify({
					cues,
					language,
					speakerId,
				});
				if (options.deferred)
					await new Promise<void>((resolve) =>
						window.addEventListener("finish-tts", () => resolve(), { once: true }),
					);
				return {
					success: true,
					clips: cues.map((cue) => ({
						id: cue.id,
						audioPath: `${location.origin}/voice-${cue.id}.wav`,
						durationMs: 1000,
					})),
				};
			};
			window.electronAPI.cancelAutoEditAnalysis = async () => {
				document.documentElement.dataset.ttsCanceled = "true";
				return { success: true };
			};
			window.electronAPI.onMenuSaveProject = (callback) => {
				const handler = () => void callback();
				window.addEventListener("save-tts", handler);
				return () => window.removeEventListener("save-tts", handler);
			};
			window.electronAPI.saveProjectFile = async (project) => {
				sessionStorage.setItem("tts-project", JSON.stringify(project));
				return { success: true, path: "/test.recordly" };
			};
			window.electronAPI.loadCurrentProjectFile = async () => {
				const saved = sessionStorage.getItem("tts-project");
				return saved
					? { success: true, path: "/test.recordly", project: JSON.parse(saved) }
					: { success: false };
			};
		},
		options,
	);
	// A real one-second PCM WAV, without committing large media fixtures.
	const wav = Buffer.alloc(44 + 48000 * 2);
	wav.write("RIFF", 0);
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write("WAVEfmt ", 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(48000, 24);
	wav.writeUInt32LE(96000, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(wav.length - 44, 40);
	for (let i = 0; i < 48000; i++)
		wav.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / 48000) * 6000), 44 + i * 2);
	await page.route("**/voice-*.wav*", (route) =>
		route.fulfill({ body: wav, contentType: "audio/wav" }),
	);
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000", {
		timeout: 20000,
	});
}

async function openSpeech(page: Page) {
	await page.getByRole("button", { name: "Add Layer", exact: true }).click();
	await page.getByRole("menuitem", { name: "Text to speech", exact: true }).click();
	return page.getByRole("dialog", { name: "Text to speech", exact: true });
}

test("typed paragraphs become movable, trimmable audio clips with undo, saving and reopen", async ({
	page,
}) => {
	await setup(page);
	const dialog = await openSpeech(page);
	await dialog
		.getByRole("textbox", { name: "Text", exact: true })
		.fill("First spoken line.\nSecond spoken line.");
	await page.screenshot({
		path: "test-results/text-to-speech-dialog.png",
		animations: "disabled",
	});
	await dialog.getByRole("button", { name: "Add to timeline", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	const audio = page.locator('[data-variant="audio"]');
	await expect(audio).toHaveCount(2);
	await expect(audio.first()).toHaveAttribute("data-start-ms", "0");
	await expect(audio.nth(1)).toHaveAttribute("data-start-ms", "1250");
	const request = JSON.parse((await page.locator("html").getAttribute("data-tts-request"))!);
	expect(request).toMatchObject({
		language: "en",
		speakerId: 3,
		cues: [{ text: "First spoken line." }, { text: "Second spoken line." }],
	});
	const videoBox = (await page.locator('[data-variant="clip"]').boundingBox())!;
	const box = (await audio.first().boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + videoBox.width / 2, box.y + box.height / 2, {
		steps: 15,
	});
	await page.mouse.up();
	await expect(audio.first()).not.toHaveAttribute("data-start-ms", "0");
	const movedStart = Number(await audio.first().getAttribute("data-start-ms"));
	expect(movedStart).toBeGreaterThan(2250);
	const left = (await audio.first().getByTitle("Resize left").boundingBox())!;
	await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
	await page.mouse.down();
	await page.mouse.move(left.x + left.width / 2 + videoBox.width / 20, left.y + left.height / 2, {
		steps: 10,
	});
	await page.mouse.up();
	await expect
		.poll(async () => Number(await audio.first().getAttribute("data-start-ms")))
		.toBeGreaterThan(movedStart);
	const trimmedStart = await audio.first().getAttribute("data-start-ms");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(audio.first()).toHaveAttribute("data-start-ms", String(movedStart));
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect(audio.first()).toHaveAttribute("data-start-ms", trimmedStart!);
	await expect(page.locator('[data-variant="clip"] img').first()).toBeVisible({ timeout: 20000 });
	await page.evaluate(() => window.dispatchEvent(new Event("save-tts")));
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(sessionStorage.getItem("tts-project") ?? "{}").editor
						?.audioRegions?.[0]?.sourceOffsetMs,
			),
		)
		.toBeGreaterThan(0);
	await page.reload();
	await expect(audio).toHaveCount(2);
	await expect(audio.first()).toHaveAttribute("data-start-ms", trimmedStart!);
	await expect(page.locator('[data-variant="clip"] img').first()).toBeVisible({ timeout: 20000 });
	await page.screenshot({
		path: "test-results/text-to-speech-timeline.png",
		animations: "disabled",
	});
});

test("scissors split the selected voice clip at the playhead without cutting the screen video", async ({
	page,
}) => {
	await setup(page);
	const dialog = await openSpeech(page);
	await dialog.getByRole("textbox", { name: "Text", exact: true }).fill("Split this voice clip.");
	await dialog.getByRole("button", { name: "Add to timeline", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	const audio = page.locator('[data-variant="audio"]');
	await expect(audio).toHaveCount(1);
	const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
	await page.mouse.click(row.x + row.width / 12, row.y - 8);
	await expect(page.getByTestId("playhead-cap")).toHaveAttribute("aria-label", "Playhead 0.5s");
	await audio.click();
	await page.getByRole("button", { name: "Split Clip (C)", exact: true }).click();
	await expect(audio).toHaveCount(2);
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	const boundary = Number(await audio.first().getAttribute("data-end-ms"));
	expect(boundary).toBeGreaterThan(490);
	expect(boundary).toBeLessThan(510);
	await page.evaluate(() => window.dispatchEvent(new Event("save-tts")));
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(sessionStorage.getItem("tts-project") ?? "{}").editor
						?.audioRegions?.[1]?.sourceOffsetMs,
			),
		)
		.toBe(boundary);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(audio).toHaveCount(1);
});

test("missing voices and failed readiness checks explain the disabled button and allow rechecking", async ({
	page,
}) => {
	await setup(page, { installed: false, deferred: false });
	const dialog = await openSpeech(page);
	await dialog.getByRole("textbox", { name: "Text", exact: true }).fill("Hello.");
	await expect(dialog.getByText(/offline voice is not installed/)).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Add to timeline", exact: true }),
	).toBeDisabled();
	await page.evaluate(() => {
		window.electronAPI.getBundledTtsStatus = async () => {
			throw new Error("Unavailable");
		};
	});
	await dialog.getByRole("button", { name: "Recheck voices", exact: true }).click();
	await expect(dialog.getByRole("status")).toContainText("Could not check offline voices");
});

test("canceling synthesis discards its late result and preserves typed text", async ({ page }) => {
	await setup(page, { installed: true, deferred: true });
	const dialog = await openSpeech(page);
	await dialog
		.getByRole("textbox", { name: "Text", exact: true })
		.fill("Do not add this canceled line.");
	await dialog.getByRole("button", { name: "Add to timeline", exact: true }).click();
	await expect(
		dialog.getByRole("button", { name: "Making the voice…", exact: true }),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-tts-canceled", "true");
	await page.evaluate(() => window.dispatchEvent(new Event("finish-tts")));
	await expect(
		dialog.getByRole("button", { name: "Add to timeline", exact: true }),
	).toBeEnabled();
	await expect(page.locator('[data-variant="audio"]')).toHaveCount(0);
	await expect(dialog.getByRole("textbox", { name: "Text", exact: true })).toHaveValue(
		"Do not add this canceled line.",
	);
});
