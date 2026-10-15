# Jsox 云端准备清单

当前不需要购买 GPU，不需要把密码或 API Key 发到聊天。现有 Firebase 项目 ID 已知：**d-recorder-ef064**。没有部署新收费资源、迁移数据或调用真实 AI API。

## 现在你可以准备

1. **测试电脑**：Windows + Node.js 22；解压源码后运行 `START-DESKTOP.cmd`。本地 AI Studio 准备页面不要求 Firebase、邮箱或 Gemini Key。若脚本失败，提供错误文字即可，不发账号密码。
2. **真实且获授权的短视频**：中文、English、Bahasa Melayu、三语混说各至少 5 段（建议 30–60 秒）；另附正确逐字稿和希望保留/删减的片段。优先用虚构账号和测试资料。先留在你电脑，等上传披露与安全验证完成；不要把客户机密发给第三方。
3. **Firebase 状态**：在现有项目控制台查看是否已启用 Authentication、Firestore、Storage、App Check，以及数据库和存储地区、当前套餐。可提供状态/地区的截图，遮掉个人资料，不需要私钥。不要新建重复数据库，不要启用公开测试 Rules。
4. **Gemini API 账号**：可打开 [Google AI Studio](https://aistudio.google.com/) 了解可用模型与配额，暂时不需要开通付费。API Key 将来只放 Google Secret Manager，不能放 Electron、网站、GitHub 或聊天。

账号登录只用于之后可选的 Cloud Studio；现有桌面本地录屏和剪辑继续无账号使用。界面马来文需要当地使用者复核；真实语音质量需单独测 WER/CER，不能由界面文案替代。

## 部署前一起确认

- Firebase 后端这条路径通常需要 **Blaze + 关联 Cloud Billing**，即使请求量落在免费配额。届时确认你能接受的月预算，再决定是否开通。预算提醒不是硬停费开关。
- 确认实际数据位置后选 Functions/Run 地区；`asia-southeast1` 只是代码样例，不能擅自移动既有数据。先只读盘点现有资源和规则。
- 先跑通安全 Rules/事务测试，采用独立测试工作区或确认过的 staging 项目。不能用生产数据绕过 Emulator 检查。
- 云端先用 CPU，建议测试起点 4 vCPU / 8 GiB、min instances 0 / max 1、并发 1；**这是待压测配置，不是已验证最低要求或性能保证**。设队列限流、每日任务额度与存储清理。
- 选择可用的 Gemini 模型、明确免费/付费数据处理条款与配额，再显示实际报价。免费配额不代表整个视频流程免费；Storage、外网下载、Functions、Run、Tasks 都需单独核实。
- 正式 App Check 与浏览器来源、登录方式、IAM、私有 bucket、签名上传 CORS 均需真实验收。Electron attestation 尚未解决，不放生产 debug token。
- Pexels/Pixabay 可后加；服务通常可申请免费 API 配额，但内容许可、人物/商标权、速率与留存限制需核验，当前开关仍关闭。Whisper 选定权重的来源、体积、许可和 SHA256 必须先确认。

到需要配置时，开发者先给出具体资源清单和可审阅设置，再由你在自己的安全环境里输入密钥。没有必要先购买六个语音模型或 GPU 服务。声音克隆继续暂不做。

## 官方参考（以当时控制台和条款为准）

- [Gemini API 价格与免费额度](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API 服务条款](https://ai.google.dev/gemini-api/terms)
- [Firebase 套餐](https://firebase.google.com/pricing)
- [Cloud Run 价格](https://cloud.google.com/run/pricing)
- [Firebase 预算提醒](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills)
- [Pexels API](https://www.pexels.com/api/)、[Pixabay API](https://pixabay.com/api/docs/)

本清单没有引用未经核实的现价、免费限额或推理速度；当前 Google 官方下载在本开发环境有访问限制，真实服务状态和条款需要上线前核实。
