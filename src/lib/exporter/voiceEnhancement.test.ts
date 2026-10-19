import { describe, expect, it } from "vitest";
import {
	getEnhancementAssetPaths,
	resolveEnhancedAudioPath,
	buildResolvedAudioPlan,
} from "./audioRoutingEngine";
import { hasNonDefaultSourceTrackSettings } from "./audioProcessorShared";

const source = "C:\\recordings\\take.mic.wav";
const enhanced = "C:\\derived\\new.mic.rnnoise.wav";
const settings = {
	mic: {
		volume: 0.7,
		normalize: false,
		voiceEnhancement: {
			enabled: true,
			engine: "rnnoise" as const,
			originalPath: source,
			audioPath: enhanced,
			sampleRate: 48000 as const,
			samples: 48001,
		},
	},
};
describe("non-destructive RNNoise routing", () => {
	it("replaces decoder input but keeps original track identities and gain", () => {
		const plan = buildResolvedAudioPlan({
			videoResource: "C:\\recordings\\take.mp4",
			sourceAudioFallbackPaths: [source],
		});
		expect(plan.playbackPaths).toEqual([source]);
		expect(resolveEnhancedAudioPath(source, settings)).toBe(enhanced);
		expect(plan.tracks.filter((t) => t.kind === "mic")).toHaveLength(1);
		expect(hasNonDefaultSourceTrackSettings(settings)).toBe(true);
	});
	it("undo restores original and stale source references are not reused", () => {
		expect(
			resolveEnhancedAudioPath(source, {
				mic: {
					...settings.mic,
					voiceEnhancement: { ...settings.mic.voiceEnhancement, enabled: false },
				},
			}),
		).toBe(source);
		expect(resolveEnhancedAudioPath("C:\\different.mic.wav", settings)).toBe(
			"C:\\different.mic.wav",
		);
	});
	it("matches authenticated localhost URLs without changing remote resources", () => {
		expect(
			resolveEnhancedAudioPath(
				`http://127.0.0.1:4321/video?path=${encodeURIComponent(source)}&token=abc`,
				settings,
			),
		).toBe(enhanced);
		expect(resolveEnhancedAudioPath("https://example.com/video", settings)).toBe(
			"https://example.com/video",
		);
	});
	it("collects both references for persistent projects without rewriting media", () => {
		expect(getEnhancementAssetPaths(settings)).toEqual([enhanced, source]);
		expect(getEnhancementAssetPaths(null)).toEqual([]);
	});
});
