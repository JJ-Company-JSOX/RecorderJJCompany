# Windows 本地测试包

本地测试包使用当前安装的 Electron 和预编译 Windows x64 helpers，不执行 C++/CUDA 编译、不下载 Whisper 模型、不生成安装器、不签名、不发布。

首次准备缺少的 helper/runtime，可从另一个相同版本的源码副本复用：

```powershell
npm run prepare:win:test -- --helpers-from "C:\path\to\checkout\electron\native\bin\win32-x64" --helpers-only
```

脚本验证四个 helper 的二进制 SHA-256、PE 架构和源码指纹。二进制校验失败会中止；随附 manifest 的源码指纹陈旧时会明确警告，因此不能将该测试包视为 native 源码重建验证。Whisper CLI 和必需 DLL 仅复用本机现有文件，未附带模型。

构建最新 TypeScript/renderer/Electron bundle 并打包：

```powershell
npm run build:win:test
```

若 `dist` 和 `dist-electron` 已经是待测试版本，仅打包现有产物：

```powershell
npm run package:win:test
```

这两个命令均使用 `--publish never`。测试配置复用 `node_modules/electron/dist`，关闭 native 重建和签名资源下载；所需依赖或二进制不存在时会中止。普通构建中的 GitHub 发布配置指向 `JJ-Company-JSOX/RecorderJJCompany`。

输出为 `release\win-unpacked`。保留整个目录，双击其中的 `Start-Jsox-Test.cmd`；启动无需 Node.js、Vite、编译器或开发服务器。启动器禁用自动更新，并把测试设置、录制及缓存隔离在 `%APPDATA%\Jsox-test`，不迁移现有 `.recordly` 项目或录制文件。需要原项目时在测试应用中自行打开。

应用未签名，Windows 可能提示未知发布者；此包仅供测试。请勿只复制 `Recordly.exe`。打包 smoke 检查仅确认应用、FFmpeg 和 helpers 可定位；录制、声音、预览流畅度、保存和导出仍需运行验证，打包成功不代表性能已改善。
