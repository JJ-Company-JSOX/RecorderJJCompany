import { useEffect, useMemo, useRef, useState } from "react";
import { audioEnvelopeAt } from "@/lib/exporter/audioEnvelope";
import {
	buildResolvedAudioPlan,
	resolveEnhancedAudioPath,
} from "@/lib/exporter/audioRoutingEngine";
import { resolveMediaElementSource } from "@/lib/exporter/localMediaSource";
import {
	clampMediaTimeToDuration,
	enablePitchPreservingPlayback,
	estimateCompanionAudioStartDelaySeconds,
	getMediaSyncPlaybackRate,
	resolvePreviewMediaDuration,
} from "@/lib/mediaTiming";
import type { AudioRegion } from "../types";
import { supportsPreviewPlaybackRate } from "../videoPlayback/playbackRate";
import {
	getAudioResourceVersionKey,
	getVersionedAudioResourceUrl,
	isAudioResourceLoadCurrent,
} from "./audioResourceVersion";
import type { SourceAudioTrackSettings } from "./audioTypes";

const SOURCE_AUDIO_PREVIEW_PLAYING_SEEK_DRIFT_SECONDS = 0.18;
const SOURCE_AUDIO_PREVIEW_PAUSED_SEEK_DRIFT_SECONDS = 0.01;

interface UseAudioPreviewSyncParams {
	audioRegions: AudioRegion[];
	previewVolume: number;
	isPlaying: boolean;
	currentTime: number;
	timelineTime: number;
	duration: number;
	sourcePlaybackRate: number;
	previewSourceAudioFallbackPaths: string[];
	sourceAudioFallbackStartDelayMsByPath: Record<string, number>;
	sourceAudioResourceVersion: number;
	isCurrentClipMuted: boolean;
	getSourceTrackPreviewGain: (audioPath: string) => number;
	sourceAudioTrackSettings?: SourceAudioTrackSettings;
	onSourceFallbackLoadError: (error: unknown) => void;
}

export function useAudioPreviewSync({
	audioRegions,
	previewVolume,
	isPlaying,
	currentTime,
	timelineTime,
	duration,
	sourcePlaybackRate,
	previewSourceAudioFallbackPaths,
	sourceAudioFallbackStartDelayMsByPath,
	sourceAudioResourceVersion,
	isCurrentClipMuted,
	getSourceTrackPreviewGain,
	sourceAudioTrackSettings,
	onSourceFallbackLoadError,
}: UseAudioPreviewSyncParams) {
	const resolvedPlan = useMemo(
		() =>
			buildResolvedAudioPlan({
				videoResource: null,
				sourceAudioFallbackPaths: previewSourceAudioFallbackPaths,
				audioRegions,
			}),
		[audioRegions, previewSourceAudioFallbackPaths],
	);
	const resolvedUserTracks = useMemo(
		() => resolvedPlan.tracks.filter((track) => track.kind === "user"),
		[resolvedPlan],
	);
	const resolvedSourceTracks = useMemo(
		() => resolvedPlan.tracks.filter((track) => track.kind !== "user"),
		[resolvedPlan],
	);

	const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
	const audioElementRevokersRef = useRef<Map<string, () => void>>(new Map());
	const audioElementResourcesRef = useRef<Map<string, string>>(new Map());
	const sourceAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
	const sourceAudioElementRevokersRef = useRef<Map<string, () => void>>(new Map());
	const sourceAudioElementResourcesRef = useRef<Map<string, string>>(new Map());
	const sourcePlaybackErrorsRef = useRef<Map<string, string>>(new Map());
	const lastSourceAudioSyncTimeRef = useRef<number | null>(null);
	const [sourceLoadVersion, setSourceLoadVersion] = useState(0);

	useEffect(() => {
		let cancelled = false;
		const existing = audioElementsRef.current;
		const currentIds = new Set(resolvedUserTracks.map((track) => track.id));

		for (const [id, audio] of existing) {
			if (!currentIds.has(id)) {
				audio.pause();
				audio.src = "";
				audioElementRevokersRef.current.get(id)?.();
				audioElementRevokersRef.current.delete(id);
				audioElementResourcesRef.current.delete(id);
				existing.delete(id);
			}
		}

		for (const track of resolvedUserTracks) {
			let audio = existing.get(track.id);
			if (!audio) {
				audio = new Audio();
				audio.preload = "auto";
				existing.set(track.id, audio);
			}

			if (audioElementResourcesRef.current.get(track.id) !== track.sourceRef.path) {
				audio.pause();
				audio.src = "";
				audioElementRevokersRef.current.get(track.id)?.();
				audioElementRevokersRef.current.delete(track.id);
				audioElementResourcesRef.current.set(track.id, track.sourceRef.path);

				void (async () => {
					const resolved = await resolveMediaElementSource(track.sourceRef.path);
					const latestAudio = existing.get(track.id);

					if (
						cancelled ||
						latestAudio !== audio ||
						audioElementResourcesRef.current.get(track.id) !== track.sourceRef.path
					) {
						resolved.revoke();
						return;
					}

					audioElementRevokersRef.current.set(track.id, resolved.revoke);
					latestAudio.src = resolved.src;
				})();
			}

			audio.volume = Math.max(0, Math.min(1, track.gain * previewVolume));
		}

		return () => {
			cancelled = true;
		};
	}, [previewVolume, resolvedUserTracks]);

	useEffect(() => {
		const existing = sourceAudioElementsRef.current;
		const currentIds = new Set(resolvedSourceTracks.map((track) => track.sourceRef.path));

		for (const [id, audio] of existing) {
			if (!currentIds.has(id)) {
				audio.pause();
				audio.src = "";
				sourcePlaybackErrorsRef.current.delete(id);
				sourceAudioElementRevokersRef.current.get(id)?.();
				sourceAudioElementRevokersRef.current.delete(id);
				sourceAudioElementResourcesRef.current.delete(id);
				existing.delete(id);
			}
		}

		for (const track of resolvedSourceTracks) {
			const audioPath = track.sourceRef.path;
			const decoderPath = resolveEnhancedAudioPath(audioPath, sourceAudioTrackSettings);
			const resourceKey = getAudioResourceVersionKey(decoderPath, sourceAudioResourceVersion);
			let audio = existing.get(audioPath);
			if (!audio) {
				audio = new Audio();
				audio.preload = "auto";
				audio.crossOrigin = "anonymous";
				existing.set(audioPath, audio);
			}
			audio.volume = 1;
			audio.dataset.sourceAudioPath = audioPath;

			// Web Audio API createMediaElementSource breaks preservesPitch on Chromium.
			// We route directly through the HTMLAudioElement to ensure pitch preservation works
			// during speed changes. Note: this limits maximum preview volume to 1.0 (100%).

			if (sourceAudioElementResourcesRef.current.get(audioPath) !== resourceKey) {
				sourcePlaybackErrorsRef.current.delete(audioPath);
				audio.pause();
				audio.src = "";
				sourceAudioElementRevokersRef.current.get(audioPath)?.();
				sourceAudioElementRevokersRef.current.delete(audioPath);
				sourceAudioElementResourcesRef.current.set(audioPath, resourceKey);

				// Resource identity, not effect lifetime, decides staleness. Playback and fallback
				// rerenders must not cancel the only load for the current finalized sidecar version.
				void (async () => {
					try {
						const resolved = await resolveMediaElementSource(decoderPath);
						const latestAudio = existing.get(audioPath);

						if (
							latestAudio !== audio ||
							!isAudioResourceLoadCurrent(
								sourceAudioElementResourcesRef.current,
								audioPath,
								resourceKey,
							)
						) {
							resolved.revoke();
							return;
						}

						sourceAudioElementRevokersRef.current.set(audioPath, resolved.revoke);
						latestAudio.src = getVersionedAudioResourceUrl(
							resolved.src,
							sourceAudioResourceVersion,
						);
						latestAudio.load();
						lastSourceAudioSyncTimeRef.current = null;
						setSourceLoadVersion((version) => version + 1);
					} catch (error) {
						const latestAudio = existing.get(audioPath);
						if (
							latestAudio !== audio ||
							!isAudioResourceLoadCurrent(
								sourceAudioElementResourcesRef.current,
								audioPath,
								resourceKey,
							)
						) {
							return;
						}

						sourceAudioElementRevokersRef.current.get(audioPath)?.();
						sourceAudioElementRevokersRef.current.delete(audioPath);
						sourceAudioElementResourcesRef.current.delete(audioPath);
						if (latestAudio === audio) {
							latestAudio.pause();
							latestAudio.src = "";
						}
						onSourceFallbackLoadError(error);
					}
				})();
			}

			audio.volume = Math.max(
				0,
				Math.min(
					1,
					getSourceTrackPreviewGain(audioPath) * (isCurrentClipMuted ? 0 : previewVolume),
				),
			);
		}

		if (resolvedSourceTracks.length === 0) {
			lastSourceAudioSyncTimeRef.current = null;
		}
	}, [
		getSourceTrackPreviewGain,
		isCurrentClipMuted,
		onSourceFallbackLoadError,
		resolvedSourceTracks,
		sourceAudioResourceVersion,
		sourceAudioTrackSettings,
		previewVolume,
	]);

	useEffect(() => {
		return () => {
			for (const audio of audioElementsRef.current.values()) {
				audio.pause();
				audio.src = "";
			}
			for (const revoke of audioElementRevokersRef.current.values()) {
				revoke();
			}
			audioElementsRef.current.clear();
			audioElementRevokersRef.current.clear();
			audioElementResourcesRef.current.clear();
			for (const audio of sourceAudioElementsRef.current.values()) {
				audio.pause();
				audio.src = "";
			}
			for (const revoke of sourceAudioElementRevokersRef.current.values()) {
				revoke();
			}
			sourceAudioElementsRef.current.clear();
			sourceAudioElementRevokersRef.current.clear();
			sourceAudioElementResourcesRef.current.clear();
			sourcePlaybackErrorsRef.current.clear();
			lastSourceAudioSyncTimeRef.current = null;
		};
	}, []);

	useEffect(() => {
		const currentTimeMs = timelineTime * 1000;

		for (const track of resolvedUserTracks) {
			const audio = audioElementsRef.current.get(track.id);
			if (!audio) continue;

			const startMs = track.timelineBinding.startMs;
			const endMs = track.timelineBinding.endMs;
			const isInRegion = currentTimeMs >= startMs && currentTimeMs < endMs;
			audio.volume = Math.max(
				0,
				Math.min(
					1,
					track.gain *
						previewVolume *
						audioEnvelopeAt(
							currentTimeMs - startMs,
							endMs - startMs,
							track.fadeInMs,
							track.fadeOutMs,
						),
				),
			);

			const audioOffset = ((track.sourceRef.offsetMs ?? 0) + currentTimeMs - startMs) / 1000;
			const pastSourceEnd = Number.isFinite(audio.duration) && audioOffset >= audio.duration;
			if (isPlaying && isInRegion && !pastSourceEnd) {
				enablePitchPreservingPlayback(audio);
				if (Math.abs(audio.currentTime - audioOffset) > 0.2) {
					audio.currentTime = audioOffset;
				}
				const syncedPlaybackRate = getMediaSyncPlaybackRate({
					basePlaybackRate: 1,
					currentTime: audio.currentTime,
					targetTime: audioOffset,
				});
				if (Math.abs(audio.playbackRate - syncedPlaybackRate) > 0.001) {
					audio.playbackRate = syncedPlaybackRate;
				}
				if (audio.paused) {
					audio.play().catch(() => undefined);
				}
			} else if (!audio.paused) {
				audio.pause();
			}
		}
	}, [isPlaying, resolvedUserTracks, timelineTime, previewVolume]);

	useEffect(() => {
		if (resolvedSourceTracks.length === 0) {
			lastSourceAudioSyncTimeRef.current = null;
			return;
		}
		let cancelled = false;
		// A newly resolved source must pass the same playback checks as timeline updates.
		void sourceLoadVersion;
		// A deliberate pause/play retries a failed device or decoder. Timeline ticks do not.
		if (!isPlaying) sourcePlaybackErrorsRef.current.clear();

		const previousTimelineTime = lastSourceAudioSyncTimeRef.current;
		const timelineJumped =
			previousTimelineTime === null || Math.abs(currentTime - previousTimelineTime) > 0.25;
		const driftThreshold = isPlaying
			? SOURCE_AUDIO_PREVIEW_PLAYING_SEEK_DRIFT_SECONDS
			: SOURCE_AUDIO_PREVIEW_PAUSED_SEEK_DRIFT_SECONDS;
		for (const audio of sourceAudioElementsRef.current.values()) {
			if (!audio.src) continue;
			if (!supportsPreviewPlaybackRate(sourcePlaybackRate)) {
				audio.pause();
				continue;
			}
			const sourceAudioPath = audio.dataset.sourceAudioPath ?? "";
			audio.volume = Math.max(
				0,
				Math.min(
					1,
					getSourceTrackPreviewGain(sourceAudioPath) *
						(isCurrentClipMuted ? 0 : previewVolume),
				),
			);

			enablePitchPreservingPlayback(audio);
			const audioDuration = resolvePreviewMediaDuration(audio.duration, duration);
			const isMicCompanionTrack = /\.mic\./i.test(sourceAudioPath);
			const rawStartDelaySeconds = estimateCompanionAudioStartDelaySeconds(
				duration,
				audioDuration,
				sourceAudioFallbackStartDelayMsByPath[sourceAudioPath],
			);
			const maxPreviewStartDelaySeconds = isMicCompanionTrack ? 2 : 5;
			const startDelaySeconds = isMicCompanionTrack
				? 0
				: Number.isFinite(duration) &&
						(rawStartDelaySeconds >= Math.max(0, duration - 0.01) ||
							rawStartDelaySeconds >
								Math.max(maxPreviewStartDelaySeconds, duration * 0.9))
					? 0
					: rawStartDelaySeconds;
			const beforeAudioStart = currentTime + 0.001 < startDelaySeconds;
			const targetTime = clampMediaTimeToDuration(
				currentTime - startDelaySeconds,
				audioDuration,
			);

			const shouldSeek =
				timelineJumped ||
				(!isPlaying && Math.abs(audio.currentTime - targetTime) > driftThreshold) ||
				(isPlaying && Math.abs(audio.currentTime - targetTime) > 0.9);
			if (shouldSeek) {
				try {
					audio.currentTime = targetTime;
				} catch {
					// no-op
				}
			}

			// KISS for companion source tracks: fixed playback rate avoids audible flutter/stutter
			// from continuous micro-corrections on system audio.
			const syncedPlaybackRate = sourcePlaybackRate;
			if (Math.abs(audio.playbackRate - syncedPlaybackRate) > 0.001) {
				audio.playbackRate = syncedPlaybackRate;
			}

			const atEnd = audioDuration !== null && targetTime >= audioDuration;
			if (isPlaying && !isCurrentClipMuted && !beforeAudioStart && !atEnd) {
				// Source tracks already use HTMLAudioElement directly for pitch-preserving
				// playback. An unrelated, suspended AudioContext must not block them.
				const resourceKey = sourceAudioElementResourcesRef.current.get(sourceAudioPath);
				if (
					audio.paused &&
					sourcePlaybackErrorsRef.current.get(sourceAudioPath) !== resourceKey
				) {
					void audio.play().catch((error: unknown) => {
						if (cancelled || (error instanceof Error && error.name === "AbortError"))
							return;
						if (
							!resourceKey ||
							sourceAudioElementsRef.current.get(sourceAudioPath) !== audio ||
							sourceAudioElementResourcesRef.current.get(sourceAudioPath) !==
								resourceKey ||
							sourcePlaybackErrorsRef.current.get(sourceAudioPath) === resourceKey
						)
							return;
						sourcePlaybackErrorsRef.current.set(sourceAudioPath, resourceKey);
						onSourceFallbackLoadError(error);
					});
				}
			} else if (!audio.paused) {
				audio.pause();
			}
		}

		lastSourceAudioSyncTimeRef.current = currentTime;
		return () => {
			cancelled = true;
		};
	}, [
		sourceLoadVersion,
		currentTime,
		duration,
		sourcePlaybackRate,
		getSourceTrackPreviewGain,
		isCurrentClipMuted,
		isPlaying,
		previewVolume,
		resolvedSourceTracks,
		sourceAudioFallbackStartDelayMsByPath,
		onSourceFallbackLoadError,
	]);
}
