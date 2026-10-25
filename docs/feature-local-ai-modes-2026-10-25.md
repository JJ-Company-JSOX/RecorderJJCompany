# 轻量智能与可选 Ollama 模式

日期：2026-10-25。复用已有本地分析、计划审阅、解说、撤销、保存和导出；新增入口在编辑器 **AI auto edit → AI mode / 智能模式**。

## 两个可用模式

| 模式 | 本批行为 |
|---|---|
| 轻量智能（默认） | 默认快速本地媒体/点击规则剪辑，无需启动 Ollama；保留已有“快速＋字幕”和内置完整分析设置 |
| Ollama 高级模式 | 用户填写本机已安装模型并主动检查后，先使用现有媒体/可选字幕分析，再用 Ollama 审阅有证据的剪辑候选；可生成所选语言的解说稿并进入原有配音/字幕流程 |

Ollama 文本路径只审阅候选 ID、操作类型、时间与原因，不发送完整转录、路径或屏幕截图；不会凭空新增剪辑候选或扩大有证据的范围。本批没有将文本模型冒充视觉理解模型，也没有替换现有视觉管线。

模型选择保存在当前电脑。重开编辑器后需要再次检查服务与模型；检查展示真实名称、磁盘体积和许可证。只连接 `127.0.0.1:11434`，拒绝云端别名、远程模型元数据和重定向。轻量模式不探测 Ollama。

## 给开发者及客户的安装命令

应用中提供命令及复制按钮；不会自动执行安装、同意条款或拉取权重。在 Windows PowerShell 运行：

```powershell
winget install --id Ollama.Ollama -e --source winget
```

安装后重新打开 PowerShell，运行：

```powershell
ollama pull qwen3:4b
ollama list
```

回到应用，模型填 `qwen3:4b`，点击 **Check local model / 检查本地模型**。也可填写自己已安装的本地模型名称。若 `winget` 不可用，使用 [Ollama 官方 Windows 安装程序](https://ollama.com/download/OllamaSetup.exe)。示例模型下载量约 2–3 GB，实际体积/进度以客户端拉取结果为准；需要额外数 GB RAM，建议电脑总内存 16 GB。未在此环境安装 Ollama 或下载该模型，没有声称该建议是硬件实测最低要求。

## 取消与资源

- 本地审阅、解说接入已有每窗口 AbortController；禁止同一窗口重复任务，取消、关闭编辑器及退出应用会中止请求，迟到结果不能成功应用。
- 每次模型元数据请求超时 8 秒，推理超时 120 秒；限制请求/响应体积、上下文 4096、输出 2048 token，每批最多审阅 200 个剪辑候选、生成 100 个解说片段。中文/英文/马来语及简洁/教程/详细风格传到现有解说请求。
- Chat 请求明确设置 `keep_alive: 0`。这是发送给 Ollama 的卸载策略，不是对用户外部服务实际 RAM 释放的实测保证，也不会强制结束用户其他模型进程。
- 录制面板不会加载编辑模型。用户自己启动的 Ollama 或其他窗口正在进行的 AI 编辑仍可能占内存。
- 客户“高级版”的定价、支付和离线授权尚未确定，本批没有收费锁、扣费或假购买按钮。Ollama 自身为 MIT 开源软件；若销售应用高级功能/部署支持，应明确收费对象，并单独核验所选模型许可证。没有重新分发 Ollama 或模型权重。

代码：[模式与安装入口](../src/components/video-editor/auto-edit/AiModeSettings.tsx)、[剪辑接入](../src/components/video-editor/auto-edit/AutoEditPanel.tsx)、[审阅](../electron/ipc/autoEdit/reviewer.ts)、[解说](../electron/ipc/autoEdit/narrator.ts)、[取消与 IPC](../electron/ipc/register/autoEdit.ts)。

## 验证

- 全量 **2073 项通过、18 跳过**，含 loopback/拒绝 cloud、计划范围保护、语言、上下文/输出上限及卸载参数、取消/销毁、并发拒绝、迟到结果与监听器回收。末次增加解说风格参数后，24 项解说与 IPC 回归通过；生产构建和主进程加载再次通过。
- 最终 7 项 AI 模式/快速剪辑复验全部通过，配合 17 项录制/窗口/设备场景，共覆盖 24 个独立界面场景。24 项合跑的首轮 20/24、修复设备查询后 23/24；余下首屏按钮问题通过移动设置区修复后，原 7 项 AI 测试全部通过。没有把未通过的中间批次写成全通过。
- 使用明确模拟的桌面 IPC，实际编辑状态、撤销、保存和重开在 Chromium 执行。验证默认不检查 Ollama、命令复制、服务不可用、模型配置保存/重开、真实计划应用/撤销、取消后迟到结果丢弃、本地模型/语言/风格传递且不调用内置推理。没有把 fixture 文本当成真实模型质量评估。
- 首轮新设置挤压了 1024×640 首屏的开始按钮，后续将模式设置放到主要操作之后；保留原“完整按钮可见”的断言。新取消测试最初写错按钮名称为 `Cancel`，实际为 `Cancel analysis`，已修正测试定位。
- 真实 Ollama 安装、推理质量、GPU/CPU/RAM、Windows 客户安装包及实际工程成片仍待实机验证；未增加新依赖或自动下载大型文件。

2026-10-25 实际读取上游 [README](https://github.com/ollama/ollama/blob/main/README.md) 和 [MIT LICENSE](https://github.com/ollama/ollama/blob/main/LICENSE)，确认 Windows 安装入口及本地 API；模型许可证由安装后的 API 检查展示，不将程序的 MIT 当成所有模型的许可证。其他参考项目继续采用[已有开源研究](research/08-recommended-implementation-plan.md)：优先复用 FFmpeg、Whisper 和 sherpa-onnx，而不增加重复的常驻服务。

最终日志：`/tmp/recordly-ready-ollama-unit-final.log`、`/tmp/recordly-ready-ollama-narration-last.log`、`/tmp/recordly-ready-ollama-build-delivery.log`、`/tmp/recordly-ready-ollama-ai-ui-last.log`。在启动旧版本的 PowerShell 按 `Ctrl+C` 后更新：

```powershell
& {
    $ErrorActionPreference = "Stop"
    Set-Location "$env:USERPROFILE\RecorderJJCompany-20261024-110640"
    git pull --ff-only origin jsox-preview
    if ($LASTEXITCODE -ne 0) { throw "更新失败，请把报错发我。" }
    npm.cmd run dev
}
```
