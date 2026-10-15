export const visionMessages = {
	en: {
		zoom: "AI suggested zoom",
		title: "Local visual analysis · experimental",
		info: "Sends 8 sampled frames (up to 640×360) to the installed vision model on this computer only. No audio or original video file is sent. Single frames can miss fast actions and cannot prove a segment is safe to cut. AI adds zoom/text suggestions; cuts and speed changes still require rule evidence. Do not analyze sensitive screens on a shared Ollama service.",
		consent: "I agree to send these sampled images to my local Ollama service.",
		analyze: "Analyze video frames",
		busy: "Analyzing sampled frames",
		reason: "Suggestion from sampled screen content; verify against the original.",
		warning:
			"Sparse samples only. Fast changes, small text and speech meaning may be missed. This is not a complete semantic video edit.",
		visionRequired:
			"Install a local vision-capable model, inspect it and review its license first.",
		result: "Visual samples analyzed",
	},
	zh: {
		zoom: "AI 建议缩放",
		title: "本地画面 AI 分析 · 实验版",
		info: "仅向本机已安装的视觉模型发送 8 张抽样画面（最大 640×360），不发送音频或原视频文件。单帧会漏掉快速操作，不能证明某段可安全删除。AI 新增缩放／文字建议；剪切与变速仍需规则证据。共享 Ollama 服务上不要分析敏感画面。",
		consent: "我同意将这些抽样画面交给本机 Ollama 分析。",
		analyze: "分析视频画面",
		busy: "正在分析抽样画面",
		reason: "根据抽样画面提出的建议，请对照原视频确认。",
		warning: "只分析稀疏抽样，可能漏掉快速变化、小字和语音含义；不是完整的语义剪辑。",
		visionRequired: "请先安装有视觉能力的本地模型，检查模型并阅读许可证。",
		result: "已分析画面样本",
	},
	ms: {
		zoom: "Cadangan zum AI",
		title: "Analisis visual setempat · eksperimen",
		info: "Menghantar 8 bingkai sampel (maksimum 640×360) hanya kepada model visual pada komputer ini. Tiada audio atau fail video asal dihantar. Sampel mungkin terlepas tindakan pantas. AI mencadangkan zum/teks; potongan dan kelajuan masih memerlukan bukti peraturan. Elakkan skrin sensitif pada perkhidmatan Ollama yang dikongsi.",
		consent: "Saya bersetuju menghantar bingkai sampel kepada Ollama setempat.",
		analyze: "Analisis bingkai video",
		busy: "Menganalisis bingkai sampel",
		reason: "Cadangan daripada sampel skrin; semak video asal.",
		warning:
			"Sampel jarang mungkin terlepas perubahan pantas, teks kecil dan makna pertuturan. Ini bukan suntingan semantik lengkap.",
		visionRequired: "Pasang model visual setempat, periksa model dan lesennya dahulu.",
		result: "Sampel visual dianalisis",
	},
};
