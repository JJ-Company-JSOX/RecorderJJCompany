import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/contexts/I18nContext";
import type { CursorTelemetryPoint } from "../types";
import { applyEditPlan } from "./apply";
import { messages, type PlanLanguage } from "./messages";
import { baselineFor, buildEditPlan, type Decision, type EditPlan, type EditState } from "./plan";

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
	const [plan, setPlan] = useState<EditPlan | null>(null);
	const [decisions, setDecisions] = useState<Record<string, Decision>>({});
	const [busy, setBusy] = useState<"analysis" | "review" | null>(null);
	const [error, setError] = useState("");
	const [applied, setApplied] = useState(false);
	const [model, setModel] = useState("");
	const [modelInfo, setModelInfo] = useState<{
		name: string;
		sizeBytes: number;
		license: string;
	} | null>(null);
	const [modelConsent, setModelConsent] = useState(false);
	const generation = useRef(0);
	useEffect(() => {
		if (open) return;
		generation.current++;
		void window.electronAPI.cancelAutoEditAnalysis?.();
		setBusy(null);
	}, [open]);
	const stale = !!plan && plan.baseline !== baselineFor(state, source);
	const pending = plan?.suggestions.some(
		(s) => !s.blocked && (!decisions[s.id] || decisions[s.id] === "pending"),
	);
	const accepted = plan?.suggestions.some((s) => decisions[s.id] === "accept");
	const analyze = async () => {
		const run = ++generation.current;
		setBusy("analysis");
		setError("");
		setApplied(false);
		setPlan(null);
		setDecisions({});
		try {
			if (!window.electronAPI.analyzeAutoEdit) throw new Error(m.unavailable);
			const result = await window.electronAPI.analyzeAutoEdit(source);
			if (run !== generation.current) return;
			if (!result.success || !result.evidence) throw new Error(result.error);
			setPlan(
				buildEditPlan({
					state,
					source,
					evidence: result.evidence,
					cursor,
					id: crypto.randomUUID(),
				}),
			);
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
				className="max-h-[85vh] max-w-3xl overflow-y-auto p-6"
				aria-label={m.title}
			>
				<DialogHeader>
					<DialogTitle>{m.title}</DialogTitle>
				</DialogHeader>
				<select
					aria-label="Plan language"
					value={language}
					onChange={(e) => setLanguage(e.target.value as PlanLanguage)}
					className="rounded border p-2"
				>
					<option value="zh">中文</option>
					<option value="en">English</option>
					<option value="ms">Bahasa Melayu</option>
				</select>
				<p>{m.intro}</p>
				<p className="text-sm text-muted-foreground">{m.privacy}</p>
				<Button
					disabled={!!busy || !source || state.clipRegions.length === 0}
					onClick={() => void analyze()}
				>
					{busy === "analysis" ? m.busy : m.analyze}
				</Button>
				{busy === "analysis" && (
					<Button
						variant="ghost"
						onClick={() => {
							generation.current++;
							void window.electronAPI.cancelAutoEditAnalysis?.();
							setBusy(null);
						}}
					>
						{m.cancel}
					</Button>
				)}
				{error && <p role="alert">{error}</p>}
				{stale && <p role="alert">{m.stale}</p>}
				{applied && <p role="status">{m.applied}</p>}
				{plan && (
					<>
						{plan.warnings.map((warning, i) => (
							<p key={`${warning}-${i}`} className="text-sm">
								{m.warning}: {m[warning as keyof typeof m] ?? warning}
							</p>
						))}
						<p className="text-sm">{m.decisionHint}</p>
						{plan.reviewer === "local-ai" && <p role="status">{m.reviewed}</p>}
						{!plan.suggestions.length && <p>{m.empty}</p>}
						<ol className="space-y-3">
							{plan.suggestions.map((s) => (
								<li
									key={s.id}
									data-suggestion-id={s.id}
									className="rounded-lg border p-3"
								>
									<div className="flex justify-between gap-2">
										<strong>{m[s.kind]}</strong>
										<span>
											{(s.startMs / 1000).toFixed(2)}–
											{(s.endMs / 1000).toFixed(2)} s
											{s.speed ? ` · ${s.speed}×` : ""}
										</span>
									</div>
									<p className="text-sm">{m[s.reason]}</p>
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
											onChange={(e) => setModelConsent(e.target.checked)}
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
						</details>
						<details>
							<summary>{m.details}</summary>
							<pre className="max-h-48 overflow-auto text-xs">
								{JSON.stringify({ ...plan, decisions }, null, 2)}
							</pre>
						</details>
						<div className="flex gap-2">
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
							<Button
								disabled={stale || !!busy || pending || !accepted}
								onClick={() => {
									try {
										onApply(applyEditPlan(state, source, plan, decisions));
										setPlan(null);
										setDecisions({});
										setApplied(true);
										setError("");
									} catch (e) {
										setError(
											`${m.error} ${e instanceof Error ? e.message : ""}`,
										);
									}
								}}
							>
								{m.apply}
							</Button>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
