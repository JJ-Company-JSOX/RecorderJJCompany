export type NarrationAudioClip = NonNullable<
	Awaited<ReturnType<Window["electronAPI"]["synthesizeAutoEditNarration"]>>["clips"]
>[number];
type Cue = { id: string; text: string };
/** Session-only, bounded reuse. Placement edits do not require another model inference. */
export class NarrationAudioCache {
	private readonly entries = new Map<string, NarrationAudioClip>();
	private key(text: string, language: string, voice?: number) {
		return JSON.stringify([language, voice ?? null, text.trim()]);
	}
	clear() {
		this.entries.clear();
	}
	get(cue: Cue, language: string, voice?: number): NarrationAudioClip | undefined {
		const found = this.entries.get(this.key(cue.text, language, voice));
		return found
			? { ...found, id: cue.id, chunks: found.chunks?.map((chunk) => ({ ...chunk })) }
			: undefined;
	}
	remember(cues: Cue[], clips: NarrationAudioClip[], language: string, voice?: number) {
		for (const clip of clips) {
			const cue = cues.find((c) => c.id === clip.id);
			if (
				!cue ||
				!clip.audioPath ||
				!Number.isFinite(clip.durationMs) ||
				clip.durationMs <= 0
			)
				continue;
			const key = this.key(cue.text, language, voice);
			this.entries.delete(key);
			this.entries.set(key, { ...clip, chunks: clip.chunks?.map((chunk) => ({ ...chunk })) });
			while (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value!);
		}
	}
}
