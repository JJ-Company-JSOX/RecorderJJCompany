export type AudioAnalysisErrorCode = "NO_AUDIO" | "AUDIO_EXTRACTION_FAILED" | "NO_USABLE_SPEECH";

export type AudioSourceAttempt = {
	label: string;
	readable: boolean;
	outcome: "no-audio" | "unreadable" | "probe-failed" | "extraction-failed";
};

export class NoCaptionAudioError extends Error {
	readonly code = "NO_AUDIO" as const;
	constructor(
		message = "No audio was found in the recording or its linked audio files.",
		readonly attempts: AudioSourceAttempt[] = [],
	) {
		super(message);
	}
}

export class AudioExtractionError extends Error {
	readonly code = "AUDIO_EXTRACTION_FAILED" as const;
	constructor(readonly attempts: AudioSourceAttempt[]) {
		super(
			"The recording audio could not be read or extracted. No automatic edits were applied.",
		);
	}
}

export class NoUsableSpeechError extends Error {
	readonly code = "NO_USABLE_SPEECH" as const;
	constructor() {
		super("Audio was read, but no usable speech was recognized.");
	}
}
