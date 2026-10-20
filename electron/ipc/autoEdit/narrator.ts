import type { EditPlan } from "../../../src/components/video-editor/auto-edit/plan";
import type {
	NarrationCue,
	NarrationDraft,
} from "../../../src/components/video-editor/auto-edit/narration";
import { inspectLocalModel, localRequest } from "./reviewer";

export interface NarrationGenerator {
	generate(plan: EditPlan, model: string): Promise<NarrationDraft>;
}

type NarrationCandidate = {
	id: string;
	kind: string;
	startMs: number;
	endMs: number;
	reason: string;
};

const NARRATION_SYSTEM_PROMPT =
	'Write a short narration line for each listed timestamped action from a screen-recording tutorial editing plan. Reply with {"cues":[{"id":"...","text":"..."}]}, exactly one cue per listed action id. Keep each line under 25 words, present tense, friendly. Describe only what the action kind/reason implies (for example a "zoom" at a "click" is the presenter zooming in on where they clicked; a "trim" removes a pause or repeat). Never invent on-screen content, numbers, names or claims the action metadata does not support. No markdown.';

// The bundled voice (AISHELL-3) has a Mandarin-only lexicon and silently drops other words.
export type NarrationLanguage = "zh" | "en" | "ms";
const LANGUAGE_INSTRUCTION: Record<NarrationLanguage, string> = {
	zh: " Write every line in Simplified Chinese (Mandarin); it will be read aloud by a Mandarin voice.",
	en: " Write every line in plain English; it will be read aloud by an English voice.",
	ms: " Write every line in Bahasa Melayu (Malaysian Malay, not Indonesian); it will be read aloud by a Malay voice.",
};
export const isNarrationLanguage = (value: unknown): value is NarrationLanguage =>
	value === "zh" || value === "en" || value === "ms";

const NARRATION_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		cues: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: { type: "string" },
					text: { type: "string", maxLength: 500 },
				},
				required: ["id", "text"],
			},
		},
	},
	required: ["cues"],
};

/**
 * Only structural action metadata (kind/reason/timing) is ever sent to a
 * model, local or bundled — never transcript text, captions or file paths —
 * so the model can only describe the shape of the edit, not invent facts
 * about what was said or shown.
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
 * Same draft, generated with the AI edition's own bundled offline model
 * (the same llama-server.exe + Qwen3-VL-2B-Instruct session already started
 * for speech/vision analysis) instead of a separately installed Ollama —
 * no extra download, no separate program for the customer to set up.
 */
export async function generateBundledNarration(
	plan: EditPlan,
	complete: (instruction: string, question: string, schema: object) => Promise<string>,
	language: NarrationLanguage = "zh",
): Promise<NarrationDraft> {
	const candidates = buildNarrationCandidates(plan);
	if (!candidates.length) return { cues: [] };
	const content = await complete(
		NARRATION_SYSTEM_PROMPT + LANGUAGE_INSTRUCTION[language],
		JSON.stringify(candidates),
		NARRATION_SCHEMA,
	);
	return parseNarrationCues(candidates, JSON.parse(content));
}
