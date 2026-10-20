export const guideMessages = {
	en: {
		title: "How to use AI auto edit",
		steps: [
			"Record with your microphone on and talk while you work. Silent recordings still work, but can only be edited from the picture.",
			"Click “Start automatic editing” and keep this window open. It usually takes a few minutes.",
			"Go back to the editor and play the result. Not happy? Press Ctrl+Z to undo.",
			"Want an AI voice-over? On the result screen choose “Next: add AI voice-over”: draft the lines, edit them, tick to approve, then generate the voice.",
			"When it looks right, choose Export in the top-right corner of the editor.",
		],
		termsTitle: "What the words mean",
		terms: [
			["Available", "Edits that can be applied to your video."],
			[
				"Protected",
				"Edits the AI found but did not apply, so it does not damage your video. The reason is written under each one. Most often you already have a zoom or text there.",
			],
			["Review required", "Available edits you have not accepted or rejected yet."],
			["Accept", "Edits you chose to apply."],
		] as Array<[string, string]>,
		summaryHelp:
			"“Protected” edits were found but left out on purpose; the reason is shown under each one.",
	},
	zh: {
		title: "怎么使用 AI 自动剪辑",
		steps: [
			"录制时打开麦克风，边操作边讲解。没有声音也能用，但只能按画面来剪。",
			"点“开始自动剪辑”，保持这个窗口打开，一般需要几分钟。",
			"回到编辑器播放检查。不满意就按 Ctrl+Z 撤销。",
			"想要 AI 配音：在结果页面点“下一步：加 AI 配音”，然后生成草稿 → 修改文字 → 勾选确认 → 生成解说语音。",
			"满意后，在编辑器右上角点“导出”。",
		],
		termsTitle: "名词解释",
		terms: [
			["可用建议", "可以套用到视频上的修改。"],
			[
				"已保护",
				"AI 找到了，但为了不弄坏你的视频没有套用。每一条下面都写着原因，最常见的是那一段你已经有缩放或文字了。",
			],
			["待审阅", "还没决定接受或拒绝的可用建议。"],
			["接受", "你选择要套用的修改。"],
		] as Array<[string, string]>,
		summaryHelp: "“已保护”是 AI 找到但特意没有套用的修改，原因写在每一条下面。",
	},
	ms: {
		title: "Cara menggunakan suntingan automatik AI",
		steps: [
			"Rakam dengan mikrofon dihidupkan dan bercakap sambil bekerja. Rakaman senyap masih boleh, tetapi hanya disunting berdasarkan gambar.",
			"Klik “Mulakan suntingan automatik” dan biarkan tetingkap ini terbuka. Biasanya beberapa minit.",
			"Kembali ke editor dan mainkan hasilnya. Tidak puas hati? Tekan Ctrl+Z untuk buat asal.",
			"Mahu suara AI? Di skrin hasil pilih “Seterusnya: tambah suara AI”: draf baris, suntingnya, tanda untuk lulus, kemudian jana suara.",
			"Apabila sudah betul, pilih Eksport di penjuru kanan atas editor.",
		],
		termsTitle: "Maksud istilah",
		terms: [
			["Tersedia", "Suntingan yang boleh digunakan pada video anda."],
			[
				"Dilindungi",
				"Suntingan yang ditemui AI tetapi tidak digunakan supaya video anda tidak rosak. Sebabnya ditulis di bawah setiap satu. Selalunya anda sudah ada zum atau teks di situ.",
			],
			["Perlu disemak", "Suntingan tersedia yang belum anda terima atau tolak."],
			["Terima", "Suntingan yang anda pilih untuk digunakan."],
		] as Array<[string, string]>,
		summaryHelp:
			"Suntingan “Dilindungi” ditemui tetapi sengaja tidak digunakan; sebabnya dipaparkan di bawah setiap satu.",
	},
};
