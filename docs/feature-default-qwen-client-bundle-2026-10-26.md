# 默认 Qwen3 1.7B 与完整 Windows 客户端 — 2026-10-26

本轮把 Ollama 的默认文字模型改为 `qwen3:1.7b`，并把运行程序及模型接入现有 Windows 客户端打包流程。沿用现有录制、故事、配音、字幕与导出实现，没有付费 API、新的录制器或导出器。

## 顾客体验

- 未保存过模型名称时，默认填 `qwen3:1.7b`；已经主动选择并保存的 4B／自定义模型不被覆盖。
- **新故事默认不分析画面**，适合 16 GB RAM、无独立显卡的文字流程。已保存工程里的画面开关保留。旧工程若出现视觉模型警告，可直接点警告里的“Turn off frame analysis”，也可点击“Use lightweight CPU settings”或取消“Analyze sampled video frames”。不会自动替顾客下载 3B 视觉模型。
- 1.7B 根据创作要求、素材说明及主动开启的原声识别文字写稿。文字模型不能看画面。使用默认 1.7B 的聊天请求关闭额外思考输出；没有测量用户电脑上的实际提速。
- 完整客户端包含私有 Ollama 和全部模型文件。使用时才启动，独立动态 loopback 端口、模型目录和用户数据目录；不安装全局服务，不接管顾客原来的 Ollama。选择其他模型时仍可使用顾客已有的本地服务。
- 模型检查成功后，界面标注“模型和运行程序已随 App 提供”，并隐藏开发环境的安装命令。缺失／损坏时明确报错，不能悄悄改用顾客另外安装的默认模型。
- ZIP 客户端使用**完整包手动更新**，关闭与 NSIS 安装器不兼容的自动更新。更新前关闭 App 并保存工程，用完整新包替换旧目录；保留用户数据与素材。

## 交付形式与体积

默认 Windows 客户端输出：`release/Jsox-Recorder-Windows-1.4.0-x64.zip`（版本取 package.json）。顾客下载完整 ZIP，解压到自己的程序目录，运行其中的 `Recordly.exe`。不能只分发一个 EXE，`resources` 等目录须同行。

使用 ZIP／ZIP64 保留全部模型，避免假定一个普通 NSIS 自解压文件能承载多 GB 的完整资源。本轮没有制作该真实 ZIP，也没有实测最终大小。

已核查的官方 Ollama v0.40.11 Windows archive 为 **1,586,356,606 bytes**（约 1.59 GB 下载），SHA-256 `bda4a493ba8a7c24d57263cd843cd68cee84f44aed4299eeed532acad7eda12a`；MIT LICENSE 为 1058 bytes，SHA-256 `5934ed2ce0d15154bcdb9c85203210abac0da4314af34081e36df4599f90b226`。解压后 2.23 GB，其中 2.15 GB 是 GPU 后端（`lib/ollama/cuda_v12` 1.17 GB、`cuda_v13` 0.94 GB、`vulkan` 0.04 GB），而且 archive 没有附带 NVIDIA CUDA 与 Microsoft VC++ 运行库的许可证文本。客户端只用 CPU，所以准备流程先校验完整 archive，再去掉这三个目录（锁文件 `runtime.excludedPaths`），CPU 运行程序约 0.1 GB。2026-10-26 审计补充：去掉 GPU 后端后的真实 CPU 推理尚未在 Windows 上验证。

1.7B 模型在用户的实际 `ollama list` 中显示约 1.4 GB；它之外，完整客户端仍含原有视觉、语音识别和配音资产。因此最终 ZIP 会明显大于单个模型，构建和解压均需足够磁盘空间；这里不提供未测量的体积或安装时间保证。

## 构建机准备（不是顾客命令）

复用已经安装的模型可以避免重复下载：

```cmd
npm.cmd run prepare:offline-ollama -- --models-from "C:\Users\jeffreylhz\.ollama\models"
npm.cmd run verify:offline-ollama
```

也可运行 `npm.cmd run prepare:offline-ollama`，默认寻找本机已有模型；没有时才在构建机访问官方 registry。`--runtime-from "D:\Downloads\ollama-windows-amd64.zip"` 可复用已下载的固定版本 archive，仍必须通过大小与 SHA-256 校验。

构建完整客户端还需原有资产与 Windows helpers：

```cmd
npm.cmd run prepare:offline-ai
npm.cmd run prepare:offline-speech
npm.cmd run prepare:offline-voice
npm.cmd run prepare:offline-tts
npm.cmd run prepare:offline-ocr
npm.cmd run prepare:offline-ollama
npm.cmd run build:win
```

`build:win` 编译现有原生 helpers，调用 `build:win:client`，再由 `package:win:client` 验证全部资产并使用 `electron-builder.client.json5` 生成完整 ZIP。`npm run build` 的 Windows 路径也转到这里。已有离线／语音测试包继续沿用其独立配置，但同样要求新的 Ollama 资源齐全。

准备脚本先验证本地或官方内容，再完整暂存并替换；失败保留旧 bundle。所有大文件留在 Git 忽略的 `vendor/offline-ollama`，不提交模型或运行 archive。打包后 smoke 对**复制到成品里的资源**再次执行：

```text
node scripts/prepare-offline-ollama.mjs --verify --root <package>/resources/offline-ollama
```

校验全部文件大小／SHA-256、registry manifest 的每个 config/layer blob、许可证和 Windows x64 PE，拒绝越界路径、链接和额外文件。这个 `--verify` 路径不联网、不启动 Ollama。

Windows build/release workflow 改为在构建机准备这些资源并调用完整客户端构建；ZIP 进入校验和、attestation 和上传清单。发布暂存仍兼容历史 NSIS 工件的 metadata，但 ZIP 不发布 NSIS 自动更新 metadata。此轮没有触发远程构建或发布。

## 许可证与尚未验证的来源

Ollama 主程序 MIT、Qwen3 权重 Apache-2.0；准备流程保留实际模型 license 层、固定 Ollama LICENSE、CPU 运行程序自带的 llama.cpp／cpp-httplib／Go 声明，并按锁文件补入 LLVM（libc++、libunwind、libomp）与 mingw-w64 winpthreads 的许可证原文（`licenses/`）。不能把全部二进制依赖都标为 MIT；原有 eSpeak NG、FFmpeg 等分发义务继续适用。

官方模型 registry 在本环境返回 HTTP 403。锁文件诚实记录用户实际已安装的 manifest ID 前缀 `8f68893c685c`，没有编造独立核查的完整 upstream SHA。准备时验证每个内容寻址 blob 的完整 SHA-256，并将完整 manifest digest 记入 bundle 收据。**公开分发前，须在可访问的构建机独立核对该模型的完整官方 manifest digest 并补全锁定值**；本轮的来源前缀不能冒充完整不可变上游 pin。

## 验证记录

- 运行程序隔离、并发启动、取消、超时、退出与 private loopback 路由已有定向测试。准备脚本已有真实本地测试归档解包、内容复制、完整性拒绝和失败保留旧包验证；模型和可执行文件均为小型测试夹具，没有真实推理。
- release 暂存脚本实际运行了四个文件系统场景：ZIP stable、ZIP beta（所有平台）、历史 NSIS stable、缺少 Windows 工件拒绝；均符合预期。
- 完整单元集 **2213 通过、18 跳过**，245 个文件通过、5 个跳过。首轮发现 reviewer 测试夹具漏导出默认模型常量，修正后完整重跑通过。随后手动更新提示的一处旧常量名被 TypeScript 检查发现，修正并定向重跑 4 个 updater 场景通过。
- 真实 Chromium **25 个界面场景通过**：默认 1.7B、保留明确保存的 4B、随包模型标记和安装指令隐藏、模型检查导航、文字默认可写稿、警告内直接关闭画面分析，以及原有故事审阅／音轨／保存恢复／取消和降级行为。模型与 TTS IPC 使用夹具，不能代表真实模型质量。
- `npm run build:app` 最终通过 TypeScript、renderer/main/preload 构建、Electron main CJS smoke。23 个变动源码文件的格式检查、脚本语法检查与 `git diff --check` 通过。原有 CSS／产物体积提示仍在。
- 三个变动 GitHub workflow/action 文件的 YAML 解析通过；实际 `--verify --root <缺失目录>` CLI 拒绝不完整资源，未创建目录、下载或启动模型。此轮没有执行 GitHub workflow。

日志：`/tmp/recordly-qwen-client-unit-final.log`、`/tmp/recordly-qwen-client-updater-final.log`、`/tmp/recordly-qwen-client-ui.log`、`/tmp/recordly-qwen-client-build-final.log`、`/tmp/recordly-qwen-client-format.log`、`/tmp/recordly-client-release-staging.log`、`/tmp/recordly-client-missing-assets-check.log`。测试跳过、原生 Windows、真实模型与下载路径的限制不计为通过。

待做：在 Windows 构建机准备真实固定 runtime 与模型、补全独立模型 manifest pin、构建完整 ZIP；再在干净 Windows 16 GB／CPU 机器断网测试检查模型、写稿、配音、保存恢复、导出，以及取消／退出无孤儿进程。需要实测启动哈希扫描和内存峰值；现在每次运行 App 只在第一次启动私有服务器时完整哈希；文件的大小、修改时间或变更时间有任何变化才重新哈希。空闲 5 分钟后退出。没有在此环境生成可供顾客下载的新 Windows 成品。
