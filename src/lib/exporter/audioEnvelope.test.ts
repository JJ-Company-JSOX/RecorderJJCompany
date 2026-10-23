import { describe, expect, it } from "vitest";
import { audioEnvelopeAt, audioEnvelopeBreakpoints } from "./audioEnvelope";

describe("project-time audio envelope", () => {
	it("keeps legacy regions at unity, with silence outside their span", () => {
		expect(audioEnvelopeAt(500, 1000)).toBe(1);
		expect(audioEnvelopeAt(-1, 1000)).toBe(0);
		expect(audioEnvelopeAt(1001, 1000)).toBe(0);
	});
	it("evaluates independent fades without exceeding unity", () => {
		expect(audioEnvelopeAt(100, 1000, 200, 400)).toBe(0.5);
		expect(audioEnvelopeAt(500, 1000, 200, 400)).toBe(1);
		expect(audioEnvelopeAt(900, 1000, 200, 400)).toBe(0.25);
		expect(audioEnvelopeBreakpoints(1000, 200, 400)).toEqual([0, 200, 600, 1000]);
	});
	it("includes the exact crossing for overlapping fades", () => {
		expect(audioEnvelopeBreakpoints(1000, 800, 800)).toEqual([0, 500, 1000]);
		expect(audioEnvelopeAt(500, 1000, 800, 800)).toBe(0.625);
	});
	it("linear export segments reproduce preview at arbitrary chunk boundaries", () => {
		for (const fades of [
			[200, 400],
			[800, 800],
			[0, 0],
			[1000, 0],
		]) {
			const points = [
				...new Set([
					137,
					863,
					...audioEnvelopeBreakpoints(1000, ...fades).filter((t) => t > 137 && t < 863),
				]),
			].sort((a, b) => a - b);
			for (let i = 1; i < points.length; i++) {
				const a = points[i - 1],
					b = points[i];
				for (let j = 0; j <= 10; j++) {
					const mix = j / 10;
					const rendered =
						audioEnvelopeAt(a, 1000, ...fades) * (1 - mix) +
						audioEnvelopeAt(b, 1000, ...fades) * mix;
					expect(rendered).toBeCloseTo(
						audioEnvelopeAt(a + (b - a) * mix, 1000, ...fades),
						10,
					);
				}
			}
		}
	});
	it("sanitizes invalid fades and zero duration", () => {
		expect(audioEnvelopeAt(100, 1000, NaN, -20)).toBe(1);
		expect(audioEnvelopeAt(100, 0)).toBe(0);
		expect(audioEnvelopeBreakpoints(0)).toEqual([]);
	});
});
