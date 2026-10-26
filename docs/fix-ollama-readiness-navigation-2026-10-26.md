# Ollama 未就绪提示的模型入口修复 — 2026-10-26

用户录制后进入编辑器，黄色卡片显示“Check the installed Ollama model before starting”，但其中的“Check again”只更新 bundled AI、语音和 TTS 状态，未调用 Ollama 检查。实际的模型名称和“Check local model”位于上方，滚动后看不到，导致用户在提示卡片里无法找到正确操作。

## 修复

- 仅在 Ollama 尚未检查成功时，黄色卡片的按钮改为 **Check or change Ollama model**（检查或更换 Ollama 模型）。
- 点击会滚动到既有 `AiModeSettings` 并聚焦模型名称输入框，不自动检查、下载或加载模型。用户填写实际安装的名称后点击原有“Check local model”。
- 未就绪模型的导航不再被无关的 bundled 状态查询阻塞。bundled 模式继续使用原来的资源重查。
- 不改变已保存的模型、默认模型、推理协议、工程格式或导出流程。

代码：`src/components/video-editor/auto-edit/AutoEditPanel.tsx`。实际本地模型检查仍在 `AiModeSettings.tsx`，通过 `inspectAutoEditLocalModel` 检查 Ollama 的 loopback `/api/tags` 和 `/api/show`，不发起推理。

## 验证

- 新增实际 Chromium 界面回归：提示卡片可见、模型框在滚动区外 → 点击入口 → 模型框进入视口并获得焦点 → 未自动检查 → 填写 `qwen3:1.7b` 并主动检查 → 允许启动。再改模型名称会重新禁用启动。
- `ollama-mode.spec.ts` 与 `auto-edit-readiness.spec.ts` 合计 **11/11 通过**，包括既有取消、配音、保存模型和 bundled 重查行为。新增场景另一次定向运行通过，未重复计入总数。
- UI 使用真实 React 和浏览器操作，模型元数据 IPC 使用夹具；不代表用户电脑的 Ollama 已启动或权重已安装。
- 格式检查、`git diff --check`、`npm run build:app`（包含 TypeScript 与 Electron 主进程 CJS smoke）均通过。原有 CSS／产物体积警告仍在；未生成或验证 Windows 安装包。

日志：`/tmp/recordly-ollama-readiness-focused-ui.log`、`/tmp/recordly-ollama-readiness-ui-all.log`、`/tmp/recordly-ollama-readiness-build.log`。未重新运行完整单元集；本轮变化限于模型设置导航与对应界面回归，前一交付的完整测试记录见 `feature-connected-story-workflow-2026-10-26.md`。

## 当前版本可直接操作

在 CMD 执行 `ollama list`，模型框填写 NAME 列的实际安装名称。下载因 DNS 中断的模型可能尚未出现在列表中。若 `ollama list` 连接失败，先从开始菜单启动 Ollama；若列表为空，需完成用户主动触发的模型下载。不能单凭这张界面截图断言 Ollama 服务停止或模型缺失。

旧版可手动把左侧面板往上滚，找到 **Installed Ollama model → Check local model**。本轮修复让黄色提示直接导航到这里，并不替用户完成系统网络修复或模型安装。
