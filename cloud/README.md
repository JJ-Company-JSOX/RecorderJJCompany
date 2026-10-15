# Jsox Firebase AI Studio — 后端开发预览

这不是已上线的云端成品。桌面现有 [AI Studio 本地上传准备 UI](../docs/ai-studio-preflight-test.md)，可预览和检查粘贴文字，但尚未接通真实云端上传/任务。现有录屏、编辑、本地 AI 和官网保留；声音克隆不在范围内。主规范：[Master Prompt](../docs/recordly-ai-studio-master-prompt.md)，十项设计：[Firebase 架构](../docs/firebase-ai-studio-architecture.md)，后续阶段：[实施计划](../docs/ai-assisted-mix-plan.md)，[用户准备清单](../docs/jsox-cloud-preparation.md)。

Firebase 项目本地绑定 `d-recorder-ef064`；尚未核实线上 Auth/Firestore/Storage/Functions 是否启用、位置及已有数据。模拟测试只使用 **demo-jsox**，不使用该线上项目。

## 依赖、许可及体积

隔离在 functions/package-lock.json 和 worker/requirements.lock，不修改桌面依赖。不下载大型 ASR 权重；faster-whisper 包内附带约 1.25 MB Silero VAD ONNX 资产，见锁定包。

| 组件 | 用途及许可 | 本次体积/性能证据 |
|---|---|---|
| Firebase Admin、Google Cloud Tasks SDK | Apache-2.0；服务端数据/队列 | npm 元数据：Admin 自身约 1.4 MB unpacked、Tasks 约 12.8 MB；不是完整依赖体积 |
| Firebase Functions SDK / Firebase CLI | MIT；API/部署及本地模拟器 | SDK 自身约 1.5 MB、CLI 约 6.1 MB unpacked；CLI 仅在模拟器命令中按版本临时调用，不进入应用 lockfile，其自身未使用的 Data Connect 工具可能含 pg 依赖，不运行或部署数据库 |
| Firebase Web / Rules testing SDK（仅开发测试） | Apache-2.0 | Firebase Web 包自身约 37.7 MB；不加入 Electron 前端 |
| Node 全部新开发依赖 | 包含 CLI、测试 SDK 和传递依赖 | 当前 Linux 的 Functions/测试依赖安装约 **295 MB**（CLI 已拆为临时开发工具）；其他系统不同 |
| FastAPI / uvicorn / requests / Google Cloud Python SDK | MIT / BSD-3-Clause / Apache-2.0 等，按锁定包核对 | CPU Worker 的 Python venv 本机约 **666 MB**，不含 FFmpeg、基础镜像或模型 |
| OpenCV / PySceneDetect | Apache-2.0 / BSD-3-Clause | 真实 3 秒合成素材的抽帧/分场景已测试，不是 10 分钟低配基准 |
| faster-whisper / CTranslate2 | MIT；CPU int8 转录路径 | 安装库但未下载模型或做真实 ASR；模型体积、许可和语速测试待核实 |
| FFmpeg | 许可证取决于编译选项，libx264 通常要求 GPL 构建相应义务 | 本地测试复用现有 ffmpeg-static；Docker Debian FFmpeg 镜像未构建/核验。分发时核查对应构建和源代码义务 |
| Gemini、Pexels、Pixabay | 商业 API / 内容许可，非下载即获得所有权 | 没发真实请求；价格、可用模型、缓存/留存及素材权利需审核 |

MIT/Apache-2.0/BSD 源码通常可在保留许可/归属等条件下用于 AGPL-3.0 项目；FFmpeg 的具体构建和模型权重单独核验，不作法律认证。不捆绑 Whisper 权重；`local_files_only` 与离线环境防止启动时隐式下载。上游 Whisper/选定 CTranslate2 权重的固定 revision、模型卡、SHA256 和实际体积未核查，不写成已验证。CPU 长视频速度、RAM 和存储峰值需真实 staging 压测。

## 本地 Node 测试

需要 Node.js 22（Functions 运行时目标）；本环境用 Node 24 编译，并另用缓存中的 Node 22 运行全部 17 项领域/服务契约测试；真实 Functions 运行时仍需 staging 确认。Rules Emulator 需要 Java 21+，首次从 Google 下载官方 JAR。

```sh
cd cloud/functions
npm ci
npm test
npm run test:emulators
```

Windows 可在仓库根目录双击 `TEST-FIREBASE-BACKEND.cmd`。没有 firebase login 要求；该脚本不部署，使用 demo project。`npm test` 的服务契约使用内存 transport，并非真实事务验证；单独的 Emulator suite 必须通过。模拟器下载不能访问时要保留失败，不能改成生产项目、绕过 TLS/校验或假装 Rules 测试通过。

## Python CPU Worker 测试

Python 3.12 + FFmpeg/ffprobe：

```sh
python -m venv .venv
# 激活 .venv 后：
pip install -r cloud/worker/requirements.lock
PYTHONPATH=cloud/worker python -m unittest discover -s cloud/worker/tests -v
```

Windows PowerShell 设置环境用 `$env:PYTHONPATH="cloud/worker"`；FFmpeg 不在 PATH 时设置 FFMPEG_BINARY、FFPROBE_BINARY 为真实可执行路径。测试不加载 Whisper 权重、不调用供应商。Job 状态测试的 Firestore transport 为 fake，不能代替真事务或 Rules 验收。Worker 不应带生产凭据直接在公网运行；生产访问由 Cloud Run IAM 强制私有。

## 线上部署前必须完成

1. 确认原有项目、数据及资源位置，不运行覆盖式 init 或自动 migration；cloud/firebase.json 与 website/firebase.json 分开。
2. Auth 登录方式和正式 App Check attestation；本地桌面不启用强制账号。
3. Rules Emulator 全通过、真实 vector index 验证、Bucket 私有/IAM 验证。
4. 选择地区和 Gemini 分析模型；Secret Manager 绑定 API Key。不要把 key 填进 .env.example 或前端。
5. 镜像构建、Whisper 工件审阅与 provision、CPU/RAM 压测；Cloud Run min=0/max=1/concurrency=1/timeout≥1800s，Cloud Tasks 专用 OIDC 账号和 queue 参数。
6. 应用经审阅的 Storage lifecycle / Firestore TTL；Functions reconciler/Scheduler 必须正常工作，不能只上线入队接口。
7. 用户披露、真实敏感信息扫描、供应商缓存和许可政策、报价/实际账单对账；`STOCK_TERMS_REVIEWED=false` 默认阻止素材搜索/渲染。

**没有执行 firebase deploy、gcloud deploy、数据库迁移或真实 API 调用。** 不要把现有 unpriced 成本字段当作免费服务或商业 Credits 账单。

## 本轮测试结果（代码提交前再次核对）

- TypeScript Functions build 与 **17 项测试**通过（11 项领域测试 + 6 项服务契约），Node 24 和 Node 22 都运行。覆盖 pipeline 隔离、拒绝素材不冒充授权、来源校验、事务内权限重读、新分析任务指针、单次取消退款和严格时间线字段。
- Python **16 项测试**通过：含实际 FFmpeg 拼接 MP4、OpenCV 抽帧、PySceneDetect 分场景；另测缓存随 Whisper revision 失效、旧任务不覆盖新分析、取消不发布半成品、严格字段校验。Job 与服务事务采用 fake/in-memory Firestore transport，不能代替真实事务重试、并发和原子性验收。
- 现有桌面 TypeScript 检查通过，本轮未修改录屏、桌面时间线、PixiJS 导出或网站代码。此前 M2a 的页面/导入/生产构建记录仍在 validation.json，未把历史检查冒充本轮重跑。
- Rules/真实 Firestore 事务/Storage emulator suite **未运行成功**：官方 `cloud-firestore-emulator-v1.22.0.jar` 下载被 HTTP 403 拒绝。本轮保留并扩展为 9 项，供有网络权限的电脑运行；语法检查不代表执行通过。
- 真实 Firestore vector queries、Auth/App Check、Google IAM/Cloud Tasks、供应商 API、Whisper 推理、新马真实样本质量与费用均未验证。Docker 镜像尚未构建。

机器可读的本轮检查记录：[validation.json](validation.json)。GitHub Actions 配置会在本分支 cloud 文件变更后运行；尚未读取到运行结果，不能用“已配置 CI”代替“CI 已通过”。
