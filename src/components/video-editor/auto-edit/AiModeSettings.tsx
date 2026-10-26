import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import type { PlanLanguage } from "./messages";

export type AiProvider = "builtin" | "ollama";
export type OllamaModel = NonNullable<
	Awaited<ReturnType<Window["electronAPI"]["inspectAutoEditLocalModel"]>>["info"]
>;
const PROVIDER_KEY = "recordly.autoEdit.provider";
const MODEL_KEY = "recordly.autoEdit.ollamaModel";
export const savedAiProvider = (): AiProvider =>
	loadAppSetting(PROVIDER_KEY) === "ollama" ? "ollama" : "builtin";
export const saveAiProvider = (value: AiProvider) => saveAppSetting(PROVIDER_KEY, value);
const INSTALL = "winget install --id Ollama.Ollama -e --source winget";
export const DEFAULT_OLLAMA_MODEL = "qwen3:1.7b";
const PULL = `ollama pull ${DEFAULT_OLLAMA_MODEL}`;
const copy = {
	en: {
		mode: "AI mode",
		builtin: "Lightweight smart (default)",
		ollama: "Ollama advanced",
		help: "Lightweight mode uses fast local editing by default. Ollama reviews edit candidates and drafts narration; it needs more memory and may take longer. Recording controls do not load these models.",
		model: "Installed Ollama model",
		check: "Check local model",
		checking: "Checking local model…",
		ready: "Local model ready",
		bundled:
			"Included with this app. No separate Ollama installation or model download is needed.",
		install: "Install Ollama on Windows",
		instructions:
			"Run the first command in CMD or PowerShell. After installation, open a new terminal and run the second. The default qwen3:1.7b model downloads roughly 1.4 GB; Ollama shows the actual size and progress. Allow several GB of additional RAM; 16 GB total is recommended. Model licenses vary.",
		copy: "Copy command",
		copied: "Copied",
		copyFailed: "Copy failed; select and copy the command above.",
		missing: "Start Ollama and install the named local model, then check again.",
		clientModel: "Included local model",
		clientMissing:
			"The included local AI files are missing or damaged. Close the app, extract the complete package again, then reopen it.",
		language:
			"Only local models are accepted. Model choice is remembered on this computer; availability is checked again when you reopen the editor.",
		start: "Start Ollama editing",
		firstCheck: "Check the installed Ollama model before starting.",
		metadata:
			"Edit review uses timing/action metadata. Story planning can use your brief and explicitly enabled sampled frames with a vision model.",
	},
	zh: {
		mode: "智能模式",
		builtin: "轻量智能（默认）",
		ollama: "Ollama 高级模式",
		help: "轻量模式默认使用快速本地剪辑。Ollama 可审阅剪辑建议、生成解说，需要更多内存，也可能更慢。录制控制面板不会加载这些模型。",
		model: "已安装的 Ollama 模型",
		check: "检查本地模型",
		checking: "正在检查本地模型…",
		ready: "本地模型已就绪",
		bundled: "模型和运行程序已随 App 提供，无需另装 Ollama 或下载模型。",
		install: "在 Windows 安装 Ollama",
		instructions:
			"在 CMD 或 PowerShell 运行第一条命令。安装后重新打开终端，再运行第二条。默认 qwen3:1.7b 模型下载约 1.4 GB，实际大小和进度以 Ollama 显示为准。运行时还需要数 GB 内存，建议电脑配有 16 GB 内存。各模型许可证不同。",
		copy: "复制命令",
		copied: "已复制",
		copyFailed: "复制失败，请选中上面的命令手动复制。",
		missing: "请启动 Ollama，安装所填模型后重新检查。",
		clientModel: "内置本地模型",
		clientMissing: "内置 AI 文件缺失或损坏。请关闭 App，重新解压完整安装包后再打开。",
		language: "仅接受本地模型。模型选择保存在这台电脑上，重新打开编辑器后需要再次检查可用性。",
		start: "开始 Ollama 智能剪辑",
		firstCheck: "请先检查已安装的 Ollama 模型。",
		metadata:
			"剪辑审阅只用操作与时间信息；故事策划可使用主题说明，并在开启画面分析且模型支持视觉时读取抽样画面。",
	},
	ms: {
		mode: "Mod AI",
		builtin: "Pintar ringan (lalai)",
		ollama: "Ollama lanjutan",
		help: "Mod ringan menggunakan suntingan setempat pantas. Ollama menyemak cadangan dan menghasilkan narasi; ia memerlukan lebih memori dan mungkin lebih perlahan. Kawalan rakaman tidak memuatkan model ini.",
		model: "Model Ollama terpasang",
		check: "Semak model setempat",
		checking: "Menyemak model…",
		ready: "Model setempat sedia",
		bundled:
			"Disertakan dalam aplikasi. Tidak perlu memasang Ollama atau memuat turun model lagi.",
		install: "Pasang Ollama pada Windows",
		instructions:
			"Jalankan arahan pertama dalam CMD atau PowerShell. Selepas pemasangan, buka terminal baharu untuk arahan kedua. Model lalai qwen3:1.7b sekitar 1.4 GB; Ollama menunjukkan saiz dan kemajuan sebenar. Sediakan beberapa GB RAM tambahan; 16 GB jumlah disyorkan. Lesen model berbeza.",
		copy: "Salin arahan",
		copied: "Disalin",
		copyFailed: "Gagal menyalin; pilih dan salin arahan di atas.",
		missing: "Mulakan Ollama dan pasang model bernama, kemudian semak semula.",
		clientModel: "Model setempat terbina dalam",
		clientMissing:
			"Fail AI terbina dalam hilang atau rosak. Tutup aplikasi, ekstrak semula pakej lengkap, kemudian buka semula.",
		language:
			"Hanya model setempat. Pilihan disimpan pada komputer ini; semak semula apabila editor dibuka semula.",
		start: "Mulakan suntingan Ollama",
		firstCheck: "Semak model Ollama terpasang dahulu.",
		metadata:
			"Semakan suntingan menggunakan metadata masa/tindakan. Cerita menggunakan taklimat dan sampel imej apabila analisis visual diaktifkan dengan model visual.",
	},
};
export const aiModeCopy = (language: PlanLanguage) => copy[language];

export function AiModeSettings({
	language,
	provider,
	disabled,
	onProvider,
	onModel,
	modelInfo,
	clientEdition = false,
}: {
	/** The complete client: its only local model is the bundled one, so nothing is installed. */
	clientEdition?: boolean;
	language: PlanLanguage;
	provider: AiProvider;
	disabled: boolean;
	onProvider: (value: AiProvider) => void;
	onModel: (value: OllamaModel | null) => void;
	modelInfo: OllamaModel | null;
}) {
	const m = copy[language];
	const [model, setModel] = useState(() => {
		const value = loadAppSetting<unknown>(MODEL_KEY);
		return typeof value === "string" ? value : DEFAULT_OLLAMA_MODEL;
	});
	const info = modelInfo;
	const modelName = clientEdition ? DEFAULT_OLLAMA_MODEL : model.trim();
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState("");
	const [copied, setCopied] = useState("");
	const request = useRef(0);
	useEffect(
		() => () => {
			request.current++;
		},
		[],
	);
	const invalidate = () => {
		request.current++;
		onModel(null);
		setChecking(false);
		setError("");
	};
	const check = async () => {
		const run = ++request.current;
		setChecking(true);
		setError("");
		onModel(null);
		try {
			const result = await window.electronAPI.inspectAutoEditLocalModel(modelName);
			if (run !== request.current) return;
			if (!result.success || !result.info) throw new Error(result.error || m.missing);
			onModel(result.info);
			// A client keeps the developer's saved choice untouched; it can only use its own model.
			if (!clientEdition) saveAppSetting(MODEL_KEY, modelName);
		} catch (reason) {
			if (run === request.current)
				setError(
					clientEdition
						? m.clientMissing
						: `${m.missing} ${reason instanceof Error ? reason.message : ""}`,
				);
		} finally {
			if (run === request.current) setChecking(false);
		}
	};
	const copyCommand = async (command: string) => {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(command);
		} catch {
			setCopied("error");
		}
	};
	return (
		<div className="space-y-3 rounded-xl border border-separator p-3" data-ai-mode-settings>
			<label className="flex flex-col gap-2 text-sm">
				<span>{m.mode}</span>
				<select
					aria-label={m.mode}
					value={provider}
					disabled={disabled}
					onChange={(event) => {
						invalidate();
						onProvider(event.target.value === "ollama" ? "ollama" : "builtin");
					}}
					className="w-full rounded-lg border border-separator bg-background p-2 text-foreground"
				>
					<option value="builtin">{m.builtin}</option>
					<option value="ollama">{m.ollama}</option>
				</select>
			</label>
			{provider === "ollama" && <p className="text-xs text-muted-foreground">{m.help}</p>}
			{provider === "ollama" && (
				<>
					<label className="flex flex-col gap-2 text-sm">
						{clientEdition ? m.clientModel : m.model}
						<input
							aria-label={clientEdition ? m.clientModel : m.model}
							maxLength={120}
							value={clientEdition ? DEFAULT_OLLAMA_MODEL : model}
							readOnly={clientEdition}
							disabled={disabled || checking}
							onChange={(event) => {
								invalidate();
								setModel(event.target.value);
							}}
							className="rounded-lg border border-separator bg-background p-2 text-foreground"
						/>
					</label>
					<Button
						variant="secondary"
						disabled={disabled || checking || !modelName}
						onClick={() => void check()}
					>
						{checking ? m.checking : m.check}
					</Button>
					{info && (
						<div role="status" className="text-xs text-emerald-500">
							{m.ready}: {info.name} · {(info.sizeBytes / 1024 ** 3).toFixed(2)} GiB
							{info.runtime === "bundled" && <p>{m.bundled}</p>}
							<details className="text-muted-foreground">
								<summary>License</summary>
								<pre className="max-h-32 overflow-auto whitespace-pre-wrap">
									{info.license}
								</pre>
							</details>
						</div>
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<p className="text-xs text-muted-foreground">
						{m.language} {m.metadata}
					</p>
					{!clientEdition && info?.runtime !== "bundled" && (
						<details className="space-y-2 text-sm">
							<summary className="cursor-pointer">{m.install}</summary>
							<p className="py-2 text-xs text-muted-foreground">{m.instructions}</p>
							{[INSTALL, PULL].map((command) => (
								<div key={command} className="mb-3 space-y-1">
									<code className="block select-text overflow-x-auto rounded bg-background p-2 text-xs">
										{command}
									</code>
									<Button
										size="sm"
										variant="secondary"
										onClick={() => void copyCommand(command)}
									>
										{copied === command ? m.copied : m.copy}
									</Button>
								</div>
							))}
							{copied === "error" && <p role="alert">{m.copyFailed}</p>}
						</details>
					)}
				</>
			)}
		</div>
	);
}
