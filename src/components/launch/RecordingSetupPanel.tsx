import { useEffect, useRef, useState } from "react";
import {
	FolderOpen,
	House,
	MicrophoneIcon,
	MinusIcon,
	MonitorIcon,
	SpeakerHigh,
	UploadSimple,
	VideoCameraIcon,
	XIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/contexts/I18nContext";
import { MarqueeText } from "./MarqueeText";
import styles from "./RecordingSetupPanel.module.css";

const copy = {
	en: {
		title: "Choose what to record",
		subtitle: "Your screen. Your story.",
		storyPrompt: "What are you creating? (optional)",
		storyPlaceholder:
			"For example: Introduce my product to first-time customers and draft a short sales story.",
		storyHint:
			"Carried into the editor after recording or importing a video. AI starts only when you ask it to.",
		screen: "Full screen",
		window: "Window",
		area: "Select an area",
		import: "Import video",
		screenHint: "Choose a display",
		windowHint: "Focus on one app",
		areaHint: "Drag to select on screen",
		importHint: "Edit an existing recording",
		devices: "Devices & audio",
		camera: "Camera",
		microphone: "Microphone",
		system: "System audio",
		systemOffHint: "Computer sound is off. Turn on System audio to record videos or music.",
		systemOnHint:
			"Records sound from the default output device. Keep videos or music on that device while recording.",
		off: "Off",
		on: "On · captured with the screen",
		default: "System default",
		countdown: "Countdown",
		seconds: "s",
		preview: "Floating camera preview",
		ready: "Ready when you are",
		choose: "Select a screen or window first",
		record: "Start recording",
		starting: "Countdown in progress…",
		cancel: "Cancel countdown",
		back: "Back",
		refresh: "Refresh",
		loading: "Loading recording sources…",
		empty: "No sources found. Check recording permissions, then refresh.",
		listFailed: "Could not load sources. Refresh to try again.",
		selectFailed: "Could not select that source. Please try again.",
		selecting: "Selecting source…",
		local: "Saved on your computer",
		change: "Change",
		file: "Open video or project",
		home: "Home",
		minimize: "Hide controls",
		close: "Close recorder",
		systemHint:
			"Records playback audio when supported by the capture engine; no output-device routing is changed.",
	},
	zh: {
		title: "选择你的录制方式",
		subtitle: "记录操作，让表达更清楚。",
		storyPrompt: "创作要求（选填）",
		storyPlaceholder: "例如：向第一次接触的顾客介绍我的产品，帮我策划简短的销售故事。",
		storyHint: "录制或导入视频后带入编辑器；只有你主动开始时才调用 AI。",
		screen: "全屏录制",
		window: "窗口录制",
		area: "选取区域",
		import: "导入视频",
		screenHint: "选择要录制的显示器",
		windowHint: "专注一个应用窗口",
		areaHint: "在屏幕上拖动框选",
		importHint: "打开已有视频继续编辑",
		devices: "设备与声音",
		camera: "摄像头",
		microphone: "麦克风",
		system: "系统声音",
		systemOffHint: "电脑声音已关闭。录制视频或音乐的原声，请开启系统声音。",
		systemOnHint: "录制默认输出设备的声音。请让视频或音乐使用该设备播放。",
		off: "关闭",
		on: "开启 · 随屏幕捕获",
		default: "系统默认设备",
		countdown: "开始倒计时",
		seconds: "秒",
		preview: "显示摄像头悬浮预览",
		ready: "准备就绪，随时开始",
		choose: "请先选择显示器或窗口",
		record: "开始录制",
		starting: "正在倒计时…",
		cancel: "取消倒计时",
		back: "返回",
		refresh: "刷新",
		loading: "正在读取录制来源…",
		empty: "没有找到来源，请检查录屏权限后刷新。",
		listFailed: "无法读取来源，请点击刷新重试。",
		selectFailed: "无法选择此来源，请重试。",
		selecting: "正在选择来源…",
		local: "录制内容保存到本机",
		change: "更换",
		file: "打开视频或工程",
		home: "Home",
		minimize: "隐藏控制面板",
		close: "关闭录屏程序",
		systemHint: "捕获引擎支持时录制系统播放声音，不会切换电脑的声音输出设备。",
	},
};

type Device = { deviceId: string; label: string };
type Props = {
	storyPrompt?: string;
	onStoryPromptChange?: (value: string) => void;
	platform: string | null;
	selectedSource: string;
	hasSelectedSource: boolean;
	disabled: boolean;
	countdownActive: boolean;
	microphoneEnabled: boolean;
	microphoneDeviceId: string;
	microphones: Device[];
	webcamEnabled: boolean;
	webcamDeviceId: string;
	cameras: Device[];
	systemAudioEnabled: boolean;
	countdownDelay: number;
	canPreviewCamera: boolean;
	previewCamera: boolean;
	onPreviewCamera: (enabled: boolean) => void;
	onMicrophone: (device: string | null) => void;
	onCamera: (device: string | null) => void;
	onSystemAudio: (enabled: boolean) => void;
	onCountdown: (delay: number) => void;
	prepareSelection: () => Promise<boolean>;
	onSourceSelected: (source: ProcessedDesktopSource) => void;
	onPickOnScreen: () => void;
	onRecord: () => void;
	onCancelCountdown: () => void;
	onOpenFile: () => Promise<void>;
	onHome: () => void;
	onHide: () => void;
	onClose: () => void;
};

/** Recording setup only: the existing useScreenRecorder remains the single capture owner. */
export function RecordingSetupPanel(props: Props) {
	const { locale } = useI18n();
	const m = copy[locale.startsWith("zh") ? "zh" : "en"];
	const [mode, setMode] = useState<"screen" | "window" | null>(null);
	const [sources, setSources] = useState<ProcessedDesktopSource[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const request = useRef(0);
	const inFlight = useRef(false);
	useEffect(
		() => () => {
			request.current++;
		},
		[],
	);
	const locked = props.disabled || busy;

	const list = async (kind: "screen" | "window") => {
		if (props.disabled || inFlight.current) return;
		inFlight.current = true;
		const run = ++request.current;
		setMode(kind);
		setSources([]);
		setError("");
		setBusy(true);
		try {
			if (!(await props.prepareSelection())) {
				if (run === request.current) setMode(null);
				return;
			}
			const next = await window.electronAPI.getSources({
				types: [kind],
				thumbnailSize: { width: 220, height: 124 },
				fetchWindowIcons: false,
			});
			if (run === request.current)
				setSources(next.filter((source) => source.id.startsWith(`${kind}:`)));
		} catch {
			if (run === request.current) setError(m.listFailed);
		} finally {
			if (run === request.current) setBusy(false);
			inFlight.current = false;
		}
	};
	const select = async (source: ProcessedDesktopSource) => {
		if (props.disabled || inFlight.current) return;
		inFlight.current = true;
		const run = ++request.current;
		setBusy(true);
		setError("");
		try {
			const selected = await window.electronAPI.selectSource(source);
			if (selected?.id !== source.id) throw new Error("Source selection rejected");
			if (run === request.current) {
				props.onSourceSelected(selected);
				setMode(null);
			}
		} catch {
			if (run === request.current) setError(m.selectFailed);
		} finally {
			if (run === request.current) setBusy(false);
			inFlight.current = false;
		}
	};
	const openFile = async () => {
		if (props.disabled || inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		setError("");
		try {
			if (await props.prepareSelection()) await props.onOpenFile();
		} catch {
			setError(m.selectFailed);
		} finally {
			setBusy(false);
			inFlight.current = false;
		}
	};
	const card = (
		kind: "screen" | "window" | "area" | "import",
		title: string,
		hint: string,
		action: () => void,
	) => (
		<button type="button" className={styles.modeCard} disabled={locked} onClick={action}>
			<span className={`${styles.illustration} ${styles[kind]}`} aria-hidden="true">
				<span className={styles.desktop}>
					<span className={styles.orbit} />
					{kind === "window" && (
						<span className={styles.appWindow}>
							<i />
							<i />
							<i />
						</span>
					)}
					{kind === "area" && <span className={styles.areaOutline} />}
					{kind === "import" && <UploadSimple size={32} />}
				</span>
			</span>
			<strong>{title}</strong>
			<small>{hint}</small>
		</button>
	);

	return (
		<section className={styles.panel} aria-label={m.title}>
			<header className={styles.header}>
				<div className={styles.brand}>
					<img src={`${import.meta.env.BASE_URL}app-icons/jsox-mark.svg`} alt="" />
					<strong>
						Jsox <span>Recorder</span>
					</strong>
				</div>
				<button
					type="button"
					className={styles.headerButton}
					disabled={locked}
					onClick={() => void openFile()}
					title={m.file}
					aria-label={m.file}
				>
					<FolderOpen size={18} />
				</button>
				<div className={styles.windowActions}>
					<button type="button" onClick={props.onHome} title={m.home} aria-label={m.home}>
						<House size={20} weight="fill" />
					</button>
					<button
						type="button"
						onClick={props.onHide}
						title={m.minimize}
						aria-label={m.minimize}
					>
						<MinusIcon size={18} />
					</button>
					<button
						type="button"
						onClick={props.onClose}
						title={m.close}
						aria-label={m.close}
					>
						<XIcon size={18} />
					</button>
				</div>
			</header>
			<div className={styles.body}>
				<div className={styles.modes}>
					<div className={styles.heading}>
						<div>
							<h1>{m.title}</h1>
							<p>{m.subtitle}</p>
						</div>
						{mode && (
							<button
								type="button"
								disabled={busy}
								onClick={() => {
									setMode(null);
									setError("");
								}}
							>
								{m.back}
							</button>
						)}
					</div>
					{props.onStoryPromptChange && (
						<label className={styles.storyPrompt}>
							<span>{m.storyPrompt}</span>
							<textarea
								aria-label={m.storyPrompt}
								maxLength={2000}
								rows={2}
								value={props.storyPrompt ?? ""}
								disabled={locked || props.countdownActive}
								placeholder={m.storyPlaceholder}
								onChange={(event) =>
									props.onStoryPromptChange?.(event.target.value)
								}
							/>
							<small>{m.storyHint}</small>
						</label>
					)}
					{!mode ? (
						<div className={styles.modeGrid}>
							{card("screen", m.screen, m.screenHint, () => void list("screen"))}
							{card("window", m.window, m.windowHint, () => void list("window"))}
							{props.platform === "darwin" &&
								card("area", m.area, m.areaHint, props.onPickOnScreen)}
							{card("import", m.import, m.importHint, () => void openFile())}
						</div>
					) : (
						<div className={styles.sourcePicker}>
							<div className={styles.sourceHeading}>
								<strong>{mode === "screen" ? m.screen : m.window}</strong>
								<button
									type="button"
									disabled={busy}
									onClick={() => void list(mode)}
								>
									{m.refresh}
								</button>
							</div>
							{busy ? (
								<p role="status">{sources.length ? m.selecting : m.loading}</p>
							) : (
								!error && !sources.length && <p>{m.empty}</p>
							)}
							<div className={styles.sources}>
								{sources.map((source) => (
									<button
										type="button"
										key={source.id}
										disabled={locked}
										onClick={() => void select(source)}
									>
										{source.thumbnail ? (
											<img src={source.thumbnail} alt="" />
										) : (
											<MonitorIcon size={28} />
										)}
										<span>{source.name}</span>
									</button>
								))}
							</div>
						</div>
					)}
					{error && (
						<p role="alert" className={styles.error}>
							{error}
						</p>
					)}
				</div>
				<aside className={styles.devices} aria-label={m.devices}>
					<h2>{m.devices}</h2>
					<label>
						<span>
							<VideoCameraIcon size={17} />
							{m.camera}
						</span>
						<select
							aria-label={m.camera}
							disabled={locked || props.countdownActive}
							value={props.webcamEnabled ? props.webcamDeviceId : "off"}
							onChange={(event) =>
								props.onCamera(
									event.target.value === "off" ? null : event.target.value,
								)
							}
						>
							<option value="off">{m.off}</option>
							<option value="default">{m.default}</option>
							{props.cameras
								.filter((d) => d.deviceId !== "default")
								.map((d) => (
									<option key={d.deviceId} value={d.deviceId}>
										{d.label}
									</option>
								))}
						</select>
					</label>
					<label>
						<span>
							<MicrophoneIcon size={17} />
							{m.microphone}
						</span>
						<select
							aria-label={m.microphone}
							disabled={locked || props.countdownActive}
							value={props.microphoneEnabled ? props.microphoneDeviceId : "off"}
							onChange={(event) =>
								props.onMicrophone(
									event.target.value === "off" ? null : event.target.value,
								)
							}
						>
							<option value="off">{m.off}</option>
							<option value="default">{m.default}</option>
							{props.microphones
								.filter((d) => d.deviceId !== "default")
								.map((d) => (
									<option key={d.deviceId} value={d.deviceId}>
										{d.label}
									</option>
								))}
						</select>
					</label>
					<label title={m.systemHint}>
						<span>
							<SpeakerHigh size={17} />
							{m.system}
						</span>
						<select
							aria-label={m.system}
							disabled={locked || props.countdownActive}
							value={props.systemAudioEnabled ? "on" : "off"}
							onChange={(event) => props.onSystemAudio(event.target.value === "on")}
						>
							<option value="off">{m.off}</option>
							<option value="on">{m.on}</option>
						</select>
					</label>
					<label className={styles.delay}>
						<span>{m.countdown}</span>
						<select
							aria-label={m.countdown}
							disabled={locked || props.countdownActive}
							value={props.countdownDelay}
							onChange={(event) => props.onCountdown(Number(event.target.value))}
						>
							{[0, 3, 5, 10].map((delay) => (
								<option key={delay} value={delay}>
									{delay ? `${delay} ${m.seconds}` : m.off}
								</option>
							))}
						</select>
					</label>
					<p className={styles.audioHint} role="status">
						{props.systemAudioEnabled ? m.systemOnHint : m.systemOffHint}
					</p>
					{props.webcamEnabled && props.canPreviewCamera && (
						<label className={styles.preview}>
							<input
								type="checkbox"
								checked={props.previewCamera}
								disabled={locked || props.countdownActive}
								onChange={(event) => props.onPreviewCamera(event.target.checked)}
							/>
							{m.preview}
						</label>
					)}
				</aside>
			</div>
			<footer className={styles.footer}>
				<div className={styles.summary}>
					<small>{m.local}</small>
					{props.hasSelectedSource ? (
						<button
							type="button"
							className="group"
							title={props.selectedSource}
							aria-label="Choose recording source"
							disabled={locked}
							onClick={props.onPickOnScreen}
						>
							<MarqueeText text={props.selectedSource} />
							<span>{m.change}</span>
						</button>
					) : (
						<span role="status">{m.choose}</span>
					)}
				</div>
				{props.countdownActive ? (
					<button
						type="button"
						className={styles.cancel}
						onClick={props.onCancelCountdown}
					>
						{m.cancel}
					</button>
				) : (
					<button
						type="button"
						className={styles.record}
						title="Record"
						disabled={locked || !!mode || !props.hasSelectedSource}
						onClick={props.onRecord}
					>
						<span />
						{m.record}
					</button>
				)}
			</footer>
		</section>
	);
}
