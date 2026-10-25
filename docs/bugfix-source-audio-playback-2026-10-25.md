# 系统音轨已加载但没有播放：移除无关的音频上下文等待

基线：`318bce34`，`codex/recording-launcher`。延续现有录制器、工程格式、HTMLAudioElement 预览和导出管线，没有新增依赖或模型下载。

## 可复现的问题

`useAudioPreviewSync` 的系统 / 麦克风独立音轨已经直接由 HTMLAudioElement 播放，以保留变速时的音高。旧代码仍建立一套没有连接这些音轨的 AudioContext / gain 节点，并在每次播放独立音轨前等待 `AudioContext.resume()`。

当这个无关上下文一直挂起时，视频仍可正常播放，独立音轨却始终没有执行 `play()`；同时因独立 system 音轨是权威来源，视频内嵌音轨会按既有路由静音，造成编辑器整体无声。

新增 Chromium 回归测试使用真实六秒 PCM WAV、真实媒体元素和真实视频预览，只将 Web Audio 上下文恢复固定为未完成。修复前正常上下文用例通过、挂起上下文用例失败：独立音轨已加载、音量 1、未静音，但始终暂停。这是可复现的软件缺陷；没有用户本机检测输出，仍不能断言其具体录制就是这个原因。

## 修复

- 删除预览里未连接音轨的 AudioContext、gain / media 节点及其恢复等待，独立音轨直接按既有播放 / 暂停、时间映射和倍率规则控制。
- 删除仅用于恢复这个上下文的内部回调和调用链。编辑器原有播放按钮、快捷键及轨道音量继续生效。
- 已播放的音轨不在每个视频帧重复调用 `play()`。
- 实际解码 / 播放拒绝会进入已有音轨错误提示；暂停或切换资源产生的 AbortError 不弹错误。
- 同一音轨资源失败后，不逐帧重复播放请求或堆叠提示。用户暂停再播放可以重试，更新后的资源也可重新尝试。
- 录制、媒体文件、工程和最终导出逻辑没有改变。

## 实际验证

- 修复前：源音轨播放测试 1 通过 / 1 失败，挂起上下文用例明确失败。
- Chromium 回归覆盖：上下文正常 / 挂起时真实音轨的加载、播放、与视频时间差、暂停和音量 0 / 1；真实播放错误只提示一次且不逐帧重试。
- 最终使用独立端口与测试输出目录，9 项界面测试全部通过，包括现有音频偏移 / 淡入淡出实际 PCM 渲染，以及文字配音添加、移动、左裁剪、拆分、撤销、保存重开和取消用例。
- 完整单元测试：2040 通过、18 跳过。最后的错误重试边界另跑 15 项音频测试，全部通过。
- `npm run build:app` 的 TypeScript、Vite 和 Electron main CJS smoke 通过。

原始日志保存在执行环境 `/tmp/recordly-source-audio-before.log`、`/tmp/recordly-source-audio-ui-isolated.log`、`/tmp/recordly-source-audio-unit-final.log`、`/tmp/recordly-source-audio-unit-last.log` 和 `/tmp/recordly-source-audio-build-last.log`。这些临时日志没有加入仓库。

## 实际限制

测试使用明确的声音和 IPC 返回值，没有连接用户 Windows 扬声器、耳机或 WASAPI 设备。它验证媒体播放状态、时间、音量和受控 PCM 合成，不等同于真机听音或整个录制链验收。

如果本机原素材根本未捕获到原声，预览修复不能补出缺失内容。请保留原视频与所有同名 system / mic 音轨；更新后先重新打开原工程播放，需要进一步定位时运行 `node scripts/diagnose-recording-audio.mjs`。检测使用方式及前一轮录制状态修复见[上一份记录](bugfix-recorded-audio-and-text-to-speech-2026-10-25.md)。
