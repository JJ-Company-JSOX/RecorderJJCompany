export interface HudOverlayTaskbarOptions {
	skipTaskbar: boolean;
	focusable: boolean;
}

/** The large Windows setup is a normal window; only the small controls are an overlay. */
export function isHudSetupWindow(
	platform: NodeJS.Platform,
	setupVisible: boolean,
	recordingActive: boolean,
): boolean {
	return platform === "win32" && setupVisible && !recordingActive;
}

export function getHudOverlayTaskbarOptions(platform: NodeJS.Platform): HudOverlayTaskbarOptions {
	const showInWindowsTaskbar = platform === "win32";
	return {
		skipTaskbar: !showInWindowsTaskbar,
		focusable: showInWindowsTaskbar,
	};
}
