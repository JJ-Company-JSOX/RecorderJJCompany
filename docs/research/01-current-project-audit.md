# 01 — RecorderJJCompany 当前项目审计

审计日期：2026-10-24（Asia/Singapore）。基线：`codex/recording-launcher` / `e06191c510d864ff160ecbb6b69e084c44532020`。开始审计时工作区干净。沿用 Electron、React、TypeScript、PixiJS、FFmpeg、原生捕获；不迁移 WPF，不另起录制器／导出管线。

## 方法与证据边界

扫描 `src/`、`electron/`、`scripts/`、`tests/`、`cloud/` 共 1151 个路径，读取下列关键实现、依赖清单、锁文件、测试及既有验证文档。不是逐字审阅所有文件，也不是完整渗透测试。源码／测试的存在只证明有实现线索，下面的“已验证”均限定具体测试范围。

本轮在 Linux/Node 24/Chromium/FFmpeg 环境实际重跑：

- Vitest：222 个文件通过，5 个跳过；1968 项通过，18 项跳过。含真实 FFmpeg 混合规格导入、取消及素材保留用例；模型／设备相关跳过项不计入通过。
- Chromium：10 项通过。包括背景／比例撤销，鼠标控件，标注保存／撤销，裁剪恢复，排序，关联图层删除／撤销，智能剪辑应用／审阅／取消及识别语言请求。Electron IPC、ASR 返回值为显式 fixture；不是 Windows 捕获或真实模型推理。
- 当前会话此前已有生产构建／主进程 CommonJS 加载通过记录；本研究不以该记录替代新 Windows 安装包验收。
- 无 Windows 桌面、实际多显示器 DPI、物理音频／摄像头设备、Windows GPU 驱动；未运行新的模型推理、未下载权重、未安装依赖。

既有证据如 [离线语音验证](../offline-speech-validation-2026-10-19.md)、[阶段记录](../recording-stages-2-3.md) 是历史记录，不能外推为当前提交全部通过。临时原始输出：`/tmp/recordly-research-20261024/current-unit.log`、`current-ui.log`；这些日志不随源码分发。

## 架构与 16 项功能审计

状态口径：**已验证**＝仅列出的自动验证通过；**待验证**＝代码调用链存在，目标设备／模型未验证；**部分实现**＝至少一个明确子能力缺失；**未实现**＝未发现可接通实现；**Bug**＝有可重复证据。性能需求单列，未测量不宣称优化收益。

| 模块 | 实际调用链／代码证据 | 状态及本轮证据 | 限制／性能关注 |
|---|---|---|---|
| Electron 主／渲染进程 | [main.ts](../../electron/main.ts) → [handlers.ts](../../electron/ipc/handlers.ts) → `register*Handlers`；[preload.ts](../../electron/preload.ts) → [App.tsx](../../src/App.tsx) 按 windowType lazy 加载 | 已验证：现有启动／权限／导航单元检查通过；待验证：Windows 窗口与 native helper 实际生命周期 | `contextIsolation:true`、`nodeIntegration:false`；HUD `webSecurity:false` 是需复审的特殊边界，见 05 |
| React UI | [EditorShell](../../src/components/video-editor/layout/EditorShell.tsx)、[EditorSidebar](../../src/components/video-editor/layout/EditorSidebar.tsx)、[SettingsPanel](../../src/components/video-editor/SettingsPanel.tsx) | 已验证：10 项实际 renderer 操作；部分实现：FocuSee 参考图完整参数／特效集未覆盖 | 选中标注会覆盖当前属性面板；不是按钮存在即完成 |
| TypeScript 类型 | [types.ts](../../src/components/video-editor/types.ts)、[projectPersistence](../../src/components/video-editor/projectPersistence.ts)、[electron-env.d.ts](../../electron/electron-env.d.ts) | 部分实现：静态类型和大量 runtime validation；**Bug A-01：工程 version 只校验 typeof number** | IPC 类型不是运行时授权；不能接受未来格式后用旧格式保存 |
| 屏幕捕获 | [useScreenRecorder](../../src/hooks/useScreenRecorder.ts) → [recording handlers](../../electron/ipc/register/recording.ts) → [windows.ts](../../electron/ipc/recording/windows.ts) → `wgc-capture.exe`；不可用时已有浏览器回退 | 待验证：真实录制；已验证：状态／取消／源映射等自动检查 | Windows 原生可用性要求 Win10 build≥19041；[capturePicker](../../electron/ipc/register/capturePicker.ts) 的 `allowArea` 仅 darwin，Windows 区域选择是部分实现／缺失，不应显示成已完成 |
| 系统声音／麦克风 | 同一 recorder 管线 → companion sidecar → [audio routing](../../src/lib/exporter/audioRoutingEngine.ts) → offline mixer；[audioTypes](../../src/components/video-editor/audio/audioTypes.ts) | 已验证：时间切片／路由／混音算法与真实 FFmpeg 导入；待验证：Windows WASAPI／麦克风实录同步 | 有源音轨音量、归一化、派生 RNNoise；用户音频片段淡入淡出已接通，源音轨淡入淡出未完整实现 |
| 摄像头 | `prepareWebcamRecorder` / `stopWebcamRecorder` in [useScreenRecorder](../../src/hooks/useScreenRecorder.ts) → 独立素材；[webcam layout](../../src/components/video-editor/webcamOverlay.ts)；预览／导出同步素材时间 | 待验证：设备实录；已有同步／布局单元检查通过 | 失败提示后屏幕录制继续；多摄像头、设备断连和极端 offset 尚需实机 |
| FFmpeg | [binary resolution](../../electron/ipc/ffmpeg/binary.ts)、[recording library](../../electron/ipc/recording/library.ts)、[native export](../../electron/ipc/export/native-video.ts) | 已验证：Linux 实际合成／导入／取消测试；待验证：发布包携带的 Windows 二进制 | 使用 argv spawn/execFile，不能据此免除协议、路径与版本审核；不同 FFmpeg 构建许可证不同 |
| 时间轴 | [clipSequence](../../src/components/video-editor/clipSequence.ts)、[useTimelineProjection](../../src/components/video-editor/hooks/useTimelineProjection.ts)、[timeline runtime](../../src/components/video-editor/timeline/hooks/useTimelineEditorRuntime.ts) | 已验证：裁剪恢复／排序／关联图层撤销 UI 及纯函数；部分实现：完整轨道锁定／显示管理 | source-ms 与 timeline-ms 已分离；图片片段全组合、移动／重复素材边界须继续验证 |
| AI 自动剪辑 | [AutoEditPanel](../../src/components/video-editor/auto-edit/AutoEditPanel.tsx) → `analyzeCompleteAutoEdit` → [register/autoEdit](../../electron/ipc/register/autoEdit.ts) → media/ASR/LLM → [speechPlan](../../src/components/video-editor/auto-edit/speechPlan.ts) → [applyEditPlan](../../src/components/video-editor/auto-edit/apply.ts) | 已验证：fixture 应用／审阅／迟到结果取消；待验证：当前包真实模型；部分实现：不能通用理解所有内容、不是无误语义剪辑师 | 最长 10 分钟；基线校验防 stale plan；不是所有口头禅都可自动安全删除 |
| AI 画面理解 | [vision.ts](../../electron/ipc/autoEdit/vision.ts) / bounded frame extraction → [bundled.ts](../../electron/ipc/autoEdit/bundled.ts) llama.cpp + Qwen3-VL | 已验证：真实 FFmpeg 有界抽帧＋模型替身响应的验证／取消；待验证：实际视觉质量 | 最多抽样而非逐帧理解；敏感标注不能直接盖住操作控件 |
| AI 解说词 | [narrator.ts](../../electron/ipc/autoEdit/narrator.ts)、[tutorialScript.ts](../../electron/ipc/autoEdit/tutorialScript.ts) → 审阅草稿 → narration scheduling | 已验证：有界草稿／排程的自动测试；待验证：自然度／事实准确性 | 不应把生成文本当真实屏幕事实；用户确认后生成配音 |
| 本地 AI 配音 | [tts.ts](../../electron/ipc/autoEdit/tts.ts)、[offline-tts lock](../../scripts/offline-tts.lock.json)，Kokoro／Piper 路径；原有声轨／字幕进入 timeline | 待验证：当前机器未运行真实模型；单元检查通过 | 各语种 voice/model 单独许可；不新增第二套 Python 运行时 |
| 自动字幕 | [useAutoCaptionController](../../src/components/video-editor/captions/useAutoCaptionController.ts) → [captions generate](../../electron/ipc/captions/generate.ts) / bundledSpeech → [captionTimeline](../../src/components/video-editor/captionTimeline.ts) | 已验证：投影、拆合、编辑、输出、取消单元；UI fixture；待验证：真实识别／对齐质量 | 模型下载显式触发；通用下载 URL 使用 mutable main，需补固定 revision／哈希；CPU 性能未测 |
| MP4 导出 | [useExportRunner](../../src/components/video-editor/export/useExportRunner.ts) → [buildExportRenderOptions](../../src/components/video-editor/export/buildExportRenderOptions.ts) → existing VideoExporter/ModernVideoExporter → Pixi compositor + existing mux/FFmpeg | 部分实现：调用链与自动路径测试已验证；当前本轮未完成真实用户工程的每像素成片比对／Windows GPU 试编码 | native 路径有 frame-count/duration validation，不能外推所有保存路径均完整校验；取消／回退不等于所有设备稳定 |
| CPU/GPU 资源 | [gpuSwitches](../../electron/gpuSwitches.ts)、[bundled](../../electron/ipc/autoEdit/bundled.ts) `llamaThreads`/CPU layers、export backpressure/解码 cache | 已验证：资源策略单元；待验证／需性能测量：真实 RAM 峰值、cursor FPS、冷启动 | Windows ANGLE d3d11；AI 先转录再 LLM，避免同时加载；核显仍承担预览图形工作，不等于“无 GPU 使用” |
| 测试／构建 | [package.json](../../package.json)、[vite config](../../vite.config.ts)、native build scripts、[Windows package preparation](../../scripts/prepare-windows-test-package.mjs) | 本轮 1968 tests + 10 renderer 场景通过；Windows 安装／签名／旧 CPU 待验证 | package:offline 需完整资源；源码 ZIP 不等于可供普通客户直接安装的包 |

## FocuSee 参考图逐项矩阵：UI → 保存 → 时间 → 成片

| 参考功能 | UI 入口 | 工程保存／重开依据 | 预览／导出依据 | 判定 |
|---|---|---|---|---|
| 画布比例／纯色／渐变／本地背景 | Scene、顶部比例；SettingsPanel | useProjectSnapshotModel → normalizeProjectEditor → useProjectLifecycle；比例／blur 撤销 UI 通过 | buildExportRenderOptions → frameRenderer/modernFrameRenderer 共用 layout | 已接线；实际图像与多比例成片比对待验证 |
| Padding、圆角、阴影、背景模糊 | Scene（部分参数需 Advanced） | 持久化字段与 presentationHistory 已覆盖 | renderer layout、compositeWithShadows | 自动验证部分通过；不是照片中所有 Inset/Fixed Zoom 参数都存在 |
| 鼠标大小／样式／点击光圈／点击声音 | Cursor，Show Cursor 已在普通面板 | cursor 字段保存；重开自定义参数保持；声音不单独存媒体文件 | telemetry source time；buildCursorClickAudioRegions 按 clip/speed 映射输出时间；预览与 MP4 共用映射 | 已验证控件／纯函数／WAV 解码；实录 DPI／重绘一致性待验证 |
| 光标角度／闲置隐藏／结束前返回／烟花节日 | 未找到完整贯通实现 | 无完整参数链 | 无完整同款实现 | 部分／未实现，不照图摆空按钮 |
| 自动 Zoom | 原有 auto/manual zoom 与时间轴 | zoomRegions + history | 源点击 → timeline Zoom；共用 zoomTransform/camera spring | 自动算法／时间映射已验证，真实素材观感待验证 |
| 文字／箭头／模糊遮罩 | 左侧 Annotation tools + 原有属性面板 | annotationRegions、位置／样式／时间，保存与撤销 UI 通过 | VideoPlayback timelineTime 与 compositor timelineEffects 时间一致；annotationRenderer 参与成片 | 已接线，真实用户素材最终像素级验证待做 |
| 矩形／圆形／聚光灯／放大镜同款 | 未找到完整独立类型；当前 figure 是方向箭头 | 不冒称支持 | 不冒称已导出 | 未实现／部分 |
| 摄像头布局 | Webcam | webcam independent sourcePath/timeOffset/layout | webcam sync 按 source 时间，与主素材裁剪投影配合 | 待实机验收 |
| 智能剪辑／按文字剪片 | AI auto edit | EditState、baseline、undo transaction；caption source cues | apply 后仍进入同一 clip timeline + exporter | fixture 已验证；真实 ASR/语义质量待验证；不是付费 API 的空按钮 |
| AI 动画头像／手机投屏／3D 镜头 | 无完整落地模块 | — | — | 未实现，P4，不能抢占核心稳定工作 |

## 关键调用链审阅结论

1. 背景、鼠标、标注都已通过 `buildExportRenderOptions` 传入原有导出器，不应另做 FFmpeg 特效管线。`timelineEffects` 为 true 时 exporter 以输出时间驱动图层，cursor 与 webcam 仍使用素材时间。字幕通过 `projectCaptionCues` 投影保留片段；这些时间概念不能混写。
2. 保存链保存编辑参数而非改写原视频。`atomicSave.ts` 有同路径写队列、临时文件 sync、备份及 Windows transient rename 重试；`useProjectSaveActions` 有防抖 autosave。但缺少完整用户可见的缺失素材重新定位／异常恢复选择，不等于完全没有恢复底座。
3. 本地工作流账号开关 `ACCOUNTS_ENABLED=false`；存在云端／Supabase／Firebase 相关代码不代表本地录屏要登录，更不应因为研究改数据库或接付费服务。

## 已确认缺陷与待核实风险

**A-01（P0，工程数据保真）：未来／无效工程版本被接受。** 当前 `PROJECT_VERSION=2`，但 renderer 的 `validateProjectData` 和 main 的 `isLoadableProjectData` 均只检查 `typeof version === "number"`。本轮将实际 validator 函数用已安装 TypeScript 转译后运行：version 1、2、999、1.5、-1 均返回 true。若未来工程被当前版本加载、归一化及 autosave，未知字段可能丢失；本轮没有制造或实际覆盖用户工程。先补一个共享纯版本守卫，再用版本 1/2 和未来版本拒绝用例验证，不改变格式、不迁移数据。

其他项暂定风险／缺口而非已复现攻击：HUD webSecurity:false、loopback media CORS '*'、部分 IPC 未显式统一验证 senderFrame、可变模型下载源、所有 MP4 路径尚未统一解码／音轨检查。详细见 05；不能把这些静态发现写成已被利用的漏洞。

## 下一步顺序

先修 A-01 并保留 1/2 兼容；随后补实录→工程重开→含背景／鼠标／标注 MP4 的 Windows 验收证据。维持当前 recorder/exporter，研究新项目仅提供算法、资源边界和恢复设计参考。新增 UI 特效前必须补齐保存、时间投影、导出和撤销，手机投屏／动画头像／3D 留后。

## A-01 审计后修复记录

按后续“先审计、再修复核心问题”的授权，新增无UI依赖的 `src/types/projectVersion.ts` 共享版本守卫，main/renderer 都只接受整数 v1/v2。未来版本给出“请用新版打开、原文件未改变”的提示，在媒体授权和会话切换前拒绝。没有格式升级或数据迁移。

实际验证：`projectPersistence.test.ts` 29 项、`manager.test.ts` 22 项共 **51 项通过**；包括v1/v2兼容、非法/未来版本拒绝、未来工程和媒体字节不变、会话和权限集合不变。TypeScript检查通过。测试输出见临时 `fix-version.log` / `fix-types.log`。全量1968通过为修复前的基线结果，不把它冒充为修复后的全量结果。

修复后全量复验：**1979 项通过、18 项跳过**（222 个测试文件通过、5 个跳过）；`npm run build:app` 通过 TypeScript、Vite、Electron main/preload 构建与主进程加载检查。日志为临时研究目录的 `post-fix-unit.log` / `post-fix-build.log`。未构建或运行 Windows 安装包。
