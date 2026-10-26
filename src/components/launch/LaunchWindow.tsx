import {
	discardStoryIntent,
	refreshStoryIntent,
	stageStoryIntent,
} from "../video-editor/auto-edit/storyIntent";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwiseIcon, DotsThreeVerticalIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "../../contexts/I18nContext";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { useVideoDevices } from "../../hooks/useVideoDevices";
import { HudInteractionContext } from "./contexts/HudInteractionContext";
import {
	canToggleFloatingWebcamPreview,
	WEBCAM_PREVIEW_RESIZE_HANDLES,
} from "./floatingWebcamPreview";
import { useHudBarDrag } from "./hooks/useHudBarDrag";
import { useLaunchHudInteractionState } from "./hooks/useLaunchHudInteractionState";
import { useLaunchWindowActions } from "./hooks/useLaunchWindowActions";
import { useLaunchWindowSystemState } from "./hooks/useLaunchWindowSystemState";
import { useRecordingTimer } from "./hooks/useRecordingTimer";
import { useWebcamPreviewOverlay } from "./hooks/useWebcamPreviewOverlay";
import styles from "./LaunchWindow.module.css";
import {
	LaunchPopoverCoordinatorProvider,
	useLaunchPopoverCoordinator,
} from "./popovers/LaunchPopoverCoordinator";
import { RecordingControls } from "./RecordingControls";
import { RecordingReadyBar } from "./RecordingReadyBar";
import { RecordingSetupPanel } from "./RecordingSetupPanel";

export function LaunchWindow() {
	return (
		<LaunchPopoverCoordinatorProvider>
			<LaunchWindowContent />
		</LaunchPopoverCoordinatorProvider>
	);
}

function LaunchWindowContent() {
	const t = useScopedT("launch");
	const { openId } = useLaunchPopoverCoordinator();

	const {
		recording,
		paused,
		finalizing,
		countdownActive,
		toggleRecording,
		pauseRecording,
		resumeRecording,
		cancelRecording,
		cancelRecordingStart,
		microphoneEnabled,
		setMicrophoneEnabled,
		microphoneDeviceId,
		setMicrophoneDeviceId,
		systemAudioEnabled,
		setSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled,
		webcamDeviceId,
		setWebcamDeviceId,
		countdownDelay,
		setCountdownDelay,
		preparePermissions,
	} = useScreenRecorder();

	const [storyPrompt, setStoryPrompt] = useState("");
	const recordingIntent = useRef<string | null>(null);
	const previouslyRecording = useRef(false);
	useEffect(() => {
		if (recording && !previouslyRecording.current)
			recordingIntent.current = stageStoryIntent(storyPrompt);
		previouslyRecording.current = recording;
	}, [recording, storyPrompt]);
	useEffect(() => {
		if (!recording) return;
		const timer = setInterval(() => refreshStoryIntent(recordingIntent.current), 60_000);
		return () => {
			clearInterval(timer);
			refreshStoryIntent(recordingIntent.current);
		};
	}, [recording]);
	const cancelRecordingWithIntent = useCallback(() => {
		discardStoryIntent(recordingIntent.current);
		recordingIntent.current = null;
		cancelRecording();
	}, [cancelRecording]);
	const { elapsed, formatTime } = useRecordingTimer(recording, paused);
	const hudContentRef = useRef<HTMLDivElement>(null);
	const hudBarRef = useRef<HTMLDivElement>(null);

	const { selectedSource, hasSelectedSource, syncSelectedSource, openVideoFile } =
		useLaunchWindowActions();

	const showWebcamControls = webcamEnabled && !recording;
	const { devices, selectedDeviceId, setSelectedDeviceId } = useMicrophoneDevices(
		!recording || microphoneEnabled || openId === "mic",
		microphoneDeviceId,
	);
	const {
		devices: videoDevices,
		selectedDeviceId: selectedVideoDeviceId,
		setSelectedDeviceId: setSelectedVideoDeviceId,
	} = useVideoDevices(!recording || webcamEnabled || openId === "webcam");

	const { hudOverlayMousePassthroughSupported, platform } =
		useLaunchWindowSystemState(preparePermissions);

	useEffect(() => {
		if (!selectedDeviceId) {
			return;
		}

		setMicrophoneDeviceId(selectedDeviceId === "default" ? undefined : selectedDeviceId);
	}, [selectedDeviceId, setMicrophoneDeviceId]);

	useEffect(() => {
		if (selectedVideoDeviceId && selectedVideoDeviceId !== "default") {
			setWebcamDeviceId(selectedVideoDeviceId);
		}
	}, [selectedVideoDeviceId, setWebcamDeviceId]);

	const {
		showFloatingWebcamPreview,
		setShowFloatingWebcamPreview,
		showRecordingWebcamPreview,
		webcamPreviewOffset,
		webcamPreviewSize,
		recordingWebcamPreviewContainerRef,
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
		handleWebcamPreviewPointerDown,
		handleWebcamPreviewPointerMove,
		handleWebcamPreviewPointerUp,
		handleWebcamPreviewResizePointerDown,
		handleWebcamPreviewResizePointerMove,
		handleWebcamPreviewResizePointerUp,
		setRecordingWebcamPreviewNode,
	} = useWebcamPreviewOverlay({
		webcamEnabled,
		webcamDeviceId,
		showWebcamControls,
		webcamPopoverOpen: openId === "webcam",
		hudOverlayMousePassthroughSupported,
	});

	useEffect(() => {
		window.electronAPI?.hudOverlaySetWebcamPreviewVisible?.(showRecordingWebcamPreview);
	}, [showRecordingWebcamPreview]);

	useEffect(() => {
		return () => {
			window.electronAPI?.hudOverlaySetWebcamPreviewVisible?.(false);
		};
	}, []);

	const {
		recordingHudOffset,
		hudBarTransformRef,
		isHudDraggingRef,
		handleHudBarPointerDown,
		handleHudBarPointerMove,
		handleHudBarPointerUp,
	} = useHudBarDrag({
		hudContentRef,
		hudBarRef,
		recordingWebcamPreviewContainerRef,
	});

	const { handleHudMouseEnter, handleHudMouseLeave, beginInteractiveHudAction } =
		useLaunchHudInteractionState({
			openId,
			isHudDraggingRef,
			isWebcamPreviewDraggingRef,
			webcamPreviewDragStartRef,
		});

	const pickerPending = useRef(false);
	const [isPickerPending, setIsPickerPending] = useState(false);
	const [sourceReady, setSourceReady] = useState(false);
	const [setupVisible, setSetupVisible] = useState(true);
	useEffect(() => {
		window.electronAPI.hudOverlaySetSetupVisible?.(setupVisible);
	}, [setupVisible]);
	const handlePickOnScreen = useCallback(async () => {
		if (pickerPending.current || recording || finalizing) return;
		pickerPending.current = true;
		setIsPickerPending(true);
		beginInteractiveHudAction();
		try {
			if (!(await cancelRecordingStart())) return;
			if (!(await preparePermissions())) return;
			const result = await window.electronAPI.pickCaptureTarget();
			if (result.success && result.source) {
				syncSelectedSource(result.source);
				setSetupVisible(false);
			}
			if (result.message && !result.canceled) {
				if (result.success) toast.info(result.message);
				else toast.error(result.message);
			}
		} catch {
			toast.error("Unable to open the source picker.");
		} finally {
			pickerPending.current = false;
			setIsPickerPending(false);
		}
	}, [
		recording,
		cancelRecordingStart,
		preparePermissions,
		finalizing,
		beginInteractiveHudAction,
		syncSelectedSource,
	]);

	useEffect(() => {
		let mounted = true;
		let selectionEventSeen = false;

		void window.electronAPI
			.getSelectedSource()
			.then((source) => {
				if (mounted) setSourceReady(true);
				if (mounted && !selectionEventSeen) {
					syncSelectedSource(source);
				}
			})
			.catch(() => {
				if (mounted) {
					setSourceReady(true);
					toast.error("Unable to load the recording source. Pick a screen again.");
				}
			});

		const cleanup = window.electronAPI.onSelectedSourceChanged((source) => {
			selectionEventSeen = true;
			if (mounted) syncSelectedSource(source);
		});

		return () => {
			mounted = false;
			cleanup?.();
		};
	}, [syncSelectedSource]);

	const openHome = () => {
		localStorage.setItem("recordly.open-dashboard", String(Date.now()));
		void window.electronAPI.showProjectDashboard();
	};
	const closePending = useRef(false);
	const backPending = useRef(false);
	const returnToSetup = useCallback(async () => {
		if (backPending.current || recording || finalizing || pickerPending.current) return;
		backPending.current = true;
		beginInteractiveHudAction();
		try {
			if (await cancelRecordingStart()) setSetupVisible(true);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not return to recording settings.",
			);
		} finally {
			backPending.current = false;
		}
	}, [recording, finalizing, beginInteractiveHudAction, cancelRecordingStart]);
	const closeRecorder = useCallback(async () => {
		if (closePending.current) return;
		closePending.current = true;
		beginInteractiveHudAction();
		try {
			// Finish cancellation before destroying the renderer that owns startup.
			if (await cancelRecordingStart()) window.electronAPI.hudOverlayClose();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not close the recorder.");
		} finally {
			closePending.current = false;
		}
	}, [beginInteractiveHudAction, cancelRecordingStart]);

	const recordingControls = (
		<RecordingControls
			onHome={openHome}
			paused={paused}
			microphoneEnabled={microphoneEnabled}
			elapsed={elapsed}
			onPauseResume={paused ? resumeRecording : pauseRecording}
			onStopRecording={toggleRecording}
			onHideHud={() => window.electronAPI?.hudOverlayHide?.()}
			onCancelRecording={cancelRecordingWithIntent}
			formatTime={formatTime}
		/>
	);

	const idleControls = (
		<RecordingSetupPanel
			storyPrompt={storyPrompt}
			onStoryPromptChange={setStoryPrompt}
			platform={platform}
			selectedSource={selectedSource}
			hasSelectedSource={hasSelectedSource}
			disabled={isPickerPending || !sourceReady}
			countdownActive={countdownActive}
			microphoneEnabled={microphoneEnabled}
			microphoneDeviceId={selectedDeviceId || "default"}
			microphones={devices}
			webcamEnabled={webcamEnabled}
			webcamDeviceId={selectedVideoDeviceId || "default"}
			cameras={videoDevices}
			systemAudioEnabled={systemAudioEnabled}
			countdownDelay={countdownDelay}
			canPreviewCamera={canToggleFloatingWebcamPreview(hudOverlayMousePassthroughSupported)}
			previewCamera={showFloatingWebcamPreview}
			onPreviewCamera={setShowFloatingWebcamPreview}
			onMicrophone={(deviceId) => {
				setMicrophoneEnabled(deviceId !== null);
				if (deviceId) {
					setSelectedDeviceId(deviceId);
					setMicrophoneDeviceId(deviceId === "default" ? undefined : deviceId);
				}
			}}
			onCamera={(deviceId) => {
				setWebcamEnabled(deviceId !== null);
				if (deviceId) {
					setSelectedVideoDeviceId(deviceId);
					setWebcamDeviceId(deviceId === "default" ? undefined : deviceId);
				}
			}}
			onSystemAudio={setSystemAudioEnabled}
			onCountdown={setCountdownDelay}
			prepareSelection={async () => {
				beginInteractiveHudAction();
				return (await cancelRecordingStart()) && (await preparePermissions());
			}}
			onSourceSelected={(source) => {
				syncSelectedSource(source);
				setSetupVisible(false);
			}}
			onPickOnScreen={() => void handlePickOnScreen()}
			onRecord={toggleRecording}
			onCancelCountdown={() => void cancelRecordingStart()}
			onOpenFile={() =>
				openVideoFile((path) => {
					stageStoryIntent(storyPrompt, path);
				})
			}
			onHome={openHome}
			onHide={() => void window.electronAPI.hudOverlayHide()}
			onClose={() => void closeRecorder()}
		/>
	);

	const readyControls = (
		<RecordingReadyBar
			source={selectedSource}
			countdown={countdownActive}
			disabled={isPickerPending || !sourceReady || !hasSelectedSource}
			microphone={microphoneEnabled}
			camera={webcamEnabled}
			systemAudio={systemAudioEnabled}
			onBack={() => void returnToSetup()}
			onMicrophone={() => setMicrophoneEnabled(!microphoneEnabled)}
			onCamera={() => setWebcamEnabled(!webcamEnabled)}
			onSystemAudio={() => setSystemAudioEnabled(!systemAudioEnabled)}
			onSettings={() => void returnToSetup()}
			onStart={toggleRecording}
			onCancelCountdown={() => void cancelRecordingStart()}
			onHide={() => void window.electronAPI.hudOverlayHide()}
			onClose={() => void closeRecorder()}
		/>
	);

	const finalizingControls = (
		<div className={styles.finalizingState}>
			<ArrowClockwiseIcon size={15} className={styles.finalizingSpin} />
			<div className={styles.finalizingCopy}>
				<span>{t("recording.preparing", "Preparing recording")}</span>
				<small>{t("recording.preparingSubtitle", "Opening the editor in a moment")}</small>
			</div>
		</div>
	);

	const hudMode = finalizing
		? "finalizing"
		: recording
			? "recording"
			: setupVisible
				? "idle"
				: "ready";
	const useNativeHudBarDrag =
		platform === "linux" ||
		hudOverlayMousePassthroughSupported === false ||
		(platform === "win32" && hudMode === "idle");

	return (
		<HudInteractionContext.Provider
			value={{ onMouseEnter: handleHudMouseEnter, onMouseLeave: handleHudMouseLeave }}
		>
			<div
				className="w-full flex justify-center bg-transparent overflow-visible items-end pb-5 pointer-events-none"
				style={{ height: "100vh" }}
			>
				<div
					ref={hudContentRef}
					className="flex items-center overflow-visible flex-col-reverse pointer-events-none"
				>
					<div className="flex flex-col items-center pointer-events-none p-2">
						<div
							ref={hudBarTransformRef}
							style={{
								transform: `translate3d(${recordingHudOffset.x}px, ${recordingHudOffset.y}px, 0)`,
							}}
						>
							<div
								ref={hudBarRef}
								className={`${styles.bar} ${hudMode === "idle" ? styles.setupBar : hudMode === "ready" ? styles.readyBar : ""} launch-theme mb-2 pointer-events-auto`}
								onMouseEnter={handleHudMouseEnter}
								onMouseLeave={handleHudMouseLeave}
							>
								<div
									// Linux compositors and non-passthrough Windows fallback windows
									// need native window dragging; the JS drag path only translates
									// content inside the HUD window.
									className={`${hudMode === "idle" ? styles.setupDrag : ""} flex items-center px-0.5 cursor-grab active:cursor-grabbing ${
										useNativeHudBarDrag ? styles.electronDrag : ""
									}`}
									onPointerDown={handleHudBarPointerDown}
									onPointerMove={handleHudBarPointerMove}
									onPointerUp={handleHudBarPointerUp}
									onPointerCancel={handleHudBarPointerUp}
								>
									<DotsThreeVerticalIcon
										weight="fill"
										size={18}
										className="text-[#6b6b78]"
									/>
								</div>

								<div
									className={`${styles.barStateViewport} ${hudMode === "idle" ? styles.setupViewport : hudMode === "ready" ? styles.readyViewport : ""}`}
								>
									<div
										key={hudMode}
										className={`${styles.barState} ${hudMode === "idle" ? styles.setupState : hudMode === "ready" ? styles.readyState : ""}`}
									>
										{finalizing
											? finalizingControls
											: recording
												? recordingControls
												: setupVisible
													? idleControls
													: readyControls}
									</div>
								</div>
							</div>
						</div>
						{showRecordingWebcamPreview && (
							<div
								ref={recordingWebcamPreviewContainerRef}
								className={`${styles.recordingWebcamPreview} ${styles.electronNoDrag} pointer-events-auto`}
								data-hud-interactive
								title={t("recording.webcam")}
								style={{
									transform: `translate(${webcamPreviewOffset.x}px, ${webcamPreviewOffset.y}px)`,
									width: webcamPreviewSize.width,
									height: webcamPreviewSize.height,
								}}
								onMouseEnter={handleHudMouseEnter}
								onMouseLeave={handleHudMouseLeave}
								onPointerDown={handleWebcamPreviewPointerDown}
								onPointerMove={handleWebcamPreviewPointerMove}
								onPointerUp={handleWebcamPreviewPointerUp}
								onPointerCancel={handleWebcamPreviewPointerUp}
							>
								<video
									ref={setRecordingWebcamPreviewNode}
									className={styles.recordingWebcamPreviewVideo}
									muted
									playsInline
									style={{ transform: "scaleX(-1)" }}
								/>
								{WEBCAM_PREVIEW_RESIZE_HANDLES.map((handle) => (
									<div
										key={handle}
										data-resize-handle={handle}
										className={styles.recordingWebcamPreviewResizeHandle}
										onPointerDown={handleWebcamPreviewResizePointerDown}
										onPointerMove={handleWebcamPreviewResizePointerMove}
										onPointerUp={handleWebcamPreviewResizePointerUp}
										onPointerCancel={handleWebcamPreviewResizePointerUp}
									/>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</HudInteractionContext.Provider>
	);
}
