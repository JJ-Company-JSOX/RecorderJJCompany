import type { EditPlan } from "../../../src/components/video-editor/auto-edit/plan";
import type {
	NarrationCue,
	NarrationDraft,
} from "../../../src/components/video-editor/auto-edit/narration";
import type { ScreenEvent } from "./narrationFrames";
import { inspectLocalModel, localRequest } from "./reviewer";
import { generateTutorialScript, type NarrationStyle } from "./tutorialScript";

export interface NarrationGenerator {
	generate(plan: EditPlan, model: string): Promise<NarrationDraft>;
}

type NarrationCandidate = {
	id: string;
	kind: string;
	startMs: number;
	endMs: number;
	reason: string;
	/** What the on-device vision model saw at that moment (untrusted, may be empty). */
	screen?: string;
};

const NARRATION_SYSTEM_PROMPT =
	'Write a short narration line for each listed timestamped action from a screen-recording tutorial editing plan. Reply with {"cues":[{"id":"...","text":"..."}]}, exactly one cue per listed action id. Keep each line under 15 words, present tense, friendly. Describe only what the action kind/reason implies (for example a "zoom" at a "click" is the presenter zooming in on where they clicked; a "caption" at a "click" is the presenter clicking something; a "caption" for "vision" is a moment to say what the screen shows; a "speed" part is sped up; a "trim" removes a pause or repeat). Never invent on-screen content, numbers, names or claims the action metadata does not support. No markdown.';
// The bundled voice (AISHELL-3) has a Mandarin-only lexicon and silently drops other words.
export type NarrationLanguage = "zh" | "en" | "ms";
export const isNarrationLanguage = (value: unknown): value is NarrationLanguage =>
	value === "zh" || value === "en" || value === "ms";

/**
 * Only structural action metadata (kind/reason/timing) is sent to a model —
 * never transcript text, captions or file paths. The bundled model may also
 * get a short note of what its own vision pass read on screen at that moment.
 */
function buildNarrationCandidates(plan: EditPlan): NarrationCandidate[] {
	return plan.suggestions
		.filter((s) => !s.blocked)
		.map(({ id, kind, startMs, endMs, reason }) => ({ id, kind, startMs, endMs, reason }));
}

function parseNarrationCues(candidates: NarrationCandidate[], raw: unknown): NarrationDraft {
	if (
		!raw ||
		typeof raw !== "object" ||
		!Array.isArray((raw as { cues?: unknown }).cues) ||
		(raw as { cues: unknown[] }).cues.length > candidates.length
	)
		throw new Error("Invalid narration draft");
	const byId = new Map(candidates.map((c) => [c.id, c]));
	const seen = new Set<string>();
	const cues: NarrationCue[] = (raw as { cues: unknown[] }).cues.map((value: unknown) => {
		if (!value || typeof value !== "object") throw new Error("Invalid narration draft");
		const cue = value as Record<string, unknown>;
		const source = typeof cue.id === "string" ? byId.get(cue.id) : undefined;
		if (!source || seen.has(source.id)) throw new Error("Unknown or duplicate narration cue");
		seen.add(source.id);
		if (typeof cue.text !== "string" || !cue.text.trim() || cue.text.length > 500)
			throw new Error("Invalid narration text");
		return {
			id: source.id,
			startMs: source.startMs,
			endMs: source.endMs,
			text: cue.text.trim(),
		};
	});
	return { cues: cues.sort((a, b) => a.startMs - b.startMs) };
}

/**
 * Drafts process narration ("now clicking here to zoom in...") using a
 * user-operated local Ollama model, inspected and consented to first.
 */
export class LocalNarrationGenerator implements NarrationGenerator {
	async generate(plan: EditPlan, model: string): Promise<NarrationDraft> {
		await inspectLocalModel(model);
		const candidates = buildNarrationCandidates(plan);
		if (!candidates.length) return { cues: [] };
		const parsed = (await localRequest("/api/chat", {
			model,
			stream: false,
			format: "json",
			options: { temperature: 0.3 },
			messages: [
				{ role: "system", content: NARRATION_SYSTEM_PROMPT },
				{ role: "user", content: JSON.stringify(candidates) },
			],
		})) as { message: { content: string } };
		return parseNarrationCues(candidates, JSON.parse(parsed.message.content));
	}
}

/**
 * Draft generated with the AI edition's own bundled offline model (the llama-server +
 * Qwen3-VL session already started for this request), no separate program for the customer.
 * Stage A (what happened at each moment) has already run; this is Stage B: one coherent
 * script written from the ordered events.
 */
export async function generateBundledNarration(
	plan: EditPlan,
	complete: (
		instruction: string,
		question: string,
		schema: object,
		maxTokens?: number,
	) => Promise<string>,
	language: NarrationLanguage = "zh",
	events: Map<string, ScreenEvent> = new Map(),
	options: { style?: NarrationStyle; timelineEndMs?: number } = {},
): Promise<NarrationDraft> {
	return generateTutorialScript({
		plan,
		events,
		language,
		style: options.style ?? "tutorial",
		timelineEndMs:
			options.timelineEndMs ??
			Math.max(0, ...plan.suggestions.map((s) => s.endMs)) + OUTRO_FALLBACK_MS,
		complete,
	});
}
const OUTRO_FALLBACK_MS = 3000;
