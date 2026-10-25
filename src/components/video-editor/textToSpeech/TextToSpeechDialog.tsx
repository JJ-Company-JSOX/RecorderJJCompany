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
import { SpeechAudioPreview } from "./SpeechAudioPreview";

type TtsStatus = Awaited<ReturnType<typeof window.electronAPI.getBundledTtsStatus>>;
type Language = "zh" | "en";

/** Pause between the clips of one text, about the gap between narration lines. */
const CLIP_GAP_MS = 250;
type SpeechClip = { audioPath: string; durationMs: number };
type GeneratedSpeech = { key: string; clips: SpeechClip[]; skipped: number };

const selectClass =
	"rounded-lg border border-separator bg-background px-2 py-1.5 text-sm text-foreground";

/**
 * Previews typed text with the bundled offline voice and adds it at a chosen timeline time,
 * one clip per paragraph, without analyzing the video or regenerating just to change placement.
 */
export function TextToSpeechDialog({
	open,
	onOpenChange,
	hasVideo,
	sourceKey,
	initialStartMs,
	durationMs,
	addClips,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	hasVideo: boolean;
	sourceKey: string | null;
	initialStartMs: number;
	durationMs: number;
	addClips: (
		clips: SpeechClip[],
		gapMs: number,
		startMs: number,
	) => PlacedAudioClip[] | undefined;
}) {
	const { t, locale } = useI18n();
	const [text, setText] = useState("");
	const [pickedLanguage, setPickedLanguage] = useState<Language | null>(null);
	const [status, setStatus] = useState<TtsStatus | null>(null);
	const [statusError, setStatusError] = useState(false);
	const [statusRetry, setStatusRetry] = useState(0);
	const [voiceChoice, setVoiceChoice] = useState(savedVoiceChoice);
	const [busy, setBusy] = useState<"preview" | "generate" | null>(null);
	const [error, setError] = useState("");
	const [insertSeconds, setInsertSeconds] = useState("0");
	const [allowTrim, setAllowTrim] = useState(false);
	const [speech, setSpeech] = useState<GeneratedSpeech | null>(null);
	const [previewSpeech, setPreviewSpeech] = useState<(GeneratedSpeech & { run: number }) | null>(
		null,
	);
	const generation = useRef(0);
	const player = useRef<AudioContext | null>(null);
	const pending = useRef(false);
	useEffect(() => {
		if (!open) {
			setPreviewSpeech(null);
			return;
		}
		// Opening the dialog at the end should not launch an expensive job that cannot be placed.
		const startMs = initialStartMs >= durationMs ? 0 : Math.max(0, initialStartMs);
		setInsertSeconds(String(startMs / 1000));
		setAllowTrim(false);
	}, [open, sourceKey, initialStartMs, durationMs]);
	useEffect(() => {
		setSpeech(null);
		setPreviewSpeech(null);
	}, [sourceKey]);

	useEffect(() => {
		if (!open) return;
		let active = true;
		setError("");
		setStatus(null);
		setStatusError(false);
		void window.electronAPI
			.getBundledTtsStatus()
			.then((next) => {
				if (active) setStatus(next);
			})
			.catch(() => {
				if (active) setStatusError(true);
			});
		return () => {
			active = false;
		};
	}, [open, statusRetry]);
	useEffect(
		() => () => {
			generation.current++;
			closePlayer(player.current);
			if (pending.current) void window.electronAPI.cancelAutoEditAnalysis?.();
		},
		[sourceKey],
	);

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
	// Placement is independent of the synthesis cache: changing the time never reloads the model.
	const speechKey = JSON.stringify([language, voice?.id, segments]);
	const generated = speech?.key === speechKey ? speech : null;
	const startMs = Math.round(Number(insertSeconds) * 1000);
	const validPosition =
		insertSeconds.trim() !== "" &&
		Number.isFinite(startMs) &&
		startMs >= 0 &&
		startMs < durationMs;
	const availableMs = validPosition ? durationMs - startMs : 0;
	const voiceDurationMs = generated
		? generated.clips.reduce((sum, clip) => sum + clip.durationMs, 0) +
			Math.max(0, generated.clips.length - 1) * CLIP_GAP_MS
		: 0;
	const needsTrim = !!generated && voiceDurationMs > availableMs;
	const changePosition = (value: string) => {
		setInsertSeconds(value);
		setAllowTrim(false);
		setError("");
	};
	useEffect(() => {
		setAllowTrim(false);
		setPreviewSpeech(null);
		setError("");
		closePlayer(player.current);
	}, [speechKey]);

	const chooseVoice = (id: number) => {
		const next = { ...voiceChoice, [language]: id };
		setVoiceChoice(next);
		saveVoiceChoice(next);
	};
	const stop = () => {
		generation.current++;
		void window.electronAPI.cancelAutoEditAnalysis?.();
		closePlayer(player.current);
		setPreviewSpeech(null);
	};
	const changeOpen = (next: boolean) => {
		if (!next) {
			if (busy) stop();
			closePlayer(player.current);
			setPreviewSpeech(null);
		}
		onOpenChange(next);
	};
	const makeSpeech = async (run: number): Promise<GeneratedSpeech | null> => {
		if (generated) return generated;
		const cues = segments.map((segment, index) => ({ id: `tts-${index + 1}`, text: segment }));
		const result = await window.electronAPI.synthesizeAutoEditNarration(
			cues,
			language,
			voice?.id,
		);
		if (run !== generation.current) return null;
		if (!result.success || !result.clips) throw new Error(result.error);
		const clips = cues.flatMap((cue) => {
			const clip = result.clips?.find((candidate) => candidate.id === cue.id);
			return clip ? [{ audioPath: clip.audioPath, durationMs: clip.durationMs }] : [];
		});
		if (!clips.length)
			throw new Error(
				t("editor.textToSpeech.nothingSpoken", "The voice could not say any of this text."),
			);
		const next = { key: speechKey, clips, skipped: cues.length - clips.length };
		setSpeech(next);
		return next;
	};

	const preview = async () => {
		if (pending.current || !installed || tooMany) return;
		pending.current = true;
		const run = ++generation.current;
		setBusy("preview");
		setError("");
		closePlayer(player.current);
		setPreviewSpeech(null);
		try {
			if (segments.length) {
				const next = await makeSpeech(run);
				if (next && run === generation.current) setPreviewSpeech({ ...next, run });
				return;
			}
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
			pending.current = false;
			setBusy(null);
		}
	};

	const generate = async () => {
		if (
			pending.current ||
			!installed ||
			!hasVideo ||
			!segments.length ||
			tooMany ||
			!validPosition
		)
			return;
		pending.current = true;
		closePlayer(player.current);
		setPreviewSpeech(null);
		const run = ++generation.current;
		setBusy("generate");
		setError("");
		try {
			const next = await makeSpeech(run);
			if (!next || run !== generation.current) return;
			const { clips } = next;
			const requiredMs =
				clips.reduce((sum, clip) => sum + clip.durationMs, 0) +
				Math.max(0, clips.length - 1) * CLIP_GAP_MS;
			// Let the user choose an earlier time or explicitly accept truncation before editing.
			if (requiredMs > availableMs && !allowTrim) {
				setPreviewSpeech({ ...next, run });
				return;
			}
			const placed = addClips(clips, CLIP_GAP_MS, startMs) ?? [];
			if (!placed.length) {
				setError(
					t(
						"editor.textToSpeech.noRoom",
						"The voice is ready, but could not be added here. Choose an earlier insertion time and try again; the voice will be reused.",
					),
				);
				return;
			}
			const notes = [
				next.skipped > 0 &&
					t(
						"editor.textToSpeech.skipped",
						"{{count}} part(s) had nothing the voice could say and were skipped.",
						{ count: next.skipped },
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
			setSpeech(null);
			setPreviewSpeech(null);
			onOpenChange(false);
		} catch (e) {
			if (run === generation.current)
				setError(
					`${t("editor.textToSpeech.error", "Could not make the voice:")} ${e instanceof Error ? e.message : ""}`,
				);
		} finally {
			pending.current = false;
			setBusy(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{t("editor.textToSpeech.title", "Text to Audio")}</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						{t(
							"editor.textToSpeech.description",
							"Type and preview your text, then choose where to add it. Each paragraph becomes an editable audio clip.",
						)}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<textarea
						value={text}
						onChange={(event) => setText(event.target.value)}
						maxLength={MAX_SPEECH_TEXT_CHARS}
						rows={5}
						disabled={!!busy}
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
									disabled={!!busy || !installed || tooMany}
									onClick={() => void preview()}
								>
									{busy === "preview"
										? t("editor.textToSpeech.previewing", "Loading the voice…")
										: segments.length
											? t("editor.textToSpeech.previewText", "Preview text")
											: t("editor.textToSpeech.preview", "Preview voice")}
								</Button>
							</>
						)}
					</div>
					{open && previewSpeech?.key === speechKey && (
						<SpeechAudioPreview
							key={`${speechKey}:${previewSpeech.run}`}
							clips={previewSpeech.clips}
						/>
					)}
					{hasVideo && (
						<div className="space-y-2 rounded-lg border border-separator p-3 text-sm">
							<div className="flex flex-wrap items-center gap-2">
								<label className="flex items-center gap-2">
									{t("editor.textToSpeech.insertTime", "Insert at (seconds)")}
									<input
										type="number"
										min={0}
										max={durationMs / 1000}
										step={0.001}
										value={insertSeconds}
										disabled={!!busy}
										onChange={(event) => changePosition(event.target.value)}
										className={`${selectClass} w-24 tabular-nums`}
									/>
								</label>
								<Button
									variant="secondary"
									size="sm"
									disabled={!!busy}
									onClick={() => changePosition("0")}
								>
									{t("editor.textToSpeech.useStart", "Use video start")}
								</Button>
							</div>
							{initialStartMs >= durationMs && startMs === 0 && (
								<p className="text-muted-foreground">
									{t(
										"editor.textToSpeech.endToStart",
										"The playhead is at the end. Insertion has been set to the start.",
									)}
								</p>
							)}
							<p className="text-muted-foreground">
								{t(
									"editor.textToSpeech.availableTime",
									"Available before video ends: {{seconds}} s",
									{ seconds: (availableMs / 1000).toFixed(2) },
								)}
							</p>
							{!validPosition && (
								<p role="alert" className="text-destructive">
									{t(
										"editor.textToSpeech.invalidTime",
										"Choose a time before the end of the video.",
									)}
								</p>
							)}
							{needsTrim && (
								<div className="space-y-2">
									<p role="status" className="text-amber-500">
										{t(
											"editor.textToSpeech.tooLong",
											"The voice needs {{seconds}} s. Choose an earlier time, shorten the text, or allow trimming.",
											{ seconds: (voiceDurationMs / 1000).toFixed(2) },
										)}
									</p>
									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											checked={allowTrim}
											disabled={!!busy}
											onChange={(event) => setAllowTrim(event.target.checked)}
										/>
										{t(
											"editor.textToSpeech.allowTrim",
											"Trim voice at video end",
										)}
									</label>
								</div>
							)}
						</div>
					)}
					{status && !installed && (
						<p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-sm">
							{t(
								"editor.textToSpeech.notInstalled",
								"The offline voice is not installed. Install the complete offline package, or run npm run prepare:offline-tts on a development machine.",
							)}
						</p>
					)}
					{!status && (
						<p role="status" className="text-sm text-muted-foreground">
							{statusError
								? t(
										"editor.textToSpeech.statusFailed",
										"Could not check offline voices. Try again.",
									)
								: t("editor.textToSpeech.checking", "Checking offline voices…")}
						</p>
					)}
					<Button
						variant="ghost"
						size="sm"
						disabled={!!busy}
						onClick={() => setStatusRetry((value) => value + 1)}
					>
						{t("editor.textToSpeech.recheck", "Recheck voices")}
					</Button>
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
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => (busy ? stop() : changeOpen(false))}>
						{t("common.actions.cancel", "Cancel")}
					</Button>
					<Button
						disabled={
							!installed ||
							!hasVideo ||
							!segments.length ||
							tooMany ||
							!!busy ||
							!validPosition ||
							(needsTrim && !allowTrim)
						}
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
