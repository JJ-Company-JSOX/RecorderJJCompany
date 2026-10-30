import { useEffect, useRef, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import type { PlanLanguage } from "./messages";
import { estimateRange, formatWait, validSamples } from "./taskTiming";
const SETTING = "recordly.aiTaskTimings.v1";
const copy = {
	en: {
		elapsed: "Time elapsed",
		remaining: "Estimated remaining",
		estimating: "Estimating — the first run measures this computer’s speed.",
		longer: "Taking longer than estimated; still waiting for the result.",
		hint: "Based on previous similar tasks on this computer; model loading and system load can change the time.",
	},
	zh: {
		elapsed: "已等待",
		remaining: "预计剩余",
		estimating: "正在估算：首次运行会测量本机速度。",
		longer: "耗时超过预计，仍在等待结果。",
		hint: "根据本机以往相近任务估算；模型加载和电脑负载会影响耗时。",
	},
	ms: {
		elapsed: "Masa berlalu",
		remaining: "Anggaran baki",
		estimating: "Menganggar — larian pertama mengukur kelajuan komputer ini.",
		longer: "Lebih lama daripada anggaran; masih menunggu hasil.",
		hint: "Berdasarkan tugas serupa pada komputer ini; pemuatan model dan beban sistem mempengaruhi masa.",
	},
};
export function useTaskTiming() {
	const active = useRef<{ key: string; start: number; range: [number, number] | null } | null>(
		null,
	);
	const [display, setDisplay] = useState<{
		elapsed: number;
		range: [number, number] | null;
	} | null>(null);
	useEffect(() => {
		const timer = setInterval(() => {
			if (active.current)
				setDisplay({
					elapsed: performance.now() - active.current.start,
					range: active.current.range,
				});
		}, 1000);
		return () => clearInterval(timer);
	}, []);
	return {
		display,
		start(key: string) {
			const range = estimateRange(validSamples(loadAppSetting(SETTING)), key);
			active.current = { key, start: performance.now(), range };
			setDisplay({ elapsed: 0, range });
		},
		finish(success: boolean) {
			const run = active.current;
			if (run && success)
				saveAppSetting(
					SETTING,
					validSamples([
						...validSamples(loadAppSetting(SETTING)),
						{ key: run.key, durationMs: performance.now() - run.start },
					]),
				);
			active.current = null;
			setDisplay(null);
		},
	};
}
export function TaskWaitStatus({
	timing,
	language,
	compact = false,
}: {
	timing: ReturnType<typeof useTaskTiming>["display"];
	language: PlanLanguage;
	/** A single status line with no card chrome, for tight spaces such as the main progress card. */
	compact?: boolean;
}) {
	if (!timing) return null;
	const c = copy[language];
	const { elapsed, range } = timing;
	const remaining = !range
		? c.estimating
		: elapsed >= range[1]
			? c.longer
			: `${c.remaining}: ${formatWait(Math.max(1000, range[0] - elapsed))} – ${formatWait(range[1] - elapsed)}`;
	if (compact)
		return (
			<p data-task-wait role="status" className="text-xs text-muted-foreground">
				{c.elapsed}: {formatWait(elapsed)} · {remaining}
			</p>
		);
	return (
		<div
			data-task-wait
			className="space-y-2 rounded-xl border border-white/15 bg-white/5 p-3 text-sm"
		>
			<p className="font-medium">
				{c.elapsed}: {formatWait(elapsed)}
			</p>
			<p role="status">{remaining}</p>
			{range && <p className="text-xs text-muted-foreground">{c.hint}</p>}
		</div>
	);
}
