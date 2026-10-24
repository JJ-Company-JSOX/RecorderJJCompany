import type { SourceAudioTrackSettings } from "@/components/video-editor/audio/audioTypes";
import { SOURCE_AUDIO_NORMALIZE_GAIN } from "@/components/video-editor/audio/audioTypes";
import type { AudioRegion } from "@/components/video-editor/types";
import { resolveSourceAudioFallbackPaths } from "./sourceAudioFallback";
import { audioSourceOffsetMs } from "@/components/video-editor/audio/audioRegionTiming";

export function resolveEnhancedAudioPath(
	originalPath: string,
	settings?: SourceAudioTrackSettings,
): string {
	const enhancement = settings?.[getSourceTrackIdFromPath(originalPath)]?.voiceEnhancement;
	let localPath = originalPath;
	try {
		const url = new URL(originalPath);
		if (
			(url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
			url.pathname === "/video"
		)
			localPath = url.searchParams.get("path") ?? originalPath;
		else if (url.protocol === "file:")
			localPath = decodeURIComponent(url.pathname)
				.replace(/^\/([A-Za-z]:)/, "$1")
				.replace(/\//g, "\\");
	} catch {
		/* plain path */
	}
	return enhancement?.enabled &&
		enhancement.engine === "rnnoise" &&
		enhancement.originalPath === localPath &&
		enhancement.audioPath &&
		enhancement.sampleRate === 48000 &&
		enhancement.samples > 0
		? enhancement.audioPath
		: originalPath;
}

/** Keep original path identity for gains/delays; only decoder input is replaced. */
export function getEnhancementAssetPaths(settings: unknown): string[] {
	if (!settings || typeof settings !== "object") return [];
	return Object.values(settings).flatMap((value) => {
		if (!value || typeof value !== "object") return [];
		const item = (
			value as { voiceEnhancement?: { audioPath?: unknown; originalPath?: unknown } }
		).voiceEnhancement;
		return item && typeof item.audioPath === "string" && typeof item.originalPath === "string"
			? [item.audioPath, item.originalPath]
			: [];
	});
}

export type SourceTrackId = "mic" | "system" | "mixed";
export type ResolvedAudioTrackKind = "user" | "system" | "mic" | "mixed" | "embedded";

export interface ResolvedAudioTrack {
	id: string;
	kind: ResolvedAudioTrackKind;
	sourceRef: {
		path: string;
		startDelayMs: number;
		offsetMs?: number;
	};
	gain: number;
	fadeInMs?: number;
	fadeOutMs?: number;
	timelineBinding: {
		startMs: number;
		endMs: number;
	};
}

export interface ResolvedAudioPlan {
	hasEmbeddedSourceAudio: boolean;
	pathsByTrack: Partial<Record<SourceTrackId, string>>;
	playbackPaths: string[];
	muteEmbeddedPreview: boolean;
	includeEmbeddedInExport: boolean;
	tracks: ResolvedAudioTrack[];
	masterGain: number;
}

export function getSourceTrackIdFromPath(audioPath: string): SourceTrackId {
	const normalized = audioPath.toLowerCase();
	if (normalized.includes(".mic.")) return "mic";
	if (normalized.includes(".system.")) return "system";
	return "mixed";
}

function clampGain(value: number, max: number) {
	if (!Number.isFinite(value)) return 1;
	return Math.max(0, Math.min(max, value));
}

export function buildResolvedAudioPlan(input: {
	videoResource: string | null | undefined;
	sourceAudioFallbackPaths: string[] | null | undefined;
	audioRegions?: AudioRegion[];
	sourceTrackGainById?: Partial<Record<SourceTrackId, number>>;
	embeddedGain?: number;
	masterGain?: number;
}): ResolvedAudioPlan {
	const { hasEmbeddedSourceAudio, externalAudioPaths } = resolveSourceAudioFallbackPaths(
		input.videoResource,
		input.sourceAudioFallbackPaths,
	);

	const pathsByTrack: Partial<Record<SourceTrackId, string>> = {};
	for (const path of externalAudioPaths) {
		const trackId = getSourceTrackIdFromPath(path);
		if (!pathsByTrack[trackId]) {
			pathsByTrack[trackId] = path;
		}
	}

	const hasDedicatedTracks = Boolean(pathsByTrack.system || pathsByTrack.mic);
	const playbackPaths: string[] = [];
	if (pathsByTrack.system) playbackPaths.push(pathsByTrack.system);
	if (pathsByTrack.mic) playbackPaths.push(pathsByTrack.mic);
	if (!hasDedicatedTracks && pathsByTrack.mixed) playbackPaths.push(pathsByTrack.mixed);

	const includeEmbeddedInExport = !pathsByTrack.system && !pathsByTrack.mixed;
	const resolvedRegions = (input.audioRegions ?? [])
		.slice()
		.sort((a, b) => a.startMs - b.startMs);
	const tracks: ResolvedAudioTrack[] = resolvedRegions.map((region) => ({
		id: `user:${region.id}`,
		kind: "user",
		sourceRef: {
			path: region.audioPath,
			startDelayMs: 0,
			offsetMs: audioSourceOffsetMs(region),
		},
		gain: region.muted
			? 0
			: clampGain(region.volume * (region.normalize ? SOURCE_AUDIO_NORMALIZE_GAIN : 1), 1),
		fadeInMs: region.fadeInMs,
		fadeOutMs: region.fadeOutMs,
		timelineBinding: {
			startMs: Math.max(0, region.startMs),
			endMs: Math.max(0, region.endMs),
		},
	}));

	for (const audioPath of playbackPaths) {
		const trackId = getSourceTrackIdFromPath(audioPath);
		tracks.push({
			id: `${trackId}:${audioPath}`,
			kind: trackId,
			sourceRef: {
				path: audioPath,
				startDelayMs: 0,
			},
			gain: clampGain(input.sourceTrackGainById?.[trackId] ?? 1, 2),
			timelineBinding: {
				startMs: 0,
				endMs: Number.POSITIVE_INFINITY,
			},
		});
	}

	if (hasEmbeddedSourceAudio && input.videoResource) {
		tracks.push({
			id: `embedded:${input.videoResource}`,
			kind: "embedded",
			sourceRef: {
				path: input.videoResource,
				startDelayMs: 0,
			},
			gain: clampGain(input.embeddedGain ?? input.sourceTrackGainById?.mixed ?? 1, 2),
			timelineBinding: {
				startMs: 0,
				endMs: Number.POSITIVE_INFINITY,
			},
		});
	}

	return {
		hasEmbeddedSourceAudio,
		pathsByTrack,
		playbackPaths,
		muteEmbeddedPreview: hasDedicatedTracks && !includeEmbeddedInExport,
		includeEmbeddedInExport,
		tracks,
		masterGain: clampGain(input.masterGain ?? 1, 1),
	};
}
