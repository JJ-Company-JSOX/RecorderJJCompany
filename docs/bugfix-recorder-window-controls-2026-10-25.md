# Windows 录制设置页置顶与关闭按钮

基线：`ba60b645`，`codex/recording-launcher`。用户报告大型录制设置页压住浏览器等其他应用，右上角 × 也无法关闭。

## 代码证据与修复

原 `createHudOverlayWindow` 为设置页及录制悬浮条共用的窗口始终启用 `alwaysOnTop` / `screen-saver`，Windows 下大小覆盖整个工作区。`applyHudOverlayBounds` 刷新布局时再次 `moveTop()`，鼠标穿透设置也没有区分设置页与悬浮条。

本次仍复用同一个窗口、录制器、工程和导出管线，按现有界面状态调整窗口行为：

- Windows 完整设置页：取消置顶，使用居中的有限窗口范围，强制保持可点击，不依赖透明 HUD 的鼠标移动转发来启用按钮；后台刷新布局不再抬到其他应用前面。宽高使用 DIP，并限制在当前显示器工作区，覆盖负坐标副屏和小工作区。
- 小准备栏 / 正在录制：继续保持原有悬浮、置顶和鼠标穿透。切换原生窗口状态时重新应用捕获保护和鼠标状态，保留 Windows 转发修复。
- 设置页拖动柄使用原生窗口拖动；按钮和下拉框明确排除在拖动区之外。
- × 复用原来的关闭 IPC，新增关闭前取消尚在启动中的录制 / 倒计时，避免先销毁拥有启动任务的渲染器。已有编辑器及其未保存提醒保持原流程；最小化仍走原窗口操作。
- 关闭时清理鼠标状态重置计时器和旧来源选择状态，避免重新打开时继承穿透状态。

界面测试额外复现了通知遮挡问题：原底部右侧提示会盖住准备栏的 ×，鼠标悬停又会延长提示显示，导致关闭按钮一直收不到点击。现在录制窗口的通知放在顶部中央并限制宽度；编辑器通知位置保持原来设置。

## 验证

- 新增针对真实窗口创建 / IPC / 状态切换代码的 BrowserWindow 替身测试。修复前 **3 失败、1 通过**，分别揭示设置页置顶、布局刷新抬升、回到设置页仍穿透的问题；修复后全部通过。该测试验证原生 API 调用参数和状态，不等同于 Windows 桌面 Z-order 实测。
- 窗口几何测试覆盖负坐标副屏和小工作区。既有文件对话框归属测试继续通过，未重新引入无所属窗口的文件对话框。
- Chromium 实际点击验证 × 和最小化、非拖动区域、通知可见时的按钮命中，以及关闭前取消倒计时；没有使用强制点击来绕过遮挡。
- 录制设置、选择来源、准备栏、倒计时取消、启动时释放麦克风 / 鼠标资源等 **15 项界面回归通过**；最后单独重跑的 **2 项通过**，包含 1440、860、560 宽度视口下通知显示时 × / 最小化按钮的实际命中检查。
- 完整单元测试 **2046 通过、18 跳过**。后续状态清理和延迟鼠标修复另跑 **30 项相关窗口与文件对话框测试，全部通过**。
- `npm run build:app` 的 TypeScript、Vite 和 Electron main CJS smoke 通过。

原始日志：`/tmp/recordly-window-controls-before.log`、`/tmp/recordly-window-controls-unit.log`、`/tmp/recordly-window-controls-unit-last.log`、`/tmp/recordly-window-controls-ui-final.log`、`/tmp/recordly-window-controls-ui-last.log`、`/tmp/recordly-window-controls-build-last.log`，未加入仓库。

## 环境限制与启动

当前是 Linux 环境，没有可运行的 Windows 桌面，未直接验证用户电脑的窗口层级、真实鼠标转发或原生拖动。不能将 BrowserWindow 替身、浏览器命中测试写成 Windows 真机验收。

需要停止旧 Electron 主进程并重新启动；仅刷新渲染页面无法替换旧窗口的原生设置。已有开发项目中，先在启动软件的 PowerShell 按 Ctrl+C，再执行：

```powershell
git pull --ff-only origin jsox-preview
if ($LASTEXITCODE -eq 0) { npm.cmd run dev }
```

本次不增加依赖、安装程序或模型下载。
