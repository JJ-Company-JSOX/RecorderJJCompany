import { useScopedT } from "@/contexts/I18nContext";
import styles from "./LaunchWindow.module.css";

interface Props {
	source: string;
	countdown: boolean;
	disabled: boolean;
	microphone: boolean;
	camera: boolean;
	systemAudio: boolean;
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
	return (
		<div
			role="group"
			aria-label={t("ready.title", "Ready to record")}
			className={`flex items-center gap-2 px-2 py-2 ${styles.electronNoDrag}`}
		>
			<button
				type="button"
				disabled={disabled}
				onClick={props.onSettings}
				className="max-w-44 truncate rounded-lg px-3 py-2 text-sm hover:bg-white/10"
				title={props.source}
			>
				{props.source}
			</button>
			<button
				type="button"
				disabled={disabled}
				aria-pressed={props.microphone}
				onClick={props.onMicrophone}
				className="rounded-lg px-2 py-2 text-xs hover:bg-white/10"
			>
				{t("ready.microphone", "Microphone")} {props.microphone ? "✓" : "—"}
			</button>
			<button
				type="button"
				disabled={disabled}
				aria-pressed={props.camera}
				onClick={props.onCamera}
				className="rounded-lg px-2 py-2 text-xs hover:bg-white/10"
			>
				{t("ready.camera", "Camera")} {props.camera ? "✓" : "—"}
			</button>
			<button
				type="button"
				disabled={disabled}
				aria-pressed={props.systemAudio}
				onClick={props.onSystemAudio}
				className="rounded-lg px-2 py-2 text-xs hover:bg-white/10"
			>
				{t("ready.systemAudio", "System audio")} {props.systemAudio ? "✓" : "—"}
			</button>
			<button
				type="button"
				disabled={disabled}
				onClick={props.onSettings}
				className="rounded-lg px-2 py-2 text-xs hover:bg-white/10"
			>
				{t("ready.settings", "Recording settings")}
			</button>
			{props.countdown ? (
				<button
					type="button"
					onClick={props.onCancelCountdown}
					className="rounded-full bg-red-500 px-4 py-2 text-sm text-white"
				>
					{t("ready.cancelCountdown", "Cancel countdown")}
				</button>
			) : (
				<button
					type="button"
					disabled={props.disabled}
					onClick={props.onStart}
					className="rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
				>
					{t("ready.start", "Start recording")}
				</button>
			)}
			<button
				type="button"
				onClick={props.onHide}
				className="rounded-lg px-2 py-2"
				aria-label={t("ready.hide", "Hide recorder")}
			>
				−
			</button>
			<button
				type="button"
				onClick={props.onClose}
				className="rounded-lg px-2 py-2"
				aria-label={t("ready.close", "Close recorder")}
			>
				×
			</button>
		</div>
	);
}
