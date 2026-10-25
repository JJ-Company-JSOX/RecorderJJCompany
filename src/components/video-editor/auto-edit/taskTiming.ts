/** Estimates use successful runs on this computer, never an artificial progress percentage. */
export type TimingSample = { key: string; durationMs: number };
export function workloadBucket(units: number): number {
	return 2 ** Math.ceil(Math.log2(Math.max(1, units)));
}
export function validSamples(value: unknown): TimingSample[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(s): s is TimingSample =>
				!!s &&
				typeof s.key === "string" &&
				s.key.length <= 300 &&
				Number.isFinite(s.durationMs) &&
				s.durationMs >= 1000 &&
				s.durationMs <= 24 * 60 * 60 * 1000,
		)
		.slice(-100);
}
export function estimateRange(samples: TimingSample[], key: string): [number, number] | null {
	const matches = samples.filter((s) => s.key === key).slice(-5);
	if (!matches.length) return null;
	return [
		Math.min(...matches.map((s) => s.durationMs)) * 0.7,
		Math.max(...matches.map((s) => s.durationMs)) * 1.5,
	];
}
export function formatWait(ms: number): string {
	const seconds = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
