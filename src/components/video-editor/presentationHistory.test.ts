import { describe, expect, it } from "vitest";
import {
	createEditorHistoryStack,
	type EditorHistorySnapshot,
	recordEditorHistorySnapshot,
	redoEditorHistoryStack,
	undoEditorHistoryStack,
} from "./editorHistory";
import { pickPresentationHistoryState } from "./presentationHistory";
import { normalizeProjectEditor } from "./projectPersistence";

describe("presentation history", () => {
	it("tracks camera, cursor, background, caption style and ratio without playback state", () => {
		const editor = normalizeProjectEditor({
			wallpaper: "#123456",
			aspectRatio: "1:1",
			cursorSize: 2,
		});
		const state = pickPresentationHistoryState(editor);
		expect(state).toMatchObject({
			wallpaper: "#123456",
			aspectRatio: "1:1",
			cursorSize: 2,
			webcam: editor.webcam,
			autoCaptionSettings: editor.autoCaptionSettings,
		});
		expect(state).not.toHaveProperty("clipRegions");
		expect(state).not.toHaveProperty("audioRegions");
		expect(state).not.toHaveProperty("resolvedWebcamVideoUrl");
	});

	it("restores independent presentation snapshots through undo and redo", () => {
		const stack = createEditorHistoryStack();
		const base: EditorHistorySnapshot = {
			zoomRegions: [],
			clipRegions: [],
			speedRegions: [],
			annotationRegions: [],
			audioRegions: [],
			autoCaptions: [],
			selectedZoomId: null,
			selectedClipId: null,
			selectedAnnotationId: null,
			selectedAudioId: null,
			presentation: pickPresentationHistoryState(
				normalizeProjectEditor({ wallpaper: "#123456" }),
			),
		};
		recordEditorHistorySnapshot(stack, base);
		const changed = structuredClone(base);
		changed.presentation!.wallpaper = "#abcdef";
		changed.presentation!.webcam!.mirror = !base.presentation!.webcam!.mirror;
		recordEditorHistorySnapshot(stack, changed);
		expect(undoEditorHistoryStack(stack, changed)?.presentation).toEqual(base.presentation);
		expect(redoEditorHistoryStack(stack, base)?.presentation).toEqual(changed.presentation);
	});
});
