import { describe, expect, it } from "vitest";
import { placeAudioClips, resolveAudioPlacement } from "./timelineAudioPlacement";

describe("timelineAudioPlacement", () => {
	it("uses first available track when no preferred track is provided", () => {
		const placement = resolveAudioPlacement({
			audioRegions: [{ id: "a1", startMs: 0, endMs: 500, trackIndex: 0 }],
			startPos: 500,
			totalMs: 2000,
			audioDurationMs: 500,
		});
		expect(placement).toEqual({ trackIndex: 0, durationMs: 500 });
	});

	it("falls back to next track when preferred track is blocked", () => {
		const placement = resolveAudioPlacement({
			audioRegions: [{ id: "a1", startMs: 0, endMs: 1500, trackIndex: 0 }],
			startPos: 1000,
			totalMs: 3000,
			audioDurationMs: 800,
		});
		expect(placement).toEqual({ trackIndex: 1, durationMs: 800 });
	});

	it("returns null when no slot is available", () => {
		const placement = resolveAudioPlacement({
			audioRegions: [{ id: "a1", startMs: 0, endMs: 2000, trackIndex: 0 }],
			startPos: 1500,
			totalMs: 2000,
			audioDurationMs: 800,
			preferredTrackIndex: 0,
		});
		expect(placement).toBeNull();
	});

	it("places clips one after another on one track from the playhead", () => {
		const clip = (name: string, durationMs: number) => ({ audioPath: name, durationMs });
		// Track 0 is busy at the playhead, so the voice goes to track 1 and stays there.
		const placed = placeAudioClips({
			audioRegions: [{ id: "music", startMs: 0, endMs: 1500, trackIndex: 0 }],
			startPos: 1000,
			totalMs: 6000,
			clips: [clip("a.wav", 1000), clip("b.wav", 1200)],
			gapMs: 250,
		});
		expect(placed).toEqual([
			{ audioPath: "a.wav", startMs: 1000, endMs: 2000, trackIndex: 1, trimmed: false },
			{ audioPath: "b.wav", startMs: 2250, endMs: 3450, trackIndex: 1, trimmed: false },
		]);
	});

	it("shortens the clip that reaches the end of the video and stops when there is no room", () => {
		const placed = placeAudioClips({
			audioRegions: [],
			startPos: 0,
			totalMs: 2000,
			clips: [
				{ audioPath: "a.wav", durationMs: 1500 },
				{ audioPath: "b.wav", durationMs: 1500 },
				{ audioPath: "c.wav", durationMs: 1500 },
			],
			gapMs: 250,
		});
		expect(placed).toEqual([
			{ audioPath: "a.wav", startMs: 0, endMs: 1500, trackIndex: 0, trimmed: false },
			{ audioPath: "b.wav", startMs: 1750, endMs: 2000, trackIndex: 0, trimmed: true },
		]);
		expect(
			placeAudioClips({
				audioRegions: [],
				startPos: 2000,
				totalMs: 2000,
				clips: [{ audioPath: "a.wav", durationMs: 500 }],
				gapMs: 0,
			}),
		).toEqual([]);
	});

	it("keeps every paragraph by reserving a track beyond later music and paragraph gaps", () => {
		const audioRegions = [
			{ id: "later-music", startMs: 1400, endMs: 2500, trackIndex: 0 },
			{ id: "in-pause", startMs: 1000, endMs: 1200, trackIndex: 1 },
		];
		const placed = placeAudioClips({
			audioRegions,
			startPos: 0,
			totalMs: 6000,
			clips: [
				{ audioPath: "a.wav", durationMs: 1000 },
				{ audioPath: "b.wav", durationMs: 1000 },
			],
			gapMs: 250,
		});
		expect(placed).toEqual([
			{ audioPath: "a.wav", startMs: 0, endMs: 1000, trackIndex: 2, trimmed: false },
			{ audioPath: "b.wav", startMs: 1250, endMs: 2250, trackIndex: 2, trimmed: false },
		]);
		expect(audioRegions).toHaveLength(2);
	});
});
