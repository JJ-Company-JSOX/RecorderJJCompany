import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { useCallback, useMemo } from "react";
import type { useI18n } from "@/contexts/I18nContext";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { useAutoCaptionController } from "../captions/useAutoCaptionController";
import { loadEditorPreferences } from "../editorPreferences";
import { useEditorHistory } from "../hooks/useEditorHistory";
import {
	type PresentationHistoryState,
	pickPresentationHistoryState,
} from "../presentationHistory";
import { useEditorPreferencesPersistence } from "../presets/useEditorPreferencesPersistence";
import { hasUnsavedProjectChanges } from "../projectDirtyState";
import { getDevOpenRecordingConfig, getSmokeExportConfig } from "../smokeExportConfig";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { useInitialEditorSource } from "./useInitialEditorSource";
import type { useProjectLibraryController } from "./useProjectLibraryController";
import { useProjectLifecycle } from "./useProjectLifecycle";
import { useProjectOpenActions } from "./useProjectOpenActions";
import { useProjectSaveActions } from "./useProjectSaveActions";
import { useProjectSnapshotModel } from "./useProjectSnapshotModel";

type Input = {
	t: ReturnType<typeof useI18n>["t"];
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	initialPreferences: ReturnType<typeof loadEditorPreferences>;
	smokeConfig: ReturnType<typeof getSmokeExportConfig>;
	devConfig: ReturnType<typeof getDevOpenRecordingConfig>;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	videoPath: string | null;
	setVideoPath: Dispatch<SetStateAction<string | null>>;
	videoSourcePath: string | null;
	setVideoSourcePath: Dispatch<SetStateAction<string | null>>;
	currentTime: number;
	setCurrentTime: Dispatch<SetStateAction<number>>;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setDuration: Dispatch<SetStateAction<number>>;
	whisperExecutablePath: string | null;
	setWhisperExecutablePath: Dispatch<SetStateAction<string | null>>;
	whisperModelPath: string | null;
	setWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	downloadedWhisperModelPath: string | null;
	setDownloadedWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	whisperModelDownloadStatus: "idle" | "downloading" | "downloaded" | "error";
	setWhisperModelDownloadStatus: Dispatch<
		SetStateAction<"idle" | "downloading" | "downloaded" | "error">
	>;
	setWhisperModelDownloadProgress: Dispatch<SetStateAction<number>>;
	isGeneratingCaptions: boolean;
	setIsGeneratingCaptions: Dispatch<SetStateAction<boolean>>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	projectNameInputRef: RefObject<HTMLInputElement | null>;
	projectSaveDialogInputRef: RefObject<HTMLInputElement | null>;
	nextZoomIdRef: MutableRefObject<number>;
	nextClipIdRef: MutableRefObject<number>;
	nextAudioIdRef: MutableRefObject<number>;
	nextAnnotationIdRef: MutableRefObject<number>;
	nextAnnotationZIndexRef: MutableRefObject<number>;
	clipInitializedRef: MutableRefObject<boolean>;
	autoFullTrackClipIdRef: MutableRefObject<string | null>;
	autoFullTrackClipEndMsRef: MutableRefObject<number | null>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAutoSuggestTelemetryCountRef: MutableRefObject<number>;
	autoSuggestedVideoPathRef: MutableRefObject<string | null>;
	applySessionPresentation: (
		session:
			| { hideOverlayCursorByDefault?: boolean; nativeCaptureUnavailable?: boolean }
			| null
			| undefined,
	) => void;
	refreshProjectLibrary: ReturnType<typeof useProjectLibraryController>["refreshProjectLibrary"];
	captureProjectThumbnail: ReturnType<
		typeof useProjectLibraryController
	>["captureProjectThumbnail"];
	remountPreview: () => void;
};

export function useEditorProjectController(input: Input) {
	const snapshot = useProjectSnapshotModel({
		t: input.t,
		project: input.project,
		appearance: input.appearance,
		timeline: input.timeline,
		aspectRatio: input.aspectRatio,
		projectNameInputRef: input.projectNameInputRef,
		projectSaveDialogInputRef: input.projectSaveDialogInputRef,
	});
	const presentation = useMemo(
		() => pickPresentationHistoryState(snapshot.currentPersistedEditorState),
		[snapshot.currentPersistedEditorState],
	);
	const applyPresentation = useCallback(
		(state: Partial<PresentationHistoryState>) => {
			if (state.wallpaper !== undefined) input.appearance.setWallpaper(state.wallpaper);
			if (state.shadowIntensity !== undefined)
				input.appearance.setShadowIntensity(state.shadowIntensity);
			if (state.backgroundBlur !== undefined)
				input.appearance.setBackgroundBlur(state.backgroundBlur);
			if (state.zoomMotionBlur !== undefined)
				input.appearance.setZoomMotionBlur(state.zoomMotionBlur);
			if (state.zoomMotionBlurTuning !== undefined)
				input.appearance.setZoomMotionBlurTuning(state.zoomMotionBlurTuning);
			if (state.connectZooms !== undefined)
				input.appearance.setConnectZooms(state.connectZooms);
			if (state.zoomInDurationMs !== undefined)
				input.appearance.setZoomInDurationMs(state.zoomInDurationMs);
			if (state.zoomInOverlapMs !== undefined)
				input.appearance.setZoomInOverlapMs(state.zoomInOverlapMs);
			if (state.zoomOutDurationMs !== undefined)
				input.appearance.setZoomOutDurationMs(state.zoomOutDurationMs);
			if (state.connectedZoomGapMs !== undefined)
				input.appearance.setConnectedZoomGapMs(state.connectedZoomGapMs);
			if (state.connectedZoomDurationMs !== undefined)
				input.appearance.setConnectedZoomDurationMs(state.connectedZoomDurationMs);
			if (state.zoomInEasing !== undefined)
				input.appearance.setZoomInEasing(state.zoomInEasing);
			if (state.zoomOutEasing !== undefined)
				input.appearance.setZoomOutEasing(state.zoomOutEasing);
			if (state.connectedZoomEasing !== undefined)
				input.appearance.setConnectedZoomEasing(state.connectedZoomEasing);
			if (state.showCursor !== undefined) input.appearance.setShowCursor(state.showCursor);
			if (state.loopCursor !== undefined) input.appearance.setLoopCursor(state.loopCursor);
			if (state.cursorStyle !== undefined) input.appearance.setCursorStyle(state.cursorStyle);
			if (state.cursorSize !== undefined) input.appearance.setCursorSize(state.cursorSize);
			if (state.cursorSmoothing !== undefined)
				input.appearance.setCursorSmoothing(state.cursorSmoothing);
			if (state.cursorSpringStiffnessMultiplier !== undefined)
				input.appearance.setCursorSpringStiffnessMultiplier(
					state.cursorSpringStiffnessMultiplier,
				);
			if (state.cursorSpringDampingMultiplier !== undefined)
				input.appearance.setCursorSpringDampingMultiplier(
					state.cursorSpringDampingMultiplier,
				);
			if (state.cursorSpringMassMultiplier !== undefined)
				input.appearance.setCursorSpringMassMultiplier(state.cursorSpringMassMultiplier);
			if (state.cameraSpringStiffnessMultiplier !== undefined)
				input.appearance.setCameraSpringStiffnessMultiplier(
					state.cameraSpringStiffnessMultiplier,
				);
			if (state.cameraSpringDampingMultiplier !== undefined)
				input.appearance.setCameraSpringDampingMultiplier(
					state.cameraSpringDampingMultiplier,
				);
			if (state.cameraSpringMassMultiplier !== undefined)
				input.appearance.setCameraSpringMassMultiplier(state.cameraSpringMassMultiplier);
			if (state.cursorClickSound !== undefined)
				input.appearance.setCursorClickSound(state.cursorClickSound);
			if (state.cursorClickSoundVolume !== undefined)
				input.appearance.setCursorClickSoundVolume(state.cursorClickSoundVolume);
			if (state.cursorClickEffect !== undefined)
				input.appearance.setCursorClickEffect(state.cursorClickEffect);
			if (state.cursorClickEffectColor !== undefined)
				input.appearance.setCursorClickEffectColor(state.cursorClickEffectColor);
			if (state.cursorClickEffectScale !== undefined)
				input.appearance.setCursorClickEffectScale(state.cursorClickEffectScale);
			if (state.cursorClickEffectOpacity !== undefined)
				input.appearance.setCursorClickEffectOpacity(state.cursorClickEffectOpacity);
			if (state.cursorClickEffectDurationMs !== undefined)
				input.appearance.setCursorClickEffectDurationMs(state.cursorClickEffectDurationMs);
			if (state.zoomSmoothness !== undefined)
				input.appearance.setZoomSmoothness(state.zoomSmoothness);
			if (state.zoomClassicMode !== undefined)
				input.appearance.setZoomClassicMode(state.zoomClassicMode);
			if (state.cursorMotionBlur !== undefined)
				input.appearance.setCursorMotionBlur(state.cursorMotionBlur);
			if (state.cursorClickBounce !== undefined)
				input.appearance.setCursorClickBounce(state.cursorClickBounce);
			if (state.cursorClickBounceDuration !== undefined)
				input.appearance.setCursorClickBounceDuration(state.cursorClickBounceDuration);
			if (state.cursorSway !== undefined) input.appearance.setCursorSway(state.cursorSway);
			if (state.borderRadius !== undefined)
				input.appearance.setBorderRadius(state.borderRadius);
			if (state.padding !== undefined) input.appearance.setPadding(state.padding);
			if (state.cropRegion !== undefined) input.appearance.setCropRegion(state.cropRegion);
			if (state.webcam !== undefined) input.appearance.setWebcam(state.webcam);
			if (state.aspectRatio !== undefined) input.setAspectRatio(state.aspectRatio);
			if (state.autoCaptionSettings !== undefined)
				input.timeline.setAutoCaptionSettings(state.autoCaptionSettings);
		},
		[
			input.appearance.setWallpaper,
			input.appearance.setShadowIntensity,
			input.appearance.setBackgroundBlur,
			input.appearance.setZoomMotionBlur,
			input.appearance.setZoomMotionBlurTuning,
			input.appearance.setConnectZooms,
			input.appearance.setZoomInDurationMs,
			input.appearance.setZoomInOverlapMs,
			input.appearance.setZoomOutDurationMs,
			input.appearance.setConnectedZoomGapMs,
			input.appearance.setConnectedZoomDurationMs,
			input.appearance.setZoomInEasing,
			input.appearance.setZoomOutEasing,
			input.appearance.setConnectedZoomEasing,
			input.appearance.setShowCursor,
			input.appearance.setLoopCursor,
			input.appearance.setCursorStyle,
			input.appearance.setCursorSize,
			input.appearance.setCursorSmoothing,
			input.appearance.setCursorSpringStiffnessMultiplier,
			input.appearance.setCursorSpringDampingMultiplier,
			input.appearance.setCursorSpringMassMultiplier,
			input.appearance.setCameraSpringStiffnessMultiplier,
			input.appearance.setCameraSpringDampingMultiplier,
			input.appearance.setCameraSpringMassMultiplier,
			input.appearance.setCursorClickSound,
			input.appearance.setCursorClickSoundVolume,
			input.appearance.setCursorClickEffect,
			input.appearance.setCursorClickEffectColor,
			input.appearance.setCursorClickEffectScale,
			input.appearance.setCursorClickEffectOpacity,
			input.appearance.setCursorClickEffectDurationMs,
			input.appearance.setZoomSmoothness,
			input.appearance.setZoomClassicMode,
			input.appearance.setCursorMotionBlur,
			input.appearance.setCursorClickBounce,
			input.appearance.setCursorClickBounceDuration,
			input.appearance.setCursorSway,
			input.appearance.setBorderRadius,
			input.appearance.setPadding,
			input.appearance.setCropRegion,
			input.appearance.setWebcam,
			input.setAspectRatio,
			input.timeline.setAutoCaptionSettings,
		],
	);
	const history = useEditorHistory({
		presentation,
		applyPresentation,
		timeline: input.timeline,
		nextZoomIdRef: input.nextZoomIdRef,
		nextClipIdRef: input.nextClipIdRef,
		nextAnnotationIdRef: input.nextAnnotationIdRef,
		nextAudioIdRef: input.nextAudioIdRef,
		nextAnnotationZIndexRef: input.nextAnnotationZIndexRef,
	});
	const lifecycle = useProjectLifecycle({
		t: input.t,
		project: input.project,
		appearance: input.appearance,
		timeline: input.timeline,
		aspectRatio: input.aspectRatio,
		setAspectRatio: input.setAspectRatio,
		currentSourcePath: snapshot.currentSourcePath,
		currentPersistedEditorState: snapshot.currentPersistedEditorState,
		videoPlaybackRef: input.videoPlaybackRef,
		setIsPlaying: input.setIsPlaying,
		setCurrentTime: input.setCurrentTime,
		setDuration: input.setDuration,
		applySessionPresentation: input.applySessionPresentation,
		refreshProjectLibrary: input.refreshProjectLibrary,
		buildPersistedEditorState: snapshot.buildPersistedEditorState,
		resetHistory: history.resetHistory,
		refs: {
			nextZoomIdRef: input.nextZoomIdRef,
			nextClipIdRef: input.nextClipIdRef,
			nextAudioIdRef: input.nextAudioIdRef,
			nextAnnotationIdRef: input.nextAnnotationIdRef,
			nextAnnotationZIndexRef: input.nextAnnotationZIndexRef,
			clipInitializedRef: input.clipInitializedRef,
			autoFullTrackClipIdRef: input.autoFullTrackClipIdRef,
			autoFullTrackClipEndMsRef: input.autoFullTrackClipEndMsRef,
			pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
			pendingFreshRecordingAutoSuggestTelemetryCountRef:
				input.pendingFreshRecordingAutoSuggestTelemetryCountRef,
			autoSuggestedVideoPathRef: input.autoSuggestedVideoPathRef,
		},
	});
	const hasUnsavedChanges = useMemo(
		() =>
			hasUnsavedProjectChanges(
				lifecycle.currentProjectSnapshot,
				input.project.lastSavedSnapshot,
			),
		[lifecycle.currentProjectSnapshot, input.project.lastSavedSnapshot],
	);

	useInitialEditorSource({
		project: input.project,
		appearance: input.appearance,
		timeline: input.timeline,
		smokeConfig: input.smokeConfig,
		devConfig: input.devConfig,
		videoSourcePath: input.videoSourcePath,
		pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
		applyLoadedProject: lifecycle.applyLoadedProject,
		resetSourceScopedEditorState: lifecycle.resetSourceScopedEditorState,
		applySessionPresentation: input.applySessionPresentation,
	});
	useEditorPreferencesPersistence({
		appearance: input.appearance,
		aspectRatio: input.aspectRatio,
		whisperExecutablePath: input.whisperExecutablePath,
		whisperModelPath: input.whisperModelPath,
	});
	const autoCaption = useAutoCaptionController({
		t: input.t,
		videoPath: input.videoPath,
		setVideoPath: input.setVideoPath,
		videoSourcePath: input.videoSourcePath,
		setVideoSourcePath: input.setVideoSourcePath,
		webcamSourcePath: input.appearance.webcam.sourcePath ?? null,
		whisperExecutablePath: input.whisperExecutablePath,
		setWhisperExecutablePath: input.setWhisperExecutablePath,
		whisperModelPath: input.whisperModelPath,
		setWhisperModelPath: input.setWhisperModelPath,
		downloadedWhisperModelPath: input.downloadedWhisperModelPath,
		setDownloadedWhisperModelPath: input.setDownloadedWhisperModelPath,
		whisperModelDownloadStatus: input.whisperModelDownloadStatus,
		setWhisperModelDownloadStatus: input.setWhisperModelDownloadStatus,
		setWhisperModelDownloadProgress: input.setWhisperModelDownloadProgress,
		isGeneratingCaptions: input.isGeneratingCaptions,
		setIsGeneratingCaptions: input.setIsGeneratingCaptions,
		autoCaptionSettings: input.timeline.autoCaptionSettings,
		setAutoCaptionSettings: input.timeline.setAutoCaptionSettings,
		setAutoCaptions: input.timeline.setAutoCaptions,
		syncActiveVideoSource: lifecycle.syncActiveVideoSource,
	});
	const saveActions = useProjectSaveActions({
		project: input.project,
		currentSourcePath: snapshot.currentSourcePath,
		currentProjectSnapshot: lifecycle.currentProjectSnapshot,
		currentPersistedEditorState: snapshot.currentPersistedEditorState,
		projectDisplayName: snapshot.projectDisplayName,
		hasUnsavedChanges,
		projectSaveDialogInputRef: input.projectSaveDialogInputRef,
		projectNameInputRef: input.projectNameInputRef,
		openProjectSaveDialog: lifecycle.openProjectSaveDialog,
		resolveProjectSaveDialog: lifecycle.resolveProjectSaveDialog,
		captureProjectThumbnail: input.captureProjectThumbnail,
		refreshProjectLibrary: input.refreshProjectLibrary,
		remountPreview: input.remountPreview,
	});
	const openActions = useProjectOpenActions({
		project: input.project,
		appearance: input.appearance,
		videoPlaybackRef: input.videoPlaybackRef,
		pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
		hasUnsavedChanges,
		setIsPlaying: input.setIsPlaying,
		setCurrentTime: input.setCurrentTime,
		setDuration: input.setDuration,
		applyLoadedProject: lifecycle.applyLoadedProject,
		openUnsavedChangesDialog: lifecycle.openUnsavedChangesDialog,
		saveProject: saveActions.saveProject,
		refreshProjectLibrary: input.refreshProjectLibrary,
		resetSourceScopedEditorState: lifecycle.resetSourceScopedEditorState,
		applySessionPresentation: input.applySessionPresentation,
		handleSaveProject: saveActions.handleSaveProject,
		handleSaveProjectAs: saveActions.handleSaveProjectAs,
	});

	return {
		snapshot,
		history,
		lifecycle,
		autoCaption,
		saveActions,
		openActions,
		hasUnsavedChanges,
	};
}
