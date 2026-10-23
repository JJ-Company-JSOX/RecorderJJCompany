import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import type { PlanLanguage } from "./messages";

/** The narration voice chosen for each language, remembered across sessions. */
const VOICE_SETTING = "recordly.narrationVoice";
export type VoiceChoice = Partial<Record<PlanLanguage, number>>;

export function savedVoiceChoice(): VoiceChoice {
	const saved = loadAppSetting<unknown>(VOICE_SETTING);
	if (!saved || typeof saved !== "object") return {};
	return Object.fromEntries(
		Object.entries(saved).filter(
			([language, id]) => ["zh", "en", "ms"].includes(language) && Number.isInteger(id),
		),
	);
}

export const saveVoiceChoice = (choice: VoiceChoice) => saveAppSetting(VOICE_SETTING, choice);

/** Stops a voice preview; closing an already closed player would reject. */
export function closePlayer(player: AudioContext | null) {
	if (player && player.state !== "closed") void player.close().catch(() => undefined);
}

/** Plays preview samples once; the returned player closes itself when it is done. */
export function playVoiceSamples(samples: ArrayLike<number>, sampleRate: number) {
	const context = new AudioContext();
	const buffer = context.createBuffer(1, samples.length, sampleRate);
	buffer.copyToChannel(new Float32Array(samples), 0);
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.connect(context.destination);
	source.onended = () => closePlayer(context);
	source.start();
	return context;
}
