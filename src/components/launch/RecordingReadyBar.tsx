import {
	ArrowLeft,
	Gear,
	MicrophoneIcon,
	MinusIcon,
	MonitorIcon,
	SpeakerHighIcon,
	VideoCameraIcon,
	XIcon,
} from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import styles from "./RecordingReadyBar.module.css";

interface Props {
	source: string;
	countdown: boolean;
	disabled: boolean;
	microphone: boolean;
	camera: boolean;
	systemAudio: boolean;
	onBack: () => void;
	onMicrophone: () => void;
	onCamera: () => void;
	onSystemAudio: () => void;
	onSettings: () => void;
	onStart: () => void;
	onCancelCountdown: () => void;
	onHide: () => void;
	onClose: () => void;
}

/** A confirmed source is ready to record; opening setup again is an explicit action. */
export function RecordingReadyBar(props: Props) {
	const t = useScopedT("launch");
	const disabled = props.disabled || props.countdown;
	const devices = [
		{
			label: t("ready.microphone", "Microphone"),
			enabled: props.microphone,
			onClick: props.onMicrophone,
			Icon: MicrophoneIcon,
		},
		{
			label: t("ready.camera", "Camera"),
			enabled: props.camera,
			onClick: props.onCamera,
			Icon: VideoCameraIcon,
		},
		{
			label: t("ready.systemAudio", "System audio"),
			enabled: props.systemAudio,
			onClick: props.onSystemAudio,
			Icon: SpeakerHighIcon,
		},
	];
	return (
		<div role="group" aria-label={t("ready.title", "Ready to record")} className={styles.panel}>
			<div className={styles.header}>
				<button
					type="button"
					onClick={props.onBack}
					className={styles.back}
					aria-label={t("ready.back", "Back")}
				>
					<ArrowLeft size={18} aria-hidden="true" />
					<span>{t("ready.back", "Back")}</span>
				</button>
				<button
					type="button"
					disabled={disabled}
					onClick={props.onSettings}
					className={styles.source}
					title={props.source}
					aria-label={props.source}
				>
					<MonitorIcon size={22} aria-hidden="true" />
					<span className={styles.sourceCopy}>
						<span className={styles.heading}>
							{t("ready.title", "Ready to record")}
						</span>
						<span className={styles.sourceName}>{props.source}</span>
					</span>
				</button>
				<div className={styles.windowActions}>
					<button
						type="button"
						onClick={props.onHide}
						className={styles.windowButton}
						aria-label={t("ready.hide", "Hide recorder")}
						title={t("ready.hide", "Hide recorder")}
					>
						<MinusIcon size={19} aria-hidden="true" />
					</button>
					<button
						type="button"
						onClick={props.onClose}
						className={`${styles.windowButton} ${styles.close}`}
						aria-label={t("ready.close", "Close recorder")}
						title={t("ready.close", "Close recorder")}
					>
						<XIcon size={19} aria-hidden="true" />
					</button>
				</div>
			</div>
			<div className={styles.controls}>
				<div className={styles.devices}>
					{devices.map(({ label, enabled, onClick, Icon }) => (
						<button
							key={label}
							type="button"
							disabled={disabled}
							aria-pressed={enabled}
							onClick={onClick}
							className={styles.device}
						>
							<Icon size={18} aria-hidden="true" />
							<span className={styles.deviceCopy}>
								<span>{label}</span>
								<span className={styles.deviceState}>
									{enabled ? t("ready.on", "On") : t("ready.off", "Off")}
								</span>
							</span>
						</button>
					))}
				</div>
				<div className={styles.actions}>
					<button
						type="button"
						disabled={disabled}
						onClick={props.onSettings}
						className={styles.settings}
					>
						<Gear size={18} aria-hidden="true" />
						<span>{t("ready.settings", "Recording settings")}</span>
					</button>
					{props.countdown ? (
						<button
							type="button"
							onClick={props.onCancelCountdown}
							className={`${styles.start} ${styles.cancelCountdown}`}
						>
							<span className={styles.cancelMark} aria-hidden="true" />
							{t("ready.cancelCountdown", "Cancel countdown")}
						</button>
					) : (
						<button
							type="button"
							disabled={props.disabled}
							onClick={props.onStart}
							className={styles.start}
						>
							<span className={styles.recordDot} aria-hidden="true" />
							{t("ready.start", "Start recording")}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
