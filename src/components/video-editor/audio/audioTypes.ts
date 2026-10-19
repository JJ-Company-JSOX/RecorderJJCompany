import type { AudioPeaksData } from "../timeline/core/timelineTypes";

export type SourceAudioTrackId = "mixed" | "system" | "mic" | (string & {});

export interface SourceAudioTrackSetting {
	volume: number;
	normalize: boolean;
	/** Optional derived asset; original source is never overwritten. */
	voiceEnhancement?: {
		enabled: boolean;
		engine: "rnnoise";
		originalPath: string;
		audioPath: string;
		sampleRate: 48000;
		samples: number;
	};
}

export type SourceAudioTrackSettings = Record<string, SourceAudioTrackSetting>;

export interface SourceAudioTrackMetaItem {
	id: SourceAudioTrackId;
	label: string;
}

export type SourceAudioTrackMeta = SourceAudioTrackMetaItem[];

export interface SourceAudioTrackWithPeaks extends SourceAudioTrackMetaItem {
	peaks: AudioPeaksData;
}

export const SOURCE_AUDIO_FALLBACK_TOAST_ID = "source-audio-fallback-error";
export const SOURCE_AUDIO_NORMALIZE_GAIN = 1.35;
