import type { CaptionCue } from "../types";

/** Transcript timestamps always refer to the original source, never the edited timeline. */
export interface SpeechCue extends CaptionCue {
	confidence?: number;
	uncertain?: boolean;
	/** Whole-phrase DTW/acoustic bounds, not exact word timing. */
	alignment?: "dtw-speech";
	/** Derived from bundled VAD, never from a language-model response. */
	vadBoundaryVerified?: boolean;
}
export interface SpeechTranscript {
	version: 1;
	durationMs: number;
	audioVerified: boolean;
	alignmentVerified: boolean;
	cues: SpeechCue[];
}
export interface SpeechCut {
	kind: "repeat" | "false-start";
	removeCueIds: string[];
	keepCueIds: string[];
	rationale: string;
	/** Derived by validation, never accepted from a model response. */
	blocked?: string;
}
export interface SpeechAnalysis {
	version: 1;
	transcript: SpeechTranscript;
	cuts: SpeechCut[];
	warnings: string[];
}

export function speechTokens(text: string): string[] {
	// Keep every word, number and Han character. Do not discard negation, stopwords or units.
	return (
		text
			.normalize("NFKC")
			.toLowerCase()
			.match(
				/\p{N}+(?:[.,]\p{N}+)*|\p{Script=Han}|[\p{L}\p{M}]+|[^\p{L}\p{M}\p{N}\s.,!?;:，。！？；：、…“”"'‘’（）()]/gu,
			) ?? []
	);
}

export function assertSpeechTranscript(raw: unknown): asserts raw is SpeechTranscript {
	if (!raw || typeof raw !== "object") throw Error("Invalid speech transcript");
	const value = raw as SpeechTranscript;
	if (
		value.version !== 1 ||
		!Number.isFinite(value.durationMs) ||
		value.durationMs <= 0 ||
		value.durationMs > 24 * 60 * 60 * 1000 ||
		typeof value.audioVerified !== "boolean" ||
		typeof value.alignmentVerified !== "boolean" ||
		!Array.isArray(value.cues) ||
		value.cues.length > 5000
	)
		throw Error("Invalid speech transcript");
	const ids = new Set<string>();
	for (const cue of value.cues) {
		if (
			!cue ||
			typeof cue.id !== "string" ||
			!/^[\p{L}\p{N}_.:-]{1,120}$/u.test(cue.id) ||
			ids.has(cue.id) ||
			typeof cue.text !== "string" ||
			!cue.text.trim() ||
			cue.text.length > 2000 ||
			!Number.isFinite(cue.startMs) ||
			!Number.isFinite(cue.endMs) ||
			cue.startMs < 0 ||
			cue.endMs <= cue.startMs ||
			cue.endMs > value.durationMs ||
			(cue.confidence !== undefined &&
				(!Number.isFinite(cue.confidence) || cue.confidence < 0 || cue.confidence > 1)) ||
			(cue.uncertain !== undefined && typeof cue.uncertain !== "boolean") ||
			(cue.alignment !== undefined && cue.alignment !== "dtw-speech") ||
			(cue.vadBoundaryVerified !== undefined && typeof cue.vadBoundaryVerified !== "boolean")
		)
			throw Error("Invalid or duplicate speech cue");
		ids.add(cue.id);
		if (cue.words !== undefined) {
			if (!Array.isArray(cue.words) || cue.words.length > 1000)
				throw Error("Invalid speech words");
			for (const word of cue.words)
				if (
					!word ||
					typeof word.text !== "string" ||
					word.text.length > 2000 ||
					!Number.isFinite(word.startMs) ||
					!Number.isFinite(word.endMs) ||
					word.startMs < cue.startMs ||
					word.endMs <= word.startMs ||
					word.endMs > cue.endMs
				)
					throw Error("Invalid speech word timing");
		}
	}
}

/** Recheck this in both processes: a model cannot authorize deleting novel facts. */
export function speechCutIssue(cut: SpeechCut, transcript: SpeechTranscript): string | undefined {
	const byId = new Map(transcript.cues.map((cue) => [cue.id, cue]));
	const removed = cut.removeCueIds.map((id) => byId.get(id));
	const kept = cut.keepCueIds.map((id) => byId.get(id));
	if (
		!removed.length ||
		!kept.length ||
		removed.some((cue) => !cue) ||
		kept.some((cue) => !cue) ||
		new Set([...cut.removeCueIds, ...cut.keepCueIds]).size !== removed.length + kept.length
	)
		return "speech-invalid-grounding";
	const removeCues = removed as SpeechCue[],
		keepCues = kept as SpeechCue[];
	if (!transcript.audioVerified || !transcript.alignmentVerified)
		return "speech-audio-unverified";
	if ([...removeCues, ...keepCues].some((cue) => cue.uncertain || (cue.confidence ?? 1) < 0.85))
		return "speech-asr-uncertain";
	if ([...removeCues, ...keepCues].some((cue) => cue.vadBoundaryVerified !== true))
		return "speech-vad-unverified";
	// An earlier failed take may be removed only if its entire text recurs in the later take.
	if (Math.max(...removeCues.map((c) => c.endMs)) > Math.min(...keepCues.map((c) => c.startMs)))
		return "speech-invalid-grounding";
	const ordered = [...transcript.cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
	for (const cues of [removeCues, keepCues]) {
		const indices = cues.map((cue) =>
			ordered.findIndex((candidate) => candidate.id === cue.id),
		);
		if (indices.some((index, i) => i > 0 && index !== indices[i - 1] + 1))
			return "speech-invalid-grounding";
	}
	for (const removedCue of removeCues)
		if (
			transcript.cues.some(
				(cue) =>
					!cut.removeCueIds.includes(cue.id) &&
					cue.startMs < removedCue.endMs &&
					removedCue.startMs < cue.endMs,
			)
		)
			return "speech-overlapping-speech";
	const removedTokens = speechTokens(removeCues.map((cue) => cue.text).join(" ")),
		keptTokens = speechTokens(keepCues.map((cue) => cue.text).join(" "));
	if (!removedTokens.length) return "speech-unique-content";
	if (cut.kind === "repeat") {
		if (removedTokens.join(" ") !== keptTokens.join(" ")) return "speech-unique-content";
	} else if (cut.kind === "false-start") {
		if (
			removedTokens.length > keptTokens.length ||
			removedTokens.some((token, i) => token !== keptTokens[i])
		)
			return "speech-unique-content";
	} else return "speech-invalid-grounding";
	if ([...removeCues, ...keepCues].some((cue) => cue.confidence === undefined))
		return "speech-confidence-unverified";
	return undefined;
}
