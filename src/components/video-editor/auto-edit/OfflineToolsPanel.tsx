import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getClipSourceStartMs, getClipSourceEndMs, mapSourceTimeToTimelineTime } from "../types";
import { baselineFor, overlaps, type EditState } from "./plan";

type ToolResult = Awaited<ReturnType<Window["electronAPI"]["runOfflineTool"]>>;
export function OfflineToolsPanel({
	source,
	state,
	language,
	busy,
	setBusy,
	onApply,
	onSeek,
}: {
	source: string;
	state: EditState;
	language: string;
	busy: boolean;
	setBusy: (value: boolean) => void;
	onApply: (state: EditState) => void;
	onSeek: (seconds: number) => void;
}) {
	const zh = language === "zh";
	const [status, setStatus] = useState<Awaited<
		ReturnType<Window["electronAPI"]["getOfflineToolsStatus"]>
	> | null>(null);
	const [result, setResult] = useState<ToolResult | null>(null),
		[error, setError] = useState("");
	const [track, setTrack] = useState<"mic" | "mixed">("mic");
	const [urls, setUrls] = useState<{ original: string; enhanced: string } | null>(null);
	const [resultBaseline, setResultBaseline] = useState("");
	const generation = useRef(0),
		current = useRef({ source, state });
	current.current = { source, state };
	// biome-ignore lint/correctness/useExhaustiveDependencies: A source change invalidates results and pending callbacks.
	useEffect(() => {
		generation.current++;
		setResult(null);
		setUrls(null);
		setError("");
		return () => {
			generation.current++;
		};
	}, [source]);
	const stale = resultBaseline !== baselineFor(state, source);
	const run = async (kind: "scene" | "sherpa" | "rnnoise") => {
		const id = ++generation.current,
			baseline = baselineFor(state, source);
		setBusy(true);
		setError("");
		setResult(null);
		setUrls(null);
		try {
			if (!window.electronAPI.runOfflineTool)
				throw Error(
					zh ? "此版本尚未包含离线工具。" : "This build does not include offline tools.",
				);
			const response = await window.electronAPI.runOfflineTool({
				kind,
				videoPath: source,
				language,
				track,
			});
			if (id !== generation.current) return;
			if (!response.success) throw Error(response.error);
			setResult(response);
			setResultBaseline(baseline);
			if (response.kind === "rnnoise") {
				const [a, b] = await Promise.all([
					window.electronAPI.getLocalMediaUrl(response.asset.originalPath),
					window.electronAPI.getLocalMediaUrl(response.asset.audioPath),
				]);
				if (id === generation.current && a.success && b.success)
					setUrls({ original: a.url, enhanced: b.url });
			}
		} catch (e) {
			if (id === generation.current) setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};
	const apply = () => {
		if (
			!result?.success ||
			stale ||
			baselineFor(current.current.state, current.current.source) !== resultBaseline
		)
			return;
		if (result.kind === "rnnoise") {
			const settings = { ...state.sourceAudioTrackSettingsByClip };
			for (const clip of state.clipRegions) {
				const tracks = settings[clip.id] ?? {};
				settings[clip.id] = {
					...tracks,
					[result.track]: {
						...(tracks[result.track] ?? { volume: 1, normalize: false }),
						voiceEnhancement: { ...result.asset, enabled: true },
					},
				};
			}
			onApply({ ...state, sourceAudioTrackSettingsByClip: settings });
		} else if (result.kind === "sherpa") {
			const captions = result.transcript.cues
				.filter(
					(c) =>
						state.clipRegions.some(
							(clip) =>
								c.startMs >= getClipSourceStartMs(clip) &&
								c.endMs <= getClipSourceEndMs(clip),
						) && !state.autoCaptions.some((existing) => overlaps(existing, c)),
				)
				.map((c, i) => ({
					id: `sherpa-${Date.now()}-${i}`,
					startMs: c.startMs,
					endMs: c.endMs,
					text: c.text,
				}));
			onApply({
				...state,
				autoCaptions: [...state.autoCaptions, ...captions].sort(
					(a, b) => a.startMs - b.startMs,
				),
			});
		}
	};
	return (
		<details
			className="rounded-xl border border-separator p-4"
			data-offline-tools
			onToggle={(e) => {
				if (e.currentTarget.open && !status)
					void window.electronAPI
						.getOfflineToolsStatus?.()
						.then(setStatus)
						.catch(() =>
							setError(zh ? "无法检查离线工具" : "Could not inspect offline tools"),
						);
			}}
		>
			<summary className="cursor-pointer font-medium">
				{zh ? "让人声更清楚" : "Make voices clearer"}
			</summary>
			<div className="mt-3 space-y-4 text-sm">
				<div className="space-y-2">
					<p>
						{zh
							? "去掉背景杂音，让说话声更清楚。先试听前后对比，满意再使用，随时可以撤销。有音乐的片段不建议使用。"
							: "Removes background noise so speech is easier to hear. Listen to before and after first, then decide. You can always undo. Not recommended for music."}
					</p>
					<label className="flex flex-wrap items-center gap-2">
						<span>{zh ? "处理哪一段声音" : "Which sound to clean up"}</span>
						<select
							value={track}
							disabled={busy}
							onChange={(e) => setTrack(e.target.value as "mic" | "mixed")}
							className="rounded border p-2"
						>
							<option value="mic">{zh ? "我的麦克风" : "My microphone"}</option>
							<option value="mixed">
								{zh ? "视频里的全部声音" : "All sound in the video"}
							</option>
						</select>
					</label>
					<Button
						disabled={busy || !source || status?.rnnoise.available === false}
						onClick={() => void run("rnnoise")}
					>
						{zh ? "试听效果" : "Preview clearer voice"}
					</Button>
				</div>
				{import.meta.env.DEV && (
					<div className="space-y-4 rounded border border-dashed p-3">
						<p className="text-xs text-muted-foreground">
							Developer tools (hidden in customer builds)
						</p>
						<div>
							<strong>PySceneDetect — {zh ? "场景分段" : "Scene boundaries"}</strong>
							<p>
								{zh
									? "只检测画面变化，不会自动删除或判断精彩片段。"
									: "Detects visual changes; does not delete clips or identify highlights."}
							</p>
							<Button
								disabled={busy || !source || status?.scene.available === false}
								onClick={() => void run("scene")}
							>
								{zh ? "检测场景" : "Detect scenes"}
							</Button>
						</div>
						<div>
							<strong>
								sherpa-onnx —{" "}
								{zh ? "较小语音模型对比" : "Smaller speech model comparison"}
							</strong>
							<p>
								{zh
									? "Whisper base INT8：与默认 small 模型对比。转录可添加为字幕，不用于批准语义剪切。"
									: "Whisper base INT8 compared with the default small model. Reviewed text can become subtitles; it cannot approve semantic cuts."}
							</p>
							<Button
								disabled={busy || !source || status?.sherpa.available === false}
								onClick={() => void run("sherpa")}
							>
								{zh ? "生成对比转录" : "Generate comparison transcript"}
							</Button>
						</div>
					</div>
				)}
				{error && <p role="alert">{error}</p>}
				{result?.success && (
					<div className="max-h-72 space-y-3 overflow-y-auto rounded border p-3">
						{result.kind === "scene" && (
							<>
								<p>
									{result.analysis.scenes.length}{" "}
									{zh
										? "个场景，时间按采样帧估算"
										: "scenes, sampled frame timing"}
								</p>
								{result.analysis.scenes.map((s, i) => (
									<Button
										key={s.startMs}
										disabled={busy}
										onClick={() =>
											onSeek(
												mapSourceTimeToTimelineTime(
													s.startMs,
													state.clipRegions,
												) / 1000,
											)
										}
									>
										{i + 1}: {(s.startMs / 1000).toFixed(2)}–
										{(s.endMs / 1000).toFixed(2)}s
									</Button>
								))}
							</>
						)}
						{result.kind === "sherpa" && (
							<>
								<p>
									{(result.transcript.elapsedMs / 1000).toFixed(1)}s —{" "}
									{zh ? "请先检查文字和时间" : "Review text and timing first"}
								</p>
								{result.transcript.cues.map((c, i) => (
									<p key={i}>
										{(c.startMs / 1000).toFixed(1)}–
										{(c.endMs / 1000).toFixed(1)}s: {c.text} ({c.alignment})
									</p>
								))}
							</>
						)}
						{result.kind === "rnnoise" && urls && (
							<>
								<p>{zh ? "原来的声音" : "Before"}</p>
								<audio controls preload="none" src={urls.original} />
								<p>{zh ? "处理后的声音" : "After"}</p>
								<audio controls preload="none" src={urls.enhanced} />
							</>
						)}
						{result.kind !== "scene" && (
							<Button disabled={busy || stale} onClick={apply}>
								{result.kind === "rnnoise"
									? zh
										? "使用处理后的声音"
										: "Use the clearer voice"
									: zh
										? "应用已检查的结果"
										: "Apply reviewed result"}
							</Button>
						)}
						{stale && (
							<p>
								{zh
									? "编辑内容已改变，请重新生成结果。"
									: "Edits changed. Generate a fresh result before applying."}
							</p>
						)}
					</div>
				)}
			</div>
		</details>
	);
}
