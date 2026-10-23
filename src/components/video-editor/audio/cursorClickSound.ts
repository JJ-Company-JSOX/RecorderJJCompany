import {
	type AudioRegion,
	type ClipRegion,
	type CursorTelemetryPoint,
	getClipSourceEndMs,
	getClipSourceStartMs,
} from "../types";

export const CURSOR_CLICK_SAMPLE_RATE = 24000;
export const CURSOR_CLICK_DURATION_MS = 22;
const CLICK_TYPES = new Set(["click", "double-click", "right-click", "middle-click"]);

/** Original synthesized click. No stock sound or remote resource is used. */
export function createCursorClickSamples(): Float32Array<ArrayBuffer> {
	const length = Math.round((CURSOR_CLICK_SAMPLE_RATE * CURSOR_CLICK_DURATION_MS) / 1000);
	return Float32Array.from({ length }, (_, i) => {
		const t = i / CURSOR_CLICK_SAMPLE_RATE;
		const envelope = Math.sin((Math.PI * i) / (length - 1)) * Math.exp(-t * 210);
		const value =
			envelope *
			(Math.sin(2 * Math.PI * 1800 * t) + 0.3 * Math.sin(2 * Math.PI * 3900 * t)) *
			0.6;
		return Math.round(value * 32767) / 32768;
	});
}

let soundUrl: string | undefined;
export function getCursorClickSoundUrl(): string {
	if (soundUrl) return soundUrl;
	const samples = createCursorClickSamples();
	const bytes = new Uint8Array(44 + samples.length * 2);
	const view = new DataView(bytes.buffer);
	const text = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
	};
	text(0, "RIFF");
	view.setUint32(4, bytes.length - 8, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, CURSOR_CLICK_SAMPLE_RATE, true);
	view.setUint32(28, CURSOR_CLICK_SAMPLE_RATE * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	text(36, "data");
	view.setUint32(40, samples.length * 2, true);
	samples.forEach((sample, index) =>
		view.setInt16(44 + index * 2, Math.round(sample * 32768), true),
	);
	soundUrl = `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
	return soundUrl;
}

/** Source clicks become output-time cues using the same clip bounds and speed as video. */
export function buildCursorClickAudioRegions(
	telemetry: CursorTelemetryPoint[],
	clips: ClipRegion[],
	volume: number,
): AudioRegion[] {
	if (!Number.isFinite(volume) || volume <= 0 || !telemetry.length) return [];
	const clicks = telemetry.filter(
		(point) => Number.isFinite(point.timeMs) && CLICK_TYPES.has(point.interactionType ?? ""),
	);
	if (!clicks.length) return [];
	const result: AudioRegion[] = [];
	for (const clip of clips) {
		const start = getClipSourceStartMs(clip);
		const end = getClipSourceEndMs(clip);
		const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
		const seen = new Set<number>();
		for (const [index, point] of clicks.entries()) {
			if (point.timeMs < start || point.timeMs >= end || seen.has(point.timeMs)) continue;
			seen.add(point.timeMs);
			const startMs = clip.startMs + (point.timeMs - start) / speed;
			result.push({
				id: `cursor-click-${clip.id}-${index}`,
				startMs,
				endMs: Math.min(clip.endMs, startMs + CURSOR_CLICK_DURATION_MS),
				audioPath: getCursorClickSoundUrl(),
				volume: Math.min(1, volume),
			});
		}
	}
	return result.sort((a, b) => a.startMs - b.startMs);
}
