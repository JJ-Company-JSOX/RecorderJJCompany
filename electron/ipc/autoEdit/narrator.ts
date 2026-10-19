import type { EditPlan } from "../../../src/components/video-editor/auto-edit/plan";
import type {
	NarrationCue,
	NarrationDraft,
} from "../../../src/components/video-editor/auto-edit/narration";
import { inspectLocalModel, localRequest } from "./reviewer";

export interface NarrationGenerator {
	generate(plan: EditPlan, model: string): Promise<NarrationDraft>;
}

/**
 * Drafts process narration ("now clicking here to zoom in...") from the plan's
 * action metadata only (kind/reason/timing) — never transcript text, file
 * paths or any other recording content — so the model can only describe the
 * shape of the edit, not invent facts about what was said or shown.
 */
export class LocalNarrationGenerator implements NarrationGenerator {
	async generate(plan: EditPlan, model: string): Promise<NarrationDraft> {
		await inspectLocalModel(model);
		const candidates = plan.suggestions
			.filter((s) => !s.blocked)
			.map(({ id, kind, startMs, endMs, reason }) => ({ id, kind, startMs, endMs, reason }));
		if (!candidates.length) return { cues: [] };
		const parsed = (await localRequest("/api/chat", {
			model,
			stream: false,
			format: "json",
			options: { temperature: 0.3 },
			messages: [
				{
					role: "system",
					content:
						'Write a short narration line for each listed timestamped action from a screen-recording tutorial editing plan. Reply with {"cues":[{"id":"...","text":"..."}]}, exactly one cue per listed action id. Keep each line under 25 words, present tense, friendly. Describe only what the action kind/reason implies (for example a "zoom" at a "click" is the presenter zooming in on where they clicked; a "trim" removes a pause or repeat). Never invent on-screen content, numbers, names or claims the action metadata does not support. No markdown.',
				},
				{ role: "user", content: JSON.stringify(candidates) },
			],
		})) as { message: { content: string } };
		const raw = JSON.parse(parsed.message.content);
		if (!raw || !Array.isArray(raw.cues) || raw.cues.length > candidates.length)
			throw new Error("Invalid narration draft");
		const byId = new Map(candidates.map((c) => [c.id, c]));
		const seen = new Set<string>();
		const cues: NarrationCue[] = raw.cues.map((value: unknown) => {
			if (!value || typeof value !== "object") throw new Error("Invalid narration draft");
			const cue = value as Record<string, unknown>;
			const source = typeof cue.id === "string" ? byId.get(cue.id) : undefined;
			if (!source || seen.has(source.id)) throw new Error("Unknown or duplicate narration cue");
			seen.add(source.id);
			if (typeof cue.text !== "string" || !cue.text.trim() || cue.text.length > 500)
				throw new Error("Invalid narration text");
			return { id: source.id, startMs: source.startMs, endMs: source.endMs, text: cue.text.trim() };
		});
		return { cues: cues.sort((a, b) => a.startMs - b.startMs) };
	}
}
