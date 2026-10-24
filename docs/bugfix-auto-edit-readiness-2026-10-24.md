# 自动剪辑按钮不可用的诊断与修复

日期：2026-10-24（Asia/Singapore）。基线：`codex/recording-launcher` / `814ea970`。没有访问用户电脑的文件或硬件。

## 原因与修复范围

用户截图中的橙色状态与禁用按钮表示离线 AI/语音组件未就绪。原入口同时要求视觉 AI、语音识别、视频路径和非空时间轴，但只在较低位置显示模型缺失提示，且无重新检查入口。顶部“无需额外安装”无条件显示；源码下载加 `npm ci` 并不包含完整 AI 资源，因而容易造成误解。截图本身不能区分具体缺失哪一套资源或 IPC 是否失败。

[AutoEditPanel.tsx](../src/components/video-editor/auto-edit/AutoEditPanel.tsx) 现将未就绪原因直接显示在起始设置区域：

- 分别检查 AI 与语音状态，区分缺失、平台不支持、检查失败、内存不足和视频未打开。
- “重新检查”重新读取当前资源和内存，无需切换面板；关闭面板后的迟到检查结果不应用。
- 一个状态请求失败时保留另一项独立能力，语音故障不禁用已就绪的纯视觉方案。
- 内存判断沿用后端的可用内存门槛；当前内置 AI 运行时要求至少 3 GiB 可用内存。
- 无需额外安装的说明只在完整 AI 已就绪时显示。中、英、马来文明确区分源码开发版与随附资源的完整离线版。
- 未就绪时提供显式“先用本地分析”入口，调用现有 `analyzeAutoEdit` → `buildEditPlan` → 审阅/应用/撤销流程。它不调用视觉模型或 ASR，不冒充语音识别或新字幕生成。

没有绕过模型检查，没有新建分析/导出管线，没有自动下载模型或安装依赖。

## 当前版本立即可用的方式

原界面向下滚动，展开 **Other analysis tools**，点击 **Generate local plan**。该方式按已有静音、静止画面、鼠标点击和保护规则生成建议供审阅；实际可剪范围仍取决音频证据及已有编辑。

## Windows x64 源码版的完整 AI 资源准备

这是用户主动执行的开发准备流程。模型来自仓库现有锁文件：Qwen3-VL 主权重和视觉投影合计 1,552,463,168 字节，Whisper 模型 190,085,487 字节；共约 **1.75 GB**，不含运行组件、源码、工具链和临时文件。Qwen 权重许可 Apache-2.0，Whisper 权重及两个运行时代码许可 MIT；现有准备脚本核验固定 revision、大小、哈希和许可文件。

停止当前开发程序后，在包含 `package.json` 的项目目录，用 PowerShell 主动运行：

```powershell
& {
    $ErrorActionPreference = "Stop"
    npm.cmd run prepare:offline-ai
    if ($LASTEXITCODE -ne 0) { throw "AI 资源准备失败，已停止。" }
    npm.cmd run prepare:offline-speech
    if ($LASTEXITCODE -ne 0) { throw "语音资源准备失败，已停止。" }
    npm.cmd run dev
}
```

现有脚本还会下载便携构建工具并编译 Windows 运行组件，使用两个编译任务，首次执行可能较久；不是普通客户每次启动的步骤。资源路径为 `vendor/offline-ai/win32-x64/` 及其 `speech/` 子目录。打包程序的对应资源位于应用 resources；源码目录的准备不等于修复另一个已安装程序。

本次没有在 Linux 环境执行这些 Windows 模型下载/编译命令，也没有验证用户电脑的实际模型推理或速度。准备失败应保留日志，不把按钮就绪或 mock 测试当作实际 AI 验收。

## 实际验证

- 新增 [auto-edit-readiness.spec.ts](../tests/ui/auto-edit-readiness.spec.ts) 的 **5 个 Chromium 界面测试通过**：缺资源时即时解释与本地分析、资源准备后刷新、部分 IPC 失败恢复、平台不支持、低内存。
- 原有离线 AI/语音流程中选取的 **7 个界面回归通过**：视觉方案与撤销、缺失模型说明、一键剪辑、取消迟到推理、审阅模式、单独缺少语音资源、识别语言传递。共 **12 项界面验证**，IPC 和模型输出明确使用 fixture；浏览器交互实际执行。
- `npm test`：**2001 项通过、18 项跳过**，225 个文件通过、5 个跳过。
- TypeScript、`npm run build:app`、主进程 CJS 加载检查通过。
- 临时日志为 `/tmp/recordly-autoedit-readiness-*.log`，不随源码分发。

真实 Windows 模型推理、硬件性能和识别质量仍待实机验证。测试没有下载权重，也没有声称已启用用户电脑上的完整 AI。
