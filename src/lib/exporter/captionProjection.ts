import { projectCaptionCues } from "@/components/video-editor/captionTimeline";
import {
	getClipSourceStartMs,
	type CaptionCue,
	type ClipRegion,
} from "@/components/video-editor/types";

/** Project once before rendering; source-only legacy callers keep their original clock. */
export function captionRenderConfig(
	cues: CaptionCue[] | undefined,
	clips: ClipRegion[] | undefined,
): {
	autoCaptions: CaptionCue[] | undefined;
	captionCoordinateSpace: "source" | "timeline";
} {
	if (clips === undefined) return { autoCaptions: cues, captionCoordinateSpace: "source" };
	return {
		captionCoordinateSpace: "timeline",
		autoCaptions: projectCaptionCues(cues ?? [], clips).map((fragment) => {
			const { clip } = fragment;
			const sourceStart = getClipSourceStartMs(clip);
			const time = (ms: number) => clip.startMs + (ms - sourceStart) / clip.speed;
			const words = fragment.words?.flatMap((word) => {
				const startMs = Math.max(fragment.startMs, time(word.startMs));
				const endMs = Math.min(fragment.endMs, time(word.endMs));
				return startMs < endMs ? [{ ...word, startMs, endMs }] : [];
			});
			return {
				id: fragment.id,
				startMs: fragment.startMs,
				endMs: fragment.endMs,
				text: fragment.text,
				...(words?.length ? { words } : {}),
			};
		}),
	};
}
