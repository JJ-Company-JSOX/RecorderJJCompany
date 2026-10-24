export function systemAudioUnavailableMessage(locale: string) {
	if (locale.startsWith("zh"))
		return "系统声音捕获失败，本次录制将没有电脑播放的声音。请检查 Windows 声音输出设备，再重新开始录制。";
	if (locale.startsWith("ms"))
		return "Audio sistem tidak dapat dirakam. Rakaman ini diteruskan tanpa bunyi komputer. Semak peranti output bunyi, kemudian mulakan rakaman baharu.";
	return "System audio could not be captured. This recording will continue without computer playback sound. Check your sound output device, then start a new recording.";
}
