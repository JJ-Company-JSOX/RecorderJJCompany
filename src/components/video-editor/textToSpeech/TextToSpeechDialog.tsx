import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/contexts/I18nContext";
import {
	closePlayer,
	playVoiceSamples,
	saveVoiceChoice,
	savedVoiceChoice,
} from "../auto-edit/narrationVoice";
import type { PlacedAudioClip } from "../timeline/hooks/utils/timelineAudioPlacement";
import { MAX_SEGMENTS, MAX_SPEECH_TEXT_CHARS, speechLanguage, speechSegments } from "./speechText";

type TtsStatus = Awaited<ReturnType<typeof window.electronAPI.getBundledTtsStatus>>;
type Language = "zh" | "en";

/** Pause between the clips of one text, about the gap between narration lines. */
const CLIP_GAP_MS = 250;

const selectClass =
	"rounded-lg border border-separator bg-background px-2 py-1.5 text-sm text-foreground";

/**
 * Turns typed text into speech with the bundled offline voice and adds it to the timeline at
 * the playhead, one clip per paragraph, without the AI looking at the video.
 */
export function TextToSpeechDialog({
	open,
	onOpenChange,
	hasVideo,
	addClips,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	hasVideo: boolean;
	addClips: (
		clips: Array<{ audioPath: string; durationMs: number }>,
		gapMs: number,
	) => PlacedAudioClip[] | undefined;
}) {
	const { t, locale } = useI18n();
	const [text, setText] = useState("");
	const [pickedLanguage, setPickedLanguage] = useState<Language | null>(null);
	const [status, setStatus] = useState<TtsStatus | null>(null);
	const [voiceChoice, setVoiceChoice] = useState(savedVoiceChoice);
	const [busy, setBusy] = useState<"preview" | "generate" | null>(null);
	const [error, setError] = useState("");
	const generation = useRef(0);
	const player = useRef<AudioContext | null>(null);

	useEffect(() => {
		if (!open) return;
		let active = true;
		setError("");
		void window.electronAPI
			.getBundledTtsStatus()
			.then((next) => {
				if (active) setStatus(next);
			})
			.catch(() => {
				if (active) setStatus(null);
			});
		return () => {
			active = false;
		};
	}, [open]);
	useEffect(() => () => closePlayer(player.current), []);

	const language = pickedLanguage ?? speechLanguage(text);
	const voices = (status?.voiceList ?? []).filter((voice) => voice.language === language);
	const voice =
		voices.find((candidate) => candidate.id === voiceChoice[language]) ??
		voices.find((candidate) => candidate.default) ??
		voices[0];
	const labelLanguage = locale.startsWith("zh") ? "zh" : "en";
	const installed = !!status?.available && !!status.voices?.[language];
	const segments = speechSegments(text);
	const tooMany = segments.length > MAX_SEGMENTS;

	const chooseVoice = (id: number) => {
		const next = { ...voiceChoice, [language]: id };
		setVoiceChoice(next);
		saveVoiceChoice(next);
	};
	const stop = () => {
		generation.current++;
		void window.electronAPI.cancelAutoEditAnalysis?.();
		setBusy(null);
	};
	const changeOpen = (next: boolean) => {
		if (!next) {
			if (busy) stop();
			closePlayer(player.current);
		}
		onOpenChange(next);
	};

	const preview = async () => {
		const run = ++generation.current;
		setBusy("preview");
		setError("");
		try {
			const result = await window.electronAPI.previewAutoEditNarrationVoice?.(
				language,
				voice?.id,
			);
			if (run !== generation.current) return;
			if (!result?.success || !result.samples || !result.sampleRate)
				throw new Error(result?.error);
			closePlayer(player.current);
			player.current = playVoiceSamples(result.samples, result.sampleRate);
		} catch (e) {
			if (run === generation.current)
				setError(
					`${t("editor.textToSpeech.error", "Could not make the voice:")} ${e instanceof Error ? e.message : ""}`,
				);
		} finally {
			if (run === generation.current) setBusy(null);
		}
	};

	const generate = async () => {
		const run = ++generation.current;
		setBusy("generate");
		setError("");
		try {
			const cues = segments.map((segment, index) => ({
				id: `tts-${index + 1}`,
				text: segment,
			}));
			const result = await window.electronAPI.synthesizeAutoEditNarration(
				cues,
				language,
				voice?.id,
			);
			if (run !== generation.current) return;
			if (!result.success || !result.clips) throw new Error(result.error);
			// The voice returns no clip for a part with nothing in it that it can say.
			const clips = cues.flatMap((cue) => {
				const clip = result.clips?.find((candidate) => candidate.id === cue.id);
				return clip ? [{ audioPath: clip.audioPath, durationMs: clip.durationMs }] : [];
			});
			if (!clips.length)
				throw new Error(
					t(
						"editor.textToSpeech.nothingSpoken",
						"The voice could not say any of this text.",
					),
				);
			const placed = addClips(clips, CLIP_GAP_MS) ?? [];
			if (!placed.length)
				throw new Error(
					t(
						"editor.textToSpeech.noRoom",
						"There is no room for the voice at the playhead. Move the playhead or free an audio track.",
					),
				);
			const notes = [
				cues.length > clips.length &&
					t(
						"editor.textToSpeech.skipped",
						"{{count}} part(s) had nothing the voice could say and were skipped.",
						{ count: cues.length - clips.length },
					),
				clips.length > placed.length &&
					t(
						"editor.textToSpeech.notPlaced",
						"{{count}} part(s) did not fit before the end of the video.",
						{ count: clips.length - placed.length },
					),
				placed.some((clip) => clip.trimmed) &&
					t("editor.textToSpeech.trimmed", "The voice was cut where the video ends."),
			].filter(Boolean);
			const added = t("editor.textToSpeech.added", "Voice added to the timeline");
			if (notes.length) toast.warning(added, { description: notes.join(" ") });
			else toast.success(added);
			setText("");
			onOpenChange(false);
		} catch (e) {
			if (run === generation.current)
				setError(
					`${t("editor.textToSpeech.error", "Could not make the voice:")} ${e instanceof Error ? e.message : ""}`,
				);
		} finally {
			if (run === generation.current) setBusy(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>{t("editor.textToSpeech.title", "Text to speech")}</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						{t(
							"editor.textToSpeech.description",
							"Type what the voice should say. It is added to the timeline at the playhead, one clip per paragraph.",
						)}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<textarea
						value={text}
						onChange={(event) => setText(event.target.value)}
						maxLength={MAX_SPEECH_TEXT_CHARS}
						rows={7}
						disabled={busy === "generate"}
						aria-label={t("editor.textToSpeech.textLabel", "Text")}
						placeholder={t(
							"editor.textToSpeech.placeholder",
							"Type or paste what the voice should say…",
						)}
						className="w-full resize-y rounded-lg border border-separator bg-background p-3 text-sm text-foreground"
					/>
					<div className="flex justify-between text-xs text-muted-foreground">
						<span>
							{segments.length > 1 &&
								t("editor.textToSpeech.parts", "{{count}} clips", {
									count: segments.length,
								})}
						</span>
						<span className="tabular-nums">
							{text.length} / {MAX_SPEECH_TEXT_CHARS}
						</span>
					</div>
					<div className="flex flex-wrap items-center gap-3 text-sm">
						<label className="flex items-center gap-2">
							{t("editor.textToSpeech.language", "Language")}
							<select
								value={language}
								onChange={(event) =>
									setPickedLanguage(event.target.value as Language)
								}
								disabled={!!busy}
								className={selectClass}
							>
								<option value="zh">
									{t("editor.textToSpeech.chinese", "Chinese")}
								</option>
								<option value="en">
									{t("editor.textToSpeech.english", "English")}
								</option>
							</select>
						</label>
						{voices.length > 0 && (
							<>
								<label className="flex items-center gap-2">
									{t("editor.textToSpeech.voice", "Voice")}
									<select
										value={voice?.id}
										onChange={(event) =>
											chooseVoice(Number(event.target.value))
										}
										disabled={!!busy}
										className={selectClass}
									>
										{voices.map((candidate) => (
											<option key={candidate.id} value={candidate.id}>
												{candidate.labels[labelLanguage]}
											</option>
										))}
									</select>
								</label>
								<Button
									variant="secondary"
									size="sm"
									disabled={!!busy || !installed}
									onClick={() => void preview()}
								>
									{busy === "preview"
										? t("editor.textToSpeech.previewing", "Loading the voice…")
										: t("editor.textToSpeech.preview", "Preview voice")}
								</Button>
							</>
						)}
					</div>
					{status && !installed && (
						<p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-sm">
							{t(
								"editor.textToSpeech.notInstalled",
								"The offline voice is not installed. Install the complete offline package, or run npm run prepare:offline-tts on a development machine.",
							)}
						</p>
					)}
					{installed && status?.engine === "vits" && (
						<p className="text-xs text-muted-foreground">
							{t(
								"editor.textToSpeech.olderVoice",
								"This is the older voice: it reads one language per line and skips English words in Chinese text.",
							)}
						</p>
					)}
					{!hasVideo && (
						<p className="text-sm text-muted-foreground">
							{t("editor.textToSpeech.noVideo", "Open a video first.")}
						</p>
					)}
					{tooMany && (
						<p className="text-sm text-destructive">
							{t(
								"editor.textToSpeech.tooMany",
								"The text has too many paragraphs. Keep it to {{max}} or fewer.",
								{ max: MAX_SEGMENTS },
							)}
						</p>
					)}
					{error && <p className="text-sm text-destructive">{error}</p>}
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => (busy ? stop() : changeOpen(false))}>
						{t("common.actions.cancel", "Cancel")}
					</Button>
					<Button
						disabled={!installed || !hasVideo || !segments.length || tooMany || !!busy}
						onClick={() => void generate()}
					>
						{busy === "generate"
							? t("editor.textToSpeech.generating", "Making the voice…")
							: t("editor.textToSpeech.add", "Add to timeline")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
