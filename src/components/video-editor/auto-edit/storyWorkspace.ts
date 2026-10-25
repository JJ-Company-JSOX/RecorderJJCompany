import type { PlanLanguage } from "./messages";
import type { NarrationCue, NarrationDraft } from "./narration";
import { emptyStoryBrief, type StoryBrief } from "./story";

/** Editor-only story work. Media remains in the project's existing independent assets. */
export interface StoryWorkspace {
	version: 1;
	brief: StoryBrief;
	draft: NarrationDraft | null;
	edits: Record<string, string>;
	titles: Record<string, string>;
	approved: boolean;
	baseline: string | null;
	briefSnapshot: string | null;
	audioSnapshot: string | null;
	style: "concise" | "tutorial" | "detailed";
	language: PlanLanguage;
	storyMode: boolean;
}
export function emptyStoryWorkspace(): StoryWorkspace {
	return {
		version: 1,
		brief: emptyStoryBrief(),
		draft: null,
		edits: {},
		titles: {},
		approved: false,
		baseline: null,
		briefSnapshot: null,
		audioSnapshot: null,
		style: "tutorial",
		language: "en",
		storyMode: false,
	};
}
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const boundedText = (value: unknown, length: number, fallback = "") =>
	typeof value === "string" ? value.slice(0, length) : fallback;
const optionalText = (value: unknown, length: number) =>
	typeof value === "string" && value.length <= length ? value : null;
const validId = (value: unknown): value is string =>
	typeof value === "string" &&
	/^[a-zA-Z0-9_-]{1,64}$/.test(value) &&
	!["__proto__", "prototype", "constructor"].includes(value);
const time = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86400000;
function normalizeDraft(value: unknown): NarrationDraft | null {
	if (!record(value) || !Array.isArray(value.cues) || value.cues.length > 32) return null;
	const seen = new Set<string>();
	const cues: NarrationCue[] = [];
	for (const cue of value.cues) {
		if (
			!record(cue) ||
			!validId(cue.id) ||
			seen.has(cue.id) ||
			!time(cue.startMs) ||
			!time(cue.endMs) ||
			cue.endMs <= cue.startMs ||
			typeof cue.text !== "string" ||
			cue.text.length > 5000
		)
			return null;
		seen.add(cue.id);
		cues.push({
			id: cue.id,
			startMs: cue.startMs,
			endMs: cue.endMs,
			text: cue.text,
			...(typeof cue.title === "string" ? { title: boundedText(cue.title, 60) } : {}),
			...(typeof cue.stage === "string" ? { stage: boundedText(cue.stage, 40) } : {}),
		});
	}
	return { cues };
}
/** Accept only known, bounded fields. Approval is revoked specifically when opening a file. */
export function normalizeStoryWorkspace(
	value: unknown,
	options: { clearApproval?: boolean } = {},
): StoryWorkspace | null {
	if (!record(value) || value.version !== 1) return null;
	const defaults = emptyStoryWorkspace();
	const rawBrief = record(value.brief) ? value.brief : {};
	const brief: StoryBrief = {
		...defaults.brief,
		topic: boundedText(rawBrief.topic, 2000),
		audience: boundedText(rawBrief.audience, 2000),
		facts: boundedText(rawBrief.facts, 2000),
		ending: boundedText(rawBrief.ending, 2000),
		notes: boundedText(rawBrief.notes, 2000),
		analyzeVideo: typeof rawBrief.analyzeVideo === "boolean" ? rawBrief.analyzeVideo : true,
	};
	// Optional transcript consent is part of the brief, and is never enabled by an old project.
	Object.assign(brief, { includeTranscript: rawBrief.includeTranscript === true });
	const draft = normalizeDraft(value.draft);
	const lines = (raw: unknown, max: number) =>
		Object.fromEntries(
			(draft?.cues ?? []).flatMap((cue) =>
				record(raw) && typeof raw[cue.id] === "string"
					? [[cue.id, boundedText(raw[cue.id], max)]]
					: [],
			),
		);
	return {
		version: 1,
		brief,
		draft,
		edits: lines(value.edits, 5000),
		titles: lines(value.titles, 60),
		approved: !options.clearApproval && !!draft && value.approved === true,
		baseline: optionalText(value.baseline, 2000000),
		briefSnapshot: optionalText(value.briefSnapshot, 20000),
		audioSnapshot: optionalText(value.audioSnapshot, 200000),
		style: value.style === "concise" || value.style === "detailed" ? value.style : "tutorial",
		language: value.language === "zh" || value.language === "ms" ? value.language : "en",
		storyMode: value.storyMode === true,
	};
}
