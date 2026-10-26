# 免费本地 AI 方案：无独立显卡、16 GB 内存（2026-10-26）

用户已取消 Wan API，明确需要免费、适合这台电脑的开源方案。本轮只研究许可证、Windows/CPU 能力和资源取舍；没有安装依赖、下载模型或接入付费服务。已确认的硬件条件只有 **16 GB RAM、无独立 GPU**；CPU 型号、核数和磁盘空间未确认，因此不能承诺处理速度。

## 推荐结论

优先使用 **现有视频/产品图片 + 原声识别 + 主题故事稿 + 本地配音 + 字幕/标题 + 现有 FFmpeg 导出**。这个流程能够制作产品介绍，不需要逐帧生成新视频，也不需要 Wan API。

1. **原声转文字：复用现有 whisper.cpp。** 现有锁定资产是 multilingual **small Q5_1，190,085,487 bytes（约 181 MiB）**，不是 tiny/base。先使用已经安装并通过验证的资产；CPU 速度不够时，再考虑提供用户主动选择的 tiny/base 轻量包。不能宣称轻量包已经安装或已完成接入。
2. **文案/剧情：以 Qwen3 1.7B 的量化文字模型为低负担候选。** 用户已有的 4B 可以保留为较慢选项。0.6B 更轻，但产品叙事、指令遵循和事实约束更弱，不作为默认质量方案。先利用用户主题、卖点和明确允许的原声文字，减少画面推理。
3. **文字转配音：继续现有 Kokoro + sherpa-onnx 原生实现。** 不增加 Python、第二套 TTS 或收费 API。
4. **看画面：默认关闭，只在明确需要时读取一至两张低分辨率抽样图。** 现有 bundled AI 已锁定 Qwen3-VL-2B 的 Q4 模型及视觉投影器，可以作为后续复用候选。但当前产品故事的画面分析走 Ollama，bundled 视觉旁路尚未接入该故事流程；不能声称两者已经打通。文字模型不能看画面，CPU 视觉推理也不会因为免费就变快。
5. **不推荐在这台电脑安装 Wan/LTX/ComfyUI 来生成整段新视频。** 这些工具可以免费获取，但依赖、模型、内存和计算量不符合当前速度目标。CPU offload/CPU fallback 的存在，不等于这台电脑能流畅生成视频。

## 已核查的项目与许可证

下表链接均来自本轮实际读取的 GitHub README/LICENSE。模型权重、推理程序和附带数据分别适用其许可证，不能把运行时的 MIT/Apache 许可证推广到所有模型。

| 项目 | 已核实的许可与源码证据 | Windows / CPU 与当前取舍 |
|---|---|---|
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | [MIT LICENSE](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)；[README](https://github.com/ggml-org/whisper.cpp/blob/master/README.md) 明列 Windows MSVC/MinGW、量化、内存表 | **优先复用。** C/C++ 原生 CPU 识别，适合现有捕获/FFmpeg 后处理流程，无需 Python。tiny/base 可成为后续轻量资产选项。 |
| [OpenAI Whisper](https://github.com/openai/whisper) | [MIT LICENSE](https://github.com/openai/whisper/blob/main/LICENSE)；[README License](https://github.com/openai/whisper#license) 明确代码及模型权重为 MIT | 模型来源可用于离线识别；客户端应继续使用已有 whisper.cpp，而不是再安装 Python/PyTorch 版。 |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | [Apache-2.0 LICENSE](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE)；[README](https://github.com/k2-fsa/sherpa-onnx/blob/master/README.md) 列 Windows x64 和 CPU 语音能力 | **保留现有原生 Node/native 绑定。** ASR、VAD、TTS 是不同模型，不能认为所有下载包都采用同一模型许可证。 |
| [Kokoro](https://github.com/hexgrad/kokoro) | [Apache-2.0 LICENSE](https://github.com/hexgrad/kokoro/blob/main/LICENSE)；[README](https://github.com/hexgrad/kokoro/blob/main/README.md) 明确 Kokoro-82M 的 Apache-licensed weights | **优先保留。** 当前项目经 sherpa-onnx 运行中英配音。项目包另含 MIT 词典数据及 GPL-3.0-or-later eSpeak NG 数据/库，不能标成“全包 Apache”。 |
| [Qwen3](https://github.com/QwenLM/Qwen3) | [README License Agreement](https://github.com/QwenLM/Qwen3#license-agreement) 明确开放权重为 Apache 2.0；本轮根目录 LICENSE/ LICENSE.md/ LICENSE.txt 均返回 404，未据此认定仓库所有代码的许可 | **1.7B 量化文字模型为候选，已有 4B 可保留。** README 列 0.6B/1.7B/4B 等型号及本地 CPU/GPU 框架。打包前仍核对实际模型文件对应 LICENSE。 |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | [MIT LICENSE](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE)；[README](https://github.com/ggml-org/llama.cpp/blob/master/README.md) 有 Windows PowerShell、预编译和本地推理入口 | 适合复用项目现有 bundled sidecar，避免新增另一套大型运行时。无需因为增加文案功能再重复安装 Python/大模型服务。 |
| [Ollama](https://github.com/ollama/ollama) | [MIT LICENSE](https://github.com/ollama/ollama/blob/main/LICENSE)；[README](https://github.com/ollama/ollama/blob/main/README.md) 有 Windows 安装和本地模型管理 | 用户已安装时继续复用；本地使用无需付费 API。**Ollama 免费不等于所有模型许可相同，也不等于模型耗时更少。** 不要同时长驻多个模型。 |
| [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL) | [Apache-2.0 仓库 LICENSE](https://github.com/QwenLM/Qwen3-VL/blob/main/LICENSE)；[README](https://github.com/QwenLM/Qwen3-VL/blob/main/README.md)；具体权重条款还应看其模型仓库 | 仅作**按需少量看图**。优先评估已有 2B 资产，不再默认追加 3B 视觉权重。文字 Qwen3 1.7B/4B 不能替代视觉编码器。 |
| [Qwen2.5-VL 旧入口](https://github.com/QwenLM/Qwen2.5-VL) | 本轮该入口的 [README](https://github.com/QwenLM/Qwen2.5-VL/blob/main/README.md) 与当前 Qwen3-VL README 内容相同；其 [LICENSE](https://github.com/QwenLM/Qwen2.5-VL/blob/main/LICENSE) 为 Apache-2.0 | 原先举例 `qwen2.5vl:3b` 只是可选视觉模型，不适合再作为此 CPU 机器的默认额外下载；具体 Ollama 标签和量化包仍应由安装检查确认。 |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | [LICENSE.md](https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md)：默认 LGPL-2.1-or-later，可选 GPL 部分及 nonfree 组件改变分发条件 | **沿用现有管线。** 探测、音轨提取、裁剪、混音、缩放和编码可在 CPU 完成。实际安装包须核对二进制构建配置，不能只按仓库默认许可归类。 |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | [GPL-3.0 LICENSE](https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE)；[README Windows Portable](https://github.com/Comfy-Org/ComfyUI#windows-portable) 明确 Windows portable 可使用 CPU | **当前不推荐安装。** 它是执行工作流的框架，不能消除具体视频模型的硬件成本；其“支持 CPU”不是此机器快速生成视频的证据。 |
| [Wan2.1](https://github.com/Wan-Video/Wan2.1) | [Apache-2.0 LICENSE.txt](https://github.com/Wan-Video/Wan2.1/blob/main/LICENSE.txt)；[README](https://github.com/Wan-Video/Wan2.1/blob/main/README.md) 给出 T2V-1.3B 8.19 GB VRAM、RTX4090 示例 | **排除当前实施。** 上游例子是在独显设备，不适用于无独显 16 GB 系统内存。用户已取消 Wan API，也不因此自动改装本地 Wan。 |
| [Wan2.2](https://github.com/Wan-Video/Wan2.2) | [Apache-2.0 LICENSE.txt](https://github.com/Wan-Video/Wan2.2/blob/main/LICENSE.txt)；[README](https://github.com/Wan-Video/Wan2.2/blob/main/README.md) 的运行与效率表围绕 GPU | **排除当前实施。** 单卡/多卡优化或 CPU offload 不构成这台电脑可顺畅运行的验证。 |
| [LTX-Video](https://github.com/Lightricks/LTX-Video) / [LTX-2](https://github.com/Lightricks/LTX-2) | LTX-Video [仓库 Apache-2.0 LICENSE](https://github.com/Lightricks/LTX-Video/blob/main/LICENSE)，但 [README](https://github.com/Lightricks/LTX-Video/blob/main/README.md) 链接模型 OpenRAIL 许可；LTX-2 [LICENSE](https://github.com/Lightricks/LTX-2/blob/main/LICENSE) 指向 [LTX-2.x Community License](https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x)，包括商业收入门槛与用途条件，并非统一 Apache/MIT | **排除当前实施。** 当前 LTX-2 README 的 quick-start 模型集合约 66 GiB；不是 16 GB、无独显电脑的合理默认方案。不同版本的代码/模型条款不同，不能笼统承诺“完全免费商用再分发”。 |

## 资源大小：已知事实与估计分开

| 组件 | 已核查信息 | 此电脑上的建议 |
|---|---|---|
| whisper.cpp tiny / base | 上游 README 表：tiny 75 MiB、内存约 273 MB；base 142 MiB、内存约 388 MB。该表是上游一般值，不是本机基准；量化文件大小另算 | 想优先速度时考虑 tiny/base multilingual。英文 `.en` 模型不能当成中文模型。未完成轻量模型下载/安装验证。 |
| 当前 Whisper small Q5_1 | [项目锁文件](../../scripts/offline-speech.lock.json) 记录 190,085,487 bytes；识别质量/CPU速度取舍与 tiny/base 不同 | 先跑通现有已安装模型，不为“免费”重复拉取一套模型。 |
| 当前 Kokoro multi-lang v1.0 | [TTS 锁文件](../../scripts/offline-tts.lock.json) 记录压缩包 349,906,910 bytes，且详列多项许可证 | 保留。CPU 实际峰值内存和实时率需实测，不能用 350 MB 下载体积当作运行内存。 |
| Qwen3 1.7B Q4 / 已有 4B Q4 | 型号已由上游 README 验证；常见量化下载约 1–1.5 GB / 2–3 GB 属于**配置相关估计**，本轮未读取具体 Ollama manifest、未下载或测量 | 1.7B 优先。每次只运行一个模型；4B 作为较慢质量选项。做容量规划可先为 1.7B 推理进程预留约 2–4 GB、4B 预留约 4–7 GB；这些是保守规划范围，**不是本机实测峰值**。KV cache、上下文长度、量化、Electron 和浏览器都会改变结果。不能保证 16 GB 时并行运行流畅。 |
| 当前 bundled Qwen3-VL-2B | [AI 锁文件](../../scripts/offline-ai.lock.json) 记录模型 1,107,409,952 bytes + 投影器 445,053,216 bytes，合计约 1.45 GiB；这是磁盘资产大小 | 只考虑一至两图按需复用。现有 bundled 视觉教程与 Ollama 故事入口是不同调用路径，复用到故事流程仍需实现/验证。 |
| Wan / LTX 生成视频 | 上游要求与示例使用 GPU；LTX-2 当前 quick-start 模型集合约 66 GiB | 本轮不给出 CPU 生成时长预测，不建议下载。使用实录、自己的产品图片、文字/配音/已有缩放即可完成当前产品故事目标。 |

## 实施顺序与验证边界

- 优先保证原声识别→可审阅文本→故事稿→配音/字幕→导出的完整流程，识别结果不应自动当成最终字幕或已验证的产品事实。
- 所有模型按需加载；录屏时不预先启动 LLM/VLM。识别、文案、配音顺序执行，避免同时占用 CPU/RAM。保留用户取消和真实耗时记录。
- 文字模式应明确显示“按主题/文字资料编写”；只有实际送入抽样画面并使用视觉模型后才描述为看图。不能把文字模型说成看完整段视频。
- 新的 tiny/base 资产、1.7B 下载或 bundled 视觉复用都要按用户选择执行，不自动安装整个开源套件。客户端打包继续保留固定版本、校验值、NOTICE 与许可证，不把“独立 CLI 进程”当成分发义务的豁免。
- 当前没有在用户这台 Windows PC 上运行模型基准、量取峰值 RAM 或测试新的模型下载；上述建议基于已核查源码/许可和已知硬件条件，不能标作本机性能验收通过。

## 本轮来源核查记录

实际读取 15 个 GitHub 仓库入口的 README/许可文件（其中 Qwen2.5-VL 为旧入口），成功读取 31 个文本文件；另有 7 个猜测的许可文件路径返回 404，均未据此编造许可证。Qwen3 的权重许可结论来自其 README 明确声明，具体权重 LICENSE 的在线内容本轮未读取。

原始小型源码快照与读取清单位于会话临时目录 `/tmp/recordly-free-local-research-20261026/`；没有下载外部仓库、AI 权重或依赖，也不把这些快照提交到项目。只提交本报告。链接指向读取时的上游分支，后续打包仍应锁定具体版本/commit 与相应许可文本。
