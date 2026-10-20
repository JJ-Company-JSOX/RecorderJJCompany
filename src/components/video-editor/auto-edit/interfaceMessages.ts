export const interfaceMessages = {
	en: {
		title: "AI auto edit",
		noAudio:
			"No audio was found. Speech editing was not applied; your video is unchanged. Enable the microphone for narration or system audio for computer sounds, then record again. Existing audio cannot be recovered from a silent video.",
		visualAlternative: "Review a visual-only plan instead",
		silentFallback:
			"No audio was found, so this plan was built from the picture only (pauses, clicks and zooms). Nothing was recovered or invented for the missing sound. You can still draft and generate AI narration below.",
		noChanges:
			"Analysis finished. No safe automatic edits were found, so your video is unchanged. Keeping the whole frame also disables automatic zooms.",
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
		title: "AI 自动剪辑",
		noAudio:
			"没有找到音轨，未执行语音剪辑，视频保持不变。需要讲解请开启麦克风，需要电脑声音请开启系统声音，再重新录制。无法从无声视频恢复当时的声音。",
		visualAlternative: "改为审阅画面分析建议",
		silentFallback:
			"没有检测到声音，所以这份方案只根据画面生成（停顿、点击和缩放），不会恢复或编造原本的声音。你仍然可以在下方生成 AI 解说稿和配音。",
		noChanges:
			"分析已完成，没有找到可安全自动修改的内容，视频保持不变。勾选保持全画面时，也不会自动添加放大效果。",
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
		title: "Suntingan automatik AI",
		noAudio:
			"Tiada audio ditemui. Suntingan pertuturan tidak digunakan; video tidak berubah. Aktifkan mikrofon untuk narasi atau audio sistem untuk bunyi komputer, kemudian rakam semula. Audio asal tidak boleh dipulihkan daripada video tanpa suara.",
		visualAlternative: "Semak pelan visual sahaja",
		silentFallback:
			"Tiada audio ditemui, jadi pelan ini dibina daripada gambar sahaja (jeda, klik dan zum). Tiada bunyi dipulihkan atau direka. Anda masih boleh mendraf dan menjana naratif AI di bawah.",
		noChanges:
			"Analisis selesai. Tiada suntingan automatik yang selamat ditemui; video tidak berubah. Pilihan bingkai penuh turut mematikan zum automatik.",
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
