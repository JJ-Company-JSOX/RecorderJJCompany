# 02 — 开源仓库目录与可核验证据

审阅日期：2026-10-24（Asia/Singapore）。当前工程基线 `e06191c5`，审计后修复记录见 01/08。外部数据为逐仓库抓取时的快照，不以 Stars 判断质量；没有运行或安装第三方项目。


共实际请求 **31 个仓库 URL**：初始 18 个＋扩展 13 个；**30 个公开可访问**，`haxzie/prequel` 返回 HTTP404。读取 **63 个实际源码文件，覆盖 30 个仓库**，另读 README、许可证和构建清单。30 个可访问仓库在快照均未标 archived；长期无提交不等于 GitHub archived。不存在“研究了所有GitHub recorder”的承诺。

## 元数据快照

| 仓库 | HTTP / archived | 默认分支 / 固定 SHA | 最新默认分支 commit UTC | Stars | 主要语言/栈（源码/清单） | 许可判断 | 策略 |
|---|---|---|---|---|---|---|---|
| [obsproject/obs-studio](https://github.com/obsproject/obs-studio) | 200 / False | master / [`72e86655715d`](https://github.com/obsproject/obs-studio/commit/72e86655715d9a25d69ce446aa4dd44ba58e10d2) | 2026-10-23T18:14:36Z | 77988 | C/C++；Qt、libobs、D3D11、WASAPI | GPL-2.0（根标签；组合前核验具体文件可否选 GPLv3） | B |
| [CapSoftware/Cap](https://github.com/CapSoftware/Cap) | 200 / False | main / [`766e6c517341`](https://github.com/CapSoftware/Cap/commit/766e6c517341c9cb08149d0607b382576ef9ff34) | 2026-10-24T00:24:33Z | 23601 | Rust、TypeScript；Tauri、FFmpeg、WGPU/Skia | AGPL-3.0；cap-camera*/scap-* 为 MIT；逐目录核验 | B |
| [ShareX/ShareX](https://github.com/ShareX/ShareX) | 200 / False | develop / [`2548704791a9`](https://github.com/ShareX/ShareX/commit/2548704791a9a8136c78ce0649593b70e87e0c7d) | 2026-10-23T06:26:16Z | 40353 | C#/.NET；Windows Native、WGC、音频/编码层 | GPL-3.0 根；所读 ScreenRecorder/Clock 头部为 GPL-2.0-or-later（选v3需保留说明） | B |
| [alyssaxuu/screenity](https://github.com/alyssaxuu/screenity) | 200 / False | master / [`377c175cf201`](https://github.com/alyssaxuu/screenity/commit/377c175cf20194802eb9f92a89ae234880c9a847) | 2026-10-22T10:03:13Z | 18803 | JavaScript/TypeScript/React；Chrome extension MV3、MediaRecorder | GPL-3.0（only/or-later变体未全面核实） | B |
| [wulkano/Kap](https://github.com/wulkano/Kap) | 200 / False | main / [`c42692fa63ac`](https://github.com/wulkano/Kap/commit/c42692fa63ac71ed192e01684beb78a1b864aa88) | 2024-02-14T19:24:57Z | 19406 | TypeScript/JavaScript；Electron、aperture | MIT | E |
| [SeaDve/Kooha](https://github.com/SeaDve/Kooha) | 200 / False | main / [`247bd2557953`](https://github.com/SeaDve/Kooha/commit/247bd25579538035d9a87bfdf582258767d673c5) | 2026-10-02T21:23:05Z | 3543 | Rust；GTK、GStreamer、PipeWire、portal | GPL-3.0（版本选项未全量核实） | E |
| [vkohaupt/vokoscreenNG](https://github.com/vkohaupt/vokoscreenNG) | 200 / False | 3.0 / [`7db6b4e2224d`](https://github.com/vkohaupt/vokoscreenNG/commit/7db6b4e2224decab9771ed49284b5e49c0f3215c) | 2026-10-22T19:42:21Z | 1523 | C++；Qt、GStreamer | GPL-2.0-only（所读 mainwindow.cpp 明示 version 2） | E |
| [NickeManarin/ScreenToGif](https://github.com/NickeManarin/ScreenToGif) | 200 / False | master / [`a4d0a67c2131`](https://github.com/NickeManarin/ScreenToGif/commit/a4d0a67c2131cd048ceec86cd40afc2f1a06f2fd) | 2026-07-28T14:15:05Z | 27838 | C#；WPF/.NET、Windows Native | MS-PL | B |
| [getopenscreen/openscreen](https://github.com/getopenscreen/openscreen) | 200 / False | main / [`264975d8fcd2`](https://github.com/getopenscreen/openscreen/commit/264975d8fcd2b32ce62060f06c6e8523b819be9c) | 2026-10-23T13:55:51Z | 4834 | TypeScript/Rust；Electron/React、媒体工具、可选LLM SDK | MIT | B |
| [pavanjoshi914/Reframe](https://github.com/pavanjoshi914/Reframe) | 200 / False | main / [`4bc54915ad63`](https://github.com/pavanjoshi914/Reframe/commit/4bc54915ad631f39aedbce888342f05d1cd82e73) | 2026-10-16T08:32:24Z | 37 | TypeScript；Electron/React/Zustand、FFmpeg | MIT 仅 package.json 声明；未找到根 LICENSE 正文，Unverified | E |
| [focra-app/Focra](https://github.com/focra-app/Focra) | 200 / False | main / [`76c7b6557e97`](https://github.com/focra-app/Focra/commit/76c7b6557e97233c3df52f75ccdcfb73d8c0c7ec) | 2026-07-08T14:52:47Z | 37 | TypeScript；Electron/React/Pixi、transformers、FFmpeg | MIT 声明；根 LICENSE 链接未证实正文，Unverified | E |
| [mesutde/MimoScreenRecorder](https://github.com/mesutde/MimoScreenRecorder) | 200 / False | main / [`05081b48c61d`](https://github.com/mesutde/MimoScreenRecorder/commit/05081b48c61dbb66b0e71971b52afcbd2ccc5c12) | 2026-09-18T09:25:24Z | 1 | TypeScript；Electron33/React/Zustand、FFmpeg gdigrab | MIT 仅 package.json 声明；无根 LICENSE 正文，Unverified | E |
| [haxzie/prequel](https://github.com/haxzie/prequel) | 404 / Unverified | Unverified / Unverified | Unverified | Unverified | Unverified | Unverified | U |
| [mmozeiko/wcap](https://github.com/mmozeiko/wcap) | 200 / False | main / [`aa25ccb806d7`](https://github.com/mmozeiko/wcap/commit/aa25ccb806d7a6e1c0bfdcca863aabcd8e9badfa) | 2025-11-27T04:50:14Z | 1338 | C；Windows WGC/D3D11、Media Foundation、WASAPI | Unlicense（Windows SDK/codec分发另审） | B |
| [jsattler/BetterCapture](https://github.com/jsattler/BetterCapture) | 200 / False | main / [`ab852b44c4dd`](https://github.com/jsattler/BetterCapture/commit/ab852b44c4dd09c8e2ae69e7858a1b67e1cd17af) | 2026-08-30T19:31:14Z | 1694 | Swift；SwiftUI、ScreenCaptureKit、AVFoundation | MIT | B |
| [cytopia/ffscreencast](https://github.com/cytopia/ffscreencast) | 200 / False | master / [`d77a668ff50c`](https://github.com/cytopia/ffscreencast/commit/d77a668ff50cd8ac06cb1c94622ba86988f6dce9) | 2017-03-18T12:26:35Z | 1824 | Bash；FFmpeg和平台设备枚举 | MIT | E |
| [KartikLabhshetwar/better-shot](https://github.com/KartikLabhshetwar/better-shot) | 200 / False | main / [`7b7d00778fd9`](https://github.com/KartikLabhshetwar/better-shot/commit/7b7d00778fd972cf672242771d7a25870dd301b4) | 2026-10-11T13:39:33Z | 2409 | Swift；SwiftUI/AVFoundation，部分Cap衍生渲染 | BSD-3-Clause 主体 + Cap 3D adaptations AGPL-3.0-only | B |
| [webadderallorg/Recordly](https://github.com/webadderallorg/Recordly) | 200 / False | main / [`e4a9d04860f4`](https://github.com/webadderallorg/Recordly/commit/e4a9d04860f4cbad3358bda3ac4a2307489f1d03) | 2026-10-17T07:32:21Z | 34908 | TypeScript/Swift/C++；Electron/React/Pixi/FFmpeg | AGPL-3.0 主文 + 品牌/署名额外文字（NOASSERTION根标签） | A |
| [WyattBlue/auto-editor](https://github.com/WyattBlue/auto-editor) | 200 / False | master / [`c9c8ee22ba53`](https://github.com/WyattBlue/auto-editor/commit/c9c8ee22ba53b69c881536084250329e4836a8fa) | 2026-10-22T02:38:52Z | 5604 | Nim（当前版本，不是旧Python实现）；libav/FFmpeg | Unlicense；链接FFmpeg构建另审 | B |
| [carykh/jumpcutter](https://github.com/carykh/jumpcutter) | 200 / False | master / [`64536b0bf45c`](https://github.com/carykh/jumpcutter/commit/64536b0bf45c79058d1b152c0b10572dd2e07302) | 2021-04-27T21:35:38Z | 3145 | Python；NumPy、MoviePy、FFmpeg | MIT | E |
| [Breakthrough/PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | 200 / False | main / [`faa3d974709a`](https://github.com/Breakthrough/PySceneDetect/commit/faa3d974709aa15dcf6bb3340df918360e338b92) | 2026-10-22T00:18:34Z | 5284 | Python；OpenCV/NumPy | BSD-3-Clause | B |
| [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) | 200 / False | master / [`231638a0717b`](https://github.com/ggml-org/whisper.cpp/commit/231638a0717b7822784297e5980965ffcec05810) | 2026-10-19T14:14:00Z | 54604 | C/C++；ggml | MIT；权重许可另验 | A |
| [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | 200 / False | master / [`9e472ae9de8b`](https://github.com/SYSTRAN/faster-whisper/commit/9e472ae9de8bb374552f531f752654554b76b2d6) | 2026-10-16T11:12:55Z | 26084 | Python；CTranslate2、PyAV、tokenizers | MIT；模型及CTranslate2/PyAV另审 | B |
| [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | 200 / False | master / [`88204440c2ad`](https://github.com/k2-fsa/sherpa-onnx/commit/88204440c2ad19158fe77dbf470bb1fe7fdee613) | 2026-10-23T15:48:11Z | 15464 | C++/多语言绑定；ONNX Runtime | Apache-2.0；各模型license独立 | A |
| [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) | 200 / False | main / [`74ac24e7e8e2`](https://github.com/OHF-Voice/piper1-gpl/commit/74ac24e7e8e2e57a5e1fada5505c74e3d9c1843a) | 2026-10-23T23:45:29Z | 5976 | Python/C++；ONNX Runtime、espeak-ng | GPL-3.0（runtime/voices附加条款单独核实） | A |
| [remotion-dev/remotion](https://github.com/remotion-dev/remotion) | 200 / False | main / [`0eddd9ae31e1`](https://github.com/remotion-dev/remotion/commit/0eddd9ae31e1633b6ebc2ef53c5fb501cd0b5bf5) | 2026-10-23T19:11:40Z | 66721 | TypeScript/React；Chromium、FFmpeg | LicenseRef-Remotion（自定义，不是MIT） | E |
| [KDE/kdenlive](https://github.com/KDE/kdenlive) | 200 / False | master / [`a1990cc80ddc`](https://github.com/KDE/kdenlive/commit/a1990cc80ddc5f8f28e79960968911f21475f7ef) | 2026-10-23T12:58:55Z | 5922 | C++/Qt/QML；MLT | GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL（所读文件）；依赖另审 | B |
| [mltframework/shotcut](https://github.com/mltframework/shotcut) | 200 / False | master / [`34dde4fce394`](https://github.com/mltframework/shotcut/commit/34dde4fce394652c00d8f7af9ac2ce37dab1ed92) | 2026-10-22T15:28:05Z | 15481 | C++/Qt/QML；MLT | GPL-3.0-or-later（所读 multitrackmodel.cpp） | B |
| [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | 200 / False | master / [`a4abfb2979a7`](https://github.com/xinntao/Real-ESRGAN/commit/a4abfb2979a7bbff3f69f58f58ae324608821e27) | 2024-04-02T16:39:11Z | 37189 | Python；PyTorch/BasicSR/OpenCV | BSD-3-Clause 代码；模型/第三方算子另审 | E |
| [facebookresearch/faiss](https://github.com/facebookresearch/faiss) | 200 / False | main / [`e353ed74de51`](https://github.com/facebookresearch/faiss/commit/e353ed74de51d8d28443fae3ca8d2df5da790d7c) | 2026-10-23T22:36:46Z | 41199 | C++；Python可选、BLAS/OpenMP | MIT | C |
| [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) | 200 / False | master / [`edc353842c1b`](https://github.com/ggml-org/llama.cpp/commit/edc353842c1be9b4ebc27460a1da4526a026d3a9) | 2026-10-24T00:21:06Z | 132166 | C/C++；ggml、平台计算后端 | MIT；各LLM/视觉模型单独许可 | A |

UTC commit 日期仅为观察到的默认分支最近提交，不等于发布版或安全维护承诺。Root SHA 与 Atom feed 的 SHA 在本批核查一致；新提交出现后本报告不会自动更新。license 的 GitHub 自动标签可能是 NOASSERTION 或旧式 GPL-3.0，必须读取正文及具体文件。A/B/C 为可借鉴（20）；E 为当前不引入（10，仍可学设计）；U 为无法验证（1）。数量不代表可复制许可已经批准。

## 每个项目的功能与平台边界

### obsproject/obs-studio

- 平台／GPU／服务器／API：Windows/macOS/Linux；硬件编码可选；本地基本录制无服务器/API。GPU纹理与音频缓冲有预算，未测RAM。

- 主要功能：屏幕/窗口/场景、音源混音、插件、直播、编码；不是本项目时间轴编辑器。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/obsproject/obs-studio/blob/72e86655715d9a25d69ce446aa4dd44ba58e10d2/README.rst)；[COPYING ](https://github.com/obsproject/obs-studio/blob/72e86655715d9a25d69ce446aa4dd44ba58e10d2/COPYING)

### CapSoftware/Cap

- 平台／GPU／服务器／API：Windows/macOS，Linux代码也存在但逐项支持待验证；本地录制不需服务器；分享/API可选。预览GPU、捕获多缓冲中高，模型另算。

- 主要功能：分轨录制、摄像头/音频、鼠标、编辑、输出验证、崩溃恢复、分享。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/CapSoftware/Cap/blob/766e6c517341c9cb08149d0607b382576ef9ff34/README.md)；[LICENSE ](https://github.com/CapSoftware/Cap/blob/766e6c517341c9cb08149d0607b382576ef9ff34/LICENSE)

### ShareX/ShareX

- 平台／GPU／服务器／API：Windows核心；Avalonia目录不等于所有OS捕获；本地可用，上传目标可选。CPU/GPU取决编码路径。

- 主要功能：截图/区域/滚动、录屏、摄像头设备、混音、编码、工作流上传。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/ShareX/ShareX/blob/2548704791a9a8136c78ce0649593b70e87e0c7d/README.md)；[LICENSE.txt ](https://github.com/ShareX/ShareX/blob/2548704791a9a8136c78ce0649593b70e87e0c7d/LICENSE.txt)

### alyssaxuu/screenity

- 平台／GPU／服务器／API：Chrome/Chromium扩展；不是Electron原生捕获；离线录制与云录制路径需分开。扩展权限宽，下载/云路径另审。

- 主要功能：浏览器屏幕/标签/摄像头/音频、编辑、注释；部分云功能。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/alyssaxuu/screenity/blob/377c175cf20194802eb9f92a89ae234880c9a847/README.md)；[LICENSE ](https://github.com/alyssaxuu/screenity/blob/377c175cf20194802eb9f92a89ae234880c9a847/LICENSE)

### wulkano/Kap

- 平台／GPU／服务器／API：macOS；核心本地，无强制付费API；2024后未见较新提交。老Electron依赖需重审。

- 主要功能：区域录制、暂停、导出转换、插件。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：最近默认分支提交较久，维护/兼容性风险较高；不是 archived 结论。

- [README/项目说明](https://github.com/wulkano/Kap/blob/c42692fa63ac71ed192e01684beb78a1b864aa88/README.md)；[LICENSE.md ](https://github.com/wulkano/Kap/blob/c42692fa63ac71ed192e01684beb78a1b864aa88/LICENSE.md)

### SeaDve/Kooha

- 平台／GPU／服务器／API：Linux GNOME/Wayland；不是Windows；本地无付费API。不测资源优劣。

- 主要功能：屏幕/区域、系统音/麦克风、暂停/继续、格式设置。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/SeaDve/Kooha/blob/247bd25579538035d9a87bfdf582258767d673c5/README.md)；[COPYING ](https://github.com/SeaDve/Kooha/blob/247bd25579538035d9a87bfdf582258767d673c5/COPYING)

### vkohaupt/vokoscreenNG

- 平台／GPU／服务器／API：Windows/Linux；基本本地；GPU按编码选择。额外runtime与打包负担不合理。

- 主要功能：屏幕/区域、音频、摄像头、halo/点击/放大镜、定时/磁盘限制。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/vkohaupt/vokoscreenNG)；[COPYING ](https://github.com/vkohaupt/vokoscreenNG/blob/7db6b4e2224decab9771ed49284b5e49c0f3215c/COPYING)

### NickeManarin/ScreenToGif

- 平台／GPU／服务器／API：Windows；基本本地无服务器/付费API。MS-PL源码分发条件需单独审核，默认仅学设计。

- 主要功能：录屏/摄像头/画板、逐帧编辑、动作历史、多种动图/视频编码。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/NickeManarin/ScreenToGif/blob/a4d0a67c2131cd048ceec86cd40afc2f1a06f2fd/README.md)；[LICENSE.txt ](https://github.com/NickeManarin/ScreenToGif/blob/a4d0a67c2131cd048ceec86cd40afc2f1a06f2fd/LICENSE.txt)

### getopenscreen/openscreen

- 平台／GPU／服务器／API：Windows/macOS/Linux声明；本地核心，AI agent/云模型可选收费，不保证全栈免费。服务/LLM路径不引入，性能收益须实测。

- 主要功能：录屏/音频/鼠标、自动缩放、时间轴、字幕/按文字编辑、AI工具、导出。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/getopenscreen/openscreen/blob/264975d8fcd2b32ce62060f06c6e8523b819be9c/README.md)；[LICENSE ](https://github.com/getopenscreen/openscreen/blob/264975d8fcd2b32ce62060f06c6e8523b819be9c/LICENSE)

### pavanjoshi914/Reframe

- 平台／GPU／服务器／API：目标Windows/Linux/macOS；本地，字幕/头像额外能力未全证实。长 export.ts 不作替换组件，性能未基准。

- 主要功能：时间轴、trim/speed、cursor自动zoom、背景、标注、MP4导出；具体格式回退需查。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/pavanjoshi914/Reframe/blob/4bc54915ad631f39aedbce888342f05d1cd82e73/README.md)；许可证正文：Unverified（package.json 声明不替代许可证）。

### focra-app/Focra

- 平台／GPU／服务器／API：Windows/macOS/Linux声明；核心可本地，AI模型另需准备。许可澄清后才可考虑源码片段。

- 主要功能：屏幕/窗口、光标、zoom、背景、字幕、导出；README声称dwell但所读自动zoom只按click。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：最近默认分支提交较久，维护/兼容性风险较高；不是 archived 结论。

- [README/项目说明](https://github.com/focra-app/Focra/blob/76c7b6557e97233c3df52f75ccdcfb73d8c0c7ec/README.md)；许可证正文：Unverified（package.json 声明不替代许可证）。

### mesutde/MimoScreenRecorder

- 平台／GPU／服务器／API：Windows；本地基本功能；开发时用MiMo模型不代表运行时依赖付费API。GDI帧拷贝可能高，未测不可定量。

- 主要功能：录屏、设备、定时、camera预览、trim/排序/静音剪切/导出（编辑深度未全验）。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/mesutde/MimoScreenRecorder/blob/05081b48c61dbb66b0e71971b52afcbd2ccc5c12/README.md)；许可证正文：Unverified（package.json 声明不替代许可证）。

### haxzie/prequel

- 平台／GPU／服务器／API：Unverified：公开URL HTTP404，不能断言已删除/私有/归档。不估算未访问工程。

- 主要功能：未能检查。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：公开不可访问，Unverified。

- [README/项目说明](https://github.com/haxzie/prequel)；许可证正文：Unverified（package.json 声明不替代许可证）。

### mmozeiko/wcap

- 平台／GPU／服务器／API：Windows；本地，无服务器/付费API；硬件编码按设备。纹理带宽、编码缓冲需测，GPU正常参与。

- 主要功能：屏幕/窗口/区域矩形、鼠标隐藏、系统/进程音频、视频编码。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：最近默认分支提交较久，维护/兼容性风险较高；不是 archived 结论。

- [README/项目说明](https://github.com/mmozeiko/wcap/blob/aa25ccb806d7a6e1c0bfdcca863aabcd8e9badfa/README.md)；[LICENSE ](https://github.com/mmozeiko/wcap/blob/aa25ccb806d7a6e1c0bfdcca863aabcd8e9badfa/LICENSE)

### jsattler/BetterCapture

- 平台／GPU／服务器／API：macOS；Windows无；本地无强制服务器/付费API。跨平台运行时不适用。

- 主要功能：屏幕/区域/摄像头、系统音和mic、过滤内容、快捷入口、编码。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/jsattler/BetterCapture/blob/ab852b44c4dd09c8e2ae69e7858a1b67e1cd17af/README.md)；[LICENSE ](https://github.com/jsattler/BetterCapture/blob/ab852b44c4dd09c8e2ae69e7858a1b67e1cd17af/LICENSE)

### cytopia/ffscreencast

- 平台／GPU／服务器／API：Linux/macOS脚本；非Windows原生；2017后未见较新commit。包装成本高且过时，拒绝运行时整合。

- 主要功能：命令行屏幕/多屏、音频、摄像头overlay、参数配置。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：最近默认分支提交较久，维护/兼容性风险较高；不是 archived 结论。

- [README/项目说明](https://github.com/cytopia/ffscreencast/blob/d77a668ff50cd8ac06cb1c94622ba86988f6dce9/README.md)；[LICENSE ](https://github.com/cytopia/ffscreencast/blob/d77a668ff50cd8ac06cb1c94622ba86988f6dce9/LICENSE)

### KartikLabhshetwar/better-shot

- 平台／GPU／服务器／API：macOS；本地基本功能；无必需付费API。许可逐文件不能一概BSD。

- 主要功能：截图/录屏/历史、音频静音分析、美化与渲染；非Windows后端。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/KartikLabhshetwar/better-shot/blob/7b7d00778fd972cf672242771d7a25870dd301b4/README.md)；[LICENSE ](https://github.com/KartikLabhshetwar/better-shot/blob/7b7d00778fd972cf672242771d7a25870dd301b4/LICENSE)

### webadderallorg/Recordly

- 平台／GPU／服务器／API：Windows/macOS/Linux按helper能力；离线核心，云分享可选。收益需回归。

- 主要功能：录屏、cursor/autozoom、camera、背景、时间轴、字幕、GPU/CPU导出。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/webadderallorg/Recordly/blob/e4a9d04860f4cbad3358bda3ac4a2307489f1d03/README.md)；[LICENSE.md ](https://github.com/webadderallorg/Recordly/blob/e4a9d04860f4cbad3358bda3ac4a2307489f1d03/LICENSE.md)

### WyattBlue/auto-editor

- 平台／GPU／服务器／API：有Windows CLI；本地CPU可用，无付费API。别把CLI渲染作为第二导出器。

- 主要功能：响度/运动/表达式自动剪切、多轨timeline、导出。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/WyattBlue/auto-editor/blob/c9c8ee22ba53b69c881536084250329e4836a8fa/README.md)；[LICENSE ](https://github.com/WyattBlue/auto-editor/blob/c9c8ee22ba53b69c881536084250329e4836a8fa/LICENSE)

### carykh/jumpcutter

- 平台／GPU／服务器／API：脚本需Python；Windows可运行性本轮未实测；本地。不是语义理解。

- 主要功能：按音量区分声音/静音，对不同段变速，拼接音视频。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：最近默认分支提交较久，维护/兼容性风险较高；不是 archived 结论。

- [README/项目说明](https://github.com/carykh/jumpcutter/blob/64536b0bf45c79058d1b152c0b10572dd2e07302/README.md)；[LICENSE ](https://github.com/carykh/jumpcutter/blob/64536b0bf45c79058d1b152c0b10572dd2e07302/LICENSE)

### Breakthrough/PySceneDetect

- 平台／GPU／服务器／API：Windows CLI/库；CPU可用，神经detector可另选；本地。帧解码CPU为主要开销。

- 主要功能：content/adaptive/histogram/hash/threshold场景检测、时间码、分割接口。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/Breakthrough/PySceneDetect/blob/faa3d974709aa15dcf6bb3340df918360e338b92/README.md)；[LICENSE ](https://github.com/Breakthrough/PySceneDetect/blob/faa3d974709aa15dcf6bb3340df918360e338b92/LICENSE)

### ggml-org/whisper.cpp

- 平台／GPU／服务器／API：Windows CPU可用，GPU可选；本地，无付费API。模型RAM/CPU依量化与长度变化。

- 主要功能：转录、翻译、SRT/JSON/VAD等CLI，非视频编辑器。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/ggml-org/whisper.cpp/blob/231638a0717b7822784297e5980965ffcec05810/README.md)；[LICENSE ](https://github.com/ggml-org/whisper.cpp/blob/231638a0717b7822784297e5980965ffcec05810/LICENSE)

### SYSTRAN/faster-whisper

- 平台／GPU／服务器／API：Windows CPU int8可运行；CUDA可选；本地。不同时加载两套ASR模型。

- 主要功能：批次/普通转录、word timestamps、VAD、语言检测。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/SYSTRAN/faster-whisper/blob/9e472ae9de8bb374552f531f752654554b76b2d6/README.md)；[LICENSE ](https://github.com/SYSTRAN/faster-whisper/blob/9e472ae9de8bb374552f531f752654554b76b2d6/LICENSE)

### k2-fsa/sherpa-onnx

- 平台／GPU／服务器／API：Windows CPU可用，其他硬件provider可选；本地。provider和线程数决定RAM/CPU。

- 主要功能：离线/流式ASR、TTS、VAD、说话人等模型适配。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/k2-fsa/sherpa-onnx/blob/88204440c2ad19158fe77dbf470bb1fe7fdee613/README.md)；[LICENSE ](https://github.com/k2-fsa/sherpa-onnx/blob/88204440c2ad19158fe77dbf470bb1fe7fdee613/LICENSE)

### OHF-Voice/piper1-gpl

- 平台／GPU／服务器／API：本地CPU，Windows分发需核验runtime/voice；无付费API。CPU中，voice内存待测。

- 主要功能：本地TTS、语音合成及对齐输出。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/OHF-Voice/piper1-gpl/blob/74ac24e7e8e2e57a5e1fada5505c74e3d9c1843a/README.md)；[COPYING ](https://github.com/OHF-Voice/piper1-gpl/blob/74ac24e7e8e2e57a5e1fada5505c74e3d9c1843a/COPYING)

### remotion-dev/remotion

- 平台／GPU／服务器／API：Windows renderer可用；本地可渲染；许可证存在商业规模限制。新管线收益不成立，拒绝引入。

- 主要功能：React视频组合、时间序列、渲染、模板生态。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/remotion-dev/remotion/blob/0eddd9ae31e1633b6ebc2ef53c5fb501cd0b5bf5/README.md)；[LICENSE.md ](https://github.com/remotion-dev/remotion/blob/0eddd9ae31e1633b6ebc2ef53c5fb501cd0b5bf5/LICENSE.md)

### KDE/kdenlive

- 平台／GPU／服务器／API：Windows/Linux/macOS；本地，部分模型/服务可选。多轨代理减解码，但会增磁盘缓存。

- 主要功能：专业多轨、锁轨/组合/代理、转场/字幕/效果、undo。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/KDE/kdenlive/blob/a1990cc80ddc5f8f28e79960968911f21475f7ef/README.md)；[COPYING ](https://github.com/KDE/kdenlive/blob/a1990cc80ddc5f8f28e79960968911f21475f7ef/COPYING)

### mltframework/shotcut

- 平台／GPU／服务器／API：Windows/macOS/Linux；本地。长工程需缓存/代理预算。

- 主要功能：多轨剪辑、滤镜、音频、字幕/编码、代理/预览。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/mltframework/shotcut/blob/34dde4fce394652c00d8f7af9ac2ce37dab1ed92/README.md)；[COPYING ](https://github.com/mltframework/shotcut/blob/34dde4fce394652c00d8f7af9ac2ce37dab1ed92/COPYING)

### xinntao/Real-ESRGAN

- 平台／GPU／服务器／API：CPU可跑但长视频通常需GPU；本地，权重另下载。整合高（3–6周），GPU/CPU/RAM高，成本与稳定优先冲突。

- 主要功能：图像/视频超分辨率、分块推理、精度/显存选项。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：最近默认分支提交较久，维护/兼容性风险较高；不是 archived 结论。

- [README/项目说明](https://github.com/xinntao/Real-ESRGAN/blob/a4abfb2979a7bbff3f69f58f58ae324608821e27/README.md)；[LICENSE ](https://github.com/xinntao/Real-ESRGAN/blob/a4abfb2979a7bbff3f69f58f58ae324608821e27/LICENSE)

### facebookresearch/faiss

- 平台／GPU／服务器／API：CPU索引可用，GPU可选；Windows编译/分发需核验，不需服务器。向量内存≈N×dim×4字节，另有索引开销。

- 主要功能：向量相似检索/索引，不包含视频理解或embedding生成。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/facebookresearch/faiss/blob/e353ed74de51d8d28443fae3ca8d2df5da790d7c/README.md)；[LICENSE ](https://github.com/facebookresearch/faiss/blob/e353ed74de51d8d28443fae3ca8d2df5da790d7c/LICENSE)

### ggml-org/llama.cpp

- 平台／GPU／服务器／API：Windows CPU可运行，GPU可选；本地loopback server，不需云服务。内存随权重/上下文/视觉token变化。

- 主要功能：本地LLM/多模态推理、JSON约束、server/CLI。以上为所读源码与 README 的综合范围，不等于逐项运行验证；没有列出的能力是 Unverified，不据此断言绝对没有。

- 维护判断：近90天有默认分支提交，活跃粗筛；未逐 issue 核验响应质量。

- [README/项目说明](https://github.com/ggml-org/llama.cpp/blob/edc353842c1be9b4ebc27460a1da4526a026d3a9/README.md)；[LICENSE ](https://github.com/ggml-org/llama.cpp/blob/edc353842c1be9b4ebc27460a1da4526a026d3a9/LICENSE)

## 补充 GitHub 搜索（发现，不等于深入验证）

实际请求了三组 repository search，均 HTTP200；搜索结果带出的项目仅作线索，下列项目不计入31个逐仓库审阅数量。选定的扩展项目按实际源码、许可、与现有栈的重叠程度审阅，不按 Stars 排序。

- [automatic video editing silence](https://github.com/search?type=repositories&q=automatic%20video%20editing%20silence)：[YourAverageMo/auto-silence-cut](https://github.com/YourAverageMo/auto-silence-cut), [grafup/Tribe-Video-Cleaner](https://github.com/grafup/Tribe-Video-Cleaner), [Brevinbanks/VideoFillerRemover](https://github.com/Brevinbanks/VideoFillerRemover), [princeyadav-dev/audio-editing-script](https://github.com/princeyadav-dev/audio-editing-script), [IsacFreitaas/corte-automatico-videos-python](https://github.com/IsacFreitaas/corte-automatico-videos-python)。这些结果的许可证/运行质量尚未核验。

- [screen recorder cursor auto zoom](https://github.com/search?type=repositories&q=screen%20recorder%20cursor%20auto%20zoom)：[MarshallNickolauson/ScreenCraft](https://github.com/MarshallNickolauson/ScreenCraft), [OMARVII/Shotnix](https://github.com/OMARVII/Shotnix), [omacom/omareel](https://github.com/omacom/omareel), [btahir/reelbird](https://github.com/btahir/reelbird), [martian0x80/framepipe](https://github.com/martian0x80/framepipe)。这些结果的许可证/运行质量尚未核验。

- [local subtitle text to speech video](https://github.com/search?type=repositories&q=local%20subtitle%20text%20to%20speech%20video)：[buxuku/SmartSub](https://github.com/buxuku/SmartSub), [thealiraza2/CapShorts](https://github.com/thealiraza2/CapShorts), [gz08/video-subtitle-tool](https://github.com/gz08/video-subtitle-tool), [Wyzzi/live-subtitles](https://github.com/Wyzzi/live-subtitles), [Krish1090/SubtitleMaker](https://github.com/Krish1090/SubtitleMaker)。这些结果的许可证/运行质量尚未核验。
