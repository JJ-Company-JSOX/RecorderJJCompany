import type { Span } from "dnd-timeline";
import { type PointerEvent, type RefObject, useCallback, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import { retimeCaptionFragment } from "../captionTimeline";
import type { useAnnotationRegionCommands } from "../hooks/useAnnotationRegionCommands";
import type { useAudioRegionCommands } from "../hooks/useAudioRegionCommands";
import type { useCaptionCommands } from "../hooks/useCaptionCommands";
import type { useClipRegionCommands } from "../hooks/useClipRegionCommands";
import type { useEditorPlaybackControls } from "../hooks/useEditorPlaybackControls";
import type { useTimelineProjection } from "../hooks/useTimelineProjection";
import type { useZoomRegionCommands } from "../hooks/useZoomRegionCommands";
import type { useTimelineState } from "../state/useTimelineState";
import TimelineEditor, { type TimelineEditorHandle } from "../timeline/TimelineEditor";

type Props = {
	panelRef?: RefObject<HTMLDivElement | null>;
	timelineRef: RefObject<TimelineEditorHandle | null>;
	timeline: ReturnType<typeof useTimelineState>;
	projection: ReturnType<typeof useTimelineProjection>;
	playback: ReturnType<typeof useEditorPlaybackControls>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	zoomCommands: ReturnType<typeof useZoomRegionCommands>;
	clipCommands: ReturnType<typeof useClipRegionCommands>;
	audioCommands: ReturnType<typeof useAudioRegionCommands>;
	captionCommands: ReturnType<typeof useCaptionCommands>;
	annotationCommands: ReturnType<typeof useAnnotationRegionCommands>;
	videoPath: string | null;
	videoSourcePath: string | null;
	cursorTelemetrySourcePath: string | null;
	normalizedCursorTelemetry: ReturnType<typeof useTimelineState>["cursorTelemetry"];
	autoSuggestZoomsTrigger: number;
	handleAutoSuggestZoomsConsumed: () => void;
	disableSuggestedZooms: boolean;
	currentTime: number;
	handleSelectAnnotation: (id: string | null) => void;
};

const TIMELINE_HEIGHT_KEY = "recordly.timelineHeight";
const MIN_TIMELINE_HEIGHT = 96;
/** The preview always keeps at least this share of the editor's height. */
const MAX_TIMELINE_SHARE = 0.6;

function savedTimelineHeight() {
	const saved = loadAppSetting<unknown>(TIMELINE_HEIGHT_KEY);
	return typeof saved === "number" && Number.isFinite(saved) && saved >= MIN_TIMELINE_HEIGHT
		? saved
		: null;
}

/** Dragging the bar above the timeline trades its height for a bigger preview. */
function useTimelineHeight() {
	const [height, setHeight] = useState<number | null>(savedTimelineHeight);
	const startResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const panel = event.currentTarget.parentElement;
		const editor = panel?.parentElement;
		if (!panel || !editor || event.button !== 0) return;
		event.preventDefault();
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		const startY = event.clientY;
		const startHeight = panel.getBoundingClientRect().height;
		const maxHeight = Math.max(MIN_TIMELINE_HEIGHT, editor.clientHeight * MAX_TIMELINE_SHARE);
		let next = startHeight;
		const move = (moveEvent: globalThis.PointerEvent) => {
			next = Math.round(
				Math.min(
					maxHeight,
					Math.max(MIN_TIMELINE_HEIGHT, startHeight - (moveEvent.clientY - startY)),
				),
			);
			setHeight(next);
		};
		const end = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", end);
			handle.removeEventListener("pointercancel", end);
			saveAppSetting(TIMELINE_HEIGHT_KEY, next);
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", end);
		handle.addEventListener("pointercancel", end);
	}, []);
	const resetHeight = useCallback(() => {
		setHeight(null);
		saveAppSetting(TIMELINE_HEIGHT_KEY, null);
	}, []);
	return { height, startResize, resetHeight };
}

export function EditorTimelinePanel(props: Props) {
	const timelineHeight = useTimelineHeight();
	const {
		timelineRef,
		timeline,
		projection,
		playback,
		audio,
		zoomCommands,
		clipCommands,
		audioCommands,
		captionCommands,
		annotationCommands,
		videoPath,
		videoSourcePath,
		cursorTelemetrySourcePath,
		normalizedCursorTelemetry,
		autoSuggestZoomsTrigger,
		handleAutoSuggestZoomsConsumed,
		disableSuggestedZooms,
		currentTime,
		handleSelectAnnotation,
	} = props;
	const { effectiveCaptionRegions } = projection;
	const { handleCaptionRetime, handleSelectCaption, handleCaptionDelete } = captionCommands;
	const { handleTimelineSeek } = playback;
	const handleCaptionSpanChange = useCallback(
		(id: string, span: Span) => {
			const fragment = effectiveCaptionRegions.find((cue) => cue.id === id);
			if (!fragment) return;
			handleCaptionRetime(fragment.sourceCueId, retimeCaptionFragment(fragment, span));
		},
		[effectiveCaptionRegions, handleCaptionRetime],
	);
	const handleSelectCaptionFragment = useCallback(
		(id: string | null) => {
			const fragment = effectiveCaptionRegions.find((cue) => cue.id === id);
			handleSelectCaption(fragment?.sourceCueId ?? null);
			if (fragment) handleTimelineSeek(fragment.startMs / 1000);
		},
		[effectiveCaptionRegions, handleSelectCaption, handleTimelineSeek],
	);
	const handleDeleteCaptionFragment = useCallback(
		(id: string) => {
			const fragment = effectiveCaptionRegions.find((cue) => cue.id === id);
			if (fragment) handleCaptionDelete(fragment.sourceCueId);
		},
		[effectiveCaptionRegions, handleCaptionDelete],
	);

	return (
		<div
			ref={props.panelRef}
			tabIndex={-1}
			data-timeline-panel
			className="outline-none relative flex flex-shrink-0 flex-col bg-transparent px-4 pb-4 pt-2"
			style={
				timelineHeight.height === null
					? { height: "22%", minHeight: 180, maxHeight: 280 }
					: { height: timelineHeight.height }
			}
		>
			<div
				role="separator"
				aria-orientation="horizontal"
				aria-label="Resize timeline"
				title="Drag to resize the preview. Double-click to reset."
				data-timeline-resize
				className="group absolute inset-x-0 -top-1.5 z-20 flex h-3 cursor-row-resize touch-none items-center justify-center"
				onPointerDown={timelineHeight.startResize}
				onDoubleClick={timelineHeight.resetHeight}
			>
				<div className="h-1 w-10 rounded-full bg-foreground/15 transition-colors group-hover:bg-foreground/40" />
			</div>
			<TimelineEditor
				ref={timelineRef}
				videoDuration={projection.timelineDuration}
				currentTime={currentTime}
				playheadTime={projection.timelinePlayheadTime}
				onSeek={playback.handleTimelineSeek}
				videoPath={videoPath}
				videoSourcePath={videoSourcePath}
				cursorTelemetrySourcePath={cursorTelemetrySourcePath}
				cursorTelemetry={normalizedCursorTelemetry}
				autoSuggestZoomsTrigger={autoSuggestZoomsTrigger}
				onAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
				disableSuggestedZooms={disableSuggestedZooms}
				zoomRegions={timeline.zoomRegions}
				onZoomAdded={zoomCommands.handleZoomAdded}
				onZoomSuggested={zoomCommands.handleZoomSuggested}
				onZoomSpanChange={zoomCommands.handleZoomSpanChange}
				onZoomDelete={zoomCommands.handleZoomDelete}
				selectedZoomId={timeline.selectedZoomId}
				onSelectZoom={zoomCommands.handleSelectZoom}
				trimRegions={timeline.trimRegions}
				clipRegions={timeline.clipRegions}
				onClipSplit={clipCommands.handleClipSplit}
				onClipDelete={clipCommands.handleClipDelete}
				onClipSpanChange={clipCommands.handleClipSpanChange}
				selectedClipId={timeline.selectedClipId}
				onSelectClip={clipCommands.handleSelectClip}
				audioRegions={timeline.audioRegions}
				onAudioAdded={audioCommands.handleAudioAdded}
				onAudioSpanChange={audioCommands.handleAudioSpanChange}
				onAudioDelete={audioCommands.handleAudioDelete}
				selectedAudioId={timeline.selectedAudioId}
				onSelectAudio={audioCommands.handleSelectAudio}
				captionRegions={projection.effectiveCaptionRegions}
				onCaptionSpanChange={handleCaptionSpanChange}
				selectedCaptionId={
					projection.effectiveCaptionRegions.find(
						(cue) =>
							cue.sourceCueId === timeline.selectedCaptionId &&
							currentTime * 1000 >= cue.startMs &&
							currentTime * 1000 < cue.endMs,
					)?.id ??
					projection.effectiveCaptionRegions.find(
						(cue) => cue.sourceCueId === timeline.selectedCaptionId,
					)?.id ??
					null
				}
				onSelectCaption={handleSelectCaptionFragment}
				onCaptionDelete={handleDeleteCaptionFragment}
				onCaptionAdded={captionCommands.handleCaptionAdded}
				captionsEnabled={timeline.autoCaptionSettings.enabled}
				captionQuickAddEnabled={timeline.autoCaptionSettings.timelineQuickAdd}
				annotationRegions={timeline.annotationRegions}
				onAnnotationAdded={annotationCommands.handleAnnotationAdded}
				onAnnotationSpanChange={annotationCommands.handleAnnotationSpanChange}
				onAnnotationDelete={annotationCommands.handleAnnotationDelete}
				selectedAnnotationId={timeline.selectedAnnotationId}
				onSelectAnnotation={handleSelectAnnotation}
				showSourceAudioTrack={timeline.clipRegions.some((clip) => clip.showSourceAudio)}
				sourceAudioResourceVersion={timeline.sourceAudioFallbackRefreshKey}
				sourceAudioTrackSettings={audio.activeSourceAudioTrackSettings}
				getSourceAudioTrackSettingsForClip={audio.getSourceAudioTrackSettingsForClip}
				onSourceAudioAvailabilityChange={timeline.setHasClipSourceAudio}
				onSourceAudioTracksMetaChange={audio.onSourceAudioTracksMetaChange}
			/>
		</div>
	);
}
