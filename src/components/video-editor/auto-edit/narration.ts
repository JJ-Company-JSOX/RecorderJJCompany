export interface NarrationCue {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
}

export interface NarrationDraft {
	cues: NarrationCue[];
}
