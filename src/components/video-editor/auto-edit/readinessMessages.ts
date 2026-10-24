export const readinessMessages = {
	en: {
		unavailable: "AI is not ready",
		checkFailed:
			"Could not check the local AI components. Check again; if this continues, restart the desktop app.",
		unsupported:
			"The bundled AI and speech runtimes currently require Windows x64. Local rule-based analysis is still available.",
		noVideo: "Open a recording with at least one video clip before starting.",
		memoryLow:
			"AI requires at least 3 GiB of available RAM. Close other apps, then check again.",
		recheck: "Check again",
		local: "Use local analysis without AI",
		localHelp:
			"Find silence, unchanged frames and recorded clicks for review. This does not recognize speech or generate new subtitles, and needs no AI models.",
		setup: "Source builds do not include the large AI models. The complete offline edition includes them; npm install alone does not prepare them.",
	},
	zh: {
		unavailable: "AI 尚未就绪",
		checkFailed: "无法检查本地 AI 组件，请重新检查；若仍失败，请重启桌面程序。",
		unsupported: "当前内置 AI 和语音运行组件仅支持 Windows x64；仍可使用本地规则分析。",
		noVideo: "请先打开录屏，并确保时间轴中至少有一个视频片段。",
		memoryLow: "AI 至少需要 3 GiB 可用内存。请关闭其他程序后重新检查。",
		recheck: "重新检查",
		local: "先用本地分析（无需 AI 模型）",
		localHelp:
			"根据静音、静止画面和已记录的点击生成待审阅建议，不识别语音或生成新字幕，无需下载 AI 模型。",
		setup: "源码开发版不包含大型 AI 模型，完整离线版才随附这些资源；仅运行 npm install 不会准备模型。",
	},
	ms: {
		unavailable: "AI belum sedia",
		checkFailed:
			"Komponen AI tempatan tidak dapat diperiksa. Semak semula; jika masih gagal, mulakan semula aplikasi desktop.",
		unsupported:
			"Runtime AI dan pertuturan terbina dalam memerlukan Windows x64. Analisis berasaskan peraturan tempatan masih tersedia.",
		noVideo: "Buka rakaman dengan sekurang-kurangnya satu klip video sebelum bermula.",
		memoryLow:
			"AI memerlukan sekurang-kurangnya 3 GiB RAM tersedia. Tutup aplikasi lain dan semak semula.",
		recheck: "Semak semula",
		local: "Gunakan analisis tempatan tanpa AI",
		localHelp:
			"Cari senyap, bingkai tidak berubah dan klik yang dirakam untuk semakan. Tiada pengecaman pertuturan atau sari kata baharu, dan tidak memerlukan model AI.",
		setup: "Binaan kod sumber tidak menyertakan model AI besar. Edisi luar talian lengkap menyertakannya; npm install sahaja tidak menyediakan model.",
	},
} as const;
