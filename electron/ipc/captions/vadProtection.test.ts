import { expect, it } from "vitest";
import {
	hasVadProtectedBoundaries,
	parseVadEvidence,
	protectSilenceWithVad,
	protectVadAlignedCues,
	mergeVadEvidence,
} from "./vadProtection";

const evidence = {
	durationMs: 5000,
	segments: [
		{ startMs: 500, endMs: 1500 },
		{ startMs: 3000, endMs: 4000 },
	],
};
it("covers the independently measured phrase tail without cutting neighboring voice", () => {
	const voice = {
		durationMs: 12820,
		segments: [
			{ startMs: 596, endMs: 2626 },
			{ startMs: 5364, endMs: 7394 },
		],
	};
	const cues = [
		{ startMs: 527, endMs: 2616, alignment: "dtw-speech" },
		{ startMs: 5302, endMs: 7391, alignment: "dtw-speech" },
	];
	expect(protectVadAlignedCues(cues, voice)).toEqual([
		{ startMs: 527, endMs: 2690, alignment: "dtw-speech", vadBoundaryVerified: true },
		{ startMs: 5300, endMs: 7458, alignment: "dtw-speech", vadBoundaryVerified: true },
	]);
	expect(cues[0].endMs).toBe(2616);
});
it("never approves partial continuous speech, nearby competing cues or large disagreement", () => {
	const cue = { startMs: 500, endMs: 1000, alignment: "dtw-speech" };
	for (const voices of [[{ startMs: 600, endMs: 1400 }], [{ startMs: 100, endMs: 900 }]])
		expect(
			protectVadAlignedCues([cue], { durationMs: 5000, segments: voices })[0]
				.vadBoundaryVerified,
		).toBe(false);
	const shared = protectVadAlignedCues(
		[cue, { startMs: 1000, endMs: 1600, alignment: "dtw-speech" }],
		{ durationMs: 5000, segments: [{ startMs: 600, endMs: 1300 }] },
	);
	expect(shared.every((c) => !c.vadBoundaryVerified)).toBe(true);
	expect(
		protectVadAlignedCues([cue, { startMs: 1030, endMs: 1500 }], {
			durationMs: 5000,
			segments: [{ startMs: 600, endMs: 990 }],
		})[0].vadBoundaryVerified,
	).toBe(false);
});
it("merges all audible tracks and does not approve incomplete acoustic evidence", () => {
	expect(
		mergeVadEvidence([
			evidence,
			{ durationMs: 6000, segments: [{ startMs: 1400, endMs: 3100 }] },
		]),
	).toEqual({ durationMs: 6000, segments: [{ startMs: 500, endMs: 4000 }] });
	expect(mergeVadEvidence([evidence, null])).toBeNull();
});
it("restricts measured silence to padded non-voice intervals and fails closed", () => {
	expect(protectSilenceWithVad([{ startMs: 0, endMs: 5000 }], evidence)).toEqual([
		{ startMs: 0, endMs: 300 },
		{ startMs: 1700, endMs: 2800 },
		{ startMs: 4200, endMs: 5000 },
	]);
	expect(protectSilenceWithVad([{ startMs: 2000, endMs: 2500 }], evidence)).toEqual([
		{ startMs: 2000, endMs: 2500 },
	]);
	expect(protectSilenceWithVad([{ startMs: 0, endMs: 5000 }], null)).toEqual([]);
});
it("permits the confirmed target sentence internally while protecting both cut edges", () => {
	expect(hasVadProtectedBoundaries({ startMs: 400, endMs: 1600 }, evidence)).toBe(true);
	expect(hasVadProtectedBoundaries({ startMs: 600, endMs: 1600 }, evidence)).toBe(false);
	expect(hasVadProtectedBoundaries({ startMs: 400, endMs: 3100 }, evidence)).toBe(false);
	expect(hasVadProtectedBoundaries({ startMs: 1600, endMs: 2500 }, evidence)).toBe(false);
	expect(
		hasVadProtectedBoundaries({ startMs: 400, endMs: 1600 }, { ...evidence, segments: [] }),
	).toBe(false);
});
it("preserves quieter adjacent speech and does not infer a transcript from VAD", () => {
	expect(
		hasVadProtectedBoundaries(
			{ startMs: 400, endMs: 1600 },
			{
				...evidence,
				segments: [{ startMs: 500, endMs: 1700 }],
			},
		),
	).toBe(false);
	expect(hasVadProtectedBoundaries({ startMs: -10, endMs: 2000 }, evidence)).toBe(false);
	expect(hasVadProtectedBoundaries({ startMs: 0, endMs: Infinity }, evidence)).toBe(false);
});
it("returns source sample coordinates without rounding or invented word timing", () => {
	expect(
		parseVadEvidence(
			JSON.stringify({
				version: 1,
				sampleRate: 16000,
				durationSamples: 80000,
				segments: [{ startSample: 8001, endSample: 24000 }],
			}),
		),
	).toEqual({
		durationMs: 5000,
		segments: [{ startMs: 500.0625, endMs: 1500 }],
	});
});
it("rejects corrupt, out-of-range, overlapping and unsorted evidence", () => {
	for (const segments of [
		[{ startSample: -1, endSample: 100 }],
		[{ startSample: 1, endSample: 1 }],
		[{ startSample: 0, endSample: 80001 }],
		[
			{ startSample: 500, endSample: 1000 },
			{ startSample: 0, endSample: 100 },
		],
		[
			{ startSample: 0, endSample: 500 },
			{ startSample: 400, endSample: 1000 },
		],
	])
		expect(() =>
			parseVadEvidence(
				JSON.stringify({ version: 1, sampleRate: 16000, durationSamples: 80000, segments }),
			),
		).toThrow();
	expect(() => parseVadEvidence("{}")).toThrow();
});
