# 创作要求、原声理解与本地故事配音 — 2026-10-26

本轮继续现有 RecorderJJCompany，不重建录制器或导出器。用户已取消 Wan API；已知电脑为 16 GB RAM、无独立显卡。没有下载模型、添加依赖或引入收费服务。

## 实际交付

1. **录制／导入前填写要求。** 首页新增“创作要求（选填）”，例如“介绍这个产品，帮我写 30 秒的销售文案”。选择设备仍使用现有控制。成功导入媒体或录制真正开始后，要求交给新视频的故事工作区；只选中素材、取消文件选择和录制倒计时不会启动 AI。打开已有工程优先使用工程自己的工作区。
2. **在故事界面主动识别原声。** 开启“识别原声音频，再结合内容策划故事”后，先检查已经安装的语音模型，再依次执行原声识别和 Ollama 故事推理。原始 WAV／音频不发送给文字模型。识别语言可选自动、英文、中文、马来文；已有字幕中的人工修订优先，生成的旁白不作为原声证据。
3. **独立保存原声文本。** 原声时间和逐词时间保留在 `storyWorkspace.sourceSpeech`，不覆盖现有字幕。故事上下文仍按当前片段的裁剪、重排、变速、重复使用和间隙映射，并受已有字符预算限制。原始文本可展开查看；同一素材、同一识别语言再次改稿可复用识别结果，也可主动重新识别。
4. **创作要求可以单独成稿。** 不再强制填写产品事实或素材说明；可补充受众、卖点和结尾行动。原声不存在、未识别出讲话或模型未安装时显示具体原因，并提供转到字幕设置或仅按要求／画面继续的入口。既有编辑和旧草稿保留。
5. **CPU 轻量设置。** 一键关闭抽样画面推理、开启本地原声识别和文字参考。它不自动下载或切换模型。关闭文字参考会同时关闭自动识别，避免识别后又丢弃文字。优先复用现有 whisper.cpp 和 Kokoro／sherpa-onnx；若已装 4B 太慢，可由用户自行安装和选择 `qwen3:1.7b`。文字模型不会被描述为能看画面。
6. **旁白时长预算。** 可填 5–600 秒的旁白目标。后台依据当前真实素材时长和场景分配写稿预算，并限制每段文案长度；界面明确说明此值不会剪短或延长视频。实际 TTS 长度仍经既有场景适配检查，超长句需缩短或调整时间，不能静默截断。
7. **继续现有审阅、配音与导出。** 用户审阅／修改文案、标题和时段，确认后使用已有本地 TTS、字幕和标注轨道。音频仍能在原时间轴移动、拆分和裁剪。新增“导出这个视频”入口打开原有导出菜单。已有工程保存、自动保存、撤销／重做与配音缓存继续工作。

## 取消、恢复与边界

- 新增按渲染窗口管理的字幕识别取消 IPC、真实阶段事件和结构化失败原因。AbortSignal 传入现有音轨准备、FFmpeg 和 Whisper 执行路径；窗口销毁或退出时请求中止，重复识别请求返回 busy。
- 故事界面取消时立即停止等待，取消识别并丢弃晚到结果；素材或时间轴改变后不得写入过期故事。模型推理继续使用既有取消机制，原生 TTS 当前句的中断限制未改变。
- 识别结果单独校验后保存。缓存最多 5000 段，字幕及逐词文字合计最多 200000 字符，时间上限 24 小时。非法或过大结果整体拒绝，不假装完整保存。
- 为控制界面开销，原声预览最多显示前 200 段；完整缓存仍随工程保存。提供给模型的文字数量另受已披露的上下文预算限制。
- 首页跨窗口要求使用一次性本地意图，媒体导入绑定文件路径，取消录制只清理本次意图。该意图保留 30 分钟；超长录制后可在编辑器重新填写要求。工程内的创作要求不受此临时期限影响。
- 此轮不自动生成新镜头，不自动重新排序素材，也不自动压低原声；若要替换原声，仍需使用既有音轨音量／静音。

## 代码证据

| 范围 | 实际入口 |
| --- | --- |
| 首页要求与导入／录制交接 | `src/components/launch/LaunchWindow.tsx`、`RecordingSetupPanel.tsx`、`hooks/useLaunchWindowActions.ts` |
| 单次交接及新媒体工作区恢复 | `src/components/video-editor/auto-edit/storyIntent.ts`、`project/useProjectLifecycle.ts`、`useInitialEditorSource.ts`、`useProjectOpenActions.ts` |
| 原声→故事编排、取消与界面 | `src/components/video-editor/auto-edit/AutoEditPanel.tsx`、`StoryBriefEditor.tsx`、`storyWorkflowCopy.ts` |
| 模型检查、识别校验和人工字幕优先 | `src/components/video-editor/auto-edit/storyAudio.ts` |
| 原声工作区保存与合法性检查 | `src/components/video-editor/auto-edit/storyWorkspace.ts` |
| 故事时长预算与本地模型提示 | `src/components/video-editor/auto-edit/story.ts`、`electron/ipc/autoEdit/story.ts` |
| 原声取消／阶段事件及窗口隔离 | `electron/ipc/register/captions.ts`、`electron/preload.ts`、`electron/electron-env.d.ts` |
| 原导出菜单接入 | `src/components/video-editor/layout/EditorShell.tsx` |

## 实际验证

- 完整单元测试：**2174 通过、18 跳过**，243 个测试文件通过、5 个跳过。初次完整测试发现字幕 IPC 新增退出监听使旧文件对话框测试夹具缺少 `app.once`；补齐夹具后完整重跑通过。跳过项需要原生／模型条件，未计为通过。
- Chromium 实际界面：**31 个不同场景通过**（首批 30 个、最后补充的开关联动回归 1 个），包括已有 Ollama 操作、首页设备选择和录制设置，以及创作要求交接、CPU 设置、原声先于故事、识别复用、缓存随工程保存、配音／文字加入原时间轴和打开原导出菜单。识别取消晚到、无音频及模型缺失场景也通过。
- 上述 UI 用真实 React、视频／WAV 解码和工程变换；ASR、Ollama、TTS 推理及文件 IPC 使用测试夹具，不能当作真实模型质量或用户 Windows 性能的证明。
- 实际导出：新增可复现的 `scripts/smoke-story-export.mjs`，调用既有 ModernVideoExporter、Pixi、Chromium 软件 H.264 与原有 FFmpeg AAC 回退。生成的 MP4 为 320×180、15 fps、H.264/AAC、387383 bytes；视频和音轨均 6.000 秒，完整解码通过。两段测试音频在正确区间有信号，间隙静音。重复源画面的两个场景显示各自标题与字幕，提取帧已人工查看。可移植脚本本身再次运行通过，详见 [导出验证](validation-story-export-2026-10-26.md)。这使用测试画面／音调，未运行真实 AI。
- TypeScript 检查、`npm run build:app` 生产构建、Electron 主进程 CJS smoke、29 个变动源码文件的格式检查和 `git diff --check` 均通过。生产构建仍有此前已有的 PostCSS/CSS 警告；此结果不是 Windows 安装包验收。

日志：`/tmp/recordly-connected-story-unit-final.log`、`/tmp/recordly-connected-story-ui.log`、`/tmp/recordly-story-context-toggle-ui.log`、`/tmp/recordly-connected-story-types-final.log`、`/tmp/recordly-connected-story-build-final.log`、`/tmp/recordly-connected-story-format-final.log`、`/tmp/recordly-portable-story-proof.log`。临时媒体与测试日志不提交到仓库。

## 尚未验证与下一步

当前是 Linux 云端，未访问用户 C 盘、FocuSee 安装文件或 Windows 设备；未验证 Windows 安装包、新流程里的真实 Ollama／Whisper／Kokoro、峰值内存、CPU 处理速度或硬件编码。不能保证在这台电脑上实时生成。

下一步应在用户电脑用真实短视频验证“首页要求→录制电脑声音→识别→故事审阅→配音／字幕→保存重开→导出”。记录每阶段耗时、峰值 RAM、实际字幕和声音同步。随后再评估主动选择 tiny/base 多语种识别资产、1.7B 模型质量、少量视觉帧的速度，以及原声自动混音。原声缓存目前按路径和语言复用，同路径文件被外部替换时需点击“重新分析原声和故事”。

免费方案的上游许可证、资源限制和研究证据见 [免费本地 AI 研究](research/09-free-local-ai-options-2026-10-26.md)。模型和运行程序的许可证分开核查；不把独立进程调用当作免除分发义务。

## Windows 更新和启动

先关闭旧开发进程。下面同一条命令可从 **CMD 或 PowerShell** 运行；目录沿用用户已有位置，更新失败时不会继续启动：

```cmd
cmd.exe /d /c "cd /d C:\Users\jeffreylhz\RecorderJJCompany-20261024-110640 && git pull --ff-only origin jsox-preview && npm.cmd run dev"
```

入口：AI auto edit → Ollama advanced → 检查已安装模型 → AI voice-over → Plan a whole-video story → Use lightweight CPU settings。首页填写的创作要求会进入新视频的主题；不会自动发起推理。

若现有 4B 模型仍慢，用户可自行执行 `ollama pull qwen3:1.7b`，完成后回到应用选择并检查这个模型。这是可选下载，不是本次更新已附带的模型；识别与配音继续使用原有安装流程。
