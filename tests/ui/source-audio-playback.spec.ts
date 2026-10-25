import { expect, type Page, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function setup(page: Page, blockedContext: boolean) {
	await installDesktopBridge(page, "filmstrip.mp4", { signedIn: false });
	await installDesktopBridgeOverrides(
		page,
		(blockedContext) => {
			window.electronAPI.getVideoAudioFallbackPaths = async () => ({
				success: true,
				paths: [`${location.origin}/recording.system.wav`],
				startDelayMsByPath: {},
			});
			const NativeAudio = window.Audio;
			const elements: HTMLAudioElement[] = [];
			Object.assign(window, {
				testSourceAudioElements: elements,
				Audio: function (src?: string) {
					const audio = new NativeAudio(src);
					elements.push(audio);
					return audio;
				},
			});
			if (blockedContext) {
				// A real media element still works; an unrelated Web Audio context cannot resume.
				const NativeContext = window.AudioContext;
				Object.assign(window, {
					AudioContext: class extends NativeContext {
						get state() {
							return "suspended" as AudioContextState;
						}
						resume() {
							return new Promise<void>(() => undefined);
						}
					},
				});
			}
		},
		blockedContext,
	);
	const samples = 48000 * 6;
	const wav = Buffer.alloc(44 + samples * 2);
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
	wav.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++)
		wav.writeInt16LE(Math.round(Math.sin((i * Math.PI * 880) / 48000) * 6000), 44 + i * 2);
	await page.route("**/recording.system.wav*", (route) =>
		route.fulfill({ body: wav, contentType: "audio/wav" }),
	);
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"] img').first()).toBeVisible({ timeout: 20000 });
	await expect.poll(() => sourceState(page)).toMatchObject({ ready: true, paused: true });
}

async function sourceState(page: Page) {
	return page.evaluate(() => {
		const audio = (
			window as unknown as { testSourceAudioElements: HTMLAudioElement[] }
		).testSourceAudioElements.find((audio) =>
			audio.dataset.sourceAudioPath?.endsWith("/recording.system.wav"),
		);
		const video = [...document.querySelectorAll("video")].find((video) => video.videoWidth > 0);
		return audio
			? {
					ready: audio.readyState >= 2,
					paused: audio.paused,
					time: audio.currentTime,
					volume: audio.volume,
					muted: audio.muted,
					videoMuted: video?.muted,
					videoTime: video?.currentTime,
					playbackRate: audio.playbackRate,
					playAttempts: Number(audio.dataset.testPlayAttempts ?? 0),
				}
			: null;
	});
}

for (const blocked of [false, true]) {
	test(`system companion plays with the video and stops on pause (Web Audio blocked: ${blocked})`, async ({
		page,
	}) => {
		await setup(page, blocked);
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect
			.poll(() => sourceState(page))
			.toMatchObject({ paused: false, muted: false, volume: 1, videoMuted: true });
		await expect.poll(async () => (await sourceState(page))?.time ?? 0).toBeGreaterThan(0.15);
		const state = (await sourceState(page))!;
		expect(Math.abs(state.time - state.videoTime!)).toBeLessThan(0.9);
		await page.getByRole("button", { name: "Pause", exact: true }).click();
		await expect.poll(() => sourceState(page)).toMatchObject({ paused: true });
		await page.getByRole("button", { name: "Preview volume", exact: true }).click();
		const volume = page.getByRole("dialog", { name: "Preview volume" }).getByRole("slider");
		await volume.press("Home");
		await expect.poll(() => sourceState(page)).toMatchObject({ paused: true, volume: 0 });
		await volume.press("End");
		await expect.poll(() => sourceState(page)).toMatchObject({ paused: true, volume: 1 });
		await page.keyboard.press("Escape");
	});
}

test("source playback errors are reported once without retrying on every video frame", async ({
	page,
}) => {
	await setup(page, false);
	await page.evaluate(() => {
		const original = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function () {
			if (this.dataset.sourceAudioPath?.endsWith("/recording.system.wav")) {
				this.dataset.testPlayAttempts = String(
					Number(this.dataset.testPlayAttempts ?? 0) + 1,
				);
				return Promise.reject(
					new DOMException("Test audio decoder unavailable", "NotSupportedError"),
				);
			}
			return original.call(this);
		};
	});
	await page.getByRole("button", { name: "Play", exact: true }).click();
	const warning = page.getByText(
		/Could not load companion audio source:.*Test audio decoder unavailable/,
	);
	await expect(warning).toBeVisible();
	await expect.poll(async () => (await sourceState(page))?.videoTime ?? 0).toBeGreaterThan(0.5);
	await expect(warning).toHaveCount(1);
	await expect.poll(() => sourceState(page)).toMatchObject({ playAttempts: 1 });
	await page.getByRole("button", { name: "Pause", exact: true }).click();
});
