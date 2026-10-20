import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/contexts/I18nContext";
import { type AudioRegion, type CursorTelemetryPoint, mapTimelineTimeToSourceTime } from "../types";
import { applyEditPlan } from "./apply";
import { BUNDLED_MODEL_ID, type BundledAiStatus } from "./bundledTypes";
import { guideMessages } from "./guideMessages";
import { interfaceMessages } from "./interfaceMessages";
import { messages, type PlanLanguage } from "./messages";
import type { NarrationDraft } from "./narration";
import { narrationCaptions } from "./narrationCaptions";
import { narrationMessages } from "./narrationMessages";
import { OfflineToolsPanel } from "./OfflineToolsPanel";
import {
	baselineFor,
	buildEditPlan,
	type Decision,
	type EditPlan,
	type EditState,
	type EditSuggestion,
} from "./plan";
import { addSpeechSuggestions } from "./speechPlan";
import { buildTextCutPlan, textLines } from "./textCuts";
import { addVisualSuggestions } from "./vision";
import { visionMessages } from "./visionMessages";
import { wizardMessages } from "./wizardMessages";

export function AutoEditPanel({
	open,
	onClose,
	state,
	source,
	cursor,
	onApply,
	onSeek,
}: {
	open: boolean;
	onClose: () => void;
	state: EditState;
	source: string;
	cursor: CursorTelemetryPoint[];
	onApply: (next: EditState) => void;
	onSeek: (seconds: number) => void;
}) {
	const { locale } = useI18n();
	const [language, setLanguage] = useState<PlanLanguage>(locale.startsWith("zh") ? "zh" : "en");
	const m = messages[language];
	const ui = interfaceMessages[language];
	const v = visionMessages[language];
	const n = narrationMessages[language];
	const g = guideMessages[language];
	const w = wizardMessages[language];
	const [visionConsent, setVisionConsent] = useState(false);
	const [progress, setProgress] = useState({ completed: 0, total: 8 });
	const [plan, setPlan] = useState<EditPlan | null>(null);
	const [decisions, setDecisions] = useState<Record<string, Decision>>({});
	const [busy, setBusy] = useState<
		"analysis" | "review" | "narrate" | "synthesize" | "vision" | "tools" | "translate" | null
	>(null);
	const [error, setError] = useState("");
	const [silentFallback, setSilentFallback] = useState(false);
	const [applied, setApplied] = useState(false);
	const [model, setModel] = useState("");
	const [modelInfo, setModelInfo] = useState<{
		name: string;
		sizeBytes: number;
		license: string;
		capabilities?: string[];
	} | null>(null);
	const [modelConsent, setModelConsent] = useState(false);
	const [narrationDraft, setNarrationDraft] = useState<NarrationDraft | null>(null);
	const [narrationEdits, setNarrationEdits] = useState<Record<string, string>>({});
	const [narrationApproved, setNarrationApproved] = useState(false);
	const [narrationAudioReady, setNarrationAudioReady] = useState(false);
	const [ttsStatus, setTtsStatus] = useState<{
		available: boolean;
		voices?: Record<PlanLanguage, boolean>;
	} | null>(null);
	const [narrationLanguage, setNarrationLanguage] = useState<PlanLanguage>("zh");
	const [bundledStatus, setBundledStatus] = useState<BundledAiStatus | null>(null);
	const [keepFullFrame, setKeepFullFrame] = useState(false);
	const [speechReady, setSpeechReady] = useState<boolean | null>(null);
	const [autoApply, setAutoApply] = useState(true);
	const [speechStage, setSpeechStage] = useState("");
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
	const [showProtected, setShowProtected] = useState(false);
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
	const generation = useRef(0);
	useEffect(() => {
		if (!open) return;
		let active = true;
		setSpeechReady(null);
		void window.electronAPI
			.getBundledSpeechStatus?.()
			.then((status) => {
				if (active) setSpeechReady(status.available);
			})
			.catch(() => {
				if (active) setSpeechReady(false);
			});
		void window.electronAPI
			.getBundledAiStatus?.()
			.then((status) => {
				if (active) setBundledStatus(status);
			})
			.catch(() => {
				if (active) setBundledStatus(null);
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
	}, [open]);
	useEffect(() => window.electronAPI.onAutoEditFrameProgress?.(setProgress), []);
	useEffect(() => window.electronAPI.onCompleteAutoEditProgress?.(setSpeechStage), []);
	useEffect(() => {
		if (open) return;
		generation.current++;
		void window.electronAPI.cancelAutoEditAnalysis?.();
		setBusy(null);
	}, [open]);
	const stale = !!plan && plan.baseline !== baselineFor(state, source);
	const available = plan?.suggestions.filter((s) => !s.blocked) ?? [];
	const pending = available.filter((s) => !decisions[s.id] || decisions[s.id] === "pending");
	const accepted = available.filter((s) => decisions[s.id] === "accept");
	const ready = bundledStatus?.available && speechReady;
	// Mirrors the main-process check: each bundled voice can only read its own script.
	const speaks = (text: string) =>
		narrationLanguage === "zh"
			? /\p{Script=Han}/u.test(text)
			: /[A-Za-z]/.test(text) && !/\p{Script=Han}/u.test(text);
	const narrationSpeakable =
		!!narrationDraft?.cues.length &&
		narrationDraft.cues.every((c) => speaks(narrationEdits[c.id] ?? c.text));
	const voiceInstalled = !!ttsStatus?.voices?.[narrationLanguage];
	const stages = ["media", "transcribe", "understand", "vision"] as const;
	const activeStage = stages.indexOf(speechStage as (typeof stages)[number]);
	const decideRemaining = (choice: "accept" | "reject") => {
		if (!plan || stale || busy) return;
		setDecisions((current) => ({
			...current,
			...Object.fromEntries(
				available
					.filter((s) => !current[s.id] || current[s.id] === "pending")
					.map((s) => [s.id, choice]),
			),
		}));
	};
	const applyNow = (next: EditPlan, choices: Record<string, Decision>) => {
		const latest = currentState.current;
		if (baselineFor(latest.state, latest.source) !== next.baseline) throw Error(m.stale);
		const after = applyEditPlan(latest.state, latest.source, next, choices);
		onApply(after);
		const selected = next.suggestions.filter((s) => choices[s.id] === "accept");
		const length = (s: EditSuggestion) => s.endMs - s.startMs;
		setSummary({
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
		});
		// The editor may normalize the applied state, so record its baseline once it arrives.
		setUndoState({ before: latest.state, afterBaseline: null });
		setTranslated(0);
		setUndone(false);
		setPlan(null);
		setDecisions({});
		setApplied(true);
	};
	const narrationPlan = (s: EditState): EditPlan => ({
		version: 1,
		id: crypto.randomUUID(),
		coordinateSpace: "timeline-ms",
		baseline: baselineFor(s, source),
		suggestions: [
			...s.zoomRegions.map((z, i) => ({
				id: `zoom-${i + 1}`,
				kind: "zoom" as const,
				reason: "click" as const,
				startMs: z.startMs,
				endMs: z.endMs,
				focus: z.focus,
			})),
			...s.clipRegions
				.filter((c) => c.speed > 1)
				.map((c, i) => ({
					id: `speed-${i + 1}`,
					kind: "speed" as const,
					reason: "silent-moving" as const,
					startMs: c.startMs,
					endMs: c.endMs,
					speed: c.speed,
				})),
		].sort((a, b) => a.startMs - b.startMs),
		warnings: [],
		reviewer: "rules",
	});
	const analyze = async (
		withAi = false,
		withSpeech = false,
		fromSilentVideo = false,
		main = false,
	) => {
		const run = ++generation.current;
		setBusy("analysis");
		setError("");
		setSilentFallback(fromSilentVideo);
		setApplied(false);
		setSpeechStage("");
		setSummary(null);
		setUndone(false);
		setVoiceOpen(false);
		setShowProtected(false);
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
						language: "auto",
					})
				: undefined;
			if (complete?.errorCode === "NO_AUDIO") {
				if (run !== generation.current) return;
				// A silent recording is edited from the picture: frozen parts, idle parts and clicks.
				setKeepFullFrame(false);
				return analyze(!!bundledStatus?.available, false, true, main);
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
			if (withAi) {
				setBusy("vision");
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
				if (keepFullFrame && !fromSilentVideo)
					next = {
						...next,
						suggestions: next.suggestions.filter((s) => s.kind !== "zoom"),
					};
			}
			// A zoom is already there (often added by Recordly when the recording opened): skip, not "protected".
			next = {
				...next,
				suggestions: next.suggestions.filter((s) => s.blocked !== "existing-zoom"),
			};
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
			setPlan(next);
		} catch (e) {
			if (run === generation.current)
				setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		} finally {
			if (run === generation.current) setBusy(null);
		}
	};
	const analyzeFrames = async () => {
		if (
			!plan ||
			!modelInfo?.capabilities?.includes("vision") ||
			!modelConsent ||
			!visionConsent ||
			stale
		)
			return;
		const run = ++generation.current;
		setBusy("vision");
		setError("");
		setProgress({ completed: 0, total: 8 });
		setApplied(false);
		try {
			const result = await window.electronAPI.analyzeAutoEditFrames({
				videoPath: source,
				model,
				count: 8,
			});
			if (run !== generation.current) return;
			if (!result.success || !result.analysis)
				throw Error(result.error || "Visual analysis failed");
			setPlan(addVisualSuggestions(plan, state, source, result.analysis));
			setDecisions({});
		} catch (e) {
			if (run === generation.current)
				setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		} finally {
			if (run === generation.current) setBusy(null);
		}
	};
	const narrateBundled = async () => {
		const voicePlan = narrationPlan(currentState.current.state);
		if (!voicePlan.suggestions.length) return;
		const run = ++generation.current;
		setBusy("narrate");
		setError("");
		setProgress({ completed: 0, total: 0 });
		setNarrationApproved(false);
		setNarrationAudioReady(false);
		try {
			const draftLanguage = language;
			const { clipRegions } = currentState.current.state;
			// The AI looks at the source frame just after each zoom or sped-up part begins.
			const frames = voicePlan.suggestions.map((s) => ({
				id: s.id,
				timeMs: Math.max(
					0,
					mapTimelineTimeToSourceTime(
						s.startMs + Math.min(500, (s.endMs - s.startMs) / 2),
						clipRegions,
					),
				),
				...(s.focus ? { focus: s.focus } : {}),
			}));
			const result = await window.electronAPI.narrateAutoEditBundled(
				voicePlan,
				draftLanguage,
				{ videoPath: source, frames },
			);
			if (run !== generation.current) return;
			if (!result.success || !result.draft) throw new Error(result.error);
			setNarrationLanguage(draftLanguage);
			setNarrationDraft(result.draft);
			setNarrationEdits(Object.fromEntries(result.draft.cues.map((c) => [c.id, c.text])));
		} catch (e) {
			if (run === generation.current)
				setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		} finally {
			if (run === generation.current) setBusy(null);
		}
	};
	const synthesizeNarration = async () => {
		if (!narrationDraft || !narrationApproved) return;
		const run = ++generation.current;
		setBusy("synthesize");
		setError("");
		try {
			const cues = narrationDraft.cues.map((cue) => ({
				id: cue.id,
				text: narrationEdits[cue.id] ?? cue.text,
			}));
			const result = await window.electronAPI.synthesizeAutoEditNarration(
				cues,
				narrationLanguage,
			);
			if (run !== generation.current) return;
			if (!result.success || !result.clips) throw new Error(result.error);
			const { state: latestState } = currentState.current;
			const trackIndex =
				Math.max(-1, ...latestState.audioRegions.map((r) => r.trackIndex ?? 0)) + 1;
			const regions: AudioRegion[] = [];
			for (const clip of result.clips) {
				const cue = narrationDraft.cues.find((c) => c.id === clip.id);
				if (!cue) continue;
				regions.push({
					id: `narration-${clip.id}`,
					startMs: cue.startMs,
					endMs: cue.startMs + clip.durationMs,
					audioPath: clip.audioPath,
					volume: 1,
					normalize: false,
					trackIndex,
				});
			}
			onApply({
				...latestState,
				audioRegions: [...latestState.audioRegions, ...regions],
				// Silent recordings have no subtitles; the approved narration lines become them.
				autoCaptions: [
					...latestState.autoCaptions,
					...narrationCaptions(latestState, regions, cues),
				],
			});
			setNarrationAudioReady(true);
		} catch (e) {
			if (run === generation.current)
				setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		} finally {
			if (run === generation.current) setBusy(null);
		}
	};
	const review = async () => {
		if (!plan || !modelInfo || !modelConsent) return;
		const run = ++generation.current;
		setBusy("review");
		setError("");
		try {
			const result = await window.electronAPI.reviewAutoEditLocally(plan, model);
			if (run !== generation.current) return;
			if (!result.success || !result.plan) throw new Error(result.error);
			setPlan(result.plan);
			setDecisions({});
			setNarrationDraft(null);
			setNarrationEdits({});
			setNarrationApproved(false);
			setNarrationAudioReady(false);
		} catch (e) {
			if (run === generation.current)
				setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		} finally {
			if (run === generation.current) setBusy(null);
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
	const voiceActions = narrationPlan(state).suggestions.length;
	const protectedCount = plan ? plan.suggestions.length - available.length : 0;
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
		setShowProtected(false);
		setSilentFallback(false);
		setError("");
	};
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
		>
			<DialogContent
				data-auto-edit-panel
				className="!w-[calc(100vw-2rem)] !max-w-3xl max-h-[calc(100dvh-2rem)] overflow-hidden !p-0 flex flex-col gap-0"
				aria-label={m.title}
			>
				<DialogHeader className="shrink-0 border-b border-separator px-6 py-4 pr-14">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<DialogTitle className="text-xl font-semibold">{ui.title}</DialogTitle>
							<p className="mt-0.5 text-xs text-muted-foreground">
								<span
									aria-hidden="true"
									className={`mr-1.5 inline-block size-2 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`}
								/>
								{ready ? ui.ready : !bundledStatus ? ui.checking : m.offlineTitle} ·{" "}
								{ui.badge}
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
					<ol className="mt-3 flex items-center gap-2 text-xs" data-edit-workflow>
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
									<span className="text-muted-foreground">
										({w.optionalStep})
									</span>
								)}
								{index < w.steps.length - 1 && (
									<span
										aria-hidden="true"
										className="mx-1 h-px w-5 bg-separator"
									/>
								)}
							</li>
						))}
					</ol>
				</DialogHeader>
				<div
					data-auto-edit-scroll
					className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-5"
				>
					{showStart && (
						<section className="space-y-4" aria-label={m.offlineTitle}>
							<div>
								<h3 className="text-base font-semibold">{w.chooseTitle}</h3>
								<p className="text-xs text-muted-foreground">{w.chooseHelp}</p>
							</div>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
										<span className="block text-sm font-medium">
											{m.autoDraft}
										</span>
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
										onChange={(event) =>
											setKeepFullFrame(!event.target.checked)
										}
									/>
									<span>
										<span className="block text-sm font-medium">
											{w.zoomLabel}
										</span>
										<span className="block text-xs text-muted-foreground">
											{w.zoomHelp}
										</span>
									</span>
								</label>
							</div>
							<Button
								className="min-h-12 w-full text-base font-semibold"
								aria-label={m.completeEdit}
								disabled={
									!!busy ||
									!bundledStatus?.available ||
									!speechReady ||
									!source ||
									!state.clipRegions.length
								}
								onClick={() => void analyze(true, true, false, true)}
							>
								{ui.start}
							</Button>
							<p className="text-center text-xs text-muted-foreground">
								{ui.actionHelp}
							</p>
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
							{speechReady === false && <p className="text-sm">{m.speechMissing}</p>}
							{bundledStatus && !bundledStatus.available && (
								<p className="text-sm">{m.offlineMissing}</p>
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
								{m[
									speechStage as "media" | "transcribe" | "understand" | "vision"
								] ?? (busy === "review" ? m.reviewing : m.busy)}
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
											!source ||
											state.clipRegions.length === 0
										}
										onClick={() => void analyze(true)}
									>
										{m.offlineAnalyze}
									</Button>
									<Button
										disabled={
											!!busy || !source || state.clipRegions.length === 0
										}
										onClick={() => void analyze()}
									>
										{m.analyze}
									</Button>
								</div>
							</details>
							<OfflineToolsPanel
								key={open ? source : "closed"}
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
											{(bundledStatus.freeMemoryBytes / 1024 ** 3).toFixed(1)}{" "}
											GiB
										</p>
									)}
									{bundledStatus &&
										bundledStatus.freeMemoryBytes <
											bundledStatus.requiredMemoryBytes && (
											<p className="font-medium text-amber-600">
												{ui.memoryLow}
											</p>
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
								<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
											<div className="text-xs text-muted-foreground">
												{label}
											</div>
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
								{!undone && bundledStatus?.available && voiceActions > 0 && (
									<Button onClick={() => setVoiceOpen(true)}>
										{w.voiceNext}
									</Button>
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
									const locked = !!buildTextCutPlan(
										state,
										source,
										[line.id],
										"check",
									).suggestions[0]?.blocked;
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
															: current.filter(
																	(id) => id !== line.id,
																),
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
										disabled={!!busy || !bundledStatus?.available}
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
						<section
							className="space-y-4 rounded-xl border p-4"
							aria-label={w.voiceTitle}
						>
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
								<Button
									disabled={!bundledStatus?.available || !!busy}
									onClick={() => void narrateBundled()}
								>
									{busy === "narrate"
										? progress.total && progress.completed < progress.total
											? `${n.looking} ${progress.completed}/${progress.total}`
											: n.busy
										: n.draft}
								</Button>
							)}
							{narrationDraft &&
								(narrationDraft.cues.length === 0 ? (
									<p className="text-sm">{n.empty}</p>
								) : (
									<div className="space-y-3">
										<p className="text-sm">{n.editHint}</p>
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
												onChange={(e) =>
													setNarrationApproved(e.target.checked)
												}
											/>
											{n.approve}
										</label>
										{narrationApproved && !narrationSpeakable && (
											<p className="text-sm">
												{w.voiceWrongLanguage[narrationLanguage]}
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
											{busy === "synthesize"
												? n.synthesizing
												: n.generateAudio}
										</Button>
										{narrationAudioReady && (
											<p className="text-sm font-medium">{n.audioReady}</p>
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
							{plan.suggestions.length > 0 && (
								<p className="text-sm" aria-live="polite" data-plan-summary>
									{m.available}: {available.length} · {m.protectedCount}:{" "}
									{plan.suggestions.length - available.length} · {m.pending}:{" "}
									{pending.length} · {m.accept}: {accepted.length}
								</p>
							)}
							{plan.suggestions.length > available.length && (
								<p className="text-xs text-muted-foreground">{g.summaryHelp}</p>
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
							) : (
								plan.suggestions.length > 0 && (
									<p className="rounded-lg border p-3" data-plan-all-protected>
										{m.allProtected}
									</p>
								)
							)}

							{plan.reviewer === "local-ai" && !plan.visualAnalysis && (
								<p role="status">{m.reviewed}</p>
							)}
							{!plan.suggestions.length && <p>{m.empty}</p>}
							{protectedCount > 0 && (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setShowProtected((value) => !value)}
								>
									{showProtected
										? w.hideProtected
										: w.showProtected.replace("{n}", String(protectedCount))}
								</Button>
							)}
							<ol className="space-y-3">
								{plan.suggestions.map((s) => (
									<li
										key={s.id}
										data-suggestion-id={s.id}
										hidden={!!s.blocked && !showProtected}
										className={`rounded-lg border p-3 ${s.blocked ? "border-dashed opacity-70" : ""}`}
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
										{s.blocked ? (
											<p>{m[s.blocked]}</p>
										) : (
											<fieldset
												disabled={stale || !!busy}
												className="flex gap-4"
											>
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
																setDecisions((current) => ({
																	...current,
																	[s.id]: choice,
																}))
															}
														/>
														{m[choice]}
													</label>
												))}
											</fieldset>
										)}
									</li>
								))}
							</ol>
							{import.meta.env.DEV && (
								<details>
									<summary>{m.ai}</summary>
									<p className="my-2 text-sm">{m.aiInfo}</p>
									<input
										aria-label={m.model}
										placeholder={m.model}
										value={model}
										disabled={!!busy}
										onChange={(e) => {
											setModel(e.target.value);
											setModelInfo(null);
											setModelConsent(false);
											setVisionConsent(false);
										}}
										className="w-full rounded border p-2"
									/>
									<Button
										disabled={!model.trim() || !!busy}
										onClick={async () => {
											const run = ++generation.current;
											setBusy("review");
											setError("");
											setModelInfo(null);
											setModelConsent(false);
											try {
												const result =
													await window.electronAPI.inspectAutoEditLocalModel(
														model,
													);
												if (run !== generation.current) return;
												if (!result.success || !result.info)
													throw new Error(result.error);
												setModelInfo(result.info);
											} catch (e) {
												if (run === generation.current)
													setError(
														`${m.error} ${e instanceof Error ? e.message : ""}`,
													);
											} finally {
												if (run === generation.current) setBusy(null);
											}
										}}
									>
										{m.inspect}
									</Button>
									{modelInfo && (
										<div className="space-y-2 rounded border p-3 text-sm">
											<p>
												{modelInfo.name} · {m.modelSize}:{" "}
												{(modelInfo.sizeBytes / 1024 ** 3).toFixed(2)} GiB
											</p>
											<details>
												<summary>{m.modelLicense}</summary>
												<pre className="max-h-40 overflow-auto whitespace-pre-wrap">
													{modelInfo.license}
												</pre>
											</details>
											<p>{m.modelTerms}</p>
											<label className="flex gap-2">
												<input
													type="checkbox"
													checked={modelConsent}
													onChange={(e) =>
														setModelConsent(e.target.checked)
													}
												/>
												{m.modelConsent}
											</label>
										</div>
									)}
									<Button
										disabled={
											!modelInfo ||
											!modelConsent ||
											!model.trim() ||
											stale ||
											!!busy ||
											!plan.suggestions.some((s) => !s.blocked)
										}
										onClick={() => void review()}
									>
										{busy === "review" ? m.reviewing : m.review}
									</Button>

									<section
										className="mt-4 space-y-3 rounded border p-3"
										aria-label={v.title}
									>
										<h3>{v.title}</h3>
										<p className="text-sm">{v.info}</p>
										{!modelInfo?.capabilities?.includes("vision") && (
											<p className="text-sm">{v.visionRequired}</p>
										)}
										<label className="flex gap-2 text-sm">
											<input
												type="checkbox"
												checked={visionConsent}
												disabled={!!busy}
												onChange={(e) => setVisionConsent(e.target.checked)}
											/>
											{v.consent}
										</label>
										<Button
											disabled={
												!!busy ||
												stale ||
												!modelConsent ||
												!visionConsent ||
												!modelInfo?.capabilities?.includes("vision")
											}
											onClick={() => void analyzeFrames()}
										>
											{v.analyze}
										</Button>
										{busy === "vision" && (
											<p role="status">
												{v.busy}: {progress.completed}/{progress.total}
											</p>
										)}
										{plan.visualAnalysis && (
											<p role="status">
												{v.result}:{" "}
												{plan.visualAnalysis.sampledTimesMs.length} ·{" "}
												{plan.visualAnalysis.model} ·{" "}
												{(plan.visualAnalysis.elapsedMs / 1000).toFixed(1)}{" "}
												s
											</p>
										)}
									</section>
								</details>
							)}

							{import.meta.env.DEV && (
								<details className="rounded-lg border border-separator p-3">
									<summary>{m.details}</summary>
									<pre className="max-h-48 overflow-auto text-xs">
										{JSON.stringify({ ...plan, decisions }, null, 2)}
									</pre>
									<Button
										variant="secondary"
										onClick={() => {
											const url = URL.createObjectURL(
												new Blob(
													[
														JSON.stringify(
															{ ...plan, decisions },
															null,
															2,
														),
													],
													{ type: "application/json" },
												),
											);
											const anchor = document.createElement("a");
											anchor.href = url;
											anchor.download = "recordly-edit-plan.json";
											anchor.click();
											setTimeout(() => URL.revokeObjectURL(url), 1000);
										}}
									>
										{m.json}
									</Button>
								</details>
							)}
							<Button variant="ghost" size="sm" onClick={startOver}>
								{w.startOver}
							</Button>
						</section>
					)}
				</div>
				<footer
					className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-separator bg-background px-6 py-3"
					data-auto-edit-footer
				>
					<Button variant="secondary" onClick={onClose}>
						{ui.back}
					</Button>
					{plan && (
						<Button
							disabled={
								stale || !!busy || pending.length > 0 || accepted.length === 0
							}
							onClick={() => {
								try {
									applyNow(plan, decisions);
									setError("");
								} catch (e) {
									setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
								}
							}}
						>
							{m.apply}
						</Button>
					)}
				</footer>
			</DialogContent>
		</Dialog>
	);
}
