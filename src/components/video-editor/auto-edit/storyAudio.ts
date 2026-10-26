import { captionMatchesClip } from "../captionTimeline";
import {
	getClipSourceStartMs,
	getClipSourceEndMs,
	type CaptionCue,
	type ClipRegion,
} from "../types";

export type StoryAudioReason =
	| "consent-required"
	| "missing-source"
	| "missing-model"
	| "cancelled"
	| "stale"
	| "busy"
	| "no-audio"
	| "no-speech"
	| "not-approved"
	| "invalid-input"
	| "invalid-result"
	| "failed";
export type StoryAudioProgress = {
	phase: "preparing" | "transcribing" | "complete" | "cancelled" | "error";
	cueCount?: number;
};
export type StoryAudioApi = Pick<Window["electronAPI"], "generateAutoCaptions"> &
	Partial<
		Pick<Window["electronAPI"], "getBundledSpeechStatus" | "getWhisperSmallModelStatus">
	> & {
		cancelAutoCaptionGeneration?: () => Promise<{ success: boolean; cancelled: boolean }>;
		onAutoCaptionProgress?: (callback: (progress: StoryAudioProgress) => void) => () => void;
	};
export type StoryAudioResult =
	| {
			success: true;
			recognizedCues: CaptionCue[];
			mergedCues: CaptionCue[];
			addedCount: number;
			preservedCount: number;
	  }
	| { success: false; reason: StoryAudioReason; message: string; details?: string };
const messages: Record<StoryAudioReason, string> = {
	"consent-required": "Allow original-audio recognition before using speech as story evidence.",
	"missing-source": "Open a recording or imported video before recognizing its original audio.",
	"missing-model":
		"The local speech model is not installed. Set up speech recognition in Captions, or continue with the brief and video frames only.",
	cancelled:
		"Original-audio recognition was cancelled. Your existing captions and edits were kept.",
	stale: "The recording or editor state changed. Recognition results were not applied; retry on the current video.",
	busy: "Another caption-recognition task is running. Wait or cancel it before trying again.",
	"no-audio":
		"No original audio was found in this recording. You can continue with the brief and video frames only.",
	"no-speech":
		"No speech was recognized in the original audio. Check its language or continue with the brief and video frames only.",
	"not-approved":
		"The recording or its linked audio is not approved for recognition. Reopen the video and retry.",
	"invalid-input":
		"The original-audio recognition request is invalid. Reopen the video and retry.",
	"invalid-result":
		"Speech recognition returned invalid source timestamps or oversized results. Existing captions were kept.",
	failed: "Could not recognize the original audio. Retry or continue with the brief and video frames only.",
};
class StoryAudioIssue extends Error {
	constructor(
		readonly reason: StoryAudioReason,
		readonly details?: string,
	) {
		super(messages[reason]);
	}
}
const cloneCue = (cue: CaptionCue): CaptionCue => ({
	...cue,
	words: cue.words?.map((word) => ({ ...word })),
});
const overlaps = (a: CaptionCue, b: CaptionCue) => a.startMs < b.endMs && b.startMs < a.endMs;
const MAX_SOURCE_MS = 86400000;
const validTime = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SOURCE_MS;
function validateRecognizedCues(raw: unknown): CaptionCue[] {
	if (!Array.isArray(raw) || raw.length > 10000) throw new StoryAudioIssue("invalid-result");
	let characters = 0;
	const ids = new Set<string>();
	const cues = raw
		.map((cue: unknown) => {
			if (!cue || typeof cue !== "object") throw new StoryAudioIssue("invalid-result");
			const c = cue as CaptionCue;
			if (
				typeof c.id !== "string" ||
				!c.id ||
				c.id.length > 256 ||
				ids.has(c.id) ||
				typeof c.text !== "string" ||
				c.text.length > 5000 ||
				!validTime(c.startMs) ||
				!validTime(c.endMs) ||
				c.endMs <= c.startMs
			)
				throw new StoryAudioIssue("invalid-result");
			ids.add(c.id);
			characters += c.text.length;
			if (characters > 2000000) throw new StoryAudioIssue("invalid-result");
			if (
				c.words !== undefined &&
				(!Array.isArray(c.words) ||
					c.words.length > 2000 ||
					c.words.some(
						(w) =>
							!w ||
							typeof w.text !== "string" ||
							w.text.length > 5000 ||
							!validTime(w.startMs) ||
							!validTime(w.endMs) ||
							w.endMs <= w.startMs,
					))
			)
				throw new StoryAudioIssue("invalid-result");
			return {
				id: c.id,
				startMs: c.startMs,
				endMs: c.endMs,
				text: c.text.trim(),
				...(c.words
					? {
							words: c.words.map((w) => ({
								text: w.text,
								startMs: w.startMs,
								endMs: w.endMs,
								...(typeof w.leadingSpace === "boolean"
									? { leadingSpace: w.leadingSpace }
									: {}),
							})),
						}
					: {}),
			};
		})
		.filter((c) => c.text);
	return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}
/** Preserve manual or generated captions; callers can keep recognizedCues as separate story evidence. */
export function mergeStorySourceCaptions(
	existing: CaptionCue[],
	recognized: CaptionCue[],
): CaptionCue[] {
	const preserved = existing.map(cloneCue),
		usedIds = new Set(preserved.map((c) => c.id));
	const added: CaptionCue[] = [];
	for (const cue of recognized) {
		if (preserved.some((c) => overlaps(c, cue))) continue;
		let id = cue.id;
		for (let suffix = 1; usedIds.has(id); suffix++) id = `${cue.id}-story-source-${suffix}`;
		usedIds.add(id);
		added.push({ ...cloneCue(cue), id });
	}
	return [...preserved, ...added].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/** Manual subtitles have priority as story evidence; generated narration is not source speech. */
export function mergeStorySpeechEvidence(
	existing: CaptionCue[],
	recognized: CaptionCue[],
	clips?: ClipRegion[],
): CaptionCue[] {
	const original = existing.filter((c) => !c.id.startsWith("narration-")),
		speech = recognized.filter((c) => !c.id.startsWith("narration-"));
	if (!clips) return mergeStorySourceCaptions(original, speech);
	const extra: CaptionCue[] = [];
	for (const cue of speech) {
		if (!original.some((c) => overlaps(c, cue))) {
			extra.push(cloneCue(cue));
			continue;
		}
		// A correction bound to one use of a source must not suppress its other uses.
		for (const clip of clips) {
			if (
				!captionMatchesClip(cue, clip) ||
				cue.startMs >= getClipSourceEndMs(clip) ||
				cue.endMs <= getClipSourceStartMs(clip)
			)
				continue;
			if (original.some((c) => captionMatchesClip(c, clip) && overlaps(c, cue))) continue;
			extra.push({
				...cloneCue(cue),
				id: `${cue.id}-story-evidence-${clip.id}`,
				clipId: clip.id,
			});
		}
	}
	const usedIds = new Set(original.map((c) => c.id));
	return [
		...original.map(cloneCue),
		...extra.map((c) => {
			let id = c.id;
			for (let suffix = 1; usedIds.has(id); suffix++) id = `${c.id}-${suffix}`;
			usedIds.add(id);
			return { ...c, id };
		}),
	].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/** Explicit local recognition only; never downloads a model or writes to editor/project state. */
export async function transcribeStoryAudio(options: {
	api: StoryAudioApi;
	videoPath: string;
	language?: string;
	existingCaptions?: CaptionCue[];
	consent: boolean;
	signal?: AbortSignal;
	isCurrent?: () => boolean;
	whisperModelPath?: string;
	whisperExecutablePath?: string;
	onStage?: (stage: StoryAudioProgress["phase"] | "checking-model", cueCount?: number) => void;
}): Promise<StoryAudioResult> {
	const { api, signal } = options;
	let recognitionStarted = false,
		cancellationSent = false,
		unsubscribe: (() => void) | undefined;
	const isCurrent = options.isCurrent ?? (() => true);
	const guard = () => {
		if (signal?.aborted) throw new StoryAudioIssue("cancelled");
		if (!isCurrent()) throw new StoryAudioIssue("stale");
	};
	const cancel = () => {
		if (!recognitionStarted || cancellationSent) return;
		cancellationSent = true;
		try {
			void api.cancelAutoCaptionGeneration?.().catch(() => undefined);
		} catch {
			/* Cancellation is best effort; guards still discard late results. */
		}
	};
	const guarded = <T>(promise: Promise<T>): Promise<T> =>
		new Promise((resolve, reject) => {
			const abort = () => {
				cancel();
				reject(new StoryAudioIssue("cancelled"));
			};
			signal?.addEventListener("abort", abort, { once: true });
			if (signal?.aborted) abort();
			promise
				.then((value) => {
					try {
						guard();
						resolve(value);
					} catch (error) {
						reject(error);
					}
				}, reject)
				.finally(() => signal?.removeEventListener("abort", abort));
		});
	try {
		guard();
		if (!options.consent) throw new StoryAudioIssue("consent-required");
		if (typeof options.videoPath !== "string" || !options.videoPath.trim())
			throw new StoryAudioIssue("missing-source");
		options.onStage?.("checking-model");
		let modelPath = options.whisperModelPath;
		if (!modelPath) {
			const bundled = api.getBundledSpeechStatus
				? await guarded(api.getBundledSpeechStatus())
				: null;
			if (bundled?.available) modelPath = "";
			else {
				const installed = api.getWhisperSmallModelStatus
					? await guarded(api.getWhisperSmallModelStatus())
					: null;
				if (!installed?.success || !installed.exists || !installed.path)
					throw new StoryAudioIssue("missing-model");
				modelPath = installed.path;
			}
		}
		guard();
		unsubscribe = api.onAutoCaptionProgress?.((progress) => {
			if (!signal?.aborted && isCurrent())
				options.onStage?.(progress.phase, progress.cueCount);
		});
		recognitionStarted = true;
		options.onStage?.("preparing");
		const result = await guarded(
			api.generateAutoCaptions({
				videoPath: options.videoPath,
				whisperModelPath: modelPath,
				whisperExecutablePath: options.whisperExecutablePath,
				language: options.language ?? "auto",
			}),
		);
		guard();
		if (!result.success) {
			const code = (result as typeof result & { errorCode?: string }).errorCode;
			const reason: StoryAudioReason =
				code &&
				[
					"cancelled",
					"busy",
					"no-audio",
					"no-speech",
					"not-approved",
					"invalid-input",
				].includes(code)
					? (code as StoryAudioReason)
					: "failed";
			throw new StoryAudioIssue(reason, (result.message || result.error)?.slice(0, 1000));
		}
		const recognizedCues = validateRecognizedCues(result.cues);
		if (!recognizedCues.length) throw new StoryAudioIssue("no-speech");
		const existing = options.existingCaptions ?? [],
			mergedCues = mergeStorySourceCaptions(existing, recognizedCues);
		return {
			success: true,
			recognizedCues,
			mergedCues,
			addedCount: mergedCues.length - existing.length,
			preservedCount: existing.length,
		};
	} catch (error) {
		const issue =
			error instanceof StoryAudioIssue
				? error
				: new StoryAudioIssue(
						signal?.aborted ? "cancelled" : !isCurrent() ? "stale" : "failed",
						error instanceof Error ? error.message.slice(0, 1000) : undefined,
					);
		return {
			success: false,
			reason: issue.reason,
			message: issue.message,
			...(issue.details ? { details: issue.details } : {}),
		};
	} finally {
		unsubscribe?.();
	}
}
