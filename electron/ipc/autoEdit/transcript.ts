import type {
	SpeechCue,
	SpeechTranscript,
} from "../../../src/components/video-editor/auto-edit/speechTypes";

/** Bound even CJK input below the local context budget; overlap provides neighboring takes. */
export function speechWindows(transcript: SpeechTranscript): SpeechTranscript[] {
	const windows: SpeechTranscript[] = [];
	for (let offset = 0; offset < transcript.cues.length; ) {
		const cues: SpeechCue[] = [];
		let chars = 0;
		for (const cue of transcript.cues.slice(offset, offset + 16)) {
			if (cue.text.length > 2000)
				throw Error("Recognized phrase is too long for local speech analysis");
			if (cues.length && chars + cue.text.length > 2000) break;
			cues.push(cue);
			chars += cue.text.length;
		}
		windows.push({ ...transcript, cues });
		if (offset + cues.length >= transcript.cues.length) break;
		offset += Math.max(1, cues.length - 4);
	}
	return windows;
}

/** Phrase padding may extend beyond source duration; never feed invalid bounds to editing. */
export function boundSpeechCues(cues: SpeechCue[], durationMs: number): SpeechCue[] {
	return cues.flatMap((cue) => {
		const startMs = Math.max(0, Math.round(cue.startMs));
		const endMs = Math.min(durationMs, Math.round(cue.endMs));
		if (
			!Number.isFinite(startMs) ||
			!Number.isFinite(endMs) ||
			endMs <= startMs ||
			!cue.text.trim()
		)
			return [];
		const words = cue.words?.flatMap((word) => {
			const start = Math.max(startMs, word.startMs),
				end = Math.min(endMs, word.endMs);
			return Number.isFinite(start) && Number.isFinite(end) && end > start
				? [{ ...word, startMs: start, endMs: end }]
				: [];
		});
		return [
			{
				...cue,
				startMs,
				endMs,
				words,
				// Phrase-only or clipped timing is suitable for captions, not automatic speech deletion.
				uncertain:
					cue.uncertain ||
					(!words?.length && cue.alignment !== "dtw-speech") ||
					cue.startMs < 0 ||
					cue.endMs > durationMs,
			},
		];
	});
}
