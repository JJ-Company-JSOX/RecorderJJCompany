import { expect, it } from "vitest";
import { narrationBaselineFor } from "./narrationBaseline";
import type { EditState } from "./plan";
const base = (): EditState => ({
	clipRegions: [{ id: "c", startMs: 0, endMs: 5000, speed: 1 }],
	zoomRegions: [],
	annotationRegions: [],
	audioRegions: [],
	autoCaptions: [],
	speedRegions: [],
});
it("accepts equivalent normalized clips and audio presentation changes", () => {
	const state = base();
	const normalized = {
		...state,
		clipRegions: [
			{
				...state.clipRegions[0],
				sourceStartMs: 0,
				sourceMinMs: 0,
				sourceMaxMs: 5000,
				showSourceAudio: true,
				muted: false,
			},
		],
		sourceAudioTrackSettingsByClip: {},
	};
	expect(narrationBaselineFor(normalized, "a.mp4")).toBe(narrationBaselineFor(state, "a.mp4"));
});
it("rejects real trim, speed, source and caption changes", () => {
	const state = base(),
		original = narrationBaselineFor(state, "a.mp4");
	for (const patch of [
		{ endMs: 4000 },
		{ sourceStartMs: 1000 },
		{ speed: 2 },
		{ startMs: 1000 },
	]) {
		expect(
			narrationBaselineFor(
				{ ...state, clipRegions: [{ ...state.clipRegions[0], ...patch }] },
				"a.mp4",
			),
		).not.toBe(original);
	}
	expect(narrationBaselineFor(state, "b.mp4")).not.toBe(original);
	expect(
		narrationBaselineFor(
			{
				...state,
				autoCaptions: [{ id: "speech", text: "hello", startMs: 500, endMs: 1000 }],
			},
			"a.mp4",
		),
	).not.toBe(original);
});
it("ignores its own previous voice-over so regeneration remains possible", () => {
	const state = base();
	expect(
		narrationBaselineFor(
			{
				...state,
				audioRegions: [
					{
						id: "narration-1",
						audioPath: "voice.wav",
						startMs: 0,
						endMs: 1000,
						volume: 1,
					},
				],
				autoCaptions: [{ id: "narration-1", text: "hello", startMs: 0, endMs: 1000 }],
			},
			"a.mp4",
		),
	).toBe(narrationBaselineFor(state, "a.mp4"));
});
