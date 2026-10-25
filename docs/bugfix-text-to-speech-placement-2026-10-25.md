# 文字配音：插入时间、试听与重复生成

日期：2026-10-25。基于 `589cd9d8`，继续现有 Electron / React / TypeScript 项目，复用离线 TTS、音轨、工程保存和导出。

## 问题与处理

用户截图中的 `There is no room for the voice at the playhead` 来自配音窗口：原实现先合成，再按当前播放头放置；播放头在结尾时得到空放置结果，却将它归类为“无法生成声音”。并不是这条错误本身证明了模型安装失败。

- **明确插入位置**：窗口展示工程时间（秒）与剩余时长，可以直接修改或点“从视频开头添加”。在结尾打开时默认设为零，并明确说明。空值、负值、结尾及越界位置在启动合成前阻止添加。
- **固定工程时间**：打开时暂停预览并记录插入时间；添加成功后定位到声音开头。通过现有 `addAudioClips` 增加可选 `startMs`，没有使用原片时间代替裁剪/变速后的工程时间。
- **试听输入内容**：有文字时“试听输入的文字”调用原有合成 IPC，使用生成文件的原生音频播放器，可暂停、拖动和选择段落。无文字时保留现有的声音样本试听。
- **复用合成结果**：同一文本段落、语言和说话人共用一份结果；重复试听、修改插入时间和添加到时间轴不再各自合成。改变内容或声音会生成对应的新结果。缓存只保存文件路径及元数据，不保留整段 PCM 缓冲；切换视频清除缓存。它是本次编辑会话的缓存，不保证重启后仍可复用。
- **先检查是否放得下**：语音生成后若剩余时间不足，保留文字和生成结果、展示所需时长，允许改位置或缩短文字；只有主动勾选“允许在视频结尾截断声音”后才会截断。保留原始语音文件和现有非破坏性音轨编辑。
- **完整预留音轨**：`placeAudioClips` 为整段配音及段间停顿寻找同一条空轨，修复第一段能放下、第二段撞上已有音乐时被丢弃的情况。不会移走已有音频或延长主视频。
- **取消与窗口尺寸**：关闭/取消忽略迟到的合成结果、停止试听、保留输入文字；窗口限制到视口高度并允许滚动。新增提示覆盖现有 11 种界面语言。

主要代码：

- [配音窗口](../src/components/video-editor/textToSpeech/TextToSpeechDialog.tsx)
- [生成文件试听](../src/components/video-editor/textToSpeech/SpeechAudioPreview.tsx)
- [编辑器入口与定位](../src/components/video-editor/layout/EditorPreviewPanel.tsx)
- [音轨放置](../src/components/video-editor/timeline/hooks/utils/timelineAudioPlacement.ts)
- [已有音轨操作](../src/components/video-editor/timeline/hooks/actions/useTimelineAudioActions.ts)

## 验证

实际执行：

| 验证 | 结果 |
|---|---|
| `npm test` | **2047 通过、18 跳过**；包含真实 FFmpeg 的现有导入/混音验证。跳过项含原生平台及未安装模型集成测试 |
| 配音、放置及音频相关单元回归 | **66 通过**；新增整段预留音轨的冲突用例 |
| `npm run typecheck`、`npm run build:app` | 通过，包含 Electron main CJS 加载检查 |
| `tests/ui/text-to-speech.spec.ts` | 最终 **11 项全部通过**；包含真实媒体播放、试听与添加只请求合成一次、改文本/声音后重新生成、结尾打开默认零、无效时间不调用合成、变速后用工程秒数放置、截断选择、取消迟到结果、移动/裁剪/拆分、撤销、保存/重开 |
| 原声播放界面回归 | 与构建和全量测试并行的首轮 **2/3 通过**，普通音频场景观察到约 **3.859 秒**的媒体时间差；在其他任务结束后原样隔离复验 **3/3 通过**，没有修改断言。并行批次总计 13/14 通过。此差异不足以定位根因，高负载播放同步仍需后续单独测量 |
| `npm run i18n:check` | 仍有 **36 项既有 `previewQuality` 缺键**；与此前基线逐行集合比较完全一致，没有本批新增缺键，不将此检查记为全通过 |
| 小窗口 | Chromium 1000×720 实际打开配音窗口、试听、修改声音并添加；控件可见，截图已人工查看 |

界面测试使用模拟合成 IPC 加真实 PCM WAV 文件：验证调用内容、次数、实际媒体播放和时间轴行为，不能证明真实 Kokoro 的读音或推理速度。现有离线导出音频处理由全量回归覆盖；没有将浏览器媒体测试声称为用户 Windows 工程的真实 MP4 验收。

日志保存在本次工作环境的 `/tmp/recordly-tts-improvements-*.log`，界面截图为 `/tmp/recordly-tts-improved-dialog.png`；临时证据不提交到仓库。首轮配音界面 8 项已通过，补充重播、取消试听和变速后最终 11 项通过，没有依靠强制点击或放宽同步阈值规避失败。

## 启动

先在启动旧程序的 PowerShell 按 `Ctrl+C`，再运行：

```powershell
& {
    $ErrorActionPreference = "Stop"
    Set-Location "$env:USERPROFILE\RecorderJJCompany-20261024-110640"
    git pull --ff-only origin jsox-preview
    if ($LASTEXITCODE -ne 0) { throw "更新失败，请把报错发我。" }
    npm.cmd run dev
}
```

入口：编辑器预览下方 `Add Layer → Text to speech`。已有离线配音资源继续使用。本次没有新增依赖或下载模型。

## 限制与后续

- Linux 云端无法读取用户的 `C:\Program Files (x86)\iMobie\FocuSee` 或运行其中的 EXE；没有声称检查过这个本机安装包。功能分类仍以用户前面提供的截图及[已有功能矩阵](research/03-feature-comparison-matrix.md)为依据。
- Windows 原生设备、真实 Kokoro 声音质量与速度、用户工程的最终 MP4 仍待实机验证。本批没有改造捕获或另起导出流程。
- 已添加音频仍可移动、裁剪、拆分、保存和撤销；尚未增加从已有音频片段重新打开原文、编辑并替换声音的工程元数据。也没有新增语速或情感模型。
