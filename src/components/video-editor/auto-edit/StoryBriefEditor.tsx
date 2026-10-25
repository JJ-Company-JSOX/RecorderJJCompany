import { storyTextBudget, storyBriefCharacterCount } from "./storyTranscript";
import type { buildStoryTranscript } from "./storyTranscript";
import type { PlanLanguage } from "./messages";
import type { StoryBrief } from "./story";
export const storyCopy = {
	en: {
		mode: "Narration task",
		checkModel: "Check or change Ollama model",
		draftLanguage: "Draft voice language",
		voiceOutdated:
			"The timeline still contains earlier narration audio. It may not match the current words, voice or timing. Review it or generate narration audio again; unchanged lines can reuse audio prepared in this session.",
		transcript: "Use existing speech subtitles as story context",
		transcriptCount: "Subtitle context included: {included}/{total}; omitted: {omitted}.",
		transcriptPartial:
			"Partially cut subtitles without word timing are omitted so removed words are not reused.",
		openCaptions: "Create or review original subtitles",
		noTranscript:
			"No usable original-speech subtitles are available. Create subtitles in Captions first, or turn off subtitle context.",
		tooMuchText:
			"Shorten the brief: the brief and selected subtitle context are limited to {max} characters in total.",
		inputSize: "Reference text",
		measuredVoice: "Actual voice length",
		sceneRoom: "Scene length",
		saved: "The brief and draft are saved with the project. Reopen, review and approve before adding audio or text.",
		styles: {
			concise: "Short introduction",
			tutorial: "Guided product story",
			detailed: "Detailed story",
		},
		tutorial: "Describe actions / tutorial",
		story: "Plan a whole-video story",
		topic: "Topic / product",
		audience: "Audience",
		facts: "Verified features and selling points",
		ending: "What should viewers do at the end?",
		notes: "Scene notes / footage context",
		video: "Analyze sampled video frames",
		help: "Tell AI what this video is for. It plans a story across up to eight footage sections, with narration and on-screen titles. Review every claim before using it.",
		privacy:
			"Frame analysis uses a local vision model and up to eight small frames, not continuous video or recorded speech. Text-only models use your brief, scene notes and explicitly enabled subtitle context. Raw recorded audio is not sent to Ollama. Original audio is kept; mute or lower it on the timeline if you want to replace it.",
		vision: "Video analysis needs a vision model. qwen3:4b only understands text. You can install qwen2.5vl:3b, then select and check it in AI mode, or turn off frame analysis.",
		frames: "Preparing video samples",
		draft: "Draft video story",
		required: "Enter a topic and product facts or scene notes first.",
		title: "On-screen title",
		titles: "Add scene titles to timeline",
		subtitles: "Add narration as text subtitles",
		textAdded:
			"Text added to the timeline. Undo is available; existing subtitles are preserved.",
		briefChanged: "The brief changed. Draft the story again before adding audio or text.",
		start: "Start (seconds)",
		end: "End (seconds)",
		tooLong:
			"The voice is longer than its scene. Shorten this line or extend its scene before generating again:",
		timing: "Story times must stay inside a video clip and cannot overlap. Adjust them or draft again.",
	},
	zh: {
		mode: "解说任务",
		checkModel: "检查或更换 Ollama 模型",
		draftLanguage: "草稿配音语言",
		voiceOutdated:
			"时间轴仍保留之前的配音，可能与当前文案、声音或时间不同。请试听或重新生成；本次编辑中未改动的句子可复用已生成语音。",
		transcript: "用已有原声字幕帮助策划故事",
		transcriptCount: "采用字幕：{included}/{total} 段；略过 {omitted} 段。",
		transcriptPartial: "没有逐字时间的部分裁剪字幕会略过，避免把剪掉的话带回故事。",
		openCaptions: "生成或检查原声字幕",
		noTranscript: "暂时没有可用的原声字幕。请先到字幕面板生成字幕，或关闭字幕参考。",
		tooMuchText: "请缩短主题说明：说明与所选字幕合计最多 {max} 字符。",
		inputSize: "参考文字",
		measuredVoice: "实际语音时长",
		sceneRoom: "画面可用时长",
		saved: "主题和草稿随工程保存。重新打开后，请再次审阅确认，再加入配音或文字。",
		styles: { concise: "简短介绍", tutorial: "清晰讲述产品故事", detailed: "详细故事" },
		tutorial: "描述操作／步骤教学",
		story: "策划整支视频的故事",
		topic: "主题／产品名称",
		audience: "目标观众",
		facts: "已确认的功能与卖点",
		ending: "希望观众最后做什么？",
		notes: "各段素材说明／画面背景",
		video: "分析视频抽样画面",
		help: "告诉 AI 视频的目的，它会按最多八段素材策划剧情、解说和画面标题。使用前请核对所有产品描述。",
		privacy:
			"画面分析仅用本地视觉模型读取最多八张小图，不是连续观看整段视频，也不识别原声。文字模型采用你的主题、素材说明和主动开启的字幕参考，不会把原始音频发送给 Ollama。原声保留；需要替换时，请在时间轴静音或降低原声音量。",
		vision: "看画面需要视觉模型。qwen3:4b 只能处理文字。可安装 qwen2.5vl:3b，再到智能模式里选择并检查；也可关闭画面分析。",
		frames: "正在准备画面样本",
		draft: "生成视频故事稿",
		required: "请先填写主题，以及产品事实或素材说明。",
		title: "画面标题",
		titles: "将分段标题加入时间轴",
		subtitles: "将解说稿加入文字字幕",
		textAdded: "文字已加入时间轴，可撤销；原有字幕保留。",
		briefChanged: "主题说明已更改，请重新生成故事稿，再加入配音或文字。",
		start: "开始（秒）",
		end: "结束（秒）",
		tooLong: "配音超过了对应画面的时长，请缩短这一句或延长该段时间，再生成：",
		timing: "故事时间必须位于视频片段内，且不能重叠。请调整或重新生成。",
	},
	ms: {
		mode: "Tugas naratif",
		checkModel: "Semak atau tukar model Ollama",
		draftLanguage: "Bahasa suara draf",
		voiceOutdated:
			"Audio naratif terdahulu masih ada dan mungkin tidak sepadan dengan teks, suara atau masa semasa. Semak atau jana semula; baris tidak berubah boleh menggunakan audio sesi ini.",
		transcript: "Gunakan sari kata suara sedia ada sebagai konteks cerita",
		transcriptCount: "Konteks sari kata: {included}/{total}; diketepikan: {omitted}.",
		transcriptPartial:
			"Sari kata yang dipotong tanpa masa perkataan diketepikan supaya kata yang dibuang tidak digunakan semula.",
		openCaptions: "Cipta atau semak sari kata asal",
		noTranscript:
			"Tiada sari kata suara asal yang boleh digunakan. Cipta dalam panel Captions dahulu atau matikan konteks sari kata.",
		tooMuchText:
			"Pendekkan taklimat: taklimat dan sari kata terpilih dihadkan kepada {max} aksara keseluruhan.",
		inputSize: "Teks rujukan",
		measuredVoice: "Tempoh suara sebenar",
		sceneRoom: "Tempoh adegan",
		saved: "Taklimat dan draf disimpan dengan projek. Semak dan luluskan semula selepas dibuka.",
		styles: {
			concise: "Pengenalan ringkas",
			tutorial: "Cerita produk berpandu",
			detailed: "Cerita terperinci",
		},
		tutorial: "Terangkan tindakan / tutorial",
		story: "Rancang cerita seluruh video",
		topic: "Topik / produk",
		audience: "Penonton sasaran",
		facts: "Ciri dan manfaat yang disahkan",
		ending: "Tindakan penonton pada akhir",
		notes: "Nota adegan / konteks rakaman",
		video: "Analisis sampel bingkai video",
		help: "Terangkan tujuan video. AI merancang cerita, naratif dan tajuk untuk sehingga lapan bahagian. Semak semua dakwaan.",
		privacy:
			"Model visual setempat melihat sehingga lapan imej kecil, bukan video berterusan atau suara rakaman. Model teks menggunakan taklimat, nota dan konteks sari kata yang diaktifkan; audio asal tidak dihantar kepada Ollama.",
		vision: "Analisis imej memerlukan model visual. qwen3:4b hanya untuk teks. Pasang qwen2.5vl:3b dan semak dalam mod AI, atau matikan analisis imej.",
		frames: "Menyediakan sampel video",
		draft: "Draf cerita video",
		required: "Isi topik serta fakta produk atau nota adegan dahulu.",
		title: "Tajuk pada skrin",
		titles: "Tambah tajuk adegan pada garis masa",
		subtitles: "Tambah naratif sebagai sari kata",
		textAdded: "Teks ditambah. Boleh buat asal; sari kata sedia ada dikekalkan.",
		briefChanged: "Taklimat berubah. Draf cerita semula sebelum menambah audio atau teks.",
		start: "Mula (saat)",
		end: "Tamat (saat)",
		tooLong:
			"Suara melebihi masa adegan. Pendekkan baris atau panjangkan adegan dan jana semula:",
		timing: "Masa cerita mesti berada dalam klip tanpa bertindih. Laraskan atau draf semula.",
	},
};
export function StoryBriefEditor({
	value,
	onChange,
	language,
	disabled,
	visionAvailable,
	transcriptInfo,
	onOpenCaptions,
}: {
	value: StoryBrief;
	onChange: (value: StoryBrief) => void;
	language: PlanLanguage;
	disabled: boolean;
	visionAvailable: boolean;
	transcriptInfo?: ReturnType<typeof buildStoryTranscript>;
	onOpenCaptions?: () => void;
}) {
	const c = storyCopy[language];
	return (
		<div className="space-y-3 rounded-xl border border-blue-400/30 p-3" data-story-brief>
			<p className="text-sm">{c.help}</p>
			<p className="text-xs text-muted-foreground">{c.saved}</p>
			{(["topic", "audience", "facts", "ending", "notes"] as const).map((key) => (
				<label key={key} className="flex flex-col gap-1 text-sm">
					{c[key]}
					<textarea
						aria-label={c[key]}
						disabled={disabled}
						rows={key === "facts" || key === "notes" ? 3 : 2}
						maxLength={2000}
						value={value[key]}
						onChange={(e) => onChange({ ...value, [key]: e.target.value })}
						className="w-full rounded-lg border bg-background p-2"
					/>
				</label>
			))}
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					disabled={disabled}
					checked={value.analyzeVideo}
					onChange={(e) => onChange({ ...value, analyzeVideo: e.target.checked })}
				/>
				{c.video}
			</label>
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					disabled={disabled}
					checked={value.includeTranscript === true}
					onChange={(e) => onChange({ ...value, includeTranscript: e.target.checked })}
				/>
				{c.transcript}
			</label>
			{value.includeTranscript && (
				<div className="space-y-2 text-xs text-muted-foreground">
					<p>
						{c.transcriptCount
							.replace("{included}", String(transcriptInfo?.includedCues ?? 0))
							.replace("{total}", String(transcriptInfo?.totalCues ?? 0))
							.replace("{omitted}", String(transcriptInfo?.omittedCues ?? 0))}
					</p>
					{!!transcriptInfo?.omittedPartialCues && <p>{c.transcriptPartial}</p>}
					{onOpenCaptions && (
						<button
							type="button"
							disabled={disabled}
							onClick={onOpenCaptions}
							className="rounded-lg border px-3 py-2 text-sm text-foreground"
						>
							{c.openCaptions}
						</button>
					)}
				</div>
			)}
			<p className="text-xs text-muted-foreground">
				{c.inputSize}:{" "}
				{storyBriefCharacterCount(value) +
					(value.includeTranscript ? (transcriptInfo?.includedCharacters ?? 0) : 0)}{" "}
				/ {storyTextBudget(value)}
			</p>
			<p className="text-xs text-muted-foreground">{c.privacy}</p>
			{value.analyzeVideo && !visionAvailable && (
				<p className="rounded-lg border border-amber-500/40 p-2 text-sm">
					{c.vision}
					<code className="block select-all pt-2">ollama pull qwen2.5vl:3b</code>
				</p>
			)}
		</div>
	);
}
