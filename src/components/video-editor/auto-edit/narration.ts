export interface NarrationCue {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	stage?: string;
	title?: string;
}

export interface NarrationDraft {
	cues: NarrationCue[];
}
