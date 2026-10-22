/**
 * ITU-R BS.1770-4 integrated loudness for one mono channel, and the gain that brings a
 * narration line to a loudness target without letting any sample peak past a ceiling.
 * Pure TypeScript: the voice runs at its own sample rate (8 to 48 kHz), so the K-weighting
 * filters are designed for that rate instead of using the 48 kHz table from the standard.
 */

type Biquad = { b: [number, number, number]; a: [number, number, number] };

const BLOCK_S = 0.4;
const STEP_S = 0.1;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
/** Below this rate the 1.7 kHz shelf lies past Nyquist; such audio is measured unweighted. */
const MIN_WEIGHTED_RATE = 8000;

/**
 * The two K-weighting stages (high shelf, then RLB high-pass) for any sample rate, by the
 * bilinear transform of the analog prototypes behind the BS.1770 48 kHz coefficients.
 */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
	const shelfK = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
	const shelfQ = 0.7071752369554196;
	const vh = 10 ** (3.999843853973347 / 20);
	const vb = vh ** 0.4996667741545416;
	const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;
	const highPassK = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
	const highPassQ = 0.5003270373238773;
	const highPassA0 = 1 + highPassK / highPassQ + highPassK * highPassK;
	return [
		{
			b: [
				(vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
				(2 * (shelfK * shelfK - vh)) / shelfA0,
				(vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
			],
			a: [
				1,
				(2 * (shelfK * shelfK - 1)) / shelfA0,
				(1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0,
			],
		},
		{
			b: [1, -2, 1],
			a: [
				1,
				(2 * (highPassK * highPassK - 1)) / highPassA0,
				(1 - highPassK / highPassQ + highPassK * highPassK) / highPassA0,
			],
		},
	];
}

function filter(input: Float64Array, { b, a }: Biquad) {
	const output = new Float64Array(input.length);
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	for (let i = 0; i < input.length; i++) {
		const x = input[i];
		const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
		output[i] = y;
		x2 = x1;
		x1 = x;
		y2 = y1;
		y1 = y;
	}
	return output;
}

const blockLoudness = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);

/**
 * Gated integrated loudness in LUFS: 400 ms blocks every 100 ms, an absolute gate at
 * -70 LUFS, then a relative gate 10 LU under the loudness of the blocks that passed it.
 * Audio shorter than one block is measured as a single block. -Infinity when every block
 * is gated out (silence or near silence).
 */
export function integratedLoudness(samples: Float32Array, sampleRate: number) {
	if (!samples.length || !(sampleRate > 0)) return Number.NEGATIVE_INFINITY;
	let weighted = Float64Array.from(samples);
	if (sampleRate >= MIN_WEIGHTED_RATE)
		for (const stage of kWeighting(sampleRate)) weighted = filter(weighted, stage);
	const energy = new Float64Array(weighted.length + 1);
	for (let i = 0; i < weighted.length; i++) energy[i + 1] = energy[i] + weighted[i] ** 2;
	const blockLength = Math.min(weighted.length, Math.round(BLOCK_S * sampleRate));
	const step = Math.max(1, Math.round(STEP_S * sampleRate));
	const blocks: number[] = [];
	for (let start = 0; start + blockLength <= weighted.length; start += step)
		blocks.push((energy[start + blockLength] - energy[start]) / blockLength);
	const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
	const audible = blocks.filter((z) => z > 0 && blockLoudness(z) > ABSOLUTE_GATE_LUFS);
	if (!audible.length) return Number.NEGATIVE_INFINITY;
	const relativeGate = blockLoudness(mean(audible)) + RELATIVE_GATE_LU;
	const gated = audible.filter((z) => blockLoudness(z) > relativeGate);
	return blockLoudness(mean(gated));
}

export function samplePeak(samples: Float32Array) {
	let peak = 0;
	for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
	return peak;
}

export const toDb = (amplitude: number) =>
	amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY;

/**
 * The gain (dB) that brings audio measured at `loudness` LUFS with sample peak `peakDb`
 * to `targetLufs`, lowered so the peak needs at most `limiterDb` of peak limiting to stay
 * at or under `ceilingDb` (with 0, plain gain never passes the ceiling), and capped so
 * near-silence is not pumped up into audible noise.
 */
export function loudnessGainDb(
	loudness: number,
	peakDb: number,
	options: { targetLufs: number; ceilingDb: number; maxGainDb: number; limiterDb?: number },
) {
	if (!Number.isFinite(loudness) || !Number.isFinite(peakDb)) return 0;
	return Math.min(
		options.targetLufs - loudness,
		options.ceilingDb + (options.limiterDb ?? 0) - peakDb,
		options.maxGainDb,
	);
}

const LIMITER_LOOKAHEAD_S = 0.005;
const LIMITER_RELEASE_S = 0.08;

/**
 * Lookahead peak limiter: turns the level down smoothly over 5 ms before any sample that
 * would pass `ceiling` and lets it recover over about 80 ms, so a few loud syllables do not
 * hold the whole line down. Never clips; the caller bounds how much it may take off.
 */
export function limitPeaks(samples: Float32Array, sampleRate: number, ceiling: number) {
	const n = samples.length;
	const lookahead = Math.max(1, Math.round(LIMITER_LOOKAHEAD_S * sampleRate));
	// A hair under the ceiling, so rounding to 32-bit floats cannot land past it.
	const limit = ceiling * 0.9999;
	const needed = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const level = Math.abs(samples[i]);
		needed[i] = level > limit ? limit / level : 1;
	}
	// Smallest gain needed now or within the lookahead (sliding minimum, monotonic queue).
	const ahead = new Float64Array(n);
	const queue: number[] = [];
	let head = 0;
	for (let i = n - 1; i >= 0; i--) {
		while (queue.length > head && needed[queue[queue.length - 1]] >= needed[i]) queue.pop();
		queue.push(i);
		while (queue[head] > i + lookahead) head++;
		ahead[i] = needed[queue[head]];
	}
	// Averaging the last `lookahead` values ramps the gain down in time and, since each
	// average only covers windows that include sample i, never above what sample i needs.
	const release = 1 - Math.exp(-1 / (LIMITER_RELEASE_S * sampleRate));
	const output = new Float32Array(n);
	let sum = 0;
	let gain = 1;
	for (let i = 0; i < n; i++) {
		sum += ahead[i] - (i >= lookahead ? ahead[i - lookahead] : 0);
		// Before the start counts as needing no reduction.
		const ramped = (sum + Math.max(0, lookahead - i - 1)) / lookahead;
		gain = Math.min(ramped, gain + (1 - gain) * release);
		output[i] = samples[i] * Math.min(gain, needed[i]);
	}
	return output;
}

/**
 * Brings a line to the narration loudness target: one gain for the whole line, then the
 * limiter for the few peaks that would pass the ceiling (at most `limiterDb` off any of
 * them). Returns new samples and what was measured.
 */
export function normalizeLoudness(
	samples: Float32Array,
	sampleRate: number,
	{ targetLufs = -16, ceilingDb = -1.5, maxGainDb = 24, limiterDb = 4 } = {},
) {
	const loudness = integratedLoudness(samples, sampleRate);
	const peak = samplePeak(samples);
	const gainDb = loudnessGainDb(loudness, toDb(peak), {
		targetLufs,
		ceilingDb,
		maxGainDb,
		limiterDb,
	});
	const gain = 10 ** (gainDb / 20);
	const ceiling = 10 ** (ceilingDb / 20);
	let output = new Float32Array(samples.length);
	for (let i = 0; i < samples.length; i++) output[i] = samples[i] * gain;
	if (peak * gain > ceiling) output = limitPeaks(output, sampleRate, ceiling);
	const outputPeak = samplePeak(output);
	return {
		samples: output,
		gainDb,
		inputLufs: loudness,
		lufs: Number.isFinite(loudness) ? integratedLoudness(output, sampleRate) : loudness,
		peakDb: toDb(outputPeak),
		limitedDb: Math.max(0, toDb(peak * gain) - toDb(outputPeak)),
	};
}
