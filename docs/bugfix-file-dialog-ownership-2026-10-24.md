# 导入与保存文件窗口被录制面板遮挡

日期：2026-10-24（Asia/Singapore）。基线：`codex/recording-launcher` / `1787dca4`。沿用现有 Electron 窗口和录制/导出流程。

## 问题及代码依据

用户截图显示原生 **Import Media or Recordly Project** 窗口被录制面板遮挡。[windows.ts](../electron/windows.ts) 创建 HUD 时使用 `alwaysOnTop` 和 `screen-saver` 层级；原 [captions.ts](../electron/ipc/register/captions.ts) 的导入调用只传入对话框选项，没有传入所属 BrowserWindow。工程打开、保存和录制目录选择也有同样的缺口。原导出保存已有父窗口，但在父窗口不存在时会退回无父窗口弹窗。

对真实注册的 IPC handler 增加所有权断言后，原有 7 个导入/工程入口全部失败，确认调用没有传入发起窗口。这是主进程参数验证，不是 Windows 原生层级的自动复现。

## 修复

新增共享的 [fileDialogs.ts](../electron/ipc/fileDialogs.ts)，根据 `event.sender` 找到实际发起请求的 BrowserWindow，将它传给 Electron 原生文件对话框。覆盖 9 处调用：

- 导入视频/工程、选择音频、选择 Whisper 程序和模型。
- 选择录制目录、打开工程、另存工程。
- 内存导出保存和临时成片最终保存。

多窗口时分别使用各自发起窗口，不依赖全局焦点。若发起窗口已经销毁或无法定位，返回取消，不再创建没有所属窗口的弹窗。

没有额外调用 HUD 的 `show`、`hide`、`focus`、`moveTop` 或修改其置顶层级，避免影响现有 Windows 透明 HUD 鼠标转发。临时成片保留/重试、原子保存、字幕旁文件和录制架构继续复用原实现。

## 验证与限制

- 新增 [fileDialogOwnership.test.ts](../electron/ipc/register/fileDialogOwnership.test.ts) **10 项通过**：7 个入口绑定、多窗口归属，以及父窗口丢失/销毁时取消。断言未主动修改 HUD 层级和焦点。
- 原有导出回归 **6 项通过**，包含真实 FFmpeg MP4 保存/解码、失败后旧成片与完整临时文件保留。
- Chromium **3 项通过**：导入后进入编辑器、取消导入恢复控件并再次选择屏幕、确认来源进入准备栏。文件对话框 IPC 使用显式模拟，不代表操作系统窗口层级验收。
- 全量单元测试 **2011 项通过、18 项跳过**；226 个文件通过、5 个跳过。生产构建及主进程 CJS 加载检查通过。
- 原始会话日志为 `/tmp/recordly-file-dialog-*.log`，不随仓库分发。

当前环境没有 Windows 桌面，无法直接验证用户电脑上的弹窗 Z-order、任务栏及鼠标转发。此项仍需 Windows 实机确认；不能把 mock 断言称为原生窗口已经实测通过。

## 更新和临时操作

旧版中可先最小化录制面板，露出后面的文件窗口完成选择或取消。更新后需重启 Electron 主进程。在原项目目录停止旧开发程序后运行：

```powershell
git pull --ff-only origin jsox-preview
if ($LASTEXITCODE -eq 0) { npm.cmd run dev }
```

本批不增加依赖或下载模型，不需要重新准备 AI 资源。
