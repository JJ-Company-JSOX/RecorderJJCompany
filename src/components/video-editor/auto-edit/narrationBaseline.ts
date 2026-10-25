import { getClipSourceStartMs, sortClipRegions } from "../types";
import type { EditState } from "./plan";

/** A draft depends on source/time mapping, not audio volume or editor-only clip flags. */
export function narrationBaselineFor(state: EditState, source: string): string {
	return JSON.stringify({
		source,
		additionalVisualSource: state.additionalVisualSource ?? null,
		clips: sortClipRegions(state.clipRegions).map((c) => ({
			id: c.id,
			startMs: c.startMs,
			endMs: c.endMs,
			sourceStartMs: getClipSourceStartMs(c),
			speed: c.speed,
		})),
		zoomRegions: state.zoomRegions,
		speedRegions: state.speedRegions,
		// Existing speech and manually added audio must still be protected.
		captions: state.autoCaptions.filter((c) => !c.id.startsWith("narration-")),
		audio: state.audioRegions
			.filter((r) => !r.id.startsWith("narration-"))
			.map((r) => ({
				id: r.id,
				startMs: r.startMs,
				endMs: r.endMs,
				audioPath: r.audioPath,
				sourceOffsetMs: r.sourceOffsetMs ?? 0,
			})),
	});
}
