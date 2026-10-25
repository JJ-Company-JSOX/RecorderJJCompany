import { Skeleton } from "@/components/ui/skeleton";
import { setPreviewQuality, usePreviewQuality } from "@/lib/previewQuality";
import { Slider } from "@/components/ui/slider";
import {
	CaretDown,
	Check,
	Crop,
	FullScreen,
	MagicWand,
	MagnifyingGlassPlus,
	Pause,
	Play,
	Plus,
	QuitFullScreen,
	Scissors,
	SkipBack,
	SkipForward,
	SpeakerHigh,
	SpeakerLow,
	SpeakerX,
} from "@/components/ui/icons";
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { useI18n } from "@/contexts/I18nContext";
import { ASPECT_RATIOS, type AspectRatio, getAspectRatioLabel } from "@/utils/aspectRatioUtils";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { CaptionEditTarget } from "../captionEditing";
import type { useAnnotationRegionCommands } from "../hooks/useAnnotationRegionCommands";
import type { useEditorPlaybackControls } from "../hooks/useEditorPlaybackControls";
import type { useTimelineProjection } from "../hooks/useTimelineProjection";
import type { useZoomRegionCommands } from "../hooks/useZoomRegionCommands";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { TimelineEditorHandle } from "../timeline/TimelineEditor";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { TextToSpeechDialog } from "../textToSpeech/TextToSpeechDialog";
import { EditorVideoPreview } from "./EditorVideoPreview";

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	videoPath: string | null;
	previewVersion: number;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	previewAspectRatioValue: number;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	timelineRef: RefObject<TimelineEditorHandle | null>;
	currentTime: number;
	isPlaying: boolean;
	previewVolume: number;
	setPreviewVolume: Dispatch<SetStateAction<number>>;
	suspendRendering: boolean;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	projection: ReturnType<typeof useTimelineProjection>;
	playback: ReturnType<typeof useEditorPlaybackControls>;
	zoomCommands: ReturnType<typeof useZoomRegionCommands>;
	annotationCommands: ReturnType<typeof useAnnotationRegionCommands>;
	effectiveCursorTelemetry: ReturnType<typeof useTimelineState>["cursorTelemetry"];
	effectiveShowCursor: boolean;
	isCropped: boolean;
	handleOpenCropEditor: () => void;
	handleSaveAutoCaptionEdit: (target: CaptionEditTarget, text: string) => void;
	handleSelectAnnotation: (id: string | null) => void;
	setDuration: Dispatch<SetStateAction<number>>;
	isPreviewReady: boolean;
	setIsPreviewReady: Dispatch<SetStateAction<boolean>>;
	setCurrentTime: Dispatch<SetStateAction<number>>;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setError: (message: string | null) => void;
};

function formatTime(seconds: number) {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function EditorPreviewPanel(props: Props) {
	const previewQuality = usePreviewQuality();
	const {
		t,
		videoPath,
		previewVersion,
		aspectRatio,
		setAspectRatio,
		previewAspectRatioValue,
		videoPlaybackRef,
		timelineRef,
		currentTime,
		isPlaying,
		previewVolume,
		setPreviewVolume,
		suspendRendering,
		appearance,
		timeline,
		audio,
		projection,
		playback,
		zoomCommands,
		annotationCommands,
		effectiveCursorTelemetry,
		effectiveShowCursor,
		isCropped,
		handleOpenCropEditor,
		handleSaveAutoCaptionEdit,
		handleSelectAnnotation,
		setDuration,
		isPreviewReady,
		setIsPreviewReady,
		setCurrentTime,
		setIsPlaying,
		setError,
	} = props;

	// Full screen shows the preview at the size of the display, rendered at its native density.
	const panelRef = useRef<HTMLDivElement>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [textToSpeechOpen, setTextToSpeechOpen] = useState(false);
	const [textToSpeechStartMs, setTextToSpeechStartMs] = useState(0);
	useEffect(() => {
		const sync = () => setIsFullscreen(document.fullscreenElement === panelRef.current);
		document.addEventListener("fullscreenchange", sync);
		return () => document.removeEventListener("fullscreenchange", sync);
	}, []);
	const toggleFullscreen = useCallback(() => {
		if (document.fullscreenElement) {
			void document.exitFullscreen().catch(() => undefined);
			return;
		}
		void panelRef.current?.requestFullscreen().catch(() => undefined);
	}, []);
	const fullscreenLabel = isFullscreen
		? t("editor.preview.exitFullscreen", "Exit full screen (Esc)")
		: t("editor.preview.fullscreen", "Full screen preview");
	const fullscreenButton = (
		<Button
			variant="ghost"
			size="sm"
			onClick={toggleFullscreen}
			className="h-7 gap-1.5 px-2 text-xs"
			aria-label={fullscreenLabel}
			title={fullscreenLabel}
		>
			{isFullscreen ? (
				<QuitFullScreen className="h-3.5 w-3.5" />
			) : (
				<FullScreen className="h-3.5 w-3.5" />
			)}
			<span className="font-medium">{fullscreenLabel}</span>
		</Button>
	);

	const previewToolbar = useMemo(
		() => (
			<div className="flex h-10 shrink-0 items-center justify-center gap-3">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
							<span className="font-medium">{getAspectRatioLabel(aspectRatio)}</span>
							<CaretDown className="h-3 w-3" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="center">
						{ASPECT_RATIOS.map((ratio) => (
							<DropdownMenuItem
								key={ratio}
								onClick={() => setAspectRatio(ratio)}
								className="flex cursor-pointer items-center justify-between gap-3 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
							>
								<span>{getAspectRatioLabel(ratio)}</span>
								{aspectRatio === ratio ? (
									<Check className="h-3 w-3 text-[#2563EB]" />
								) : null}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
				<div className="h-4 w-px bg-foreground/20" />
				<label
					className="flex items-center gap-1 text-xs text-muted-foreground"
					title={t(
						"editor.previewQuality.help",
						"Preview only; exported quality follows your export settings.",
					)}
				>
					<span>{t("editor.previewQuality.label", "Preview")}</span>
					<select
						className="rounded bg-editor-bg px-1 py-1"
						aria-label={t("editor.previewQuality.label", "Preview")}
						value={previewQuality}
						onChange={(event) =>
							setPreviewQuality(event.target.value === "full" ? "full" : "balanced")
						}
					>
						<option value="balanced">
							{t("editor.previewQuality.balanced", "Balanced (1080p)")}
						</option>
						<option value="full">
							{t("editor.previewQuality.full", "Full display quality")}
						</option>
					</select>
				</label>
				<Button
					variant="ghost"
					size="sm"
					onClick={handleOpenCropEditor}
					className="h-7 gap-1.5 px-2 text-xs"
				>
					<Crop className="h-3.5 w-3.5" />
					<span className="font-medium">{t("settings.crop.title")}</span>
					{isCropped ? <span className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" /> : null}
				</Button>
			</div>
		),
		[aspectRatio, t, previewQuality, setAspectRatio, handleOpenCropEditor, isCropped],
	);

	// Menus and popovers render outside this panel, where a full-screen view cannot show them,
	// so full screen keeps only the controls that work in place.
	return (
		<div ref={panelRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-editor-bg">
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
					{isFullscreen ? (
						<div className="flex h-10 shrink-0 items-center justify-center">
							{fullscreenButton}
						</div>
					) : (
						<div className="flex shrink-0 items-center justify-center gap-3">
							{previewToolbar}
							<div className="h-4 w-px bg-foreground/20" />
							{fullscreenButton}
						</div>
					)}
					<div
						className={`flex min-h-0 w-full flex-1 items-stretch ${isFullscreen ? "p-2" : "px-2 py-2"}`}
						style={{ flex: "1 1 auto", margin: 0 }}
					>
						<div
							className="editor-preview-stage flex min-h-0 min-w-0 flex-1 items-center justify-center"
							style={{ containerType: "size" }}
						>
							<div
								className="editor-preview-frame relative"
								style={{
									width: `min(100cqw, calc(100cqh * ${previewAspectRatioValue}))`,
									height: `min(100cqh, calc(100cqw / ${previewAspectRatioValue}))`,
									aspectRatio: previewAspectRatioValue,
									maxWidth: "100%",
									margin: "0 auto",
									boxSizing: "border-box",
								}}
							>
								{videoPath && !isPreviewReady && (
									<Skeleton
										aria-label="Loading preview"
										className="pointer-events-none absolute inset-0 z-20 h-full w-full rounded-xl"
									/>
								)}
								<EditorVideoPreview
									videoPath={videoPath}
									previewVersion={previewVersion}
									aspectRatio={aspectRatio}
									playbackRef={videoPlaybackRef}
									currentTime={currentTime}
									isPlaying={isPlaying}
									previewVolume={previewVolume}
									suspendRendering={suspendRendering}
									appearance={appearance}
									timeline={timeline}
									audio={audio}
									effectiveZoomRegions={projection.effectiveZoomRegions}
									effectiveCursorTelemetry={effectiveCursorTelemetry}
									effectiveShowCursor={effectiveShowCursor}
									setDuration={setDuration}
									setIsPreviewReady={setIsPreviewReady}
									setCurrentTime={setCurrentTime}
									setIsPlaying={setIsPlaying}
									setError={setError}
									handlers={{
										onSelectZoom: zoomCommands.handleSelectZoom,
										onZoomFocusChange: zoomCommands.handleZoomFocusChange,
										onEditAutoCaption: handleSaveAutoCaptionEdit,
										onSelectAnnotation: handleSelectAnnotation,
										onAnnotationPositionChange:
											annotationCommands.handleAnnotationPositionChange,
										onAnnotationSizeChange:
											annotationCommands.handleAnnotationSizeChange,
									}}
								/>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className="editor-playback relative grid min-h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
				<div
					className={`editor-playback-tools z-10 flex min-w-0 items-center gap-2 ${isFullscreen ? "invisible" : ""}`}
				>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="sm" className="h-9 gap-2 px-3">
								<Plus className="h-3.5 w-3.5" />
								<span className="font-medium">{t("editor.toolbar.addLayer")}</span>
								<CaretDown className="h-3 w-3" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start">
							<DropdownMenuItem
								onClick={() => {
									const nextTrack =
										timeline.annotationRegions.length > 0
											? Math.max(
													...timeline.annotationRegions.map(
														(region) => region.trackIndex ?? 0,
													),
												) + 1
											: 0;
									timelineRef.current?.addAnnotation(nextTrack);
								}}
								className="cursor-pointer text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
							>
								{t("editor.annotations.text", "Text")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => {
									const nextTrack =
										timeline.audioRegions.length > 0
											? Math.max(
													...timeline.audioRegions.map(
														(region) => region.trackIndex ?? 0,
													),
												) + 1
											: 0;
									timelineRef.current?.addAudio(nextTrack);
								}}
								className="cursor-pointer text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
							>
								{t("timeline.audio.label")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => {
									videoPlaybackRef.current?.pause();
									setTextToSpeechStartMs(
										Math.round(projection.timelinePlayheadTime * 1000),
									);
									setTextToSpeechOpen(true);
								}}
								className="cursor-pointer text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
							>
								{t("editor.textToSpeech.menu", "Text to Audio")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						onClick={() => timelineRef.current?.addZoom()}
						variant="ghost"
						size="icon"
						className="h-9 w-9"
						title={t("timeline.zoom.addZoom")}
					>
						<MagnifyingGlassPlus className="h-4 w-4" />
					</Button>
					<Button
						onClick={() => timelineRef.current?.suggestZooms()}
						variant="ghost"
						size="icon"
						className="h-9 w-9"
						title={t("timeline.zoom.suggestZooms")}
					>
						<MagicWand className="h-4 w-4" />
					</Button>
					<Button
						onClick={() => timelineRef.current?.splitClip()}
						variant="ghost"
						size="icon"
						className="h-9 w-9"
						title={t("editor.toolbar.splitClip")}
					>
						<Scissors className="h-4 w-4" />
					</Button>
				</div>

				<div className="editor-playback-center z-10 flex items-center justify-center">
					<div className="pointer-events-auto flex items-center gap-1.5">
						<span className="mr-1 text-[10px] font-medium tabular-nums text-muted-foreground">
							{formatTime(projection.timelinePlayheadTime)}
						</span>
						<Button
							variant="ghost"
							size="icon"
							className="h-9 w-9"
							title={t("editor.playback.skipBack")}
							onClick={playback.handlePreviewSkipBack}
						>
							<SkipBack className="h-3.5 w-3.5" weight="fill" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className={`h-9 w-9  ${isPlaying ? "bg-foreground/10 text-foreground hover:bg-foreground/20" : "bg-neutral-800 text-white hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"} `}
							onClick={playback.togglePlayPause}
							title={isPlaying ? "Pause" : "Play"}
						>
							{isPlaying ? (
								<Pause className="h-3.5 w-3.5" weight="fill" />
							) : (
								<Play className="h-3.5 w-3.5" weight="fill" />
							)}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-9 w-9"
							title={t("editor.playback.skipForward")}
							onClick={playback.handlePreviewSkipForward}
						>
							<SkipForward className="h-3.5 w-3.5" weight="fill" />
						</Button>
						<span className="ml-1 text-[10px] font-medium tabular-nums text-muted-foreground/70">
							{formatTime(projection.timelineDuration)}
						</span>
					</div>
				</div>

				<div
					className={`editor-playback-volume z-10 ml-auto flex items-center ${isFullscreen ? "invisible" : ""}`}
				>
					<Popover>
						<PopoverTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("editor.playback.volume", "Preview volume")}
								title={t("editor.playback.volume", "Preview volume")}
							>
								{previewVolume <= 0.001 ? (
									<SpeakerX className="size-3.5" />
								) : previewVolume < 0.5 ? (
									<SpeakerLow className="size-3.5" />
								) : (
									<SpeakerHigh className="size-3.5" />
								)}
							</Button>
						</PopoverTrigger>
						<PopoverContent
							side="top"
							sideOffset={10}
							aria-label="Preview volume"
							className="flex w-14 flex-col items-center gap-3 p-3"
						>
							<span className="text-[10px] tabular-nums text-muted-foreground">
								{Math.round(previewVolume * 100)}%
							</span>
							<Slider
								aria-label={t("editor.playback.volume", "Preview volume")}
								orientation="vertical"
								min={0}
								max={1}
								step={0.01}
								value={[previewVolume]}
								onValueChange={([value]) => setPreviewVolume(value)}
								className="h-28"
							/>
						</PopoverContent>
					</Popover>
				</div>
			</div>
			<TextToSpeechDialog
				open={textToSpeechOpen}
				onOpenChange={setTextToSpeechOpen}
				hasVideo={projection.timelineDuration > 0}
				sourceKey={videoPath}
				initialStartMs={textToSpeechStartMs}
				durationMs={Math.round(projection.timelineDuration * 1000)}
				addClips={(clips, gapMs, startMs) => {
					const placed = timelineRef.current?.addAudioClips(clips, gapMs, startMs);
					if (placed?.length) playback.handleTimelineSeek(placed[0].startMs / 1000);
					return placed;
				}}
			/>
		</div>
	);
}
