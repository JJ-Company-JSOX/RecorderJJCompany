# Canvid 本机只读评估（2026-10-17）

范围：只读检查本机 `AppData/Local/Programs/Canvid` 的安装包和现有日志，作为 Jsox 的独立实现参考。没有运行 Canvid、修改安装文件、访问其云端编辑器，也没有把 Canvid 代码、二进制、模型、光标图片或其他素材加入本项目。下列静态事实不代表已测量 Canvid 的运行性能。

## 身份、文件与日志

- `Canvid.exe` 的 FileVersion 为 **3.2.0**，ProductVersion 为 `3.2.0.0`；ASAR 根 `package.json` 也为 `canvid@3.2.0`，厂商是 VideoCom.com Inc.。
- 安装根的 `version` 和 `pull-metadata.json` 标记 `43.7.0` / `v43.7.0`。这是另一个发布标记，不能覆盖上述应用版本证据。
- 主包 `resources/app.asar` 为 37,919,761 字节，SHA-256：`79d501f4328908ebe3b93556b62c013be0bab9447f08ee1d3099b8d55136ecd0`。包含 Electron main/preload；原生模块在 `resources/app.asar.unpacked`，FFmpeg 和其他运行库在 `resources/binaries/win`。
- 本机现有日志在 `%LOCALAPPDATA%/Canvid/logs`，检查时有 `2026-10-13.log` 与 `2026-10-16.log`。用户配置、项目和缓存也在 `%LOCALAPPDATA%/Canvid`。没有读取 `auth.json` 或项目媒体。`%APPDATA%/Canvid` 检查时为空。
- 主进程配置了远程 renderer 地址 `https://next-v3.canvid.com`；2026-10-16 日志记录该地址加载失败，错误为 `ERR_NETWORK_CHANGED`。本地包的 renderer 目录只有浏览器扩展及开发脚本，没有完整编辑器资源。因此编辑器视频合成、鼠标平滑、代理视频和 UI 按需加载策略仍未知。

## 可作为设计参考的静态事实

| 观察 | 本地证据位置（ASAR 内路径，字符偏移） | 可独立用于 Jsox 的方向 |
| --- | --- | --- |
| Windows 原生捕获与 Electron shared texture 接口相接；preload 将 VideoFrame 通过 MessagePort 转移，未使用帧时关闭它，并释放 imported texture | `packages/main/dist/index.cjs` 61672–63500；`packages/preload/dist/index.cjs` 13453–13900 | 优先复用 Jsox 已有原生捕获路径，减少整帧 CPU 拷贝；在每个成功、失败、取消路径明确归还帧/纹理。是否需要新增 shared texture 方案须由现有瓶颈决定。 |
| 捕获可按目标帧率保留有限 candidate；被替换/丢弃的原生帧释放资源；停止时清除 candidate | main 62182–62950、64918 附近 | 视频队列设置硬上限，背压时淘汰旧预览帧，避免积累延迟与内存。不得据此降低最终导出帧率。 |
| native mouse move 事件最大频率设置为 60 Hz；cursor 图像/元数据相同则跳过重复持久化；停止光标记录时清 timer 并停止鼠标/键盘 hook | main 23448–24500、25194–25600、27696–28100 | 鼠标采集、插值与绘制解耦；控制事件频率、缓存形状纹理；页面/录制退出时取消订阅、计时器和 hook。不要把每次鼠标移动转换成 React 整页更新。 |
| 包含独立的转写和模型解压 worker；系统音频对象在窗口关闭时 dispose；preload 为媒体 CLI 子进程管理取消与超时 | main 55193、84107 附近；独立 `*-worker.cjs` 文件；preload 11312–13400 | 重任务在用户进入相应功能后启动；退出/取消时终止本项目自己创建的任务。保留本地免登录，不因本评估启用 AI、下载模型或新增后台常驻服务。 |
| 包含打包好的原生模块、媒体工具和 preload/main 产物 | 安装清单 | Jsox 测试包应预先构建所需产物，启动不依赖 Vite/现场编译。只使用 Jsox 自己构建或已明确许可的依赖。 |

上述有界队列、帧释放、节流和 worker 分工是可自行设计的常见方法；不能将它们描述为已验证的 Canvid 编辑器性能优势。低分辨率预览是本项目可评估的方案，本地证据不能证明 Canvid 已采用它。预览分辨率与导出设置须各自保存、各自测试，导出继续采用用户选择的画质和原始媒体。

## 许可证与分析限制

ASAR 根清单标记 `private: true`，没有 `license` 字段；本次限定清单没有找到 Canvid 自身的许可证/EULA。安装目录的 `LICENSE.electron.txt` 与 `LICENSES.chromium.html` 是第三方许可文件，不能据此把 Canvid 的实现或素材当作已获移植授权。这里仅记录设计事实，未迁移实现。

REA 6.4.0 对原 ASAR 的首次分析因 unpacked `DeepFilterNet/build/Release/avutil-57.dll` 与归档所声明 SHA-256 不同而停止。已保存该诊断，随后以工具支持的 `record-and-continue` 开始只读分析；该模式不证明安装包可信，也没有修复或替换 DLL。全包扫描会解析 3,773 个源文件，多数是第三方依赖；为避免持续干扰本机性能基准，已取消该全量扫描，未取得全包完整分析结论。

改为把原包的 `package.json`、main 和 preload 共 3 个成员逐字节复制到忽略的诊断目录，仅供离线分析；`analysis-target-manifest.json` 保留每个成员的 SHA-256，未更改原包。局部 REA Evidence：`ev_6df0a3b6fe581d0f03bda5972af0b5527eb42bbaec058ad8a4a9c744382cf4a1`，覆盖 196,063 字节、2 个 JavaScript 文件，语法解析失败 0，发现 596 项静态事实；置信类别为 derived，graph coverage 为 incomplete。缺失的依赖、动态路径/IPC、native 导出和实际运行行为未被验证，工具未发现某项关系不等于关系不存在。

重点清单/字符偏移来自本机 ASAR 的直接解析，历史错误来自已有日志；二者与 REA 推导结果分别保留，没有把字符串出现当作运行观测。本地材料保存在已被 Git 忽略的 `.tmp/canvid/`：`inventory.json`、`feature-inventory.json`、`focused-static-observations.jsonl`、`focused-media-observations.json`、`integrity-mismatch.json`、`focused-application-evidence.json` 和 `focused-summary.json`。这些材料、诊断副本和任何用户数据均不加入提交。
