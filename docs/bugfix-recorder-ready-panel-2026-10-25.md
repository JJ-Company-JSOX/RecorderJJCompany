# 录制准备面板：返回、可读性与启动等待

日期：2026-10-25；基线 `4a030e9e`。沿用现有捕获与导出架构。

## 实际改动

- 准备面板增加明确的 **Back / 返回**。先调用现有 `cancelRecordingStart()`，等待倒计时/原生预热/设备清理完成，再返回设置；已选来源和设备保留。录制已经开始时不切换回设置。
- 使用宽度最多 800 DIP 的实色深色面板，分开显示来源、设备状态及开始操作。显示 On/Off，开启状态有颜色和按下语义；关闭/隐藏按钮至少 44×44，保留键盘焦点样式。窄屏自动换行。
- 设置页与准备页直接切换，去掉两层布局插值及串行退出/进入动画，减少来源确认后的额外视觉等待。实际捕获计时和开始顺序仍由原 hook 控制。
- 非鼠标穿透窗口为准备面板预留 320 DIP 高度，录制后的紧凑控制条继续使用 160 DIP；边界受工作区限制。
- 普通窗口来源确认原先会先执行 `bringSelectedWindowForward()`，Windows 为此启动 PowerShell / Add-Type 并等待 250 ms；开始录制时又执行相同唤起。现在确认阶段只验证、保存并广播选择，录制边界仍保留原有目标唤起。Windows 确认使用严格、零缩略图的最新来源列表，拒绝失效/改名/错误显示器来源，避免扩大捕获范围。
- 麦克风与摄像头共享正在进行的设备查询，设备热插拔使旧请求失效；修改已选麦克风只更新选择，不重复查询硬件。丢弃开发 StrictMode 已撤销挂载的尚未开始查询。查询失败后可重试，过期结果不覆盖新设备。

代码：[准备面板](../src/components/launch/RecordingReadyBar.tsx)、[返回与切换](../src/components/launch/LaunchWindow.tsx)、[窗口边界](../electron/hudOverlayBounds.ts)、[来源确认](../electron/ipc/register/sources.ts)、[共享设备查询](../src/hooks/mediaDeviceEnumeration.ts)。

## 验证与性能边界

- 当前合并工作区全量单元测试 **2073 通过、18 跳过**；生产构建、TypeScript、主进程 CJS 加载通过。结果包含本批同时开发的 [Ollama 模式](feature-local-ai-modes-2026-10-25.md)。
- Chromium 录制设置 13 项、窗口控制 2 项、设备查询 2 项，合计 **17 项通过**。包含倒计时中返回/关闭、保留设置、来源失败重试、点击与命中测试、热插拔和慢旧请求。准备面板测试覆盖 1440 宽以及 860/560/420×320 视口；截图已人工查看。
- 设备界面实测：当前麦克风与摄像头初始化共 **1 次**查询；选择另一个麦克风仍为 1 次；热插拔后共 2 次。它证明避免重复查询，没有将此换算成未经测量的全应用提速百分比。
- 单元回归让前台唤起 helper 永不完成，确认来源仍能完成；来源身份检查与录制中拒绝更换继续通过。没有在 Linux 执行 Windows PowerShell 或实际 WGC 录制，不声明真实 Windows 节省了固定总时长。
- 首轮设备浏览器测试暴露 StrictMode 撤销挂载仍启动查询，随后修复并原样通过；没有将期望查询次数放宽为 2。
- `i18n:check` 仍有此前已记录的 36 项 `previewQuality` 缺键，本批无新增缺键。

证据：`/tmp/recordly-ready-ollama-unit-final.log`、`/tmp/recordly-ready-ollama-build-last.log`、`/tmp/recordly-ready-ollama-ui-final.log`、`/tmp/recordly-ready-panel.png`。临时日志/图片不提交。

Windows 原生窗口层级、DPI、设备/驱动和真实启动耗时仍待实机验证。高分辨率预览卡顿不等于来源选择慢；代理媒体缓存、实际编码/解码和掉帧基准继续列为后续工作。使用项目原启动方式 `npm.cmd run dev`，先关闭旧主进程后再更新重启。
