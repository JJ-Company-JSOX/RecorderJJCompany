export const speedMessages = {
	en: {
		mode: "Editing mode",
		fast: "Fast edit (default)",
		speech: "Fast edit + subtitles",
		full: "Full AI analysis (slower)",
		fastHelp:
			"Cuts verified silent/static pauses and zooms recorded clicks. No AI model loading or new speech subtitles. Apply, review and Undo use the same timeline.",
		speechHelp:
			"Adds local speech recognition and subtitles. Skips language-model reasoning and visual AI; does not detect repeated takes semantically.",
		fullHelp:
			"Recognizes speech, reviews repeated takes and analyzes screen details. Requires both model bundles and takes longer on the CPU.",
		startFast: "Start fast editing",
		startSpeech: "Start editing with subtitles",
	},
	zh: {
		mode: "剪辑模式",
		fast: "快速剪辑（默认）",
		speech: "快速剪辑＋字幕",
		full: "完整 AI 分析（较慢）",
		fastHelp:
			"根据已确认的静音、静止画面和录制点击剪辑，不加载 AI 模型或识别新字幕。仍可自动应用、审阅和撤销。",
		speechHelp:
			"增加本地语音识别和字幕，跳过大模型语义推理与画面 AI 分析；不按语义识别重复录制。",
		fullHelp: "识别语音、分析重复录制与画面重点；需要两套模型，在 CPU 上耗时更长。",
		startFast: "开始快速剪辑",
		startSpeech: "开始剪辑并生成字幕",
	},
	ms: {
		mode: "Mod suntingan",
		fast: "Suntingan pantas (lalai)",
		speech: "Suntingan pantas + sari kata",
		full: "Analisis AI penuh (lebih lambat)",
		fastHelp:
			"Potong jeda senyap/statik yang disahkan dan zum klik dirakam. Tiada pemuatan model AI atau sari kata pertuturan baharu. Guna, semak dan buat asal pada garis masa yang sama.",
		speechHelp:
			"Tambah pengecaman pertuturan tempatan dan sari kata. Langkau penaakulan model bahasa dan AI visual; tiada pengesanan ulangan secara semantik.",
		fullHelp:
			"Kenal pasti pertuturan, semak ulangan dan analisis butiran skrin. Memerlukan kedua-dua model dan lebih masa CPU.",
		startFast: "Mulakan suntingan pantas",
		startSpeech: "Mulakan suntingan dengan sari kata",
	},
} as const;
