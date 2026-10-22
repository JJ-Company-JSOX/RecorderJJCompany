import { BrowserWindow } from "electron";
import { registerAnnouncementHandlers } from "./register/announcements";
import { registerCapturePickerHandlers } from "./register/capturePicker";
import { registerAssetHandlers } from "./register/assets";
import { registerCaptionHandlers } from "./register/captions";
import { openBundledOcr } from "./autoEdit/ocr/bundledOcr";
import { registerAutoEditHandlers } from "./register/autoEdit";
import { registerCloudShareHandlers } from "./register/cloudShare";
import { registerExportHandlers } from "./register/export";
import { registerPermissionHandlers } from "./register/permissions";
import { registerProjectHandlers } from "./register/project";
import { registerRecordingHandlers } from "./register/recording";
import { registerSettingsHandlers } from "./register/settings";
import { registerSourceHandlers } from "./register/sources";
import {
	selectedSource,
	setNativeScreenRecordingActive,
	setWindowsCapturePaused,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsMicAudioPath,
	setWindowsNativeCaptureActive,
	setWindowsOrphanedMicAudioPath,
	setWindowsPendingVideoPath,
	setWindowsSystemAudioPath,
	windowsCaptureProcess,
} from "./state";

export { cleanupAllExportStreams } from "./export/exportStream";
export { cleanupNativeVideoExportSessions } from "./export/native-video";

/** Returns the currently selected source ID for setDisplayMediaRequestHandler */
export function getSelectedSourceId(): string | null {
	return (selectedSource?.id as string | null) ?? null;
}

export function killWindowsCaptureProcess() {
	if (windowsCaptureProcess) {
		try {
			windowsCaptureProcess.kill();
		} catch {
			/* ignore */
		}
		setWindowsCaptureProcess(null);
		setWindowsCaptureTargetPath(null);
		setWindowsNativeCaptureActive(false);
		setNativeScreenRecordingActive(false);
		setWindowsCaptureStopRequested(false);
		setWindowsCapturePaused(false);
		setWindowsSystemAudioPath(null);
		setWindowsMicAudioPath(null);
		setWindowsOrphanedMicAudioPath(null);
		setWindowsPendingVideoPath(null);
	}
}

export function registerIpcHandlers(
	createEditorWindow: () => void,
	createSourceSelectorWindow: () => BrowserWindow,
	_getMainWindow: () => BrowserWindow | null,
	getSourceSelectorWindow: () => BrowserWindow | null,
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
) {
	const { pickSourceList } = registerSourceHandlers({
		createEditorWindow,
		createSourceSelectorWindow,
		getSourceSelectorWindow,
	});
	registerCapturePickerHandlers({ pickSourceList });
	registerRecordingHandlers(onRecordingStateChange);
	registerPermissionHandlers();
	registerAnnouncementHandlers();
	registerAssetHandlers();
	registerExportHandlers();
	registerCaptionHandlers();
	// Each voice-over job opens its own OCR engine when the build ships the OCR models.
	registerAutoEditHandlers({ openOcr: (signal) => openBundledOcr(signal) });
	registerCloudShareHandlers();
	registerProjectHandlers();
	registerSettingsHandlers();
}
