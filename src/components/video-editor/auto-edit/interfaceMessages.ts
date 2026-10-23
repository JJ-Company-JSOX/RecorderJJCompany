export const interfaceMessages = {
	en: {
		recognitionLanguage: "Recognition language",
		detectLanguage: "Detect automatically",
		recognitionLanguageHelp:
			"Select the language spoken in the recording. This is separate from the interface language; the choice is remembered on this computer.",
		title: "AI auto edit",
		silentFallback:
			"No sound was found, so this edit was built from the picture only: frozen parts are cut, idle parts are sped up and clicks are zoomed. Nothing was invented for the missing sound. Next, AI voice-over can add a voice and subtitles.",
		noChanges:
			"Analysis finished. No safe automatic edits were found, so your video is unchanged. If “Zoom in where I click” is off, no zooms are added.",
		language: "Interface language",
		badge: "Offline · stays on this computer",
		intro: "Turn a recording into a first draft, then check it before exporting.",
		steps: ["Start AI editing", "Check the draft", "Export your video"],
		stepHelp: [
			"Cut pauses, speed up quiet parts, zoom on clicks and add subtitles.",
			"Preview the result. Undo any time.",
			"Return to the editor and choose Export.",
		],
		start: "Start automatic editing",
		options: "Draft settings",
		ready: "Ready to edit",
		checking: "Checking included AI…",
		actionHelp:
			"No account, internet or extra installation needed. Your original video is preserved.",
		progress: "Working on your draft",
		wait: "Keep this window open. CPU analysis can take longer than the video itself.",
		result: "Your draft is ready",
		next: "Next: return to the editor, play the result, then choose Export in the top right.",
		back: "Back to editor",
		other: "Other analysis tools",
		otherHelp:
			"Optional alternatives. These generate suggestions for review, without automatically applying them.",
		hardware: "Which computers can run this?",
		requirements:
			"This offline edition: Windows x64, an AVX2-capable CPU and 16 GB RAM recommended. Integrated graphics are enough; AI currently runs on the CPU.",
		storage:
			"Use an SSD and leave at least 10 GB free for installation and temporary files, plus space for recordings and exports. 32 GB RAM is preferable for 4K or heavier editing; it is guidance, not a tested guarantee.",
		memory: "Available RAM now",
		memoryLow:
			"Available RAM is below the AI launch threshold. Close other apps before starting.",
		hardwareNote:
			"Windows ARM, Mac and Linux are not supported by this package. CPU requirements and speed vary; see the hardware guide.",
		reviewTitle: "Review the suggested edits",
		technical: "Analysis details",
	},
	zh: {
		recognitionLanguage: "语音识别语言",
		detectLanguage: "自动检测",
		recognitionLanguageHelp:
			"选择录音中实际使用的语言，与界面语言分开设置；此电脑会记住你的选择。",
		title: "AI 自动剪辑",
		silentFallback:
			"没有检测到声音，所以这次只根据画面剪辑：画面不动的地方剪掉，没有操作的地方加速，点击的地方放大，不会编造原本的声音。下一步可以用 AI 配音，同时自动加上字幕。",
		noChanges:
			"分析已完成，没有找到可安全自动修改的内容，视频保持不变。如果关掉了“在我点击的地方自动放大”，也不会添加放大效果。",
		language: "界面语言",
		badge: "完全离线 · 视频留在本机",
		intro: "先生成剪辑草稿，检查满意后再导出。",
		steps: ["开始自动剪辑", "检查剪辑结果", "导出视频"],
		stepHelp: [
			"剪掉停顿、加速没人说话的片段、按点击缩放，并生成字幕。",
			"播放检查，随时可以撤销。",
			"返回编辑器，点击右上角导出。",
		],
		start: "开始自动剪辑",
		options: "草稿设置",
		ready: "可以开始剪辑",
		checking: "正在检查内置 AI…",
		actionHelp: "无需账号、联网或额外安装。原视频会保留。",
		progress: "正在制作剪辑草稿",
		wait: "请保持窗口打开。CPU 分析可能比视频本身更耗时。",
		result: "剪辑草稿已完成",
		next: "下一步：返回编辑器，播放检查结果，然后点击右上角「导出」。",
		back: "返回编辑器",
		other: "其他分析工具",
		otherHelp: "可选的替代分析方式，只生成待审阅建议，不会自动应用。",
		hardware: "什么电脑适合使用？",
		requirements:
			"当前离线版适用于 Windows x64，CPU 需支持 AVX2，建议 16GB 内存。核显即可运行；目前 AI 使用 CPU 计算。",
		storage:
			"建议 SSD，安装和临时文件至少预留 10GB，另加录屏及导出空间。4K 或较重编辑建议 32GB 内存；这是配置建议，尚非实测保证。",
		memory: "当前可用内存",
		memoryLow: "当前可用内存低于 AI 启动门槛，请先关闭其他占内存的软件。",
		hardwareNote:
			"此安装包不支持 Windows ARM、Mac 或 Linux。CPU 具体要求和速度请参阅硬件说明。",
		reviewTitle: "检查建议的修改",
		technical: "分析详情",
	},
	ms: {
		recognitionLanguage: "Bahasa pengecaman suara",
		detectLanguage: "Kesan secara automatik",
		recognitionLanguageHelp:
			"Pilih bahasa pertuturan dalam rakaman, berasingan daripada bahasa antara muka. Pilihan diingati pada komputer ini.",
		title: "Suntingan automatik AI",
		silentFallback:
			"Tiada bunyi ditemui, jadi suntingan ini dibina daripada gambar sahaja: bahagian beku dipotong, bahagian tanpa aktiviti dipercepat dan klik dizum. Tiada bunyi direka. Seterusnya, suara AI boleh menambah suara dan sari kata.",
		noChanges:
			"Analisis selesai. Tiada suntingan automatik yang selamat ditemui; video tidak berubah. Jika “Zum di tempat saya klik” dimatikan, tiada zum ditambah.",
		language: "Bahasa antara muka",
		badge: "Luar talian · video kekal di komputer ini",
		intro: "Hasilkan draf dahulu, semak hasilnya, kemudian eksport.",
		steps: ["Mulakan suntingan AI", "Semak draf", "Eksport video"],
		stepHelp: [
			"Potong jeda, percepat bahagian senyap, zum pada klik dan tambah sari kata.",
			"Pratonton hasil. Buat asal bila-bila masa.",
			"Kembali ke editor dan pilih Eksport.",
		],
		start: "Mulakan suntingan automatik",
		options: "Tetapan draf",
		ready: "Sedia untuk menyunting",
		checking: "Memeriksa AI terbina dalam…",
		actionHelp:
			"Tidak memerlukan akaun, internet atau pemasangan tambahan. Video asal dikekalkan.",
		progress: "Menyediakan draf anda",
		wait: "Biarkan tetingkap ini terbuka. Analisis CPU boleh mengambil masa lebih lama daripada video.",
		result: "Draf anda sedia",
		next: "Seterusnya: kembali ke editor, mainkan hasil, kemudian pilih Eksport di kanan atas.",
		back: "Kembali ke editor",
		other: "Alat analisis lain",
		otherHelp:
			"Pilihan tambahan ini menjana cadangan untuk semakan, tanpa menggunakannya secara automatik.",
		hardware: "Komputer yang sesuai?",
		requirements:
			"Edisi ini: Windows x64, CPU dengan AVX2 dan RAM 16 GB disyorkan. Grafik bersepadu mencukupi; AI kini menggunakan CPU.",
		storage:
			"Gunakan SSD dengan ruang kosong sekurang-kurangnya 10 GB, serta ruang rakaman dan eksport. RAM 32 GB lebih sesuai untuk 4K atau suntingan berat; ini panduan, bukan jaminan yang diuji.",
		memory: "RAM tersedia sekarang",
		memoryLow: "RAM tersedia kurang daripada ambang AI. Tutup aplikasi lain sebelum bermula.",
		hardwareNote:
			"Pakej ini tidak menyokong Windows ARM, Mac atau Linux. Lihat panduan perkakasan untuk keperluan CPU dan kelajuan.",
		reviewTitle: "Semak cadangan suntingan",
		technical: "Butiran analisis",
	},
} as const;
