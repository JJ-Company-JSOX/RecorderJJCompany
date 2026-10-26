import { describe, expect, it } from "vitest";
import { emptyStoryWorkspace, normalizeStoryWorkspace } from "./storyWorkspace";
import { createProjectData, normalizeProjectEditor } from "../projectPersistence";
import {
	createEditorHistoryStack,
	recordEditorHistorySnapshot,
	undoEditorHistoryStack,
	redoEditorHistoryStack,
	type EditorHistorySnapshot,
} from "../editorHistory";
import { hasUnsavedProjectChanges } from "../projectDirtyState";
const workspace = () => ({
	...emptyStoryWorkspace(),
	storyMode: true,
	language: "en" as const,
	brief: {
		...emptyStoryWorkspace().brief,
		topic: "Product story",
		facts: "Works offline",
		includeTranscript: true,
	},
	draft: {
		cues: [
			{
				id: "story-1",
				startMs: 1000,
				endMs: 5000,
				stage: "Hook",
				title: "Offline story",
				text: "Make your product clear.",
			},
		],
	},
	edits: { "story-1": "Edited narration" },
	titles: { "story-1": "Edited heading" },
	approved: true,
	baseline: '{"source":"C:\\recording.mp4"}',
	briefSnapshot: '{"topic":"Product story"}',
	audioSnapshot: '{"lines":["Edited narration"],"voice":3,"language":"en"}',
});
const snapshot = (storyWorkspace = emptyStoryWorkspace()): EditorHistorySnapshot => ({
	storyWorkspace,
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
});
describe("persisted story workspace", () => {
	it("keeps the brief, language, edited draft, headings, timings and baseline through project serialization", () => {
		const original = workspace();
		const project = createProjectData(
			"C:\\recording.mp4",
			{ storyWorkspace: original },
			"project-id",
		);
		const reopened = normalizeProjectEditor(JSON.parse(JSON.stringify(project)).editor);
		expect(reopened.storyWorkspace).toEqual(original);
		expect(reopened.storyWorkspace).not.toBe(original);
		expect(normalizeStoryWorkspace(reopened.storyWorkspace, { clearApproval: true })).toEqual({
			...original,
			approved: false,
		});
		expect(original.approved).toBe(true);
	});
	it("makes a story-only edit dirty and includes it in ordinary undo and redo", () => {
		const first = workspace();
		const changed = { ...first, edits: { "story-1": "A better line" } };
		expect(
			hasUnsavedProjectChanges(
				createProjectData("a.mp4", { storyWorkspace: changed }),
				createProjectData("a.mp4", { storyWorkspace: first }),
			),
		).toBe(true);
		const history = createEditorHistoryStack(),
			before = snapshot(first),
			after = snapshot(changed);
		recordEditorHistorySnapshot(history, before);
		recordEditorHistorySnapshot(history, after);
		expect(undoEditorHistoryStack(history, after)?.storyWorkspace).toEqual(first);
		expect(redoEditorHistoryStack(history, before)?.storyWorkspace).toEqual(changed);
	});
	it("does not invent story state for old projects or accept unknown future workspace versions", () => {
		expect(normalizeProjectEditor({}).storyWorkspace).toBeNull();
		for (const value of [null, [], {}, { ...workspace(), version: 2 }])
			expect(normalizeStoryWorkspace(value)).toBeNull();
	});
	it("bounds imported fields and rejects corrupt drafts instead of approving their text", () => {
		const original = workspace();
		const normalized = normalizeStoryWorkspace({
			...original,
			brief: { ...original.brief, topic: "a".repeat(3000) },
			edits: { "story-1": "b".repeat(6000), unknown: "discard" },
			baseline: "x".repeat(2000001),
			audioSnapshot: "x".repeat(200001),
		})!;
		expect(normalized.brief.topic).toHaveLength(2000);
		expect(normalized.edits["story-1"]).toHaveLength(5000);
		expect(normalized.edits.unknown).toBeUndefined();
		expect(normalized.baseline).toBeNull();
		expect(normalized.audioSnapshot).toBeNull();
		for (const cues of [
			[{ ...original.draft.cues[0], endMs: -1 }],
			Array(33).fill(original.draft.cues[0]),
			[original.draft.cues[0], original.draft.cues[0]],
			[{ ...original.draft.cues[0], id: "__proto__" }],
		]) {
			const corrupt = normalizeStoryWorkspace({ ...original, draft: { cues } })!;
			expect(corrupt.draft).toBeNull();
			expect(corrupt.approved).toBe(false);
			expect(corrupt.edits).toEqual({});
		}
	});
	it("clones rather than retaining arbitrary persisted object references", () => {
		const original = workspace(),
			normalized = normalizeStoryWorkspace(original)!;
		normalized.brief.topic = "Changed";
		normalized.draft!.cues[0].text = "Changed";
		normalized.edits["story-1"] = "Changed";
		expect(original.brief.topic).toBe("Product story");
		expect(original.draft.cues[0].text).toBe("Make your product clear.");
		expect(original.edits["story-1"]).toBe("Edited narration");
	});
	it("preserves clip-bound captions and ancestry across JSON project reopening, rejects invalid provided binding", () => {
		const editor = normalizeProjectEditor(
			JSON.parse(
				JSON.stringify({
					clipRegions: [
						{
							id: "new-clip",
							startMs: 0,
							endMs: 5000,
							speed: 1,
							parentClipIds: ["original", "original", 123, ""],
						},
					],
					autoCaptions: [
						{
							id: "narration-a",
							clipId: "original",
							startMs: 0,
							endMs: 1000,
							text: "Bound",
						},
						{ id: "old", startMs: 2000, endMs: 3000, text: "Legacy" },
						{
							id: "bad",
							clipId: null,
							startMs: 3000,
							endMs: 4000,
							text: "Must not leak",
						},
					],
				}),
			),
		);
		expect(editor.clipRegions[0].parentClipIds).toEqual(["original"]);
		expect(editor.autoCaptions).toHaveLength(2);
		expect(editor.autoCaptions[0].clipId).toBe("original");
		expect(editor.autoCaptions[1].clipId).toBeUndefined();
	});
});

it("persists a valid desired narration duration, leaves old projects following footage and ignores invalid targets", () => {
	for (const value of [5, 30, 600]) {
		const saved = workspace();
		saved.brief = { ...saved.brief, targetSpeechSeconds: value };
		expect(
			normalizeProjectEditor(
				JSON.parse(JSON.stringify(createProjectData("a.mp4", { storyWorkspace: saved })))
					.editor,
			).storyWorkspace?.brief.targetSpeechSeconds,
		).toBe(value);
	}
	for (const value of [undefined, null, 4, 601, 30.5, "30"]) {
		expect(
			normalizeStoryWorkspace({
				...workspace(),
				brief: { ...workspace().brief, targetSpeechSeconds: value },
			})?.brief.targetSpeechSeconds,
		).toBeUndefined();
	}
});

const sourceSpeech = () => ({
	source: "C:\\recording.mp4",
	language: "en" as const,
	cues: [
		{
			id: "speech-1",
			clipId: "clip-1",
			startMs: 1000,
			endMs: 3000,
			text: "Hello world",
			words: [
				{ text: "Hello", startMs: 1000, endMs: 1700 },
				{ text: "world", startMs: 1800, endMs: 3000, leadingSpace: true },
			],
		},
	],
});
it("persists recognized source speech independently from final subtitle tracks with language and word timing", () => {
	const saved = {
		...workspace(),
		brief: { ...workspace().brief, autoTranscribe: true },
		sourceSpeech: sourceSpeech(),
	};
	const project = normalizeProjectEditor(
		JSON.parse(
			JSON.stringify(createProjectData("C:\\recording.mp4", { storyWorkspace: saved })),
		).editor,
	);
	expect(project.storyWorkspace?.brief.autoTranscribe).toBe(true);
	expect(project.storyWorkspace?.sourceSpeech).toEqual(saved.sourceSpeech);
	expect(project.autoCaptions).toEqual([]);
	expect(
		normalizeStoryWorkspace({
			...workspace(),
			brief: { ...workspace().brief, autoTranscribe: "true" },
		})?.brief.autoTranscribe,
	).toBe(false);
	expect(
		normalizeStoryWorkspace({ ...workspace(), sourceSpeech: null })?.sourceSpeech,
	).toBeNull();
});
it("rejects oversized or invalid source speech caches entirely instead of presenting truncated evidence", async () => {
	const { normalizeStorySourceSpeech } = await import("./storyWorkspace");
	const cache = sourceSpeech();
	for (const patch of [
		{ source: "" },
		{ source: "a".repeat(4097) },
		{ language: "fr" },
		{ cues: Array(5001).fill(cache.cues[0]) },
		{ cues: [{ ...cache.cues[0], text: "x".repeat(200001) }] },
		{ cues: [{ ...cache.cues[0], endMs: 86400001 }] },
		{ cues: [{ ...cache.cues[0], clipId: null }] },
		{ cues: [{ ...cache.cues[0], words: [{ text: "bad", startMs: 999, endMs: 1200 }] }] },
		{ cues: [{ ...cache.cues[0], words: [{ text: "bad", startMs: 1800, endMs: 3001 }] }] },
	])
		expect(normalizeStorySourceSpeech({ ...cache, ...patch })).toBeNull();
	expect(
		normalizeStorySourceSpeech({
			...cache,
			cues: [
				{
					...cache.cues[0],
					text: "x".repeat(100001),
					words: [{ text: "x".repeat(100000), startMs: 1000, endMs: 3000 }],
				},
			],
		}),
	).toBeNull();
	expect(
		normalizeStorySourceSpeech({
			...cache,
			cues: [{ ...cache.cues[0], text: "x".repeat(200000), words: undefined }],
		}),
	).not.toBeNull();
});
it("copies recognized speech so later review edits do not mutate the saved source cache", async () => {
	const { normalizeStorySourceSpeech } = await import("./storyWorkspace");
	const cache = sourceSpeech();
	const loaded = normalizeStorySourceSpeech(cache)!;
	loaded.cues[0].text = "Edited";
	loaded.cues[0].words![0].text = "Edited";
	expect(cache.cues[0].text).toBe("Hello world");
	expect(cache.cues[0].words[0].text).toBe("Hello");
});
