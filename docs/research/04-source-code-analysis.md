# 04 — 源代码分析与复用边界

审阅日期：2026-10-24（Asia/Singapore）。当前工程基线 `e06191c5`，审计后修复记录见 01/08。外部数据为逐仓库抓取时的快照，不以 Stars 判断质量；没有运行或安装第三方项目。


本报告的“源码已读”不等于运行成功。外部源码只保存在 `/tmp/recordly-research-20261024`，未复制进工程，未执行、不安装依赖、不下载模型。所有建议的成本为一名熟悉现项目工程师的粗估，不是性能实测。A 保留现有，B 改良现有，C 新独立能力，E 不建议引入，U 无法确认；D 替换必须另举证，本轮没有足够证据建议替换录制器或导出器。

## obsproject/obs-studio — B

**实际符号／类：** choose_method；WASAPISource::Start；winrt_capture_init_internal。

**原理与借鉴结论：** DXGI/WGC 选择、设备丢失重建与异步 WASAPI 回调；学诊断和资源生命周期，不嵌入整套 OBS。

**依赖／难度／CPU-GPU-RAM：** D3D11/WASAPI/libobs；工程级集成高（4–8+周），设计复用中（1–2周）；GPU纹理与音频缓冲有预算，未测RAM。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** GPL-2.0（根标签；组合前核验具体文件可否选 GPLv3）。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [plugins/win-capture/duplicator-monitor-capture.c](https://github.com/obsproject/obs-studio/blob/72e86655715d9a25d69ce446aa4dd44ba58e10d2/plugins/win-capture/duplicator-monitor-capture.c)（已读取；26058 bytes）。
- [plugins/win-wasapi/win-wasapi.cpp](https://github.com/obsproject/obs-studio/blob/72e86655715d9a25d69ce446aa4dd44ba58e10d2/plugins/win-wasapi/win-wasapi.cpp)（已读取；45973 bytes）。
- [libobs-winrt/winrt-capture.cpp](https://github.com/obsproject/obs-studio/blob/72e86655715d9a25d69ce446aa4dd44ba58e10d2/libobs-winrt/winrt-capture.cpp)（已读取；20444 bytes）。


## CapSoftware/Cap — B

**实际符号／类：** validate_instant_recording；RelativeCursorPosition::normalize；crash_sentinel::init。

**原理与借鉴结论：** 验证容器/解码/时长后标记健康；区分Windows物理坐标和mac逻辑坐标；记录异常结束哨兵。

**依赖／难度／CPU-GPU-RAM：** Rust/FFmpeg/device_query/scap；只借设计中（1–3周），引入原库高；预览GPU、捕获多缓冲中高，模型另算。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** AGPL-3.0；cap-camera*/scap-* 为 MIT；逐目录核验。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [crates/recording/src/lib.rs](https://github.com/CapSoftware/Cap/blob/766e6c517341c9cb08149d0607b382576ef9ff34/crates/recording/src/lib.rs)（已读取；4944 bytes）。
- [crates/cursor-capture/src/lib.rs](https://github.com/CapSoftware/Cap/blob/766e6c517341c9cb08149d0607b382576ef9ff34/crates/cursor-capture/src/lib.rs)（已读取；35 bytes）。
- [apps/desktop/src-tauri/src/crash_sentinel.rs](https://github.com/CapSoftware/Cap/blob/766e6c517341c9cb08149d0607b382576ef9ff34/apps/desktop/src-tauri/src/crash_sentinel.rs)（已读取；14546 bytes）。
- [crates/recording/src/output_validation.rs](https://github.com/CapSoftware/Cap/blob/766e6c517341c9cb08149d0607b382576ef9ff34/crates/recording/src/output_validation.rs)（已读取；5360 bytes）。
- [crates/recording/src/sync_calibration.rs](https://github.com/CapSoftware/Cap/blob/766e6c517341c9cb08149d0607b382576ef9ff34/crates/recording/src/sync_calibration.rs)（已读取；4846 bytes）。
- [crates/cursor-capture/src/position.rs](https://github.com/CapSoftware/Cap/blob/766e6c517341c9cb08149d0607b382576ef9ff34/crates/cursor-capture/src/position.rs)（已读取；12420 bytes）。


## ShareX/ShareX — B

**实际符号／类：** ScreenRecorder；RecordingClock.Start/Pause/Resume/TryMap。

**原理与借鉴结论：** 以WGC/WASAPI共用QPC epoch映射，暂停累计时长不进入输出时间；按状态防重复提交。

**依赖／难度／CPU-GPU-RAM：** Windows capture/MediaFoundation；仅参考clock算法低中（3–7天）；不引入.NET运行时；CPU/GPU取决编码路径。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** GPL-3.0 根；所读 ScreenRecorder/Clock 头部为 GPL-2.0-or-later（选v3需保留说明）。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [ShareX.ScreenRecordingLib/ScreenRecorder.cs](https://github.com/ShareX/ShareX/blob/2548704791a9a8136c78ce0649593b70e87e0c7d/ShareX.ScreenRecordingLib/ScreenRecorder.cs)（已读取；20786 bytes）。
- [ShareX.ScreenRecordingLib/RecordingClock.cs](https://github.com/ShareX/ShareX/blob/2548704791a9a8136c78ce0649593b70e87e0c7d/ShareX.ScreenRecordingLib/RecordingClock.cs)（已读取；2854 bytes）。


## alyssaxuu/screenity — B

**实际符号／类：** fastRecorderGate；OffscreenRecorder 的 recorder-host port。

**原理与借鉴结论：** offscreen文档维持长录制生命周期、完成后验证blob；Chrome runtime消息不能直接搬进Electron。

**依赖／难度／CPU-GPU-RAM：** chrome.* API、mediabunny；独立复写生命周期中（1–2周）；扩展权限宽，下载/云路径另审。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** GPL-3.0（only/or-later变体未全面核实）。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [src/manifest.json](https://github.com/alyssaxuu/screenity/blob/377c175cf20194802eb9f92a89ae234880c9a847/src/manifest.json)（已读取；2905 bytes）。
- [src/media/fastRecorderGate.ts](https://github.com/alyssaxuu/screenity/blob/377c175cf20194802eb9f92a89ae234880c9a847/src/media/fastRecorderGate.ts)（已读取；34157 bytes）。
- [src/pages/OffscreenRecorder/index.jsx](https://github.com/alyssaxuu/screenity/blob/377c175cf20194802eb9f92a89ae234880c9a847/src/pages/OffscreenRecorder/index.jsx)（已读取；3134 bytes）。


## wulkano/Kap — E

**实际符号／类：** aperture wrapper；Conversion。

**原理与借鉴结论：** 录制与转换队列分离、取消事件；aperture/macOS捕获不适用于Windows。

**依赖／难度／CPU-GPU-RAM：** macOS native runtime；学习小（2–4天），直接依赖无收益；老Electron依赖需重审。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MIT。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [main/aperture.ts](https://github.com/wulkano/Kap/blob/c42692fa63ac71ed192e01684beb78a1b864aa88/main/aperture.ts)（已读取；8352 bytes）。
- [main/conversion.ts](https://github.com/wulkano/Kap/blob/c42692fa63ac71ed192e01684beb78a1b864aa88/main/conversion.ts)（已读取；4035 bytes）。


## SeaDve/Kooha — E

**实际符号／类：** Recording::start/pause/resume/stop/cancel；PipelineBuilder::build。

**原理与借鉴结论：** 由portal授权源构建GStreamer视频和音频管线；GLib状态/取消有参考价值，后端不适合Windows。

**依赖／难度／CPU-GPU-RAM：** PipeWire/portal/GStreamer；移植高且重复现架构，拒绝引入；不测资源优劣。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** GPL-3.0（版本选项未全量核实）。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [src/recording.rs](https://github.com/SeaDve/Kooha/blob/247bd25579538035d9a87bfdf582258767d673c5/src/recording.rs)（已读取；21172 bytes）。
- [src/pipeline.rs](https://github.com/SeaDve/Kooha/blob/247bd25579538035d9a87bfdf582258767d673c5/src/pipeline.rs)（已读取；15128 bytes）。
- [src/timer.rs](https://github.com/SeaDve/Kooha/blob/247bd25579538035d9a87bfdf582258767d673c5/src/timer.rs)（已读取；6360 bytes）。


## vkohaupt/vokoscreenNG — E

**实际符号／类：** QvkMainWindow::set_ToolButtonEnableDisable；slot_profileSave。

**原理与借鉴结论：** 配置分组/设备/磁盘提示有参考价值；GPLv2-only源码不直接并入AGPLv3作品。

**依赖／难度／CPU-GPU-RAM：** Qt/GStreamer；整库替换高；算法独立实现可另评；额外runtime与打包负担不合理。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** GPL-2.0-only（所读 mainwindow.cpp 明示 version 2）。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [src/mainwindow.cpp](https://github.com/vkohaupt/vokoscreenNG/blob/7db6b4e2224decab9771ed49284b5e49c0f3215c/src/mainwindow.cpp)（已读取；106700 bytes）。


## NickeManarin/ScreenToGif — B

**实际符号／类：** NewRecorder；Editor；ActionStack。

**原理与借鉴结论：** 以独立StateChange和磁盘资源支持撤销/重做，参考工程快照及恢复；不迁移WPF。

**依赖／难度／CPU-GPU-RAM：** WPF/.NET/图像与编码依赖；设计中（1–2周）；MS-PL源码分发条件需单独审核，默认仅学设计。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MS-PL。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [ScreenToGif/Windows/Editor.xaml.cs](https://github.com/NickeManarin/ScreenToGif/blob/a4d0a67c2131cd048ceec86cd40afc2f1a06f2fd/ScreenToGif/Windows/Editor.xaml.cs)（已读取；266939 bytes）。
- [ScreenToGif/Windows/NewRecorder.xaml.cs](https://github.com/NickeManarin/ScreenToGif/blob/a4d0a67c2131cd048ceec86cd40afc2f1a06f2fd/ScreenToGif/Windows/NewRecorder.xaml.cs)（已读取；72693 bytes）。
- [ScreenToGif/Util/ActionStack.cs](https://github.com/NickeManarin/ScreenToGif/blob/a4d0a67c2131cd048ceec86cd40afc2f1a06f2fd/ScreenToGif/Util/ActionStack.cs)（已读取；34564 bytes）。


## getopenscreen/openscreen — B

**实际符号／类：** checkDiskSpace；recordingStorageProblem；isSalvageableFragmentedCapture。

**原理与借鉴结论：** 录制前可用空间/目录检查、停止后fragmented容器抢救；与本仓库同源，按具体commit做差异审阅而非覆盖。

**依赖／难度／CPU-GPU-RAM：** Electron/本地helper；独立改良低中（3–10天）；服务/LLM路径不引入，性能收益须实测。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MIT。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [electron/main.ts](https://github.com/getopenscreen/openscreen/blob/264975d8fcd2b32ce62060f06c6e8523b819be9c/electron/main.ts)（已读取；52513 bytes）。
- [electron/recording/diskSpaceCheck.ts](https://github.com/getopenscreen/openscreen/blob/264975d8fcd2b32ce62060f06c6e8523b819be9c/electron/recording/diskSpaceCheck.ts)（已读取；2011 bytes）。
- [electron/recording/nativeWindowsCaptureStop.ts](https://github.com/getopenscreen/openscreen/blob/264975d8fcd2b32ce62060f06c6e8523b819be9c/electron/recording/nativeWindowsCaptureStop.ts)（已读取；15846 bytes）。


## pavanjoshi914/Reframe — E

**实际符号／类：** suggestZoomsFromActivity；timelineToVideoMs；videoToTimelineMs。

**原理与借鉴结论：** 时间+空间聚类并合并点击/停留，素材与工程双向映射；现有Recordly已有类似实现，不重写；复制待许可证澄清。

**依赖／难度／CPU-GPU-RAM：** Electron/MediaRecorder/canvas；独立算法低中（3–7天）；长 export.ts 不作替换组件，性能未基准。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MIT 仅 package.json 声明；未找到根 LICENSE 正文，Unverified。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [electron/main.ts](https://github.com/pavanjoshi914/Reframe/blob/4bc54915ad631f39aedbce888342f05d1cd82e73/electron/main.ts)（已读取；123507 bytes）。
- [src/editor/autoZoom.ts](https://github.com/pavanjoshi914/Reframe/blob/4bc54915ad631f39aedbce888342f05d1cd82e73/src/editor/autoZoom.ts)（已读取；7633 bytes）。
- [src/editor/timeMapping.ts](https://github.com/pavanjoshi914/Reframe/blob/4bc54915ad631f39aedbce888342f05d1cd82e73/src/editor/timeMapping.ts)（已读取；2807 bytes）。
- [src/editor/export.ts](https://github.com/pavanjoshi914/Reframe/blob/4bc54915ad631f39aedbce888342f05d1cd82e73/src/editor/export.ts)（已读取；190103 bytes）。


## focra-app/Focra — E

**实际符号／类：** generateAutoZoomKeyframes；PixiRenderer。

**原理与借鉴结论：** 过滤捕获区域外点击，坐标归一化与固定zoom时段；不要把README中dwell宣传当源代码完成证明。

**依赖／难度／CPU-GPU-RAM：** Pixi/FFmpeg/transformers依赖重叠；拒绝重复引入；许可澄清后才可考虑源码片段。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MIT 声明；根 LICENSE 链接未证实正文，Unverified。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [src/main/index.ts](https://github.com/focra-app/Focra/blob/76c7b6557e97233c3df52f75ccdcfb73d8c0c7ec/src/main/index.ts)（已读取；2726 bytes）。
- [src/renderer/lib/PixiRenderer.ts](https://github.com/focra-app/Focra/blob/76c7b6557e97233c3df52f75ccdcfb73d8c0c7ec/src/renderer/lib/PixiRenderer.ts)（已读取；22991 bytes）。
- [src/main/recorder.ts](https://github.com/focra-app/Focra/blob/76c7b6557e97233c3df52f75ccdcfb73d8c0c7ec/src/main/recorder.ts)（已读取；3039 bytes）。


## mesutde/MimoScreenRecorder — E

**实际符号／类：** detectEncoder；ScreenRecorder。

**原理与借鉴结论：** 用64x64短片逐个试NVENC/AMF/QSV再x264；本项目已经有真实编码探针，不重复开发；gdigrab不替换WGC。

**依赖／难度／CPU-GPU-RAM：** FFmpeg子进程；复制许可未知；原架构已覆盖探针；GDI帧拷贝可能高，未测不可定量。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MIT 仅 package.json 声明；无根 LICENSE 正文，Unverified。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [src/main/index.ts](https://github.com/mesutde/MimoScreenRecorder/blob/05081b48c61dbb66b0e71971b52afcbd2ccc5c12/src/main/index.ts)（已读取；17377 bytes）。
- [src/main/recorder/screen-recorder.ts](https://github.com/mesutde/MimoScreenRecorder/blob/05081b48c61dbb66b0e71971b52afcbd2ccc5c12/src/main/recorder/screen-recorder.ts)（已读取；29316 bytes）。


## haxzie/prequel — U

**实际符号／类：** Unverified。

**原理与借鉴结论：** 没有可访问源码或许可证，排除整合，不编造功能/星标/维护状态。

**依赖／难度／CPU-GPU-RAM：** 不估算未访问工程。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** Unverified。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- Unverified：公开 URL 无可用源码。


## mmozeiko/wcap — B

**实际符号／类：** ScreenCapture_CreateForMonitor；Encoder_NewFrame；AudioCapture_GetData。

**原理与借鉴结论：** 直接纹理捕获到编码器，统一时间戳并处理区域；现有helper同技术方向，适合逐项检查边界而非替换。

**依赖／难度／CPU-GPU-RAM：** WindowsSDK/D3D11/MF；设计中（1–3周）；纹理带宽、编码缓冲需测，GPU正常参与。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** Unlicense（Windows SDK/codec分发另审）。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [wcap_screen_capture.h](https://github.com/mmozeiko/wcap/blob/aa25ccb806d7a6e1c0bfdcca863aabcd8e9badfa/wcap_screen_capture.h)（已读取；26144 bytes）。
- [wcap_audio_capture.h](https://github.com/mmozeiko/wcap/blob/aa25ccb806d7a6e1c0bfdcca863aabcd8e9badfa/wcap_audio_capture.h)（已读取；16494 bytes）。
- [wcap_encoder.h](https://github.com/mmozeiko/wcap/blob/aa25ccb806d7a6e1c0bfdcca863aabcd8e9badfa/wcap_encoder.h)（已读取；32059 bytes）。


## jsattler/BetterCapture — B

**实际符号／类：** CaptureEngine.startCapture/stopCapture；AssetWriter.appendVideoSample/finishWriting。

**原理与借鉴结论：** 分离捕获和写入、输出帧计数与错误回调；可借职责和恢复行为，不能把SCK移植为Windows后端。

**依赖／难度／CPU-GPU-RAM：** AVFoundation/SCK；仅设计低中（3–7天）；跨平台运行时不适用。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MIT。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [BetterCapture/BetterCaptureApp.swift](https://github.com/jsattler/BetterCapture/blob/ab852b44c4dd09c8e2ae69e7858a1b67e1cd17af/BetterCapture/BetterCaptureApp.swift)（已读取；2977 bytes）。
- [BetterCapture/Service/CaptureEngine.swift](https://github.com/jsattler/BetterCapture/blob/ab852b44c4dd09c8e2ae69e7858a1b67e1cd17af/BetterCapture/Service/CaptureEngine.swift)（已读取；19937 bytes）。
- [BetterCapture/Service/AssetWriter.swift](https://github.com/jsattler/BetterCapture/blob/ab852b44c4dd09c8e2ae69e7858a1b67e1cd17af/BetterCapture/Service/AssetWriter.swift)（已读取；26310 bytes）。


## cytopia/ffscreencast — E

**实际符号／类：** bin/ffscreencast 的屏幕/音频参数和命令构造。

**原理与借鉴结论：** 可阅读参数分类；不要复制shell字符串执行方式到Electron，也不替代现有类型化FFmpeg args。

**依赖／难度／CPU-GPU-RAM：** Bash/FFmpeg设备工具；包装成本高且过时，拒绝运行时整合。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MIT。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [bin/ffscreencast](https://github.com/cytopia/ffscreencast/blob/d77a668ff50cd8ac06cb1c94622ba86988f6dce9/bin/ffscreencast)（已读取；34344 bytes）。


## KartikLabhshetwar/better-shot — B

**实际符号／类：** SilenceDetector.silentRanges；BeautifierRenderer。

**原理与借鉴结论：** 用录音95分位音量和相对dB阈值找静音，留呼吸padding；静音不等于冗词，结合本项目VAD再比较。

**依赖／难度／CPU-GPU-RAM：** Swift/AVFoundation；独立TS/FFmpeg实验中（1周）；CPU线性解码；许可逐文件不能一概BSD。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** BSD-3-Clause 主体 + Cap 3D adaptations AGPL-3.0-only。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [Sources/Services/SilenceDetector.swift](https://github.com/KartikLabhshetwar/better-shot/blob/7b7d00778fd972cf672242771d7a25870dd301b4/Sources/Services/SilenceDetector.swift)（已读取；4626 bytes）。
- [Sources/Services/BeautifierRenderer.swift](https://github.com/KartikLabhshetwar/better-shot/blob/7b7d00778fd972cf672242771d7a25870dd301b4/Sources/Services/BeautifierRenderer.swift)（已读取；6339 bytes）。


## webadderallorg/Recordly — A

**实际符号／类：** VideoEditor 组合hooks；main 注册IPC。

**原理与借鉴结论：** 当前仓库的直接上游；按历史commit差异追踪修复，避免覆盖JSOX已完成工作；保留原有署名义务。

**依赖／难度／CPU-GPU-RAM：** 同源依赖；逐patch低中（1–5天），全量覆盖拒绝；收益需回归。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** AGPL-3.0 主文 + 品牌/署名额外文字（NOASSERTION根标签）。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [src/components/video-editor/VideoEditor.tsx](https://github.com/webadderallorg/Recordly/blob/e4a9d04860f4cbad3358bda3ac4a2307489f1d03/src/components/video-editor/VideoEditor.tsx)（已读取；11927 bytes）。
- [electron/main.ts](https://github.com/webadderallorg/Recordly/blob/e4a9d04860f4cbad3358bda3ac4a2307489f1d03/electron/main.ts)（已读取；31491 bytes）。


## WyattBlue/auto-editor — B

**实际符号／类：** newAudioIterator/readChunk；chunkify；timelineTo actions。

**原理与借鉴结论：** 按固定分析窗口取音量，布尔掩码做片段，再保持帧率时间基准；优先只输出范围，送现有applyEditPlan。

**依赖／难度／CPU-GPU-RAM：** Nim/libav、可选语音；算法参考中（1–2周）；别把CLI渲染作为第二导出器。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** Unlicense；链接FFmpeg构建另审。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [src/main.nim](https://github.com/WyattBlue/auto-editor/blob/c9c8ee22ba53b69c881536084250329e4836a8fa/src/main.nim)（已读取；25476 bytes）。
- [src/analyze/audio.nim](https://github.com/WyattBlue/auto-editor/blob/c9c8ee22ba53b69c881536084250329e4836a8fa/src/analyze/audio.nim)（已读取；18101 bytes）。
- [src/timeline.nim](https://github.com/WyattBlue/auto-editor/blob/c9c8ee22ba53b69c881536084250329e4836a8fa/src/timeline.nim)（已读取；21022 bytes）。
- [src/edit.nim](https://github.com/WyattBlue/auto-editor/blob/c9c8ee22ba53b69c881536084250329e4836a8fa/src/edit.nim)（已读取；16306 bytes）。


## carykh/jumpcutter — E

**实际符号／类：** jumpcutter.py audioFrameMax 等窗口处理。

**原理与借鉴结论：** 简单阈值基线可参考；对长片临时帧/内存与老依赖负担不佳，现代VAD和现有FFmpeg更合适。

**依赖／难度／CPU-GPU-RAM：** Python/MoviePy；拒绝新增runtime，算法小实验1–2天；不是语义理解。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MIT。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [jumpcutter.py](https://github.com/carykh/jumpcutter/blob/64536b0bf45c79058d1b152c0b10572dd2e07302/jumpcutter.py)（已读取；8147 bytes）。


## Breakthrough/PySceneDetect — B

**实际符号／类：** ContentDetector.process_frame；AdaptiveDetector.process_frame。

**原理与借鉴结论：** 像素内容差与局部滚动窗口比较；优先复用已有scene sidecar/adapter，边界是帧采样近似。

**依赖／难度／CPU-GPU-RAM：** OpenCV/Python；已有离线工具适配，改进中（1–2周）；帧解码CPU为主要开销。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** BSD-3-Clause。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [scenedetect/detectors/content_detector.py](https://github.com/Breakthrough/PySceneDetect/blob/faa3d974709aa15dcf6bb3340df918360e338b92/scenedetect/detectors/content_detector.py)（已读取；11059 bytes）。
- [scenedetect/detectors/adaptive_detector.py](https://github.com/Breakthrough/PySceneDetect/blob/faa3d974709aa15dcf6bb3340df918360e338b92/scenedetect/detectors/adaptive_detector.py)（已读取；6703 bytes）。


## ggml-org/whisper.cpp — A

**实际符号／类：** examples/cli/cli.cpp main。

**原理与借鉴结论：** 现有ASR后端；保留CLI边界，固定runtime/模型revision，解析时间与置信度不猜测。

**依赖／难度／CPU-GPU-RAM：** 已使用native helper；整合低，质量性能测量1–2周；模型RAM/CPU依量化与长度变化。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MIT；权重许可另验。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [examples/cli/cli.cpp](https://github.com/ggml-org/whisper.cpp/blob/231638a0717b7822784297e5980965ffcec05810/examples/cli/cli.cpp)（已读取；64715 bytes）。


## SYSTRAN/faster-whisper — B

**实际符号／类：** WhisperModel.transcribe；BatchedInferencePipeline。

**原理与借鉴结论：** 可做离线评测对照，不预设比当前whisper.cpp快；不是低成本替换，Python/CT2体积与DLL需核验。

**依赖／难度／CPU-GPU-RAM：** Python/CTranslate2/PyAV；sidecar中高（2–3周）；不同时加载两套ASR模型。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MIT；模型及CTranslate2/PyAV另审。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [faster_whisper/transcribe.py](https://github.com/SYSTRAN/faster-whisper/blob/9e472ae9de8bb374552f531f752654554b76b2d6/faster_whisper/transcribe.py)（已读取；82400 bytes）。


## k2-fsa/sherpa-onnx — A

**实际符号／类：** OfflineTts::Generate；OfflineTtsConfig。

**原理与借鉴结论：** 本项目已使用sherpa-onnx-node/离线对照工具，不加第二包装；将模型状态、取消与日志统一。

**依赖／难度／CPU-GPU-RAM：** ONNX Runtime/模型；改进低中（3–10天）；provider和线程数决定RAM/CPU。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** Apache-2.0；各模型license独立。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [sherpa-onnx/csrc/offline-tts.cc](https://github.com/k2-fsa/sherpa-onnx/blob/88204440c2ad19158fe77dbf470bb1fe7fdee613/sherpa-onnx/csrc/offline-tts.cc)（已读取；12907 bytes）。


## OHF-Voice/piper1-gpl — A

**实际符号／类：** PiperVoice.load；PiperVoice.synthesize。

**原理与借鉴结论：** 保留现有离线tts服务边界和voice锁定；不要把MIT旧piper的许可直接套到本项目现版。

**依赖／难度／CPU-GPU-RAM：** ONNX/espeak/voice模型；已有适配优先复用；CPU中，voice内存待测。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** GPL-3.0（runtime/voices附加条款单独核实）。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [src/piper/voice.py](https://github.com/OHF-Voice/piper1-gpl/blob/74ac24e7e8e2e57a5e1fada5505c74e3d9c1843a/src/piper/voice.py)（已读取；20458 bytes）。


## remotion-dev/remotion — E

**实际符号／类：** renderMedia。

**原理与借鉴结论：** 组件化视频API可学；当前许可证对派生/组织规模有限制，不直接复制或引入，更不替换Pixi导出。

**依赖／难度／CPU-GPU-RAM：** Chromium实例/编码CPU/RAM高；新管线收益不成立，拒绝引入。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** LicenseRef-Remotion（自定义，不是MIT）。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [packages/renderer/src/render-media.ts](https://github.com/remotion-dev/remotion/blob/0eddd9ae31e1633b6ebc2ef53c5fb501cd0b5bf5/packages/renderer/src/render-media.ts)（已读取；35509 bytes）。


## KDE/kdenlive — B

**实际符号／类：** TimelineModel::requestClipMove/requestClipInsertion。

**原理与借鉴结论：** 命令式修改返回可撤销动作，track/item分层与事务组合；独立TS设计复用，不引入MLT第二编辑引擎。

**依赖／难度／CPU-GPU-RAM：** Qt/MLT/FFmpeg；设计高（3–6周）；多轨代理减解码，但会增磁盘缓存。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL（所读文件）；依赖另审。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [src/timeline2/model/timelinemodel.cpp](https://github.com/KDE/kdenlive/blob/a1990cc80ddc5f8f28e79960968911f21475f7ef/src/timeline2/model/timelinemodel.cpp)（已读取；341905 bytes）。


## mltframework/shotcut — B

**实际符号／类：** MultitrackModel::moveClip/insertClip/appendClip。

**原理与借鉴结论：** 明确blank/gap和rippleAllTracks，管理轨道和模型通知；对照当前clipSequence，不更换整个timeline。

**依赖／难度／CPU-GPU-RAM：** Qt/MLT；设计中高（2–4周）；长工程需缓存/代理预算。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** GPL-3.0-or-later（所读 multitrackmodel.cpp）。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [src/models/multitrackmodel.cpp](https://github.com/mltframework/shotcut/blob/34dde4fce394652c00d8f7af9ac2ce37dab1ed92/src/models/multitrackmodel.cpp)（已读取；194842 bytes）。


## xinntao/Real-ESRGAN — E

**实际符号／类：** RealESRGANer.tile_process/enhance。

**原理与借鉴结论：** tile与padding缓解显存，不能承诺普通CPU实时；本阶段P4不加入大型runtime。

**依赖／难度／CPU-GPU-RAM：** PyTorch/模型/可选NCNN；整合高（3–6周），GPU/CPU/RAM高，成本与稳定优先冲突。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** BSD-3-Clause 代码；模型/第三方算子另审。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [realesrgan/utils.py](https://github.com/xinntao/Real-ESRGAN/blob/a4abfb2979a7bbff3f69f58f58ae324608821e27/realesrgan/utils.py)（已读取；12605 bytes）。


## facebookresearch/faiss — C

**实际符号／类：** IndexFlat::search/add。

**原理与借鉴结论：** 未来本地字幕/事件embedding索引，先定义SearchAdapter；不改变既有Firebase云端搜索，不直接添加当前依赖。

**依赖／难度／CPU-GPU-RAM：** C++/BLAS；独立CLI中高（2–3周）；向量内存≈N×dim×4字节，另有索引开销。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MIT。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [faiss/IndexFlat.cpp](https://github.com/facebookresearch/faiss/blob/e353ed74de51d8d28443fae3ca8d2df5da790d7c/faiss/IndexFlat.cpp)（已读取；31631 bytes）。


## ggml-org/llama.cpp — A

**实际符号／类：** tools/server/server.cpp 的server初始化/任务循环。

**原理与借鉴结论：** 已用于Qwen视觉和解说/语义审阅；复用现有生命周期、线程与内存限制，不引入Ollama常驻第二服务。

**依赖／难度／CPU-GPU-RAM：** ggml/模型；已有运行时改进低中（1周）；内存随权重/上下文/视觉token变化。资源影响为静态判断，未运行基准；不能据此宣称快多少或省多少内存。

**许可门槛：** MIT；各LLM/视觉模型单独许可。学习设计不等于获准复制，CLI/sidecar也不免除分发义务。

**已访问源码证据：**

- [tools/server/server.cpp](https://github.com/ggml-org/llama.cpp/blob/edc353842c1be9b4ebc27460a1da4526a026d3a9/tools/server/server.cpp)（已读取；24859 bytes）。


## 可复用模块判定

- 原生捕获：OBS/Cap/wcap 用来审查现有 WGC/D3D/WASAPI 的时钟、尺寸和设备恢复；不将 Rust/Tauri/C#/Swift 运行时加入现有录制进程。
- 场景／语音：PySceneDetect、Whisper、sherpa、llama/Piper 已有适配或同类基础；优先改契约和验证，不多打包一套。
- Auto zoom：Reframe 的点击时空聚类与现有 zoomSuggestionUtils 重叠；Focra 源码的 click-based keyframes 不能作为其 README dwell 声称已实现的证据。许可不明前仅独立算法研究。
- 多轨：Kdenlive/Shotcut 的 undo transaction、blank/ripple 和 model 通知值得参考，原 C++/MLT 实现不作为当前引擎依赖。
- 视频搜索：Faiss 只是向量索引；还需先离线提取字幕/视觉事件、生成合规 embeddings，并防跨工程访问。当前不改 Firebase/Firestore 方案。
