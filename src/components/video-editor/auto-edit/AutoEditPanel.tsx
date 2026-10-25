import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { projectCaptionCues } from "../captionTimeline";
import { type AudioRegion, type CursorTelemetryPoint, mapTimelineTimeToSourceTime } from "../types";
import { applyEditPlan } from "./apply";
import {
	AiModeSettings,
	aiModeCopy,
	savedAiProvider,
	saveAiProvider,
	type AiProvider,
	type OllamaModel,
} from "./AiModeSettings";
import { BUNDLED_MODEL_ID, type BundledAiStatus } from "./bundledTypes";
import { guideMessages } from "./guideMessages";
import { interfaceMessages } from "./interfaceMessages";
import { messages, type PlanLanguage } from "./messages";
import type { NarrationDraft } from "./narration";
import { narrationBaselineFor } from "./narrationBaseline";
import { narrationCaptions } from "./narrationCaptions";
import { narrationMessages } from "./narrationMessages";
import { narrationMoments, scheduleNarration } from "./narrationMoments";
import { OfflineToolsPanel } from "./OfflineToolsPanel";
import {
	baselineFor,
	buildEditPlan,
	type Decision,
	type EditPlan,
	type EditState,
	type EditSuggestion,
} from "./plan";
import { readinessMessages } from "./readinessMessages";
import { addSpeechSuggestions } from "./speechPlan";
import { speedMessages } from "./speedMessages";
import { buildTextCutPlan, textLines } from "./textCuts";
import { addVisualSuggestions } from "./vision";
import { visionMessages } from "./visionMessages";
import { TaskWaitStatus, useTaskTiming } from "./TaskWaitStatus";
import { workloadBucket } from "./taskTiming";
import { wizardMessages } from "./wizardMessages";

/** Spoken language is independent from the editing interface language. */
type RecognitionLanguage = "auto" | "zh" | "en" | "ms";
const RECOGNITION_LANGUAGE_SETTING = "recordly.autoEdit.recognitionLanguage";
const EDIT_MODE_SETTING = "recordly.autoEdit.mode";
type EditMode = "fast" | "speech" | "full";
type AnalysisStage = "media" | "transcribe" | "understand" | "vision";
function savedEditMode(): EditMode {
	const mode = loadAppSetting<unknown>(EDIT_MODE_SETTING);
	return mode === "speech" || mode === "full" ? mode : "fast";
}
function savedRecognitionLanguage(): RecognitionLanguage {
	const saved = loadAppSetting<unknown>(RECOGNITION_LANGUAGE_SETTING);
	return saved === "zh" || saved === "en" || saved === "ms" ? saved : "auto";
}

/** The narration voice chosen for each language, remembered across sessions. */
const VOICE_SETTING = "recordly.narrationVoice";
function savedVoiceChoice(): Partial<Record<PlanLanguage, number>> {
	const saved = loadAppSetting<unknown>(VOICE_SETTING);
	if (!saved || typeof saved !== "object") return {};
	return Object.fromEntries(
		Object.entries(saved).filter(
			([language, id]) => ["zh", "en", "ms"].includes(language) && Number.isInteger(id),
		),
	);
}

/** Stops a voice preview; closing an already closed player would reject. */
function closePlayer(player: AudioContext | null) {
	if (player && player.state !== "closed") void player.close().catch(() => undefined);
}

export const AutoEditPanel = memo(function AutoEditPanel({
	open,
	state,
	source,
	cursor,
	onApply,
	onSeek,
}: {
	open: boolean;
	state: EditState;
	source: string;
	cursor: CursorTelemetryPoint[];
	/** `seekSeconds`: where to put the playhead afterwards (default: the start). */
	onApply: (next: EditState, seekSeconds?: number) => void;
	onSeek: (seconds: number) => void;
}) {
	const { locale } = useI18n();
	const [language, setLanguage] = useState<PlanLanguage>(locale.startsWith("zh") ? "zh" : "en");
	const [recognitionLanguage, setRecognitionLanguage] =
		useState<RecognitionLanguage>(savedRecognitionLanguage);
	const m = messages[language];
	const ui = interfaceMessages[language];
	const v = visionMessages[language];
	const n = narrationMessages[language];
	const g = guideMessages[language];
	const w = wizardMessages[language];
	const setup = readinessMessages[language];
	const speed = speedMessages[language];
	const [provider, setProvider] = useState<AiProvider>(savedAiProvider);
	const [ollamaModel, setOllamaModel] = useState<OllamaModel | null>(null);
	const aiMode = aiModeCopy(language);
	const [editMode, setEditMode] = useState<EditMode>(() =>
		savedAiProvider() === "ollama" ? "fast" : savedEditMode(),
	);
	const [progress, setProgress] = useState({ completed: 0, total: 8 });
	const [plan, setPlan] = useState<EditPlan | null>(null);
	const [decisions, setDecisions] = useState<Record<string, Decision>>({});
	const [busy, setBusy] = useState<
		| "analysis"
		| "review"
		| "narrate"
		| "synthesize"
		| "preview"
		| "vision"
		| "tools"
		| "translate"
		| null
	>(null);
	const [error, setError] = useState("");
	const taskTiming = useTaskTiming();
	const [silentFallback, setSilentFallback] = useState(false);
	const [applied, setApplied] = useState(false);
	const [narrationDraft, setNarrationDraft] = useState<NarrationDraft | null>(null);
	const [narrationEdits, setNarrationEdits] = useState<Record<string, string>>({});
	const [narrationApproved, setNarrationApproved] = useState(false);
	const [narrationAudioReady, setNarrationAudioReady] = useState(false);
	const [narrationStyle, setNarrationStyle] = useState<"concise" | "tutorial" | "detailed">(
		"tutorial",
	);
	const [narrationBaseline, setNarrationBaseline] = useState<string | null>(null);
	const [narrationReport, setNarrationReport] = useState<{
		dropped: number;
		skipped: number;
		unspoken: number;
	} | null>(null);
	const [ttsStatus, setTtsStatus] = useState<Awaited<
		ReturnType<Window["electronAPI"]["getBundledTtsStatus"]>
	> | null>(null);
	const [voiceChoice, setVoiceChoice] = useState(savedVoiceChoice);
	const previewPlayer = useRef<AudioContext | null>(null);
	const [narrationLanguage, setNarrationLanguage] = useState<PlanLanguage>("zh");
	const [bundledStatus, setBundledStatus] = useState<BundledAiStatus | null>(null);
	const [keepFullFrame, setKeepFullFrame] = useState(false);
	const [speechStatus, setSpeechStatus] = useState<Awaited<
		ReturnType<Window["electronAPI"]["getBundledSpeechStatus"]>
	> | null>(null);
	const [statusChecking, setStatusChecking] = useState(true);
	const [statusCheckFailed, setStatusCheckFailed] = useState(false);
	const [statusRevision, setStatusRevision] = useState(0);
	const [autoApply, setAutoApply] = useState(true);
	const [speechStage, setSpeechStage] = useState("");
	const [stages, setStages] = useState<AnalysisStage[]>(["media"]);
	const [summary, setSummary] = useState<{
		cuts: number;
		speedUps: number;
		zooms: number;
		captions: number;
		savedMs: number;
	} | null>(null);
	const [undoState, setUndoState] = useState<{
		before: EditState;
		afterBaseline: string | null;
	} | null>(null);
	const [undone, setUndone] = useState(false);
	const [voiceOpen, setVoiceOpen] = useState(false);
	const [textOpen, setTextOpen] = useState(false);
	const [textDeleted, setTextDeleted] = useState<string[]>([]);
	const [translateTarget, setTranslateTarget] = useState<PlanLanguage>("en");
	const [translated, setTranslated] = useState(0);
	const resultAnchor = useRef<HTMLDivElement>(null);
	const progressAnchor = useRef<HTMLDivElement>(null);
	const errorAnchor = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (error) errorAnchor.current?.scrollIntoView({ block: "nearest" });
	}, [error]);
	useEffect(() => {
		if (busy) progressAnchor.current?.scrollIntoView({ block: "nearest" });
	}, [busy]);
	useEffect(() => {
		if (applied || plan) resultAnchor.current?.scrollIntoView({ block: "start" });
	}, [applied, plan]);
	useEffect(() => {
		setUndoState((current) =>
			current && current.afterBaseline === null
				? { ...current, afterBaseline: baselineFor(state, source) }
				: current,
		);
	}, [state, source]);
	const currentState = useRef({ state, source });
	currentState.current = { state, source };
	// Review mode applies accepted suggestions straight away, always from the state the plan was made on.
	const liveBase = useRef<EditState | null>(null);
	const liveBaselines = useRef(new Set<string>());
	const expectLive = useRef(false);
	useEffect(() => {
		if (!expectLive.current) return;
		expectLive.current = false;
		liveBaselines.current.add(baselineFor(state, source));
	}, [state, source]);
	const generation = useRef(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: The revision explicitly reruns metadata checks after the user prepares resources or frees memory.
	useEffect(() => {
		if (!open) return;
		let active = true;
		setStatusChecking(true);
		setStatusCheckFailed(false);
		setSpeechStatus(null);
		setBundledStatus(null);
		void Promise.allSettled([
			Promise.resolve().then(() => window.electronAPI.getBundledAiStatus()),
			Promise.resolve().then(() => window.electronAPI.getBundledSpeechStatus()),
		])
			.then(([ai, speech]) => {
				if (!active) return;
				const aiStatus =
					ai.status === "fulfilled" && typeof ai.value?.available === "boolean"
						? ai.value
						: null;
				const voiceStatus =
					speech.status === "fulfilled" && typeof speech.value?.available === "boolean"
						? speech.value
						: null;
				setBundledStatus(aiStatus);
				setSpeechStatus(voiceStatus);
				setStatusCheckFailed(!aiStatus || !voiceStatus);
			})
			.finally(() => {
				if (active) setStatusChecking(false);
			});
		void window.electronAPI
			.getBundledTtsStatus?.()
			.then((status) => {
				if (active) setTtsStatus(status);
			})
			.catch(() => {
				if (active) setTtsStatus(null);
			});
		return () => {
			active = false;
		};
	}, [open, statusRevision]);
	useEffect(() => window.electronAPI.onAutoEditFrameProgress?.(setProgress), []);
	useEffect(() => window.electronAPI.onCompleteAutoEditProgress?.(setSpeechStage), []);
	// Switching to another sidebar tab keeps work running; leaving the editor cancels it.
	useEffect(
		() => () => {
			generation.current++;
			void window.electronAPI.cancelAutoEditAnalysis?.();
			closePlayer(previewPlayer.current);
		},
		[],
	);
	const currentBaseline = baselineFor(state, source);
	const stale =
		!!plan &&
		plan.baseline !== currentBaseline &&
		!liveBaselines.current.has(currentBaseline) &&
		!expectLive.current;
	const available = plan?.suggestions.filter((s) => !s.blocked) ?? [];
	const pending = available.filter((s) => !decisions[s.id] || decisions[s.id] === "pending");
	const accepted = available.filter((s) => decisions[s.id] === "accept");
	const speechReady = speechStatus?.available;
	const memoryLow =
		!!bundledStatus?.available &&
		bundledStatus.freeMemoryBytes < bundledStatus.requiredMemoryBytes;
	const ready =
		!statusChecking &&
		!statusCheckFailed &&
		!!bundledStatus?.available &&
		!!speechReady &&
		!memoryLow;
	const noVideo = !source || !state.clipRegions.length;
	const unsupported =
		(editMode === "full" && bundledStatus?.reason === "unsupported") ||
		speechStatus?.reason === "unsupported";
	const modeReady =
		provider === "ollama"
			? !!ollamaModel && (editMode === "fast" || (!statusChecking && !!speechReady))
			: editMode === "fast" ||
				(editMode === "speech" ? !statusChecking && !!speechReady : ready);
	const canNarrate = provider === "ollama" ? !!ollamaModel : !!bundledStatus?.available;
	const requiredStatusFailed = editMode === "full" ? statusCheckFailed : !speechStatus;
	const startLabel =
		provider === "ollama"
			? aiMode.start
			: editMode === "fast"
				? speed.startFast
				: editMode === "speech"
					? speed.startSpeech
					: ui.start;
	// The Kokoro Chinese voice also says English words, so on-screen English labels can stay.
	const mixedLanguage = !!ttsStatus?.mixedLanguage;
	// Mirrors the main-process check: each bundled voice can only read its own script.
	const speaks = (text: string) =>
		narrationLanguage === "zh"
			? mixedLanguage
				? /\p{Script=Han}|[A-Za-z]/u.test(text)
				: /\p{Script=Han}/u.test(text)
			: /[A-Za-z]/.test(text) && !/\p{Script=Han}/u.test(text);
	// Emptied lines are skipped; every remaining line must suit the chosen voice.
	const narrationLines = (narrationDraft?.cues ?? [])
		.map((c) => (narrationEdits[c.id] ?? c.text).trim())
		.filter(Boolean);
	const narrationSpeakable = narrationLines.length > 0 && narrationLines.every(speaks);
	const narrationHasLatin =
		narrationLanguage === "zh" &&
		!mixedLanguage &&
		narrationLines.some((line) => /[A-Za-z]/.test(line));
	const voiceInstalled = !!ttsStatus?.voices?.[narrationLanguage];
	// Voices for the draft's language, or for the language the next draft will use.
	const voiceLanguage = narrationDraft ? narrationLanguage : language;
	const voiceOptions = (ttsStatus?.voiceList ?? []).filter((v) => v.language === voiceLanguage);
	const selectedVoice =
		voiceOptions.find((v) => v.id === voiceChoice[voiceLanguage]) ??
		voiceOptions.find((v) => v.default) ??
		voiceOptions[0];
	const chooseVoice = (id: number) => {
		const next = { ...voiceChoice, [voiceLanguage]: id };
		setVoiceChoice(next);
		saveAppSetting(VOICE_SETTING, next);
	};
	const previewVoice = async () => {
		const run = ++generation.current;
		setBusy("preview");
		setError("");
		try {
			const result = await window.electronAPI.previewAutoEditNarrationVoice?.(
				voiceLanguage,
				selectedVoice?.id,
			);
			if (run !== generation.current) return;
			if (!result?.success || !result.samples || !result.sampleRate)
				throw new Error(result?.error);
			closePlayer(previewPlayer.current);
			const context = new AudioContext();
			previewPlayer.current = context;
			const buffer = context.createBuffer(1, result.samples.length, result.sampleRate);
			buffer.copyToChannel(new Float32Array(result.samples), 0);
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(context.destination);
			source.onended = () => closePlayer(context);
			source.start();
		} catch (e) {
			if (run === generation.current)
				setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		} finally {
			if (run === generation.current) setBusy(null);
		}
	};
	const activeStage = stages.findIndex((stage) => stage === speechStage);
	const summarize = (next: EditPlan, choices: Record<string, Decision>) => {
		const selected = next.suggestions.filter((s) => choices[s.id] === "accept");
		const length = (s: EditSuggestion) => s.endMs - s.startMs;
		return {
			cuts: selected.filter((s) => s.kind === "trim").length,
			speedUps: selected.filter((s) => s.kind === "speed").length,
			zooms: selected.filter((s) => s.kind === "zoom").length,
			captions: selected.filter((s) => s.kind === "caption").length,
			savedMs: selected.reduce(
				(total, s) =>
					total +
					(s.kind === "trim"
						? length(s)
						: s.kind === "speed" && s.speed
							? length(s) * (1 - 1 / s.speed)
							: 0),
				0,
			),
		};
	};
	/** Where a plan time lands once the accepted cuts and speed-ups before it are applied. */
	const afterEdits = (choices: Record<string, Decision>, timeMs: number) =>
		(plan?.suggestions ?? []).reduce((result, s) => {
			if (choices[s.id] !== "accept" || (s.kind !== "trim" && s.kind !== "speed"))
				return result;
			const covered = Math.max(0, Math.min(timeMs, s.endMs) - s.startMs);
			return result - covered * (s.kind === "trim" ? 1 : 1 - 1 / (s.speed ?? 1));
		}, timeMs);
	const decide = (choices: Record<string, Decision>, focus?: EditSuggestion) => {
		if (!plan || stale || busy || !liveBase.current) return;
		try {
			const after = applyEditPlan(liveBase.current, source, plan, choices);
			liveBaselines.current.add(baselineFor(after, source));
			expectLive.current = true;
			setDecisions(choices);
			// Jump to the change so the timeline and preview show it right away.
			onApply(after, focus ? afterEdits(choices, focus.startMs) / 1000 : undefined);
			setError("");
		} catch (e) {
			setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		}
	};
	const decideRemaining = (choice: "accept" | "reject") =>
		decide({
			...decisions,
			...Object.fromEntries(
				available
					.filter((s) => !decisions[s.id] || decisions[s.id] === "pending")
					.map((s) => [s.id, choice]),
			),
		});
	const finishReview = () => {
		if (!plan || !liveBase.current) return;
		if (!accepted.length) {
			startOver();
			return;
		}
		setSummary(summarize(plan, decisions));
		setUndoState({ before: liveBase.current, afterBaseline: currentBaseline });
		setTranslated(0);
		setUndone(false);
		setPlan(null);
		setDecisions({});
		setApplied(true);
		liveBase.current = null;
	};
	const applyNow = (next: EditPlan, choices: Record<string, Decision>) => {
		const latest = currentState.current;
		if (baselineFor(latest.state, latest.source) !== next.baseline) throw Error(m.stale);
		const after = applyEditPlan(latest.state, latest.source, next, choices);
		onApply(after);
		setSummary(summarize(next, choices));
		// The editor may normalize the applied state, so record its baseline once it arrives.
		setUndoState({ before: latest.state, afterBaseline: null });
		setTranslated(0);
		setUndone(false);
		setPlan(null);
		setDecisions({});
		setApplied(true);
	};
	// Earlier AI voice-over is replaced, never stacked, and never counts as the user's own work.
	const withoutNarration = (s: EditState): EditState => ({
		...s,
		audioRegions: s.audioRegions.filter((r) => !r.id.startsWith("narration-")),
		autoCaptions: s.autoCaptions.filter((c) => !c.id.startsWith("narration-")),
	});
	/** Timeline spans of real speech (its subtitles), which the AI voice must not talk over. */
	const speechSpans = (s: EditState) =>
		projectCaptionCues(withoutNarration(s).autoCaptions, s.clipRegions).map(
			({ startMs, endMs }) => ({
				startMs,
				endMs,
			}),
		);
	const narrationPlan = (s: EditState): EditPlan => ({
		version: 1,
		id: crypto.randomUUID(),
		coordinateSpace: "timeline-ms",
		baseline: baselineFor(s, source),
		suggestions: narrationMoments(s, cursor, speechSpans(s)),
		warnings: [],
		reviewer: "rules",
	});
	const analyze = async (
		withAi = false,
		withSpeech = false,
		fromSilentVideo = false,
		main = false,
	) => {
		if (provider === "ollama") {
			if (!ollamaModel) {
				setError(aiMode.firstCheck);
				return;
			}
			withAi = false;
		}
		const run = ++generation.current;
		setBusy("analysis");
		setError("");
		setSilentFallback(fromSilentVideo);
		setApplied(false);
		setSpeechStage("media");
		setStages(
			withSpeech
				? withAi
					? ["media", "transcribe", "understand", "vision"]
					: ["media", "transcribe"]
				: withAi
					? ["media", "vision"]
					: provider === "ollama"
						? ["media", "understand"]
						: ["media"],
		);
		setSummary(null);
		setUndone(false);
		setVoiceOpen(false);
		setPlan(null);
		setDecisions({});
		setNarrationDraft(null);
		setNarrationEdits({});
		setNarrationApproved(false);
		setNarrationAudioReady(false);
		try {
			if (!window.electronAPI.analyzeAutoEdit) throw new Error(m.unavailable);
			const complete = withSpeech
				? await window.electronAPI.analyzeCompleteAutoEdit({
						videoPath: source,
						language: recognitionLanguage,
						mode: withAi ? "full" : "speech",
					})
				: undefined;
			if (complete?.errorCode === "NO_AUDIO") {
				if (run !== generation.current) return;
				// A silent recording is edited from the picture: frozen parts, idle parts and clicks.
				return analyze(withAi && !!bundledStatus?.available, false, true, main);
			}
			const result = complete ?? (await window.electronAPI.analyzeAutoEdit(source));
			if (run !== generation.current) return;
			if (!result.success || !result.evidence) throw new Error(result.error);
			let next = buildEditPlan({
				state,
				source,
				evidence: result.evidence,
				cursor,
				id: crypto.randomUUID(),
			});
			if (withSpeech && complete?.speech)
				next = addSpeechSuggestions(next, state, source, complete.speech, {
					cursor,
					staticRanges: result.evidence.staticRanges,
				});
			if (provider === "ollama" && ollamaModel) {
				setBusy("review");
				setSpeechStage("understand");
				const reviewed = await window.electronAPI.reviewAutoEditLocally(
					next,
					ollamaModel.name,
				);
				if (run !== generation.current) return;
				if (!reviewed.success || !reviewed.plan) throw new Error(reviewed.error || m.error);
				next = reviewed.plan;
			}
			if (withAi) {
				setBusy("vision");
				setSpeechStage("vision");
				setProgress({ completed: 0, total: 8 });
				const frames =
					complete ??
					(await window.electronAPI.analyzeAutoEditFrames({
						videoPath: source,
						model: BUNDLED_MODEL_ID,
						count: 8,
					}));
				if (run !== generation.current) return;
				if (!frames.success || !frames.analysis) throw Error(frames.error || m.error);
				next = addVisualSuggestions(next, state, source, frames.analysis);
			}
			if (keepFullFrame)
				next = { ...next, suggestions: next.suggestions.filter((s) => s.kind !== "zoom") };
			// Only offer what can actually be applied; anything that would touch existing work is left out.
			next = { ...next, suggestions: next.suggestions.filter((s) => !s.blocked) };
			if (main && autoApply) {
				// Screen labels can cover controls; preserve them for the review-first workflow.
				next = {
					...next,
					suggestions: next.suggestions.filter(
						(s) => !(s.kind === "annotation" && s.reason === "vision"),
					),
				};
				const choices: Record<string, Decision> = Object.fromEntries(
					next.suggestions.filter((s) => !s.blocked).map((s) => [s.id, "accept"]),
				);
				if (Object.keys(choices).length) {
					applyNow(next, choices);
					return;
				}
			}
			const latest = currentState.current;
			liveBase.current =
				baselineFor(latest.state, latest.source) === next.baseline ? latest.state : null;
			liveBaselines.current = new Set();
			setPlan(next);
		} catch (e) {
			if (run === generation.current)
				setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		} finally {
			if (run === generation.current) setBusy(null);
		}
	};
	const narrateBundled = async () => {
		if (provider === "ollama" && !ollamaModel) {
			setError(aiMode.firstCheck);
			return;
		}
		const voicePlan = narrationPlan(currentState.current.state);
		if (!voicePlan.suggestions.length) return;
		const run = ++generation.current;
		setBusy("narrate");
		taskTiming.start(
			JSON.stringify([
				"draft",
				provider,
				ollamaModel?.name ?? "bundled",
				language,
				narrationStyle,
				workloadBucket(voicePlan.suggestions.length),
			]),
		);
		setError("");
		setProgress({ completed: 0, total: 0 });
		setNarrationApproved(false);
		setNarrationAudioReady(false);
		try {
			const draftLanguage = language;
			const draftState = currentState.current.state;
			const { clipRegions } = draftState;
			// A click is compared before/after its exact time (an AI zoom starts 350 ms before it);
			// other moments are read just after they begin.
			const frames = voicePlan.suggestions.map((s) => {
				const action = !!s.focus && (s.kind === "zoom" || s.reason === "click");
				const atMs = action
					? s.startMs + (s.kind === "zoom" ? 350 : 0)
					: s.startMs + Math.min(500, (s.endMs - s.startMs) / 2);
				return {
					id: s.id,
					timeMs: Math.max(0, mapTimelineTimeToSourceTime(atMs, clipRegions)),
					...(s.focus ? { focus: s.focus } : {}),
					...(action ? { action } : {}),
				};
			});
			const result =
				provider === "ollama" && ollamaModel
					? await window.electronAPI.narrateAutoEditLocally(
							voicePlan,
							ollamaModel.name,
							draftLanguage,
							narrationStyle,
						)
					: await window.electronAPI.narrateAutoEditBundled(voicePlan, draftLanguage, {
							videoPath: source,
							frames,
							style: narrationStyle,
							timelineEndMs: Math.max(1, ...clipRegions.map((c) => c.endMs)),
						});
			if (run !== generation.current) return;
			if (!result.success || !result.draft) throw new Error(result.error);
			if (
				narrationBaselineFor(currentState.current.state, currentState.current.source) !==
				narrationBaselineFor(draftState, source)
			)
				throw Error(n.stale);
			taskTiming.finish(true);
			setNarrationLanguage(draftLanguage);
			setNarrationBaseline(narrationBaselineFor(draftState, source));
			setNarrationReport(null);
			setNarrationDraft(result.draft);
			setNarrationEdits(Object.fromEntries(result.draft.cues.map((c) => [c.id, c.text])));
		} catch (e) {
			if (run === generation.current)
				setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		} finally {
			if (run === generation.current) {
				taskTiming.finish(false);
				setBusy(null);
			}
		}
	};
	const synthesizeNarration = async () => {
		if (!narrationDraft || !narrationApproved) return;
		const run = ++generation.current;
		setBusy("synthesize");
		setError("");
		try {
			const { state: latestState } = currentState.current;
			// Lines were placed on the timeline as it was when drafted.
			if (narrationBaselineFor(latestState, source) !== narrationBaseline)
				throw Error(n.stale);
			const cues = narrationDraft.cues
				.map((cue) => ({ id: cue.id, text: (narrationEdits[cue.id] ?? cue.text).trim() }))
				.filter((cue) => cue.text);
			taskTiming.start(
				JSON.stringify([
					"speech",
					narrationLanguage,
					selectedVoice?.id,
					workloadBucket(cues.reduce((sum, cue) => sum + cue.text.length, 0)),
				]),
			);
			const result = await window.electronAPI.synthesizeAutoEditNarration(
				cues,
				narrationLanguage,
				selectedVoice?.id,
			);
			if (run !== generation.current) return;
			if (!result.success || !result.clips) throw new Error(result.error);
			if (
				narrationBaselineFor(currentState.current.state, currentState.current.source) !==
				narrationBaseline
			)
				throw Error(n.stale);
			taskTiming.finish(true);
			const base = withoutNarration(currentState.current.state);
			const trackIndex = Math.max(-1, ...base.audioRegions.map((r) => r.trackIndex ?? 0)) + 1;
			// Each line waits for the previous one and none runs past the end of the video.
			const { placed, dropped } = scheduleNarration(
				result.clips.flatMap((clip) => {
					const cue = narrationDraft.cues.find((c) => c.id === clip.id);
					return cue ? [{ ...clip, startMs: cue.startMs }] : [];
				}),
				Math.max(0, ...base.clipRegions.map((c) => c.endMs)),
			);
			const regions: AudioRegion[] = placed.map((clip) => ({
				id: `narration-${clip.id}`,
				startMs: clip.startMs,
				endMs: clip.endMs,
				audioPath: clip.audioPath,
				volume: 1,
				normalize: false,
				trackIndex,
			}));
			// Silent recordings have no subtitles; the approved narration lines become them,
			// timed by when each piece is actually spoken.
			const captions = narrationCaptions(
				base,
				regions,
				cues,
				Object.fromEntries(
					placed.flatMap((clip) => (clip.chunks ? [[clip.id, clip.chunks]] : [])),
				),
			);
			onApply({
				...base,
				audioRegions: [...base.audioRegions, ...regions],
				autoCaptions: [...base.autoCaptions, ...captions.cues],
			});
			setNarrationBaseline(narrationBaselineFor(base, source));
			setNarrationReport({
				dropped: dropped.length,
				skipped: captions.skipped,
				// The voice returns no clip for a line with nothing in it that it can say.
				unspoken: cues.length - result.clips.length,
			});
			setNarrationApproved(false);
			setNarrationAudioReady(true);
		} catch (e) {
			if (run === generation.current)
				setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		} finally {
			if (run === generation.current) {
				taskTiming.finish(false);
				setBusy(null);
			}
		}
	};
	const stepIndex = voiceOpen
		? 3
		: applied || plan || textOpen
			? 2
			: busy === "analysis" || busy === "vision"
				? 1
				: 0;
	const showStart =
		!plan && !applied && !voiceOpen && !textOpen && busy !== "analysis" && busy !== "vision";
	const lines = textLines(state);
	const openTextEdit = () => {
		setTextDeleted([]);
		setVoiceOpen(false);
		setTextOpen(true);
	};
	const cutText = () => {
		const next = buildTextCutPlan(state, source, textDeleted, crypto.randomUUID());
		const choices: Record<string, Decision> = Object.fromEntries(
			next.suggestions.filter((s) => !s.blocked).map((s) => [s.id, "accept"]),
		);
		if (!Object.keys(choices).length) return;
		try {
			applyNow(next, choices);
			setSilentFallback(false);
			setTextOpen(false);
		} catch (e) {
			setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		}
	};
	const canUndoRun =
		!!undoState && !undone && undoState.afterBaseline === baselineFor(state, source);
	// Moments already avoid real speech, so a narrated recording only gets lines in its pauses.
	const voiceActions = narrationPlan(state).suggestions.length;
	const translateText = async () => {
		const before = currentState.current.state;
		const lines = before.autoCaptions
			.filter((c) => c.text.trim() && c.text.length <= 300)
			.map((c) => ({ id: c.id, text: c.text }));
		if (!lines.length || !window.electronAPI.translateAutoEditSubtitles) return;
		const run = ++generation.current;
		setBusy("translate");
		setError("");
		setProgress({ completed: 0, total: 0 });
		try {
			const result = await window.electronAPI.translateAutoEditSubtitles(
				lines,
				translateTarget,
			);
			if (run !== generation.current) return;
			if (!result.success || !result.lines) throw new Error(result.error);
			const byId = new Map(result.lines.map((l) => [l.id, l.text]));
			const latest = currentState.current.state;
			if (baselineFor(latest, source) !== baselineFor(before, source)) throw Error(m.stale);
			// Word timings belong to the original words, so translated lines show as whole lines.
			onApply({
				...latest,
				autoCaptions: latest.autoCaptions.map((c) => {
					const text = byId.get(c.id);
					return text ? { id: c.id, startMs: c.startMs, endMs: c.endMs, text } : c;
				}),
			});
			setUndoState({ before, afterBaseline: null });
			setUndone(false);
			setSummary(null);
			setSilentFallback(false);
			setTranslated(textLines(latest).filter((l) => byId.has(l.id)).length);
			setTextOpen(false);
			setApplied(true);
		} catch (e) {
			if (run === generation.current)
				setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		} finally {
			if (run === generation.current) setBusy(null);
		}
	};
	const startOver = () => {
		generation.current++;
		setPlan(null);
		setDecisions({});
		setApplied(false);
		setSummary(null);
		setVoiceOpen(false);
		setTextOpen(false);
		setTranslated(0);
		setSilentFallback(false);
		setError("");
	};
	return (
		<section
			data-auto-edit-panel
			hidden={!open}
			className="flex h-full min-h-0 flex-col"
			aria-label={m.title}
		>
			<header className="shrink-0 border-b border-separator px-4 py-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<h2 className="text-base font-semibold">{ui.title}</h2>
						<p className="mt-0.5 text-xs text-muted-foreground">
							<span
								aria-hidden="true"
								className={`mr-1.5 inline-block size-2 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`}
							/>
							{modeReady
								? ui.ready
								: statusChecking
									? ui.checking
									: setup.unavailable}{" "}
							· {ui.badge}
						</p>
					</div>
					<select
						aria-label="Plan language"
						value={language}
						onChange={(e) => setLanguage(e.target.value as PlanLanguage)}
						className="rounded-lg border border-separator bg-background px-2 py-1.5 text-sm text-foreground"
					>
						<option value="zh">中文</option>
						<option value="en">English</option>
						<option value="ms">Bahasa Melayu</option>
					</select>
				</div>
				<ol
					className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
					data-edit-workflow
				>
					{w.steps.map((step, index) => (
						<li
							key={step}
							aria-current={index === stepIndex ? "step" : undefined}
							className={`flex items-center gap-1.5 ${index === stepIndex ? "font-semibold text-foreground" : index < stepIndex ? "text-primary" : "text-muted-foreground"}`}
						>
							<span
								className={`flex size-5 items-center justify-center rounded-full text-[11px] ${index === stepIndex ? "bg-primary text-white" : index < stepIndex ? "bg-primary/15" : "bg-muted"}`}
							>
								{index < stepIndex ? "✓" : index + 1}
							</span>
							{step}
							{index === 3 && (
								<span className="text-muted-foreground">({w.optionalStep})</span>
							)}
							{index < w.steps.length - 1 && (
								<span aria-hidden="true" className="mx-0.5 h-px w-3 bg-separator" />
							)}
						</li>
					))}
				</ol>
			</header>
			<div
				data-auto-edit-scroll
				className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
			>
				{showStart && (
					<section className="space-y-4" aria-label={m.offlineTitle}>
						<div>
							<h3 className="text-base font-semibold">{w.chooseTitle}</h3>
							<p className="text-xs text-muted-foreground">
								{editMode === "full"
									? w.chooseHelp
									: editMode === "fast"
										? speed.fastHelp
										: speed.speechHelp}
							</p>
						</div>
						<Button
							className="min-h-12 w-full text-base font-semibold"
							aria-label={
								provider === "builtin" && editMode === "full"
									? m.completeEdit
									: startLabel
							}
							disabled={!!busy || !modeReady || noVideo}
							onClick={() =>
								void analyze(editMode === "full", editMode !== "fast", false, true)
							}
						>
							{startLabel}
						</Button>
						{modeReady && (
							<p className="text-center text-xs text-muted-foreground">
								{ui.actionHelp}
							</p>
						)}
						<AiModeSettings
							language={language}
							provider={provider}
							modelInfo={ollamaModel}
							disabled={!!busy}
							onModel={setOllamaModel}
							onProvider={(value) => {
								generation.current++;
								setProvider(value);
								saveAiProvider(value);
								setOllamaModel(null);
								setEditMode("fast");
								saveAppSetting(EDIT_MODE_SETTING, "fast");
								setError("");
							}}
						/>
						<label className="flex flex-col gap-2 text-sm">
							<span>{speed.mode}</span>
							<select
								aria-label={speed.mode}
								value={editMode}
								disabled={!!busy}
								className="w-full rounded-lg border border-separator bg-background px-3 py-2 text-foreground"
								onChange={(event) => {
									const value = event.target.value;
									if (value !== "fast" && value !== "speech" && value !== "full")
										return;
									setEditMode(value);
									saveAppSetting(EDIT_MODE_SETTING, value);
								}}
							>
								<option value="fast">{speed.fast}</option>
								<option value="speech">{speed.speech}</option>
								{provider === "builtin" && (
									<option value="full">{speed.full}</option>
								)}
							</select>
							{editMode === "full" && (
								<span className="text-xs text-muted-foreground">
									{speed.fullHelp}
								</span>
							)}
						</label>
						{(!modeReady || noVideo) && (
							<div
								data-auto-edit-readiness
								role="status"
								aria-live="polite"
								className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
							>
								{provider === "ollama" && !ollamaModel ? (
									<p>{aiMode.firstCheck}</p>
								) : statusChecking ? (
									<p>{ui.checking}</p>
								) : requiredStatusFailed ? (
									<p>{setup.checkFailed}</p>
								) : unsupported ? (
									<p>{setup.unsupported}</p>
								) : (
									<>
										{editMode === "full" && !bundledStatus?.available && (
											<p>{m.offlineMissing}</p>
										)}
										{!speechReady && <p>{m.speechMissing}</p>}
										{editMode === "full" && memoryLow && (
											<p>{setup.memoryLow}</p>
										)}
									</>
								)}
								{noVideo && <p>{setup.noVideo}</p>}
								{!statusChecking &&
									!requiredStatusFailed &&
									!unsupported &&
									((editMode === "full" && !bundledStatus?.available) ||
										!speechReady) && (
										<p className="text-xs text-muted-foreground">
											{setup.setup}
										</p>
									)}
								<Button
									variant="secondary"
									disabled={!!busy || statusChecking}
									onClick={() => setStatusRevision((revision) => revision + 1)}
								>
									{setup.recheck}
								</Button>
								{!noVideo && (
									<>
										<Button
											variant="secondary"
											className="w-full"
											disabled={!!busy}
											onClick={() => void analyze()}
										>
											{setup.local}
										</Button>
										<p className="text-xs text-muted-foreground">
											{setup.localHelp}
										</p>
									</>
								)}
							</div>
						)}
						{editMode !== "fast" && (
							<label className="flex flex-col gap-2 text-sm">
								<span>{ui.recognitionLanguage}</span>
								<select
									value={recognitionLanguage}
									aria-label={ui.recognitionLanguage}
									disabled={!!busy}
									onChange={(event) => {
										const value = event.target.value;
										if (
											value !== "auto" &&
											value !== "zh" &&
											value !== "en" &&
											value !== "ms"
										)
											return;
										setRecognitionLanguage(value);
										saveAppSetting(RECOGNITION_LANGUAGE_SETTING, value);
									}}
									className="w-full rounded-lg border border-separator bg-background px-3 py-2 text-foreground"
								>
									<option value="auto">{ui.detectLanguage}</option>
									<option value="zh">中文</option>
									<option value="en">English</option>
									<option value="ms">Bahasa Melayu</option>
								</select>
								<span className="text-xs text-muted-foreground">
									{ui.recognitionLanguageHelp}
								</span>
							</label>
						)}
						<div className="grid grid-cols-1 gap-3">
							<label
								className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${autoApply ? "border-primary/50 bg-primary/5" : "border-separator"}`}
							>
								<input
									type="checkbox"
									className="mt-1"
									checked={autoApply}
									disabled={!!busy}
									onChange={(e) => setAutoApply(e.target.checked)}
								/>
								<span>
									<span className="block text-sm font-medium">{m.autoDraft}</span>
									<span className="block text-xs text-muted-foreground">
										{autoApply ? w.autoApplyHelp : w.reviewInsteadHelp}
									</span>
								</span>
							</label>
							<label
								className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${!keepFullFrame ? "border-primary/50 bg-primary/5" : "border-separator"}`}
							>
								<input
									type="checkbox"
									className="mt-1"
									checked={!keepFullFrame}
									disabled={!!busy}
									onChange={(event) => setKeepFullFrame(!event.target.checked)}
								/>
								<span>
									<span className="block text-sm font-medium">{w.zoomLabel}</span>
									<span className="block text-xs text-muted-foreground">
										{w.zoomHelp}
									</span>
								</span>
							</label>
						</div>
						{canNarrate && voiceActions > 0 && (
							<Button
								variant="secondary"
								className="w-full"
								disabled={!!busy}
								onClick={() => setVoiceOpen(true)}
							>
								{w.voiceEntry}
							</Button>
						)}
						{lines.length > 0 && (
							<Button
								variant="secondary"
								className="w-full"
								disabled={!!busy}
								onClick={openTextEdit}
							>
								{w.textEntry}
							</Button>
						)}
					</section>
				)}
				{error && (
					<div
						ref={errorAnchor}
						role="alert"
						className="space-y-3 rounded-lg border border-danger/30 bg-background p-3 text-sm"
					>
						<p>{error}</p>
					</div>
				)}
				{(busy === "analysis" || busy === "vision" || busy === "review") && (
					<div
						ref={progressAnchor}
						className="space-y-3 rounded-xl border border-separator bg-background p-4"
						role="status"
						aria-live="polite"
						data-analysis-progress
					>
						<p className="font-semibold">{ui.progress}</p>
						<div className="flex gap-1.5" aria-hidden="true">
							{stages.map((stage, index) => (
								<span
									key={stage}
									className={`h-1.5 flex-1 rounded-full ${index <= activeStage ? "bg-primary" : "bg-muted"}`}
								/>
							))}
						</div>
						<p className="text-sm">
							{m[speechStage as "media" | "transcribe" | "understand" | "vision"] ??
								(busy === "review" ? m.reviewing : m.busy)}
							{busy === "vision" && ` (${progress.completed}/${progress.total})`}
						</p>
						<p className="text-xs text-muted-foreground">{ui.wait}</p>
						<Button
							variant="secondary"
							onClick={() => {
								generation.current++;
								void window.electronAPI.cancelAutoEditAnalysis?.();
								setBusy(null);
							}}
						>
							{m.cancel}
						</Button>
					</div>
				)}
				{showStart && (
					<div className="space-y-3 border-t border-separator pt-4">
						<p className="text-xs font-medium text-muted-foreground">{w.more}</p>
						<details className="rounded-xl border border-separator p-4" data-how-to>
							<summary className="cursor-pointer text-sm font-medium">
								{g.title}
							</summary>
							<ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
								{g.steps.map((step) => (
									<li key={step}>{step}</li>
								))}
							</ol>
							<h4 className="mt-4 text-sm font-semibold">{g.termsTitle}</h4>
							<dl className="mt-2 space-y-2 text-sm">
								{g.terms.map(([term, meaning]) => (
									<div key={term}>
										<dt className="font-medium">{term}</dt>
										<dd className="text-muted-foreground">{meaning}</dd>
									</div>
								))}
							</dl>
						</details>
						<details
							data-analysis-options
							className="rounded-xl border border-separator p-4"
						>
							<summary className="cursor-pointer text-sm font-medium">
								{ui.other}
							</summary>
							<p className="my-3 text-xs leading-relaxed text-muted-foreground">
								{ui.otherHelp}
							</p>
							<div className="flex flex-wrap gap-2">
								<Button
									disabled={
										!!busy ||
										!bundledStatus?.available ||
										provider === "ollama" ||
										!source ||
										state.clipRegions.length === 0
									}
									onClick={() => void analyze(true)}
								>
									{m.offlineAnalyze}
								</Button>
								<Button
									disabled={!!busy || !source || state.clipRegions.length === 0}
									onClick={() => void analyze()}
								>
									{m.analyze}
								</Button>
							</div>
						</details>
						<OfflineToolsPanel
							key={source}
							source={source}
							state={state}
							language={language}
							busy={!!busy}
							setBusy={(value) => setBusy(value ? "tools" : null)}
							onApply={onApply}
							onSeek={onSeek}
						/>
						<details
							className="rounded-xl border border-separator p-4"
							data-hardware-guide
						>
							<summary className="cursor-pointer text-sm font-medium">
								{ui.hardware}
							</summary>
							<div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
								<p>{ui.requirements}</p>
								<p>{ui.storage}</p>
								{bundledStatus && (
									<p>
										{ui.memory}:{" "}
										{(bundledStatus.freeMemoryBytes / 1024 ** 3).toFixed(1)} GiB
									</p>
								)}
								{bundledStatus &&
									bundledStatus.freeMemoryBytes <
										bundledStatus.requiredMemoryBytes && (
										<p className="font-medium text-amber-600">{ui.memoryLow}</p>
									)}
								<p className="text-xs">{ui.hardwareNote}</p>
							</div>
						</details>
					</div>
				)}
				<div ref={resultAnchor} />
				{stale && <p role="alert">{m.stale}</p>}
				{applied && !voiceOpen && !textOpen && (
					<section
						className="space-y-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4"
						role="status"
						aria-live="polite"
						data-draft-result
					>
						{!undone && (
							<div>
								<h3 className="text-base font-semibold">{w.doneTitle}</h3>
								<p className="text-sm">{m.applied}</p>
							</div>
						)}
						{summary && !undone && (
							<div className="grid grid-cols-2 gap-2">
								{(
									[
										[summary.cuts, w.cuts],
										[summary.speedUps, w.speedUps],
										[summary.zooms, w.zooms],
										[summary.captions, w.captions],
									] as const
								).map(([count, label]) => (
									<div
										key={label}
										className="rounded-lg border border-separator bg-background p-3 text-center"
									>
										<div className="text-2xl font-semibold">{count}</div>
										<div className="text-xs text-muted-foreground">{label}</div>
									</div>
								))}
							</div>
						)}
						{summary && !undone && summary.savedMs >= 1000 && (
							<p className="text-sm font-medium">
								{w.shorter.replace(
									"{s}",
									String(Math.round(summary.savedMs / 1000)),
								)}
							</p>
						)}
						{silentFallback && <p className="text-sm">{ui.silentFallback}</p>}
						{translated > 0 && !undone && (
							<p className="text-sm font-medium">
								{w.translated.replace("{n}", String(translated))}
							</p>
						)}
						{undone ? (
							<p className="text-sm font-medium">{w.undone}</p>
						) : (
							<p className="text-sm">{ui.next}</p>
						)}
						<div className="flex flex-wrap gap-2">
							{!undone && canNarrate && voiceActions > 0 && (
								<Button onClick={() => setVoiceOpen(true)}>{w.voiceNext}</Button>
							)}
							{lines.length > 0 && (
								<Button variant="secondary" onClick={openTextEdit}>
									{w.textEntry}
								</Button>
							)}
							{canUndoRun && undoState && (
								<Button
									variant="secondary"
									onClick={() => {
										onApply(undoState.before);
										setUndone(true);
									}}
								>
									{w.undoRun}
								</Button>
							)}
							<Button variant="ghost" onClick={startOver}>
								{w.startOver}
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">{m.speechCaution}</p>
					</section>
				)}
				{textOpen && (
					<section
						className="space-y-4 rounded-xl border p-4"
						data-text-edit
						aria-label={w.textEdit}
					>
						<div>
							<h3 className="text-base font-semibold">{w.textEdit}</h3>
							<p className="text-sm text-muted-foreground">{w.textEditHelp}</p>
						</div>
						<ul className="max-h-[50vh] space-y-1 overflow-y-auto">
							{lines.map((line) => {
								const locked = !!buildTextCutPlan(state, source, [line.id], "check")
									.suggestions[0]?.blocked;
								const chosen = textDeleted.includes(line.id);
								return (
									<li
										key={line.id}
										className={`flex items-start gap-3 rounded-lg px-2 py-1.5 ${chosen ? "bg-danger/5" : ""}`}
									>
										<input
											type="checkbox"
											className="mt-1"
											aria-label={line.text}
											checked={chosen}
											disabled={locked}
											onChange={(e) =>
												setTextDeleted((current) =>
													e.target.checked
														? [...current, line.id]
														: current.filter((id) => id !== line.id),
												)
											}
										/>
										<button
											type="button"
											className="mt-0.5 shrink-0 font-mono text-xs text-primary"
											onClick={() => onSeek(line.startMs / 1000)}
										>
											{Math.floor(line.startMs / 60000)}:
											{String(
												Math.floor((line.startMs % 60000) / 1000),
											).padStart(2, "0")}
										</button>
										<span className="text-sm">
											<span
												className={
													chosen
														? "text-muted-foreground line-through"
														: ""
												}
											>
												{line.text}
											</span>
											{locked && (
												<span className="block text-xs text-muted-foreground">
													{w.textEditLocked}
												</span>
											)}
										</span>
									</li>
								);
							})}
						</ul>
						<div className="flex flex-wrap gap-2">
							<Button disabled={!textDeleted.length || !!busy} onClick={cutText}>
								{w.textEditCut.replace("{n}", String(textDeleted.length))}
							</Button>
							<Button variant="ghost" onClick={() => setTextOpen(false)}>
								{w.textEditBack}
							</Button>
						</div>
						<div
							className="space-y-2 border-t border-separator pt-4"
							data-translate-subtitles
							hidden={provider === "ollama"}
						>
							<h4 className="text-sm font-semibold">{w.translateTitle}</h4>
							<p className="text-xs text-muted-foreground">{w.translateHelp}</p>
							<div className="flex flex-wrap items-center gap-2">
								<label className="flex items-center gap-2 text-sm">
									{w.translateTo}
									<select
										value={translateTarget}
										onChange={(e) =>
											setTranslateTarget(e.target.value as PlanLanguage)
										}
										className="rounded-lg border border-separator bg-background px-2 py-1.5 text-sm text-foreground"
									>
										<option value="zh">中文</option>
										<option value="en">English</option>
										<option value="ms">Bahasa Melayu</option>
									</select>
								</label>
								<Button
									variant="secondary"
									disabled={
										!!busy || !bundledStatus?.available || provider === "ollama"
									}
									onClick={() => void translateText()}
								>
									{busy === "translate"
										? `${w.translating}${progress.total ? ` ${progress.completed}/${progress.total}` : ""}`
										: w.translateRun}
								</Button>
							</div>
							{bundledStatus && !bundledStatus.available && (
								<p className="text-xs">{m.offlineMissing}</p>
							)}
						</div>
					</section>
				)}
				{voiceOpen && (
					<section className="space-y-4 rounded-xl border p-4" aria-label={w.voiceTitle}>
						<div>
							<h3 className="text-base font-semibold">{w.voiceTitle}</h3>
							<p className="text-sm text-muted-foreground">{w.voiceIntro}</p>
							{ttsStatus && !ttsStatus.voices?.[language] && (
								<p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-sm">
									{w.voiceMissing[language]}
								</p>
							)}
						</div>
						{voiceActions === 0 ? (
							<p className="rounded-lg border p-3 text-sm">{w.voiceNothing}</p>
						) : (
							<div className="space-y-3">
								<label className="flex flex-wrap items-center gap-2 text-sm">
									{n.style}
									<select
										value={narrationStyle}
										disabled={!!busy}
										onChange={(e) =>
											setNarrationStyle(
												e.target.value as typeof narrationStyle,
											)
										}
										className="rounded-lg border border-separator bg-background px-2 py-1.5 text-sm text-foreground"
									>
										{(["concise", "tutorial", "detailed"] as const).map(
											(style) => (
												<option key={style} value={style}>
													{n.styles[style]}
												</option>
											),
										)}
									</select>
								</label>
								{selectedVoice && (
									<div className="flex flex-wrap items-center gap-2 text-sm">
										<label className="flex flex-wrap items-center gap-2">
											{n.voice}
											<select
												value={selectedVoice.id}
												disabled={!!busy}
												onChange={(e) =>
													chooseVoice(Number(e.target.value))
												}
												className="rounded-lg border border-separator bg-background px-2 py-1.5 text-sm text-foreground"
											>
												{voiceOptions.map((voice) => (
													<option key={voice.id} value={voice.id}>
														{voice.labels[language]}
													</option>
												))}
											</select>
										</label>
										<Button
											variant="secondary"
											size="sm"
											disabled={!!busy}
											onClick={() => void previewVoice()}
										>
											{busy === "preview" ? n.previewing : n.preview}
										</Button>
									</div>
								)}
								<div className="flex flex-wrap gap-2">
									<Button
										disabled={!canNarrate || !!busy}
										onClick={() => void narrateBundled()}
									>
										{busy === "narrate"
											? progress.total && progress.completed < progress.total
												? `${n.looking} ${progress.completed}/${progress.total}`
												: n.busy
											: n.draft}
									</Button>
									{(busy === "narrate" ||
										busy === "synthesize" ||
										busy === "preview") && (
										<Button
											variant="secondary"
											onClick={() => {
												generation.current++;
												taskTiming.finish(false);
												void window.electronAPI.cancelAutoEditAnalysis?.();
												setBusy(null);
											}}
										>
											{n.cancel}
										</Button>
									)}
								</div>
							</div>
						)}
						{(busy === "narrate" || busy === "synthesize") && (
							<TaskWaitStatus timing={taskTiming.display} language={language} />
						)}
						{narrationDraft &&
							(narrationDraft.cues.length === 0 ? (
								<p className="text-sm">{n.empty}</p>
							) : (
								<div className="space-y-3">
									<p className="text-sm">
										{n.editHint} {n.blankHint}
									</p>
									<ol className="space-y-2">
										{narrationDraft.cues.map((cue) => (
											<li key={cue.id} className="flex items-start gap-2">
												<Button
													variant="ghost"
													size="sm"
													disabled={!!busy}
													onClick={() => onSeek(cue.startMs / 1000)}
												>
													{(cue.startMs / 1000).toFixed(1)} s
												</Button>
												<textarea
													aria-label={cue.id}
													value={narrationEdits[cue.id] ?? cue.text}
													disabled={!!busy}
													rows={2}
													onChange={(e) => {
														setNarrationEdits((prev) => ({
															...prev,
															[cue.id]: e.target.value,
														}));
														setNarrationApproved(false);
														setNarrationAudioReady(false);
													}}
													className="w-full rounded-lg border p-2 text-sm"
												/>
											</li>
										))}
									</ol>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={narrationApproved}
											disabled={!!busy}
											onChange={(e) => setNarrationApproved(e.target.checked)}
										/>
										{n.approve}
									</label>
									{narrationApproved && !narrationSpeakable && (
										<p className="text-sm">
											{mixedLanguage && narrationLanguage === "zh"
												? n.wrongLanguageMixed
												: w.voiceWrongLanguage[narrationLanguage]}
										</p>
									)}
									<Button
										disabled={
											!narrationApproved ||
											!voiceInstalled ||
											!narrationSpeakable ||
											!!busy
										}
										onClick={() => void synthesizeNarration()}
									>
										{busy === "synthesize" ? n.synthesizing : n.generateAudio}
									</Button>
									{narrationHasLatin && (
										<p className="text-xs text-muted-foreground">
											{n.latinHint}
										</p>
									)}
									{narrationAudioReady && (
										<p className="text-sm font-medium">{n.audioReady}</p>
									)}
									{narrationAudioReady && !!narrationReport?.dropped && (
										<p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-sm">
											{n.dropped.replace(
												"{n}",
												String(narrationReport.dropped),
											)}
										</p>
									)}
									{narrationAudioReady && !!narrationReport?.unspoken && (
										<p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-sm">
											{n.unspoken.replace(
												"{n}",
												String(narrationReport.unspoken),
											)}
										</p>
									)}
									{narrationAudioReady && !!narrationReport?.skipped && (
										<p className="text-xs text-muted-foreground">
											{n.skipped.replace(
												"{n}",
												String(narrationReport.skipped),
											)}
										</p>
									)}
								</div>
							))}
						<details className="text-xs text-muted-foreground">
							<summary className="cursor-pointer">{w.voicePrivacy}</summary>
							<p className="mt-2">{n.info}</p>
						</details>
						<Button variant="secondary" onClick={() => setVoiceOpen(false)}>
							{w.voiceDone}
						</Button>
					</section>
				)}
				{plan && !voiceOpen && (
					<section className="space-y-4">
						{silentFallback && (
							<p role="status" className="rounded-lg border p-3 text-sm">
								{ui.silentFallback}
							</p>
						)}
						{!plan.suggestions.length && (
							<p
								role="status"
								data-no-edits
								className="rounded-lg border p-3 text-sm"
							>
								{ui.noChanges}
							</p>
						)}
						{canNarrate && voiceActions > 0 && (
							<Button className="w-full" onClick={() => setVoiceOpen(true)}>
								{w.voiceEntry}
							</Button>
						)}
						<div>
							<h3 className="text-base font-semibold">{ui.reviewTitle}</h3>
							{available.length > 0 && (
								<p className="text-xs text-muted-foreground">{w.reviewHelp}</p>
							)}
						</div>
						{plan.warnings.map((warning, i) => (
							<p key={`${warning}-${i}`} className="text-sm">
								{m.warning}:{" "}
								{warning === "vision-sampled-only"
									? v.warning
									: warning.startsWith("speech-")
										? m.speechCaution
										: (m[warning as keyof typeof m] ?? warning)}
							</p>
						))}
						{plan.warnings.includes("audio-unverified") && (
							<p className="text-sm text-muted-foreground">{m.audioHelp}</p>
						)}
						{available.length > 0 && (
							<p className="text-sm" aria-live="polite" data-plan-summary>
								{m.available}: {available.length} · {m.pending}: {pending.length} ·{" "}
								{m.accept}: {accepted.length}
							</p>
						)}
						{available.length > 0 ? (
							<>
								<p className="text-sm">{m.decisionHint}</p>
								<div className="flex flex-wrap gap-2">
									<Button
										variant="secondary"
										disabled={stale || !!busy || pending.length === 0}
										onClick={() => decideRemaining("accept")}
									>
										{m.acceptRemaining}
									</Button>
									<Button
										variant="secondary"
										disabled={stale || !!busy || pending.length === 0}
										onClick={() => decideRemaining("reject")}
									>
										{m.rejectRemaining}
									</Button>
								</div>
							</>
						) : null}

						{!plan.suggestions.length && <p>{m.empty}</p>}
						<ol className="space-y-3">
							{plan.suggestions.map((s) => (
								<li
									key={s.id}
									data-suggestion-id={s.id}
									className="rounded-lg border p-3"
								>
									<div className="flex justify-between gap-2">
										<strong>
											{s.kind === "zoom" && s.reason === "vision"
												? v.zoom
												: m[s.kind]}
										</strong>
										<span>
											{(s.startMs / 1000).toFixed(2)}–
											{(s.endMs / 1000).toFixed(2)} s
											{s.speed ? ` · ${s.speed}×` : ""}
										</span>
									</div>
									<p className="text-sm">
										{s.reason === "vision" ? v.reason : m[s.reason]}
									</p>
									{s.text && <p className="whitespace-pre-wrap">{s.text}</p>}
									<Button
										variant="ghost"
										disabled={stale || !!busy}
										onClick={() => onSeek(s.startMs / 1000)}
									>
										{m.seek}
									</Button>
									{
										<fieldset disabled={stale || !!busy} className="flex gap-4">
											<legend className="text-sm">
												{decisions[s.id]
													? m[
															decisions[s.id] === "accept"
																? "accept"
																: "reject"
														]
													: m.pending}
											</legend>
											{(["accept", "reject"] as const).map((choice) => (
												<label key={choice} className="flex gap-2">
													<input
														type="radio"
														name={s.id}
														checked={decisions[s.id] === choice}
														onChange={() =>
															decide(
																{ ...decisions, [s.id]: choice },
																s,
															)
														}
													/>
													{m[choice]}
												</label>
											))}
										</fieldset>
									}
								</li>
							))}
						</ol>
						<Button variant="ghost" size="sm" onClick={startOver}>
							{w.startOver}
						</Button>
					</section>
				)}
			</div>
			{plan && (
				<footer
					className="flex shrink-0 items-center justify-end gap-3 border-t border-separator px-4 py-3"
					data-auto-edit-footer
				>
					<Button className="w-full" disabled={stale || !!busy} onClick={finishReview}>
						{m.apply}
					</Button>
				</footer>
			)}
		</section>
	);
});
