import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/contexts/I18nContext";
import type { CursorTelemetryPoint } from "../types";
import { applyEditPlan } from "./apply";
import { BUNDLED_MODEL_ID, type BundledAiStatus } from "./bundledTypes";
import { interfaceMessages } from "./interfaceMessages";
import { messages, type PlanLanguage } from "./messages";
import { baselineFor, buildEditPlan, type Decision, type EditPlan, type EditState } from "./plan";
import { addSpeechSuggestions } from "./speechPlan";
import { addVisualSuggestions } from "./vision";
import { visionMessages } from "./visionMessages";

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
	const [visionConsent, setVisionConsent] = useState(false);
	const [progress, setProgress] = useState({ completed: 0, total: 8 });
	const [plan, setPlan] = useState<EditPlan | null>(null);
	const [decisions, setDecisions] = useState<Record<string, Decision>>({});
	const [busy, setBusy] = useState<"analysis" | "review" | "vision" | null>(null);
	const [error, setError] = useState("");
	const [applied, setApplied] = useState(false);
	const [model, setModel] = useState("");
	const [modelInfo, setModelInfo] = useState<{
		name: string;
		sizeBytes: number;
		license: string;
		capabilities?: string[];
	} | null>(null);
	const [modelConsent, setModelConsent] = useState(false);
	const [bundledStatus, setBundledStatus] = useState<BundledAiStatus | null>(null);
	const [keepFullFrame, setKeepFullFrame] = useState(true);
	const [speechReady, setSpeechReady] = useState<boolean | null>(null);
	const [autoApply, setAutoApply] = useState(true);
	const [speechStage, setSpeechStage] = useState("");
	const [draftSummary, setDraftSummary] = useState("");
	const resultAnchor = useRef<HTMLDivElement>(null);
	const progressAnchor = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (busy) progressAnchor.current?.scrollIntoView({ block: "nearest" });
	}, [busy]);
	useEffect(() => {
		if (applied || plan) resultAnchor.current?.scrollIntoView({ block: "start" });
	}, [applied, plan]);
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
	const analyze = async (withAi = false, withSpeech = false) => {
		const run = ++generation.current;
		setBusy("analysis");
		setError("");
		setApplied(false);
		setSpeechStage("");
		setDraftSummary("");
		setPlan(null);
		setDecisions({});
		try {
			if (!window.electronAPI.analyzeAutoEdit) throw new Error(m.unavailable);
			const complete = withSpeech
				? await window.electronAPI.analyzeCompleteAutoEdit({
						videoPath: source,
						language: "auto",
					})
				: undefined;
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
				next = addSpeechSuggestions(next, state, source, complete.speech);
			if (withAi) {
				setBusy("vision");
				setProgress({ completed: 0, total: 4 });
				const frames =
					complete ??
					(await window.electronAPI.analyzeAutoEditFrames({
						videoPath: source,
						model: BUNDLED_MODEL_ID,
						count: 4,
					}));
				if (run !== generation.current) return;
				if (!frames.success || !frames.analysis) throw Error(frames.error || m.error);
				next = addVisualSuggestions(next, state, source, frames.analysis);
				if (keepFullFrame)
					next = {
						...next,
						suggestions: next.suggestions.filter((s) => s.kind !== "zoom"),
					};
			}
			if (withSpeech && autoApply) {
				// Screen labels can cover controls; preserve them for the review-first workflow.
				next = {
					...next,
					suggestions: next.suggestions.filter(
						(s) => !(s.kind === "annotation" && s.reason === "vision"),
					),
				};
				const latest = currentState.current;
				if (baselineFor(latest.state, latest.source) !== next.baseline)
					throw Error(m.stale);
				const choices = Object.fromEntries(
					next.suggestions
						.filter((s) => !s.blocked)
						.map((s) => [s.id, "accept" as const]),
				);
				if (Object.keys(choices).length) {
					onApply(applyEditPlan(latest.state, latest.source, next, choices));
					const selected = next.suggestions.filter((s) => choices[s.id] === "accept");
					setDraftSummary(
						`${m.trim}: ${selected.filter((s) => s.kind === "trim").length} · ${m.caption}: ${selected.filter((s) => s.kind === "caption").length} · ${m.protectedCount}: ${next.suggestions.filter((s) => s.blocked).length}`,
					);
					setApplied(true);
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
		} catch (e) {
			if (run === generation.current)
				setError(`${m.error} ${e instanceof Error ? e.message : ""}`);
		} finally {
			if (run === generation.current) setBusy(null);
		}
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
				className="!w-[calc(100vw-2rem)] !max-w-4xl max-h-[calc(100dvh-2rem)] overflow-hidden !p-0 flex flex-col gap-0"
				aria-label={m.title}
			>
				<DialogHeader className="shrink-0 border-b border-separator px-6 py-5 pr-14">
					<div className="mb-2 text-xs font-medium text-primary">{ui.badge}</div>
					<DialogTitle className="text-2xl font-semibold">{ui.title}</DialogTitle>
					<p className="mt-1 text-sm text-muted-foreground">{ui.intro}</p>
				</DialogHeader>
				<div
					data-auto-edit-scroll
					className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 py-5"
				>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="flex items-center gap-2 text-sm font-medium" data-ai-ready>
							<span
								aria-hidden="true"
								className={`size-2 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`}
							/>
							{ready ? ui.ready : !bundledStatus ? ui.checking : m.offlineTitle}
						</p>
						<label className="flex items-center gap-2 text-xs text-muted-foreground">
							{ui.language}
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
						</label>
					</div>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-edit-workflow>
						{ui.steps.map((step, index) => (
							<div
								key={step}
								className={`rounded-xl border p-3 ${index === (applied || plan ? 1 : 0) ? "border-primary/40 bg-primary/5" : "border-separator"}`}
							>
								<div className="mb-1 flex items-center gap-2 text-sm font-semibold">
									<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">
										{index + 1}
									</span>
									{step}
								</div>
								<p className="text-xs leading-relaxed text-muted-foreground">
									{ui.stepHelp[index]}
								</p>
							</div>
						))}
					</div>
					<section
						className="space-y-4 rounded-xl border border-primary/25 bg-primary/5 p-4"
						aria-label={m.offlineTitle}
					>
						<h3 className="text-base font-semibold">{ui.options}</h3>
						<label className="flex items-start gap-2 text-sm">
							<input
								type="checkbox"
								checked={autoApply}
								disabled={!!busy}
								onChange={(e) => setAutoApply(e.target.checked)}
							/>
							{m.autoDraft}
						</label>
						<label className="flex items-start gap-2 text-sm">
							<input
								type="checkbox"
								checked={keepFullFrame}
								disabled={!!busy}
								onChange={(event) => setKeepFullFrame(event.target.checked)}
							/>
							{m.keepFullFrame}
						</label>
						<Button
							className="min-h-12 w-full text-base font-semibold sm:w-auto sm:min-w-64"
							aria-label={m.completeEdit}
							disabled={
								!!busy ||
								!bundledStatus?.available ||
								!speechReady ||
								!source ||
								!state.clipRegions.length
							}
							onClick={() => void analyze(true, true)}
						>
							{ui.start}
						</Button>
						<p className="text-xs leading-relaxed text-muted-foreground">
							{ui.actionHelp}
						</p>
						{speechReady === false && <p className="text-sm">{m.speechMissing}</p>}
						{busy && (
							<div
								ref={progressAnchor}
								className="space-y-3 rounded-lg border border-separator bg-background p-4"
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
										speechStage as
											| "media"
											| "transcribe"
											| "understand"
											| "vision"
									] ?? (busy === "review" ? m.reviewing : m.busy)}
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
						{bundledStatus && !bundledStatus.available && (
							<p className="text-sm">{m.offlineMissing}</p>
						)}
					</section>
					<details
						data-analysis-options
						className="rounded-xl border border-separator p-4"
					>
						<summary className="cursor-pointer text-sm font-medium">{ui.other}</summary>
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
								{busy ? m.offlineBusy : m.offlineAnalyze}
							</Button>
							{busy === "vision" && (
								<p role="status">
									{m.offlineBusy}: {progress.completed}/{progress.total}
								</p>
							)}
							<Button
								disabled={!!busy || !source || state.clipRegions.length === 0}
								onClick={() => void analyze()}
							>
								{busy === "analysis" ? m.busy : m.analyze}
							</Button>
						</div>
					</details>
					<details className="rounded-xl border border-separator p-4" data-hardware-guide>
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
					<div ref={resultAnchor} />
					{error && (
						<p role="alert" className="rounded-lg border border-danger/30 p-3 text-sm">
							{error}
						</p>
					)}
					{stale && <p role="alert">{m.stale}</p>}
					{applied && (
						<section
							className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4"
							role="status"
							aria-live="polite"
							data-draft-result
						>
							<h3 className="font-semibold">{ui.result}</h3>
							<p className="text-sm">{m.applied}</p>
							{draftSummary && <p className="text-sm font-medium">{draftSummary}</p>}
							<p className="text-sm">{ui.next}</p>
							<p className="text-xs text-muted-foreground">{m.speechCaution}</p>
						</section>
					)}
					{plan && (
						<>
							<h3 className="font-semibold">{ui.reviewTitle}</h3>
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
										{s.blocked ? (
											<p>{m.blocked}</p>
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
												[JSON.stringify({ ...plan, decisions }, null, 2)],
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
						</>
					)}
				</div>
				<footer
					className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-separator bg-background px-6 py-4"
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
									onApply(applyEditPlan(state, source, plan, decisions));
									setPlan(null);
									setDecisions({});
									setApplied(true);
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
