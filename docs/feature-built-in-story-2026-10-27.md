# 故事稿改用内置 AI，客户版不再打包 Ollama

日期：2026-10-27。基于 `da02f82`。用户决定：顾客不应接触 Ollama，故事稿由 App 已内置的 AI 编写。

## 顾客体验

- **默认的“轻量智能”模式就能写故事稿**：在“AI 配音和字幕”里把任务选为“故事”，填写要求，点“生成视频故事稿”。不需要选“Ollama 高级模式”，不需要检查模型，也不需要另外安装任何程序。
- **用的是同一个内置 AI**：llama.cpp 加 Qwen3-VL-2B，与教程配音和完整剪辑用的是同一个，按需启动，用完关闭。
- **可以分析画面**：开启“分析视频抽样画面”后，每段素材取一张图（640×360），先由内置视觉模型逐张写一两句看到的内容（`screenObservations`），再根据文字写整篇故事。不会把整段视频交给模型，原始音频也不会发送给模型。
- **完整客户端只有内置 AI**：客户版 ZIP 带有 `complete-client.txt` 标记，界面里不显示“智能模式”选择、Ollama、检查模型或安装命令。这个标记同时让 ZIP 客户端继续关闭旧的 NSIS 自动更新。
- **开发版仍可用 Ollama**：保留“Ollama 高级模式”，故事稿仍走原来的 Ollama 路径，连接本机 `127.0.0.1:11434`，或者开发者用 `prepare:offline-ollama` 准备的私有运行程序。

## 实现

| 部分 | 内容 |
|---|---|
| `electron/ipc/autoEdit/story.ts` | `generateBundledStory`：取帧、逐张描述、整篇写作，最后交给原有的 `parseStoryDraft` 检查。`storySchema` 给每个段落 ID 一个对象（`stage`、`title`、`text`），并设置文字长度上下限，形式与教程配音已经在这个模型上用过的 schema 相同 |
| `electron/ipc/autoEdit/bundled.ts` | `compose`：长篇结构化写作，温度 0.4，超时 10 分钟。故事会话的上下文是 8192（`STORY_CONTEXT_TOKENS`），其他用途保持 6144 |
| IPC | 新增 `auto-edit-story-bundled`；`auto-edit-edition` 返回 `completeClient` |
| 界面 | 两种模式都显示故事任务和创作要求；内置 AI 被视为能看画面；带着录前要求进入编辑器时不再切换到 Ollama |
| 打包 | 客户端、离线版和语音测试包都不再包含 `offline-ollama`，也不再要求 `verify:offline-ollama`；CI 准备步骤不再下载 Ollama |

## 体积

客户端少了 Ollama 运行程序（CPU 版约 0.1 GB；保留 GPU 后端时为 2.23 GB）和 qwen3:1.7b（约 1.4 GB）。

剩下的主要是 Qwen3-VL-2B（模型 1.11 GB 加视觉 0.45 GB）、Kokoro 配音约 0.38 GB、Whisper 识别约 0.19 GB，以及 OCR 和其他运行库。解压后约 2.6 GB，ZIP 估计约 2.3 GB，仍略超 GitHub Release 单个文件 2 GiB 的上限。这些都是估算，尚未实际构建。

## 尚未验证

- 本环境访问 Hugging Face 返回 403，无法下载模型做真实推理。故事稿的中文质量、JSON 是否完整、CPU 耗时，都要在装了内置 AI 的 Windows 电脑上实测。
- 已验证的部分：
  - 单元测试覆盖了请求格式、逐帧描述、拒绝缺段或不完整的回复、取消；
  - 用假的 llama-server 验证了 `compose` 的请求内容；
  - 界面测试覆盖了默认模式写稿和客户版隐藏 Ollama。
