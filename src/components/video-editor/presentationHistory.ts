import type { ProjectEditorState } from "./projectPersistence";

/** Persisted visual controls only. Media URLs, playback position and device settings are excluded. */
export const PRESENTATION_HISTORY_KEYS = [
	"wallpaper",
	"shadowIntensity",
	"backgroundBlur",
	"zoomMotionBlur",
	"zoomMotionBlurTuning",
	"connectZooms",
	"zoomInDurationMs",
	"zoomInOverlapMs",
	"zoomOutDurationMs",
	"connectedZoomGapMs",
	"connectedZoomDurationMs",
	"zoomInEasing",
	"zoomOutEasing",
	"connectedZoomEasing",
	"showCursor",
	"loopCursor",
	"cursorStyle",
	"cursorSize",
	"cursorSmoothing",
	"cursorSpringStiffnessMultiplier",
	"cursorSpringDampingMultiplier",
	"cursorSpringMassMultiplier",
	"cameraSpringStiffnessMultiplier",
	"cameraSpringDampingMultiplier",
	"cameraSpringMassMultiplier",
	"cursorClickSound",
	"cursorClickSoundVolume",
	"cursorClickEffect",
	"cursorClickEffectColor",
	"cursorClickEffectScale",
	"cursorClickEffectOpacity",
	"cursorClickEffectDurationMs",
	"zoomSmoothness",
	"zoomClassicMode",
	"cursorMotionBlur",
	"cursorClickBounce",
	"cursorClickBounceDuration",
	"cursorSway",
	"borderRadius",
	"padding",
	"cropRegion",
	"webcam",
] as const satisfies readonly (keyof ProjectEditorState)[];

export type PresentationHistoryState = Pick<
	ProjectEditorState,
	(typeof PRESENTATION_HISTORY_KEYS)[number] | "aspectRatio" | "autoCaptionSettings"
>;

export function pickPresentationHistoryState(
	editor: Partial<ProjectEditorState>,
): Partial<PresentationHistoryState> {
	return Object.fromEntries(
		[...PRESENTATION_HISTORY_KEYS, "aspectRatio", "autoCaptionSettings"]
			.filter((key) => key in editor)
			.map((key) => [key, editor[key as keyof ProjectEditorState]]),
	);
}
