import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("offline audio renders fades consistently across export chunks and decodes click WAV", async ({
	page,
}) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const result = await page.evaluate(async () => {
		// Exercise the real export scheduler and browser audio renderer, without physical audio devices.
		const { OfflineAudioProcessor } = await import(
			"/src/lib/exporter/offlineAudioProcessor.ts"
		);
		const { getCursorClickSoundUrl } = await import(
			"/src/components/video-editor/audio/cursorClickSound.ts"
		);
		const processor = new OfflineAudioProcessor();
		const samples = [];
		for (const chunkStart of [0, 0.37, 0.74]) {
			const context = new OfflineAudioContext(1, Math.round(0.37 * 48000), 48000);
			const buffer = context.createBuffer(1, 48000, 48000);
			buffer.getChannelData(0).fill(1);
			processor.scheduleRegionForChunk(
				context,
				buffer,
				{
					id: "fade",
					startMs: 0,
					endMs: 1000,
					audioPath: "test",
					volume: 0.8,
					fadeInMs: 800,
					fadeOutMs: 800,
				},
				[],
				chunkStart,
				0.37,
				true,
			);
			const rendered = await context.startRendering();
			samples.push(
				...[0.02, 0.15, 0.3].map((t) => ({
					time: chunkStart + t,
					value: rendered.getChannelData(0)[Math.round(t * 48000)],
				})),
			);
		}
		const context = new OfflineAudioContext(1, 4800, 48000);
		const wav = await (await fetch(getCursorClickSoundUrl())).arrayBuffer();
		const decoded = await context.decodeAudioData(wav);
		return {
			samples,
			clickDuration: decoded.duration,
			clickPeak: Math.max(...decoded.getChannelData(0)),
		};
	});
	for (const { time, value } of result.samples) {
		const expected =
			time > 1 ? 0 : 0.8 * Math.max(0, Math.min(1, time / 0.8, (1 - time) / 0.8));
		expect(value).toBeCloseTo(expected, 3);
	}
	expect(result.clickDuration).toBeGreaterThan(0.01);
	expect(result.clickDuration).toBeLessThan(0.05);
	expect(result.clickPeak).toBeGreaterThan(0.01);
	expect(result.clickPeak).toBeLessThan(1);
});
