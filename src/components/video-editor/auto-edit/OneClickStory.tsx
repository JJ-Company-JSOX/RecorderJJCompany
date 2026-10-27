import { Button } from "@/components/ui/button";
import type { PlanLanguage } from "./messages";

/** Where a one-click run is: writing the script, recording the voice-over, or finished. */
export type OneClickStage = "idle" | "script" | "voice" | "done";

export const oneClickCopy = {
	en: {
		title: "One-click AI voice-over",
		intro: "Write your topic. The AI writes the script, records the voice-over and puts subtitles and titles on the timeline.",
		topic: "Video topic",
		placeholder: "For example: introduce our new travel mug for office workers",
		language: "Voice-over and subtitle language",
		lookAtVideo: "Also look at the video (more accurate, takes a few minutes longer)",
		start: "Generate script, voice-over and subtitles",
		steps: ["Write script", "Voice-over", "Subtitles and titles"],
		frames: "Looking at the video",
		wait: "Without a graphics card this takes a few minutes. Keep this window open.",
		cancel: "Cancel",
		done: "Done! The script, voice-over and subtitles are on the timeline.",
		undo: "Undo",
		edit: "Edit the script",
		editHint:
			"To change a line, edit it below, tick the review box and press “{generate}”. Only changed lines are recorded again.",
		hide: "Hide",
	},
	zh: {
		title: "AI 一键配音解说",
		intro: "写下视频主题，AI 会写脚本、配上语音，再把字幕和标题放到时间线上。",
		topic: "视频主题",
		placeholder: "例如：介绍我们的新款保温杯，适合上班族",
		language: "配音和字幕语言",
		lookAtVideo: "同时看视频画面（更准，要多等几分钟）",
		start: "一键生成：脚本 + 配音 + 字幕",
		steps: ["写脚本", "配音", "字幕和标题"],
		frames: "正在看画面",
		wait: "电脑没有独立显卡时要等几分钟，请不要关闭窗口。",
		cancel: "取消",
		done: "完成！脚本、配音和字幕已经放到时间线上。",
		undo: "撤销",
		edit: "修改文案",
		editHint: "想改某一句：在下面直接改，勾选确认，再按「{generate}」。只会重新配改过的句子。",
		hide: "收起",
	},
	ms: {
		title: "Suara latar AI satu klik",
		intro: "Tulis topik anda. AI menulis skrip, merakam suara latar dan meletakkan sari kata serta tajuk pada garis masa.",
		topic: "Topik video",
		placeholder: "Contoh: perkenalkan botol termos baharu kami untuk pekerja pejabat",
		language: "Bahasa suara latar dan sari kata",
		lookAtVideo: "Lihat video juga (lebih tepat, beberapa minit lebih lama)",
		start: "Jana skrip, suara latar dan sari kata",
		steps: ["Tulis skrip", "Suara latar", "Sari kata dan tajuk"],
		frames: "Melihat video",
		wait: "Tanpa kad grafik, ini mengambil beberapa minit. Jangan tutup tetingkap ini.",
		cancel: "Batal",
		done: "Siap! Skrip, suara latar dan sari kata ada pada garis masa.",
		undo: "Buat asal",
		edit: "Ubah skrip",
		editHint:
			"Untuk mengubah satu baris, sunting di bawah, tandakan kotak semakan dan tekan “{generate}”. Hanya baris yang diubah dirakam semula.",
		hide: "Sembunyi",
	},
} satisfies Record<PlanLanguage, Record<string, unknown>>;

/**
 * The simple path: a topic and one button. The full voice-over controls stay available for
 * anyone who wants to adjust the brief, the voice or each line by hand.
 */
export function OneClickStory({
	language,
	stage,
	busy,
	compact = false,
	open = true,
	onOpen,
	topic,
	onTopic,
	lookAtVideo,
	onLookAtVideo,
	onLanguage,
	frames,
	blocker,
	generateLabel,
	canUndo,
	onStart,
	onCancel,
	onUndo,
	onEdit,
}: {
	language: PlanLanguage;
	stage: OneClickStage;
	/** Another task is running, so starting is not possible. */
	busy: boolean;
	/** Inside the voice-over section, which already has the topic and options. */
	compact?: boolean;
	/**
	 * Folded to one row, so the editing button above stays in view on small screens. A run in
	 * progress or just finished always shows.
	 */
	open?: boolean;
	onOpen?: (open: boolean) => void;
	topic: string;
	onTopic: (topic: string) => void;
	lookAtVideo: boolean;
	onLookAtVideo: (value: boolean) => void;
	onLanguage: (language: PlanLanguage) => void;
	frames: { completed: number; total: number };
	/** Why the run cannot start, such as a missing voice or no video. */
	blocker: string | null;
	generateLabel: string;
	canUndo: boolean;
	onStart: () => void;
	onCancel: () => void;
	onUndo: () => void;
	onEdit: () => void;
}) {
	const c = oneClickCopy[language];
	const running = stage === "script" || stage === "voice";
	const current = stage === "script" ? 0 : stage === "voice" ? 1 : stage === "done" ? 3 : -1;
	if (!open && stage === "idle")
		return (
			<button
				type="button"
				data-one-click-story
				aria-expanded={false}
				onClick={() => onOpen?.(true)}
				className="w-full rounded-xl border border-primary/40 bg-primary/5 px-4 py-2.5 text-left text-sm font-semibold hover:bg-primary/10"
			>
				✨ {c.title}
			</button>
		);
	return (
		<section
			data-one-click-story
			aria-label={c.title}
			className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-4"
		>
			<div>
				<div className="flex items-start justify-between gap-2">
					<h3 className="text-base font-semibold">✨ {c.title}</h3>
					{onOpen && !running && (
						<button
							type="button"
							aria-expanded
							onClick={() => onOpen(false)}
							className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
						>
							{c.hide}
						</button>
					)}
				</div>
				{!compact && <p className="text-xs text-muted-foreground">{c.intro}</p>}
			</div>
			{!compact && (
				<>
					<label className="flex flex-col gap-1 text-sm">
						{c.topic}
						<textarea
							aria-label={c.topic}
							rows={2}
							maxLength={2000}
							value={topic}
							disabled={busy}
							placeholder={c.placeholder}
							onChange={(e) => onTopic(e.target.value)}
							className="w-full rounded-lg border bg-background p-2 text-sm"
						/>
					</label>
					<label className="flex flex-wrap items-center gap-2 text-sm">
						{c.language}
						<select
							aria-label={c.language}
							value={language}
							disabled={busy}
							onChange={(e) => onLanguage(e.target.value as PlanLanguage)}
							className="rounded-lg border border-separator bg-background px-2 py-1.5 text-sm text-foreground"
						>
							<option value="zh">中文</option>
							<option value="en">English</option>
							<option value="ms">Bahasa Melayu</option>
						</select>
					</label>
					<label className="flex items-start gap-2 text-sm">
						<input
							type="checkbox"
							className="mt-1"
							checked={lookAtVideo}
							disabled={busy}
							onChange={(e) => onLookAtVideo(e.target.checked)}
						/>
						{c.lookAtVideo}
					</label>
				</>
			)}
			{blocker && !running && (
				<p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-sm">
					{blocker}
				</p>
			)}
			{running ? (
				<Button variant="secondary" className="w-full" onClick={onCancel}>
					{c.cancel}
				</Button>
			) : (
				<Button
					className="min-h-11 w-full text-base font-semibold"
					disabled={busy || !!blocker}
					onClick={onStart}
				>
					{c.start}
				</Button>
			)}
			{stage !== "idle" && (
				<ol className="space-y-1 text-sm" role="status">
					{c.steps.map((step, index) => (
						<li
							key={step}
							aria-current={index === current ? "step" : undefined}
							className={
								index < current
									? "text-primary"
									: index === current
										? "font-semibold"
										: "text-muted-foreground"
							}
						>
							{index < current ? "✓" : `${index + 1}.`} {step}
							{index === current &&
							index === 0 &&
							frames.total > 0 &&
							frames.completed < frames.total
								? ` · ${c.frames} ${frames.completed}/${frames.total}`
								: index === current
									? " …"
									: ""}
						</li>
					))}
				</ol>
			)}
			{running && <p className="text-xs text-muted-foreground">{c.wait}</p>}
			{stage === "done" && (
				<div className="space-y-2">
					<p className="text-sm font-medium">{c.done}</p>
					<div className="flex flex-wrap gap-2">
						{canUndo && (
							<Button variant="secondary" onClick={onUndo}>
								{c.undo}
							</Button>
						)}
						<Button variant="secondary" onClick={onEdit}>
							{c.edit}
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						{c.editHint.replace("{generate}", generateLabel)}
					</p>
				</div>
			)}
		</section>
	);
}
