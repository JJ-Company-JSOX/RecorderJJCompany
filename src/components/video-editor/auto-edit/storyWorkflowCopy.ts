export const storyWorkflowCopy = {
	en: {
		originalLanguage: "Original speech language",
		autoTranscribe: "Recognize original audio and use it for the story",
		autoInfo:
			"Runs local speech recognition before story planning. Recognized text is kept separately; your existing subtitles are preserved. Nothing is spoken until you approve the story.",
		analyzeAndDraft: "Analyze original audio and draft story",
		originalText: "Recognized original speech",
		refreshSpeech: "Reanalyze original audio and story",
		continueWithoutSpeech: "Continue with brief / frames only",
		exportVideo: "Export this video",
		target: "Narration target (seconds, optional)",
		followVideo: "Follow footage",
		invalidTarget: "Narration target must be a whole number from 5 to 600 seconds.",
		speechBudget:
			"Narration goal: {wanted} s · Footage: {available} s · Script pacing budget: {budget} s. This does not trim or extend the video; final voice length depends on synthesis.",
		cpuPreset: "Use lightweight CPU settings",
		cpuInfo:
			"For 16 GB RAM without a dedicated GPU: use speech plus text/notes first. Visual analysis is slower on CPU. Everything runs on this computer with the included AI; nothing extra is installed, and no video-generation model or paid API is used.",
		required:
			"Enter a creative request or topic first. Product facts and scene notes can be added below.",
		audioStages: {
			"checking-model": "Checking installed speech model",
			preparing: "Preparing original audio",
			transcribing: "Recognizing original speech",
			complete: "Original speech recognized",
			cancelled: "Speech recognition cancelled",
			error: "Speech recognition failed",
		},
		audioErrors: {
			"consent-required": "Enable original-audio recognition first.",
			"missing-source": "Open a recording or video first.",
			"missing-model":
				"The local speech model is missing. Open Captions to set it up, or continue with the brief only.",
			cancelled: "Speech recognition was cancelled; existing edits were kept.",
			stale: "The source or timeline changed. Retry on the current video.",
			busy: "Another speech task is running. Wait or cancel it before retrying.",
			"no-audio": "No original audio was found. Continue with the brief or sampled frames.",
			"no-speech":
				"No speech was recognized. Check the recognition language or continue without speech.",
			"not-approved": "Reopen the approved local video before recognizing audio.",
			"invalid-input": "The speech request is invalid. Reopen the video and retry.",
			"invalid-result":
				"Speech recognition returned invalid timings or oversized results; existing edits were kept.",
			failed: "Could not recognize original audio. Retry or continue without speech.",
		},
	},
	zh: {
		originalLanguage: "原声识别语言",
		autoTranscribe: "识别原声音频，再结合内容策划故事",
		autoInfo:
			"先在本机识别原声，再写故事稿。识别文字独立保留，不覆盖已有字幕；确认故事稿之前不会生成配音。",
		analyzeAndDraft: "分析原声并生成故事稿",
		originalText: "原声识别文字",
		refreshSpeech: "重新分析原声和故事",
		continueWithoutSpeech: "仅按要求／画面继续",
		exportVideo: "导出这个视频",
		target: "旁白目标时长（秒，选填）",
		followVideo: "跟随素材",
		invalidTarget: "旁白目标时长请填写 5 至 600 的整数秒。",
		speechBudget:
			"旁白目标：{wanted} 秒 · 素材：{available} 秒 · 文案节奏预算：{budget} 秒。此设置不会剪短或延长视频；实际配音长度以合成为准。",
		cpuPreset: "使用轻量 CPU 设置",
		cpuInfo:
			"适合 16GB 内存、无独立显卡：优先用原声文字和素材说明。CPU 看画面会较慢。全部在这台电脑上用内置 AI 完成，不需要另外安装，也不使用视频生成模型或付费 API。",
		required: "请先填写创作要求或主题，产品事实和素材说明可在下方补充。",
		audioStages: {
			"checking-model": "正在检查本地语音模型",
			preparing: "正在准备原声音频",
			transcribing: "正在识别原声",
			complete: "原声识别完成",
			cancelled: "已取消原声识别",
			error: "原声识别失败",
		},
		audioErrors: {
			"consent-required": "请先开启原声识别。",
			"missing-source": "请先打开录制或导入的视频。",
			"missing-model": "缺少本地语音模型。请到字幕面板安装，或仅按创作要求继续。",
			cancelled: "已取消识别，现有编辑保留。",
			stale: "素材或时间轴已改变，请按当前视频重新分析。",
			busy: "另一个语音任务正在运行，请等待或取消后重试。",
			"no-audio": "这段视频没有找到原声，可仅按创作要求或抽样画面继续。",
			"no-speech": "原声没有识别出语音，请检查识别语言或不使用原声继续。",
			"not-approved": "请重新打开已授权的本地视频后再识别。",
			"invalid-input": "识别请求无效，请重新打开视频后重试。",
			"invalid-result": "语音识别返回了无效时间或过多内容，现有编辑已保留。",
			failed: "未能识别原声，请重试或不使用原声继续。",
		},
	},
	ms: {
		originalLanguage: "Bahasa suara asal",
		autoTranscribe: "Kenal pasti audio asal untuk merancang cerita",
		autoInfo:
			"Pengecaman suara setempat dijalankan dahulu. Teks disimpan berasingan tanpa menggantikan sari kata sedia ada. Suara naratif hanya dijana selepas kelulusan.",
		analyzeAndDraft: "Analisis audio asal dan draf cerita",
		originalText: "Teks suara asal",
		refreshSpeech: "Analisis semula audio dan cerita",
		continueWithoutSpeech: "Teruskan dengan taklimat / imej",
		exportVideo: "Eksport video ini",
		target: "Sasaran naratif (saat, pilihan)",
		followVideo: "Ikut rakaman",
		invalidTarget: "Sasaran naratif mestilah integer 5 hingga 600 saat.",
		speechBudget:
			"Sasaran: {wanted} s · Rakaman: {available} s · Bajet skrip: {budget} s. Ini tidak memotong atau memanjangkan video; tempoh suara mengikut sintesis.",
		cpuPreset: "Gunakan tetapan CPU ringan",
		cpuInfo:
			"Untuk RAM16GB tanpa GPU khusus: utamakan teks suara dan nota. Analisis imej CPU lebih perlahan. Semuanya berjalan pada komputer ini dengan AI terbina dalam; tiada pemasangan tambahan, model penjana video atau API berbayar.",
		required:
			"Isi permintaan kreatif atau topik dahulu. Fakta produk dan nota boleh ditambah di bawah.",
		audioStages: {
			"checking-model": "Menyemak model suara",
			preparing: "Menyediakan audio asal",
			transcribing: "Mengecam suara asal",
			complete: "Suara asal dikenal pasti",
			cancelled: "Pengecaman dibatalkan",
			error: "Pengecaman gagal",
		},
		audioErrors: {
			"consent-required": "Aktifkan pengecaman audio asal dahulu.",
			"missing-source": "Buka rakaman atau video dahulu.",
			"missing-model":
				"Model suara setempat tiada. Sediakan melalui Captions atau teruskan dengan taklimat.",
			cancelled: "Pengecaman dibatalkan; suntingan dikekalkan.",
			stale: "Sumber atau garis masa berubah. Cuba semula.",
			busy: "Tugas suara lain sedang berjalan. Tunggu atau batalkan.",
			"no-audio": "Tiada audio asal. Teruskan dengan taklimat atau sampel imej.",
			"no-speech": "Tiada pertuturan dikesan. Semak bahasa atau teruskan tanpa suara asal.",
			"not-approved": "Buka semula video setempat yang diluluskan.",
			"invalid-input": "Permintaan tidak sah. Buka video semula.",
			"invalid-result":
				"Pengecaman memulangkan masa atau jumlah teks tidak sah; suntingan dikekalkan.",
			failed: "Pengecaman gagal. Cuba lagi atau teruskan tanpa suara asal.",
		},
	},
};
