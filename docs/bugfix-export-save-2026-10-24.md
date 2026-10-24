# 导出保存与重试缺陷修复

日期：2026-10-24。开始时为 `codex/recording-launcher` / `95f44e2c`，工作区干净。本批按“直接修 bug”的指示修复现有保存链，沿用录制器、Pixi 合成和原有导出器。

## 已复现及修复

| 缺陷 | 修复前实际证据 | 修复及验证 |
|---|---|---|
| 内存保存路径写入失败会截断已有成片 | 两个实际 IPC handler 的故障测试在写入部分字节后抛 ENOSPC，原目标内容由完整旧文件变成 `truncated` | [export.ts](../electron/ipc/register/export.ts) 先将新数据写入目标目录的独立临时文件并 flush，再复用既有替换/回滚流程；失败清理临时文件，旧成片字节保持不变 |
| 已写完临时文件，保存 IPC 抛错后失去再次保存机会 | MP4 拒绝回退到内存并抛出泛化错误；GIF 改走另一次内存保存请求 | [exportPersistence.ts](../src/components/video-editor/export/exportPersistence.ts) 区分写入阶段与最终保存阶段；最终保存异常返回错误与原 pending 文件，不重开保存请求或复制整份 Blob 到内存 |
| GIF 保存失败后清掉导出入口，原生 MP4 保存异常未保留 pending | 调用链明确缺少相应 pending 状态分支；新增 runner 回归用例覆盖 Blob GIF/MP4 和原生 MP4 返回路径 | [useExportRunner.ts](../src/components/video-editor/export/useExportRunner.ts) 统一采用可重试保存操作，保存失败保留成片、错误和 Save Again；不重新编码 |
| 再次保存可并发打开多个窗口；迟到结果可覆盖新任务状态 | 原实现无并发守卫及 pending 身份校验 | [useExportDialogActions.ts](../src/components/video-editor/export/useExportDialogActions.ts) 同时只发起一次重试，捕获 IPC 异常；pending 被替换/关闭后忽略旧结果。实际原因保留，不一律改写为“用户取消” |
| 文件系统不支持 statfs 时，所有保存均被拒绝 | ENOSYS、ENOTSUP、EOPNOTSUPP 三种故障用例在修复前均拒绝可写目录 | [destinationSpace.ts](../electron/ipc/export/destinationSpace.ts) 仅对明确不支持的查询记录警告并继续真实写入；空间不足、权限拒绝和 I/O 错误仍保留失败 |

另外，[useExportSession.ts](../src/components/video-editor/export/useExportSession.ts) 对丢弃临时文件时的异步 IPC 失败做 best-effort 处理，避免未处理的 Promise 拒绝影响界面。

## 实际运行的验证

- 新增 **22 个回归用例**，涉及文件字节保护、临时文件清理、失败重试、字幕载荷保留、并发请求、迟到结果和不支持的空间查询。
- 实际使用 FFmpeg 生成 160×90、0.4 秒 H.264/AAC 合成素材，经 `write-exported-video-to-path` handler 保存；模拟 statfs 不支持时也能写入。保存结果与原素材逐字节相同，原素材不变。
- 用 FFprobe 确认保存结果具有视频/音频轨道及合理时长，用 FFmpeg `-xerror` 完整解码；SRT 和 VTT 内容/时间正确，没有残留 partial 文件。这验证保存完整性，不代替编辑效果的视觉验收。
- `npm test`：**2001 项通过、18 项跳过；225 个测试文件通过、5 个跳过**。
- `npm run build:app`：TypeScript、renderer/main/preload 构建和主进程 CJS 加载检查通过。
- 11 个改动/新增 TypeScript 文件的 Biome 检查及 `git diff --check` 通过。

重点用例位于 [主进程导出测试](../electron/ipc/register/export.test.ts)、[空间检查测试](../electron/ipc/export/destinationSpace.test.ts)、[保存恢复测试](../src/components/video-editor/export/exportPersistence.test.ts)、[再次保存测试](../src/components/video-editor/export/useExportDialogActions.test.ts) 和 [runner 测试](../src/components/video-editor/export/useExportRunner.test.ts)。

原始会话日志存于 `/tmp/recordly-save-*.log`，为临时环境文件，不随仓库分发。Electron IPC、文件系统错误及 runner 编码器替身均为明确的测试边界；FFmpeg 文件生成、文件保存/读取、FFprobe 探测和完整解码实际执行。

## 启动与限制

已有 Node/npm 与项目依赖的开发环境中，在仓库目录运行 `npm run dev`；检查生产代码可运行 `npm run build:app`。本次没有新建录制或导出管线，没有安装/升级依赖或下载模型。

本次环境为 Linux，没有 Windows 桌面、WGC/WASAPI 设备或 Windows GPU 驱动；未生成或运行新的 Windows 安装包。Windows 文件锁/跨卷错误通过注入测试覆盖，实际 Windows 设备与网络挂载行为仍待实机验证。卡顿原因、真实多 DPI、硬件编码、字幕识别质量以及背景/鼠标/摄像头成片一致性仍属于后续验收，本批不宣称这些问题已全部解决。
