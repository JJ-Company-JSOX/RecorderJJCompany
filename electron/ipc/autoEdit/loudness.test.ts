import { describe, expect, it } from "vitest";
import {
	integratedLoudness,
	kWeighting,
	limitPeaks,
	loudnessGainDb,
	normalizeLoudness,
	samplePeak,
	toDb,
} from "./loudness";

const sine = (hz: number, db: number, seconds: number, sampleRate: number) => {
	const amplitude = 10 ** (db / 20);
	return Float32Array.from(
		{ length: Math.round(seconds * sampleRate) },
		(_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate),
	);
};
const join = (...parts: Float32Array[]) => {
	const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
};

describe("BS.1770-4 integrated loudness", () => {
	it("designs the K-weighting filters that the standard tabulates for 48 kHz", () => {
		const [shelf, highPass] = kWeighting(48000);
		const close = (actual: number[], expected: number[]) =>
			actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 8));
		close(shelf.b, [1.53512485958697, -2.69169618940638, 1.19839281085285]);
		close(shelf.a, [1, -1.69065929318241, 0.73248077421585]);
		close(highPass.b, [1, -2, 1]);
		close(highPass.a, [1, -1.99004745483398, 0.99007225036621]);
	});
	it("reads a full-scale 997 Hz sine at 48 kHz as about -3.01 LUFS", () => {
		expect(integratedLoudness(sine(997, 0, 10, 48000), 48000)).toBeCloseTo(-3.01, 2);
	});
	it.each([
		48000, 44100, 24000, 22050, 16000,
	])("measures the same tone the same way at %i Hz", (rate) => {
		expect(Math.abs(integratedLoudness(sine(997, -20, 5, rate), rate) + 23.01)).toBeLessThan(
			0.1,
		);
	});
	it("gates out silence and quiet passages instead of averaging them in", () => {
		expect(integratedLoudness(new Float32Array(48000), 48000)).toBe(Number.NEGATIVE_INFINITY);
		// Under the -70 LUFS absolute gate.
		expect(integratedLoudness(sine(997, -80, 2, 48000), 48000)).toBe(Number.NEGATIVE_INFINITY);
		// A long pause between sentences does not make the line read quieter: averaged in, it
		// would read about 1.8 LU lower. Only the blocks overlapping speech count.
		const speech = sine(997, -20, 3, 24000);
		const withPause = join(speech, new Float32Array(3 * 24000), speech);
		expect(integratedLoudness(withPause, 24000)).toBeGreaterThan(-23.4);
		expect(integratedLoudness(withPause, 24000)).toBeLessThan(-23);
		// A passage 30 dB quieter falls under the relative gate.
		const gated = integratedLoudness(join(speech, sine(997, -50, 3, 24000)), 24000);
		expect(gated).toBeGreaterThan(-23.5);
		expect(gated).toBeLessThan(-22.9);
	});
	it("measures audio shorter than one 400 ms block as a single block", () => {
		expect(integratedLoudness(sine(997, -20, 0.2, 24000), 24000)).toBeCloseTo(-23.0, 0);
		expect(integratedLoudness(new Float32Array(0), 24000)).toBe(Number.NEGATIVE_INFINITY);
	});
});

describe("narration loudness gain", () => {
	const target = { targetLufs: -16, ceilingDb: -1.5, maxGainDb: 24 };
	it("reaches the target unless the peak ceiling or the gain cap says less", () => {
		expect(loudnessGainDb(-26, -15, target)).toBeCloseTo(10, 10);
		expect(loudnessGainDb(-10, -2, target)).toBeCloseTo(-6, 10);
		// Peak-limited: -5 dBFS may only rise to -1.5.
		expect(loudnessGainDb(-26, -5, target)).toBeCloseTo(3.5, 10);
		// With 4 dB of peak limiting allowed, -5 dBFS may rise to +2.5 before the limiter.
		expect(loudnessGainDb(-26, -5, { ...target, limiterDb: 4 })).toBeCloseTo(7.5, 10);
		// Near silence is not pumped up past the cap.
		expect(loudnessGainDb(-60, -40, target)).toBe(24);
		expect(loudnessGainDb(Number.NEGATIVE_INFINITY, -80, target)).toBe(0);
	});
	it("brings a quiet line to -16 LUFS and leaves the peak under -1.5 dBFS", () => {
		const line = join(
			sine(220, -30, 1, 24000),
			new Float32Array(9000),
			sine(440, -32, 1, 24000),
		);
		const result = normalizeLoudness(line, 24000);
		expect(result.lufs).toBeCloseTo(-16, 6);
		expect(integratedLoudness(result.samples, 24000)).toBeCloseTo(-16, 2);
		expect(toDb(samplePeak(result.samples))).toBeLessThanOrEqual(-1.5);
		expect(result.peakDb).toBeCloseTo(toDb(samplePeak(result.samples)), 4);
	});
	it("limits a few loud peaks by at most 4 dB, then lowers the gain, never clipping", () => {
		const line = sine(997, -40, 2, 24000);
		for (const at of [1000, 20000, 40000]) line[at] = 0.9;
		const result = normalizeLoudness(line, 24000);
		expect(result.gainDb).toBeCloseTo(-1.5 + 4 - toDb(0.9), 4);
		expect(result.limitedDb).toBeCloseTo(4, 2);
		expect(toDb(samplePeak(result.samples))).toBeLessThanOrEqual(-1.5);
		expect(toDb(samplePeak(result.samples))).toBeGreaterThan(-1.51);
		expect(result.lufs).toBeLessThan(-16);
	});
	it("gets a line with loud syllables closer to the target than one gain could", () => {
		// Speech-like: a steady voice with short bursts 20 dB above it, as plosives give.
		const line = sine(220, -22, 4, 24000);
		for (let burst = 0.3; burst < 4; burst += 0.7)
			for (let i = 0; i < 72; i++) line[Math.round(burst * 24000) + i] *= 8;
		const gainOnly = normalizeLoudness(line, 24000, { limiterDb: 0 });
		const limited = normalizeLoudness(line, 24000);
		expect(toDb(samplePeak(gainOnly.samples))).toBeLessThanOrEqual(-1.5);
		expect(toDb(samplePeak(limited.samples))).toBeLessThanOrEqual(-1.5);
		// Up to 4 dB more gain, minus the little energy the limited bursts lose.
		expect(limited.lufs - gainOnly.lufs).toBeGreaterThan(3);
		expect(limited.limitedDb).toBeLessThanOrEqual(4.01);
	});
	it("only touches the samples around a peak", () => {
		const line = sine(220, -12, 1, 24000);
		line[12000] = 1;
		const limited = limitPeaks(line, 24000, 0.5);
		expect(samplePeak(limited)).toBeLessThanOrEqual(0.5);
		// The ramp starts 5 ms before the peak and recovers within about half a second.
		expect(limited[12000 - 200]).toBe(line[12000 - 200]);
		for (const at of [100, 6000, 23000]) expect(limited[at]).toBeCloseTo(line[at], 3);
	});
	it("returns silence unchanged", () => {
		const result = normalizeLoudness(new Float32Array(2400), 24000);
		expect(result.gainDb).toBe(0);
		expect(result.samples.every((s) => s === 0)).toBe(true);
	});
});
