# 顾客安装后直接使用的离线 AI

产品要求：顾客下载安装完整 Windows 包后，直接使用内置 AI，不安装 Ollama、不选择模型、不填写 API Key、不启动终端或服务，也不在首次使用时下载模型。AI 在本机按需运行，完成、取消或关闭应用后退出。

## 顾客流程

1. 安装完整 **Jsox Recorder Offline AI** 包，打开软件并录制或导入视频。
2. 打开 **Auto edit plan → Generate offline AI plan（生成离线 AI 方案）**，等待分析，预览建议后应用。可以批量接受／拒绝，也可以一次撤销。

默认按点击位置建议缩放；需要保留任务栏等完整画面时，可以勾选“保持完整画面，不新增缩放”。没人说话但画面仍在变化的片段默认加速 2 倍，不会删除；只有没人说话且画面不动的片段才会被剪掉。有说话的录像会按语音识别的句子边界处理句与句之间的停顿：两边各留 0.3 秒，画面不动就剪掉，画面还在动就加速 2 倍，停顿中有点击则保留。AI 每次读取最多 8 张抽样截图。已有编辑保持不变；重新分析不能覆盖受保护的已有编辑。此版本使用 CPU，不要求客户配置 GPU。

当前交付是未签名的 Windows x64 / AVX2 测试版。安装快捷方式直接启动也会禁用自动更新；升级时使用完整离线安装包，避免普通更新覆盖随包组件。便携测试入口 `Start-Jsox-Offline-AI.cmd` 使用独立的 `Jsox-offline-ai-test` 配置，不覆盖旧测试配置。旧程序有未保存项目时先保存，再切换版本。

源码 ZIP、以前的普通测试包和完整离线 AI 安装包不同。普通包缺少组件时只说明完整版本缺失，不引导顾客安装第三方 AI 软件。模型名称输入、Ollama 检查和服务配置只保留在开发模式，生产包不显示。

## 内置内容与范围

- 官方 Qwen3-VL-2B-Instruct Q4_K_M 权重和 Q8 图像组件，共 **1,552,463,168 字节**，在构建机下载并验证固定版本的 SHA-256；权重不提交到 Git。
- 固定版本 llama.cpp CPU 运行组件，由构建机编译。顾客机器不编译、不安装 AI 服务。软件仅以随机端口、随机访问令牌绑定 `127.0.0.1`，通过本机进程交换图像；没有远程 AI 请求。
- 模型、运行组件、许可与清单都随安装包提供。运行时开启 offline 模式，使用明确的本地文件路径，不提供下载模型的执行路径。
- 一次视觉分析默认读取最多四张缩小的抽样图像，提出文字标注及可选缩放；静音／静止删减仍需本地音画证据。抽样分析不等于理解全部视频，也不包含新的语音转录模型。
- 分析前检查组件完整性及可用内存。当前 CPU 路径要求 Windows x64 / AVX2，建议 16GB RAM；至少 2.5GiB 可用内存门槛是本轮实现值，后续需要在更多机器上验证。录制／导入／编辑／保存／原画质导出不依赖 AI 是否可运行。

## 构建机流程

```sh
npm run prepare:offline-ai
npm run prepare:offline-speech
npm run prepare:offline-voice
npm run prepare:offline-tts
npm run prepare:offline-ocr
npm run build:win:offline
```

完整离线 AI 包同时内置语音识别（Whisper small，约 190 MB）和 AI 解说配音（中文 AISHELL-3 VITS，约 33 MB，Apache-2.0；英文 LJSpeech VITS，约 118 MB，MIT／公有领域数据）。`prepare:offline-voice` 准备语音边界检测（Silero VAD，按句子边界剪停顿时需要）和“让人声更清楚”（RNNoise），必须在 `prepare:offline-speech` 之后运行，因为它会用到那一步下载的编译工具。打包前依次执行 `verify:offline-ai`、`verify:offline-speech`、`verify:offline-voice`、`verify:offline-tts`，任何一项缺失或损坏都会停止打包。AI 解说稿和配音跟随界面选的语言：中文、英文都有内置配音；马来文目前只能生成解说稿，没有找到许可证清楚、可商用的离线马来文声音，所以暂不内置。开发时先完成上面三个准备命令，再用 `npm run dev` 直接测试，无需打包。

准备脚本将校验后的官方模型及便携构建工具放进 Git 忽略目录，编译固定源码版本的独立 CPU 组件，检查其 Windows DLL 依赖，并生成随包清单。构建工具只在开发机 `.tmp`，模型及成品组件在 `vendor/offline-ai`；顾客包只包含运行所需文件。正式打包前执行 `verify:offline-ai`，缺失或损坏时失败，不生成“看似支持 AI、实际要求顾客另行配置”的完整版本。

开发机网络中断支持断点续传，最终仍须通过完整 SHA-256 校验。顾客安装和首次 AI 分析均不执行这些开发机脚本。

开发机可自动执行实际 App 录屏检查：`node scripts/smoke-app-recording.mjs --run`。它只启动自己的隔离实例，通过整个屏幕选择、录制、停止和编辑器预览，记录五秒合成动画及当前任务栏，文件留在忽略目录 `.tmp`；默认不录麦克风、系统音频或摄像头。先运行 `--help` 可查看范围而不开始录屏。此检查还记录源动画供帧、编码时间戳间隔和帧数，不能把变帧率或重复画面直接当成有效运动帧率。

## 实测状态

测试机为 Core Ultra 7 155U、约 16GB RAM、Intel 集成显卡、Windows 11 Pro。最终静态运行组件直接使用真实模型及合成截图，加载及校验 10.161 秒、单张推理 27.227 秒，峰值工作集 2,878,222,336 字节、私有内存 1,944,010,752 字节。观察到的连接仅为回环；完成退出、推理中取消及加载前校验阶段取消检查通过。收紧提示和输出长度后，该截图的标注为屏幕原文 `Example document`；单个样例通过不能代表所有录屏的语义准确率，焦点判断仍需人工复核。

最终保留改动的 79 项相关单元测试通过，包含 AI 证据／时间映射、组件校验、更新保护、预览画质持久化和既有运动计算。界面检查中，6 项批量审阅回归、2 项离线增量及 6 项暂停／恢复／预览唤醒检查均通过；离线增量包含默认保留全画面、应用及撤销、缺少完整包的说明。TypeScript、生产构建和 Electron 主进程加载检查通过。

最终打包版在 Electron 会话阻断远程 HTTP／HTTPS 的条件下通过真实模型分析、应用、撤销、保存、重开和 MP4 导出；生产界面不显示 Ollama 配置。1.5 秒合成片段抽样一次、生成方案约 66.232 秒（同时进行安装包压缩，不是空闲性能基准），标注为原文 `Example document`。直接运行 EXE、未设置 launcher 的禁用更新变量时，也验证了预览版更新标识生效；清除浏览器保存值并实际重启 App 后，预览画质仍正确保留。这个网络测试没有断开整台电脑网络，不能替代干净离线机器安装验收。

实际 App 录屏已通过整个屏幕 → 录制 → 停止 → 自动进入编辑器，得到 1920×1200 的 H.264 文件，覆盖完整显示器。另用实际录制文件完成导入、编辑、鼠标效果、`.recordly` 保存重开及源尺寸 MP4 导出。鼠标效果检查使用合成遥测，不能据此声称实际鼠标轨迹采集已验收；这些测试关闭了音频。无本轮并行负载复测中，源动画约 60.07fps、原始录制约 48.63fps，尚未稳定达到请求的 60fps。滤镜优化实验未通过实际性能门槛，已撤回；完整数据和限制见 [本轮验证记录](offline-ai-validation-2026-10-18.md)。不能用打包成功或编辑流程通过声称性能改善。

未进行真实客户视频、多说话人、中文／英语／马来文语音质量、干净 Windows 安装机或断网整机验收；没有部署云端、调用付费 API、上传用户录屏。此次内置的是离线视觉分析，不宣称云端 AI Studio 已完成。

## 本机测试成品

- 安装包：`release/offline-ai-test/Jsox-Recorder-Offline-AI-1.4.0-x64.exe`，1,693,821,125 字节，未签名。
- SHA-256：`a724c35a1c51bf4efb91bdc1acd24e1babca35b8ca2113528ed6e2f202dc4020`；同目录附 `.sha256` 与 `validation-receipt.json`。
- 便携入口：完整 `win-unpacked` 文件夹中的 `Start-Jsox-Offline-AI.cmd`。不能只复制其中一个 EXE，模型和资源必须同行。
- 最终成品中 9 项模型、运行组件与许可文件重新通过完整 SHA-256 校验。安装程序已生成，未在本机执行安装向导或干净电脑安装；实际流程测试运行其同批次的解包程序。

模型、安装包、详细日志和录屏均不提交 Git；仓库提交的是实现、构建锁定文件、测试及脱敏验证说明。

## 屏幕文字识别（OCR）

完整离线 AI 包内置屏幕文字识别，给 AI 解说提供画面上的原文（按钮、菜单、对话框标题、表单、状态栏，中文、英文和数字），解说稿才能说出界面上真实的名称，而不是模型猜的字。

- **模型**：PaddleOCR PP-OCRv6 small 文字检测（9,929,594 字节）和识别（21,234,383 字节）模型，RapidOCR 转换的 ONNX 版本，Apache-2.0。两个文件原样取自 PyPI 上固定版本的 rapidocr 3.10.0 wheel（27,288,134 字节，SHA-256 `2fc34e26cd0f48514804a94f8832283039c7334076bff60768b1fed9ad068050`）；wheel 内的 `MODEL_LICENSES.md` 以相同的 SHA-256 列出这两个模型，说明权重版权属于百度／PaddleOCR 权利人，按 Apache-2.0 发布，没有附加限制。识别模型的字符表（18,708 个字）存在模型元数据里，准备脚本原样取出为 `keys.txt`。旋转文字的方向分类模型没有内置：界面文字都是横排。
- **运行方式**：ONNX Runtime Web 1.30.0（MIT，WebAssembly SIMD + 多线程版本，约 14 MB）在单独的 worker 线程里运行，不用原生的 onnxruntime-node：sherpa-onnx 已经在主进程加载了它自带的 `onnxruntime.dll`，Windows 按模块名复用已加载的 DLL，再加载另一个版本会互相冲突。第一次识别时才启动 worker（`dist-electron/ocr-worker.cjs`），启动时按清单检查全部文件的大小和 SHA-256，然后加载模型；`dispose()` 结束 worker，释放内存。线程数取逻辑处理器数减 1，最多 4 个。识别请求逐个送进 worker，单张超过 120 秒视为卡住：结束 worker，下次识别重新启动。
- **处理流程**：按 RapidOCR 3.10.0 源码逐步移植到 TypeScript（`electron/ipc/autoEdit/ocr/`，保留上游版权声明并注明改动）：检测输入短边放大到 736、宽高取 32 的倍数，按模型训练时的方式转成 BGR 并归一化到 −1～1；DB 后处理（阈值 0.3、框阈值 0.5、扩张系数 1.6、最小尺寸 3），界面文字都是横排，所以框取轴对齐矩形，不需要 OpenCV、pyclipper；从上到下、从左到右排序；识别输入高 48 像素、保持宽高比、不足 320 宽的补齐，按宽高比每 6 个一批；CTC 贪心解码，每行置信度取保留字符概率的平均值，低于 0.5 的行丢弃。图像缩放逐位复现 OpenCV `cv2.resize` 的双线性插值，模型看到的像素和 RapidOCR 相同。另外加了一步 RapidOCR 没有的处理：检测模型常把只隔着空白的菜单项、标签页（“文件　编辑　视图”）连成一行，同一行里的空白宽于文字高度时就切开，分别识别。
- **接口**：`createBundledOcrEngine()` 实现 `electron/ipc/autoEdit/ocrTypes.ts` 的 `OcrEngine`，返回输入图像像素坐标的文字行；`getBundledOcrStatus()` 只检查清单和文件大小，不加载模型。开发时文件在 `vendor/offline-ai/win32-x64/ocr`，打包后在 `resources/offline-ai/ocr`，worker 从 app.asar 解包到 `app.asar.unpacked/dist-electron/ocr-worker.cjs`（worker 线程只能从磁盘加载入口文件）。`vite build` 和 `npm run dev` 都会生成这个 worker。接入 AI 解说由视频理解部分负责。

构建机上 `npm run prepare:offline-ocr` 下载 wheel（限制大小、失败重试、校验 SHA-256，缓存在 `.tmp/ocr-downloads`），只取出两个模型和许可文件；从已安装的 onnxruntime-web 复制 WASM 运行文件（版本必须是锁定的 1.30.0，否则先 `npm ci`），再从 ONNX Runtime GitHub 固定版本下载许可和第三方声明。每个文件都按 `scripts/offline-ocr.lock.json` 校验大小和 SHA-256，最后生成 `manifest.json` 和 `NOTICE.txt`；`MODEL-LICENSE.txt` 是 wheel 里的 Apache-2.0 原文，`RAPIDOCR-MODEL-LICENSES.md` 是 RapidOCR 的模型来源和署名说明。这些都是跨平台文件，可以在任何系统上准备，整个目录约 46 MB。`npm run verify:offline-ocr` 不联网，只做校验；`package:win:offline` 在打包前会执行它，缺失或损坏时停止打包。

实测（Linux 4 vCPU Xeon 2.1 GHz 沙盒，没有其他任务；Node 22）：用 Pillow 绘制 12 个合成软件截图（中文、英文、中英混排各 4 个，浅色、深色主题各半；Noto Sans SC、Inter、Liberation Sans、DejaVu Sans、Carlito、文泉驿正黑等字体；12–20 px 的菜单、侧栏、按钮、对话框标题、表单、提示框和状态栏），每个截图生成下面 5 种输入，共 60 张、1,726 个文字项：

| 输入 | 文字项 | 完全正确（不计空格） | 字符正确率 | 每张耗时，4 线程（中位数／P90） |
| --- | --- | --- | --- | --- |
| 点击处裁剪 768×432 | 204 | 100% | 100% | 1.35／1.88 秒 |
| 150% 缩放录屏的点击处裁剪 1152×648 | 199 | 100% | 100% | 1.28／2.02 秒 |
| 整帧 1280×720 | 441 | 100% | 100% | 2.18／2.48 秒 |
| 1080p（150% 缩放）整帧缩到 1280×720 | 441 | 100% | 100% | 2.20／2.34 秒 |
| 压力测试：整帧缩到 853×480，文字只有 8–9 px | 441 | 99.5% | 99.94% | 2.18／2.40 秒 |
| 合计 | 1,726 | 99.9% | 99.98% | 2.06／2.34 秒 |

- 只有 2 个错误，都在 8–9 px 的压力测试里，各错一个字母（“Language”读成“Languge”，“Check for Updates”读成“Check for Updlates”）；没有漏读的文字项。裁剪边缘被切掉一半的文字也会读出（40 张裁剪里 24 行，不计入上表），另有 1 处把边框读成“_”。
- 空格：英文单词之间的空格 99% 读出；中文和英文／数字之间的空格有 28% 读不出（如“上传 Upload”读成“上传Upload”），RapidOCR 原版同样如此。连空格一起比较时完全正确率为 92.4%，所以拿识别结果和候选文字比较时要忽略空白。
- 线程数（20 张，同一张图依次用不同线程数运行，中位数）：768×432 裁剪 1／2／3／4 线程分别 4.0／2.1／1.5／1.3 秒；1280×720 整帧 6.7／3.7／2.5／2.4 秒。第一次识别还要启动 worker、校验约 46 MB 文件并加载模型，约多 1–2 秒。
- 内存：运行时整个进程比空闲时多约 0.5 GB（峰值 648 MB，空闲 122 MB），主要是 WebAssembly 内存；`dispose()` 后大部分释放。
- 和 RapidOCR 3.10.0 原版（Python、原生 onnxruntime 1.31.0 CPU、相同模型、4 线程）对比：关掉上面的切分步骤时，60 张图的 1,742 行中，每行的框相差不超过 3 像素，1,725 行文字完全相同，其余 17 行只差中英文之间的一个空格，说明移植忠实。打开切分后完全正确率 99.9%，原版 98.9%（原版把相邻菜单项连成一行，9 项因此读不出单独的结果）。原生 onnxruntime 更快：每张中位数 0.68 秒，WASM 版 2.06 秒，约慢 3 倍；4 线程下每张裁剪仍在 2.5 秒以内，所以继续使用 WASM，避免两个 `onnxruntime.dll` 冲突。
- Electron：打包目录（`electron-builder --linux --dir`，配置同 `electron-builder.offline.json5`）里 `resources/offline-ai/ocr` 的 11 个文件和解包出来的 worker 都在；在 Electron 43.1.0 主进程里用真实的 `bundledOcr` 模块读取这个打包目录，两次运行中第一次识别 2.4–3.4 秒、之后 1.4–1.6 秒（默认 3 线程），768×432 测试图的 16 行全部正确。

未验证：真实录屏（视频压缩噪点、Windows ClearType 子像素字体）、Windows 真机速度、繁体中文、竖排文字（不支持）以及 12 px 以下、低对比度的文字。

## 来源

- [Qwen 官方 GGUF 文件](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/tree/52d6c8ffea26cc873ac5ad116f8631268d7eb503)
- [Qwen 项目许可](https://github.com/QwenLM/Qwen3-VL/blob/96588727e44c78b25ba03ea03b8e12f7e64fd0da/LICENSE)
- [llama.cpp 固定源码](https://github.com/ggml-org/llama.cpp/tree/848bbda9041decd87904f7eb5a2990863ecce03b)
- [LLVM-MinGW 官方项目](https://github.com/mstorsjo/llvm-mingw)
- [rapidocr 3.10.0 wheel（PyPI）](https://pypi.org/project/rapidocr/3.10.0/)、[RapidOCR 项目](https://github.com/RapidAI/RapidOCR)
- [PaddleOCR 项目及许可](https://github.com/PaddlePaddle/PaddleOCR)
- [ONNX Runtime 1.30.0 源码及许可](https://github.com/microsoft/onnxruntime/tree/v1.30.0)

运行组件源码和锁定的构建工具版本在脚本中记录。模型 Apache-2.0、llama.cpp MIT、LLVM 及工具链声明和本项目 AGPL 文本随包保留；这不是商业发行许可的法律认证。
