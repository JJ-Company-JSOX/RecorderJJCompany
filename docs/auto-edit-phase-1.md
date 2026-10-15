# 自动剪辑：阶段 1

仅实现阶段 1。OCR、翻译、TTS 与声音克隆尚未开始。

## 代码核对结果（实现前已有）

| 能力 | 现有实现 | 关键约定 |
|---|---|---|
| 时间线 | `src/components/video-editor/types.ts`、`state/useTimelineState.ts`、`clipSequence.ts`、`projectPersistence.ts` | `ClipRegion.startMs/endMs` 是连续时间线位置，`sourceStartMs` 是素材起点，`speed` 是素材时间／时间线时间。另存 `ZoomRegion`、`AnnotationRegion`、`AudioRegion`、`CaptionCue`；保留旧 `TrimRegion`、`SpeedRegion` 兼容路径。 |
| 自动缩放 | `timeline/zoomSuggestionUtils.ts`、`hooks/useFreshRecordingAutoZoom.ts` | 已有实际点击、停留和轨迹推断；点击聚类间隔 2500 ms、前后留白 500 ms。新录屏已有自动应用入口。此次另加审阅流程，不替换现有算法。 |
| 光标／点击 | `electron/ipc/cursor/telemetry.ts`、`register/recording.ts`、`hooks/useCursorTelemetry.ts` | 记录 `timeMs`、归一化 `cx/cy`、点击／双击／右键／中键／mouseup 和光标类型；通过 `.cursor.json` 侧车读写。 |
| 额外音频轨 | `types.ts: AudioRegion`、`audio/useVideoEditorAudio.ts`、`audio/useAudioPreviewSync.ts`、`hooks/useAudioRegionCommands.ts` | 已有导入音频、音量、标准化、多轨、预览同步和关联移动；源音频另有逐剪辑路由设置。 |
| 导出 | `export/useExportRunner.ts`、`export/buildExportRenderOptions.ts`、`src/lib/exporter/modernVideoExporter.ts`、`videoTimelineSegments.ts`、`electron/ipc/export/native-video.ts` | 已有 WebCodecs 和原生／FFmpeg 路径、源素材解码区间、变速音频混流、标注／缩放／字幕。此次写入同样的时间线对象，未另建导出器。 |
| 转录 | `captions/useAutoCaptionController.ts`、`electron/ipc/captions/generate.ts` | 已有本地 Whisper 管线和字幕；此次只使用已经存在的字幕，不启动识别、不下载模型。 |

## 使用与数据

编辑器顶部 **Auto edit plan** → 生成本地方案 → 预览每项 → 每项接受或拒绝 → 应用已接受项。面板可切换中文、English、Bahasa Melayu；整套应用的马来文翻译不在本阶段范围内。

JSON 包含 `version`、`id`、`coordinateSpace: timeline-ms`、当前编辑状态 `baseline`、`suggestions`、`warnings`、`reviewer` 和导出时的逐项 `decisions`。类型为 `trim`、`zoom`、`speed`、`annotation`。建议仍在待审状态时不能应用。JSON 是本地下载，不上传；其中的 baseline 可能包含本地文件路径和字幕，不应直接发给第三方。

- 使用已经随仓库安装的 FFmpeg／FFprobe；视频逐帧分析，不抽样或缩小画面，`freezedetect=n=0:d=1.5`；音频 `silencedetect=n=-50dB:d=1.5`。
- 删除必须同时位于静止帧区间和**每个**已发现音轨的静音交集内。考虑嵌入音轨、麦克风／系统音频侧车及已知侧车延迟。无音轨不等于静音。对齐或时长不明时不生成时间删改建议。
- 区间两端各保留 400 ms；保留后的时长至少 2500 ms 时建议删除，1000–2499 ms 时建议 1.5× 加速。转录区间及其前后 400 ms、录到的点击活动会阻止删改。
- 点击缩放只使用实际记录的点击坐标，不把停留猜成点击；同一剪辑内 2 秒内重复点击不重复建议。标注建议直接引用已有转录原文。
- 已有缩放、标注或额外音轨与时间删改相交时，该建议被保护；已有变速或旧速度轨也受到保护。独立摄像头尚未分析／对齐时不建议时间删改。接受的删减只修改明确选择的区间，后续编辑随时间线移动；不删除已有编辑内容。
- 原编辑数组不作原地修改。保留素材起点和剪辑顺序；源字幕仍按素材坐标保存。新增片段继承源音频设置，音频设置同时纳入撤销历史。修改源素材、时间线或相关音频设置后，旧方案不能应用。
- 分析支持取消；子进程使用参数数组、非 shell 调用、限制线程和超时。IPC 使用现有本地媒体授权与真实路径检查，不接受任意远程素材。

## 本地 AI 审阅边界

默认仅运行规则；AI 是用户主动选择的可选步骤。新增 `PlanReviewer` 接口和本机 Ollama 适配器。

先检查用户**已经安装**的模型，展示权重字节数与许可证正文，说明兼容性和性能尚未认定，用户确认后才能发送方案。没有捆绑、下载或推荐特定权重，因此没有新增模型体积／许可证假定。模型作为外部本地服务运行不等于其许可证自动与 AGPL-3.0 兼容；若日后捆绑／分发权重，必须单独审查。

适配器固定直连 `127.0.0.1:11434`，不使用代理、不跟随重定向、不提供云端地址。检查 tags/show 的本地权重与许可证信息，拒绝云端模型名及带远端元数据的别名。用户仍应信任并正确配置自己的本地服务；Recordly 无法审计第三方服务进程的内部行为。

只发送候选编号、类型、起止时间和规则原因；不发送视频、音频、路径、光标坐标或转录文字。AI 只能删除候选或缩小原候选时间范围，不能扩大规则证据、新增操作或改写文字。非法回复、超时或服务不可用时不改时间线。AI 审阅后所有保留项重新待审。

没有新增云端调用或遥测，因此本阶段没有上传流程。后续若添加云端功能，必须另行实现上传内容／接收方说明、敏感信息检查和用户确认，不能复用本地接口偷偷转发。

## 验证方法与结果

可重复执行：

```sh
npm run typecheck
npx vitest run src/components/video-editor/auto-edit src/components/video-editor/editorHistory.test.ts src/components/video-editor/projectPersistence.test.ts src/components/video-editor/clipSequence.test.ts src/components/video-editor/hooks/useEditorGlobalInteractions.test.ts src/lib/exporter/videoTimelineSegments.test.ts electron/ipc/autoEdit
npx playwright test tests/ui/auto-edit.spec.ts
npx vite build --config vite.config.ts
```

无图形桌面的云环境使用系统 Chromium 执行 Playwright；临时配置仅将 `launchOptions.executablePath` 指向 `/usr/bin/chromium`，保留仓库 UI 测试的 renderer-only 和测试认证配置，不修改项目默认测试配置。桌面原生录屏仍需要图形桌面。

测试证据将记录于本文末尾。媒体分析测试确实调用 FFmpeg，使用合成静止／运动画面、音调、静音和多音轨；它们不是真实语言测试。界面测试使用仓库的 Electron bridge mock，验证逐项决定、JSON 下载、写入现有时间线、撤销、方案失效及三语言控件。AI 测试使用本机服务协议 mock，验证本地路由、元数据门槛、隐私字段和非法回复拒绝；不代表真实模型推理已验收。

## 已知限制与真实样本验收

- 静音是信号阈值判定，极轻语音可能低于阈值；静止画面也可能是有意义的阅读停顿。规则不理解教学意图，所以建议必须人工预览，不自动删除。
- 零容差会保留压缩噪声、动态时钟或轻微变化的画面，因此可能漏掉很多本可删的停顿；这是保守取舍。
- 全分辨率逐帧扫描可能较慢。限制两条解码线程并串行分析音轨，但未在低配实体电脑上基准测试。额外本地模型的速度取决于具体权重、量化、内存和硬件；最长请求时间 120 秒，不承诺实时。
- 当前 AI 只基于候选时间信息审阅，无法判断语义或讲解是否重要；未安装／运行真实本地模型，尚无模型推理质量与速度结果。
- 本阶段未加入识别／OCR／翻译／TTS。已有转录按原文字与时间处理，合成的中英马字符串测试只验证保护逻辑与字符保留，不代表混说识别效果。
- 当前环境没有用户提供的真实马来文／中英马混说录屏和人工校对参考。因此错误率必须记为**未测**，不能记为 0 或“可用”。

| 真实样本 | 样本数 | CER / WER | 停顿误删率／漏检率 | 状态 |
|---|---:|---|---|---|
| 中文办公／授课录屏 | 0 | 未测 | 未测 | 待录屏、音轨、点击侧车和人工参考 |
| 英文办公／授课录屏 | 0 | 未测 | 未测 | 同上 |
| 马来文办公／授课录屏 | 0 | 未测 | 未测 | 同上 |
| 中英马混说录屏 | 0 | 未测 | 未测 | 同上 |

真实验收需要含口音、停顿、术语、静态阅读段和低音量说话的授权样本。中文用逐字参考计算 CER，英文／马来文用预先约定分词和正规化规则计算 WER，混说同时报告分语言 WER／CER 和统一标注词元错误率；公式均为 `(替换+删除+插入)/参考单位数`。剪辑另报告人工标注可删停顿上的精确率、召回率和误删语音毫秒数；没有识别输出时不编造 WER。

## 本次运行证据

- `npm run typecheck`：通过。
- 上述 8 个单元／集成测试文件：**94 项通过**；其中媒体分析测试实际执行 FFmpeg，模型服务测试使用 mock。
- `tests/ui/auto-edit.spec.ts`：**3 项通过**（系统 Chromium、Electron bridge mock）。验证接受删减、拒绝缩放、JSON 下载、写入后 6 秒时间线变为 2.8 秒、一次 Undo 恢复 6 秒，以及中／英／马控件、本地 AI 审阅后重新待审和旧方案失效。
- `npx vite build --config vite.config.ts`：renderer、Electron main/preload 打包通过；仍有生成 CSS 的空 `:is()` 选择器警告、动态导入／静态导入重叠与大 chunk 提示，未在本阶段处理。
- 新增模块的 Biome 检查与 `git diff --check`：通过。`package.json`、锁文件和许可证文件未改；未新增依赖或模型。
- 演示截图：`test-results/auto-edit-review.png`（界面 mock 场景，不是真实语料识别演示）。
- 未运行安装包发行流程，未在图形桌面实测录屏／最终编码文件，未执行真实模型推理，真实语料指标仍为未测。

本次变更仅在本地工作区；未推送或发布。当前 checkout 的 origin 指向 `webadderallorg/Recordly`，如需提交到某个 fork，需使用实际 fork 的地址，不推断空的 `RecorderJJCompany` 是该 fork。
