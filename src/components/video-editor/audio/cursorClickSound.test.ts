import { describe, expect, it } from "vitest";
import { normalizeProjectEditor } from "../projectPersistence";
import {
	buildCursorClickAudioRegions,
	CURSOR_CLICK_SAMPLE_RATE,
	createCursorClickSamples,
	getCursorClickSoundUrl,
} from "./cursorClickSound";

describe("cursor click sound", () => {
	it("generates a small, decodable PCM WAV with the same samples as preview", () => {
		const url = getCursorClickSoundUrl();
		expect(getCursorClickSoundUrl()).toBe(url);
		const bytes = Buffer.from(url.split(",")[1], "base64");
		expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
		expect(bytes.subarray(8, 12).toString()).toBe("WAVE");
		expect(bytes.readUInt32LE(24)).toBe(CURSOR_CLICK_SAMPLE_RATE);
		const samples = createCursorClickSamples();
		expect(bytes.length).toBe(44 + samples.length * 2);
		for (let i = 0; i < samples.length; i++)
			expect(bytes.readInt16LE(44 + i * 2) / 32768).toBeCloseTo(samples[i], 10);
		expect(Math.max(...samples.map(Math.abs))).toBeLessThan(1);
		expect(samples.some((sample) => Math.abs(sample) > 0.1)).toBe(true);
		expect(url.length).toBeLessThan(2000);
	});

	it("maps clicks through source trims, clip reordering and playback speed", () => {
		const regions = buildCursorClickAudioRegions(
			[
				{ timeMs: 500, cx: 0.1, cy: 0.2, interactionType: "click" },
				{ timeMs: 1500, cx: 0.8, cy: 0.2, interactionType: "click" },
				{ timeMs: 1500, cx: 0.8, cy: 0.2, interactionType: "double-click" },
				{ timeMs: 3500, cx: 0.4, cy: 0.2, interactionType: "click" },
				{ timeMs: 1600, cx: 0.4, cy: 0.2, interactionType: "move" },
			],
			[
				{ id: "later", startMs: 0, endMs: 1000, sourceStartMs: 1000, speed: 2 },
				{ id: "earlier", startMs: 2000, endMs: 3000, sourceStartMs: 0, speed: 1 },
			],
			0.35,
		);
		expect(regions.map((region) => region.startMs)).toEqual([250, 2500]);
		expect(regions.every((region) => region.endMs - region.startMs === 22)).toBe(true);
		expect(regions.every((region) => region.volume === 0.35)).toBe(true);
	});

	it("does not emit clicks for removed footage, muted effects or pointer movement", () => {
		const clicks = [{ timeMs: 500, cx: 0.1, cy: 0.1, interactionType: "click" as const }];
		expect(buildCursorClickAudioRegions(clicks, [], 0.5)).toEqual([]);
		expect(
			buildCursorClickAudioRegions(
				clicks,
				[{ id: "clip", startMs: 0, endMs: 1000, speed: 1 }],
				0,
			),
		).toEqual([]);
	});

	it("keeps an end-of-clip click inside the same clip", () => {
		const [region] = buildCursorClickAudioRegions(
			[{ timeMs: 999, cx: 0.1, cy: 0.1, interactionType: "click" }],
			[{ id: "clip", startMs: 0, endMs: 1000, speed: 1 }],
			0.5,
		);
		expect(region.endMs).toBe(1000);
	});

	it("old projects stay silent and click settings survive JSON round trips", () => {
		expect(normalizeProjectEditor({}).cursorClickSound).toBe(false);
		expect(
			normalizeProjectEditor(
				JSON.parse(
					JSON.stringify({ cursorClickSound: true, cursorClickSoundVolume: 0.25 }),
				),
			),
		).toMatchObject({ cursorClickSound: true, cursorClickSoundVolume: 0.25 });
	});
});
