# Recordly AI Studio — Firebase Master Prompt（Jsox Recorder fork）

本文件是用户本轮 Firebase 架构更新的规范入口。对外产品名仍为 **Jsox Recorder**，保留 Recordly / OpenScreen 来源及 AGPL-3.0。它取代旧评估文档中第一版使用 SQL 数据库、独立向量数据库或必需 GPU 的设想；不重写现有桌面录制、PixiJS 编辑器或导出管线。

你是负责 Electron、React/TypeScript、Firebase、Python CPU 音视频 Worker 和产品交互的工程师。开始前检查仓库与真实配置，不臆测功能缺失。默认复用 Firebase 项目 `d-recorder-ef064`，但必须先确认实际数据库位置、私有 Bucket、已启用服务及权限；本地 `.firebaserc` 不能证明云端资源已创建。不得自动迁移既有用户或项目数据。

## 固定架构

- Firebase Authentication、Cloud Firestore、Cloud Storage for Firebase、Cloud Functions for Firebase、Firebase App Check。
- Cloud Tasks 负责可靠异步调度；私有 Cloud Run **CPU** Worker 负责 FFmpeg、OpenCV、PySceneDetect、faster-whisper 和外部 AI/素材 API 调用。
- Gemini API 提供画面描述及文本 embedding；Pexels/Pixabay 只搜索元数据，在客户批准后才下载素材。
- 第一版使用 Firestore 原生 vector search；不引入 PostgreSQL 或 pgvector。不把 Firestore 关键词层描述成 Elasticsearch 等价全文检索。
- 无必需 GPU、Ollama 云服务、声音克隆、支付或订阅上线；本地 Ollama 测试功能保留独立。

## 数据及状态

建立用户、工作区、成员、视频、场景、转录分段、视频事件、视频向量、AI Mix 项目、B-roll 建议、素材审批、时间线版本、导出任务、AI 用量和审计集合。文档路径和字段以 [Firebase 架构](firebase-ai-studio-architecture.md) 为准。

所有业务对象按工作区分区，服务端根据认证身份检查成员关系，不能信任请求里的 uid 或角色。时间线采用不可变版本及 expectedVersion 乐观并发控制；大时间线使用版本清单和私有 Storage 对象，不能塞进单个接近 1 MiB 的文档。当前后端只接收有明确大小限制的小版本，不伪称大型时间线外置已实现。

队列和用户操作使用绑定工作区、用户、操作、请求 ID 的幂等键；同一个键不得重复预扣或创建第二个处理任务。任务有租约、取消、超时、重试上限、一次性退款和过期回收。配额单位不是已经收费的商业 Credits；实际金额未知时记录 null/unpriced，不能编造费用。

在已有集合中仅处理明确属于 `cpu-mix-v1` 且路径/工作区相符的任务；忽略或拒绝其他 pipeline。每个视频的新分析任务成为当前任务，旧请求重放不得覆盖其指针；每个尝试写独立 generation，结果发布与成功结算在同一事务完成。复用 key 必须包含 Whisper 模型 revision；不能用换了权重的旧缓存宣称已重新分析。

## 固定用户流程

**Upload → Analyze → Search B-roll → Customer Approval → Editable Timeline → FFmpeg Render → MP4 Export**

上传仅在用户选择云端处理后执行。明确原视频进入私有 Google Cloud Storage、哪些抽样图像/转录/查询词交给 Gemini、哪些关键词交给素材供应商；上传前完成本地敏感信息检查与用户确认。不得把布尔确认字段等同于已经实现敏感信息扫描。

素材审批和编辑项目状态必须存入 Firestore；仅通过客户审批、具有可追溯来源和适用使用权的素材才能渲染。保存时间线、排队、下载素材、导出完成和签发下载 URL 时重新核对授权。模型输出永远是可编辑建议，不能绕过审批写入最终导出。

拒绝/撤销素材不需要声明已取得使用权，记录真实的否定决定。简化 CPU timeline 不能静默丢弃桌面效果：遇到缩放、变速、额外音轨或未知字段时明确拒绝，直到提供经过验证的映射/渲染支持。

## 安全

- Firestore/Storage Rules 默认拒绝写入；状态变更由具备 Auth + App Check 的服务端 API 执行。
- 云端只读/编辑权限分离，禁止跨工作区向量查询，禁止客户端写审批、账本、租约和向量。
- API Key 只在 Secret Manager/服务端绑定，不放进 Electron、网页、Firestore 可读文档、下载 URL 或日志。
- Cloud Run 不允许匿名调用，Cloud Tasks 使用专用服务账号 OIDC；应用内校验任务与工作区。App Check 不是用户授权的替代品。
- 原视频及产物不公开；上传使用服务器签发的受限短时 V4 PUT URL，客户端不能直接写 Bucket；导出使用短时 V4 签名 URL，不生成永久 Firebase download token。已签发链接在到期前可能仍有效，不能承诺瞬时撤销。
- Electron 的 App Check 生产凭据不能靠前端静态密钥或生产 debug token。先验证适合客户端的 attestation 或承载于正式 Web Studio；当前不重新开启本地强制邮箱登录。

## 成本与维护

复用分析结果和查询 embedding；避免全库监听；限制查询数量、分段、写入批量、视频大小和时长。只下载已批准素材；缓存遵守供应商条款。临时本地文件随任务清除，派生产物使用可审阅的生命周期策略，原片删除由独立保留政策控制。记录用户、Job、Provider/模型、字符/Token/时长/调用数和价格版本；金额未核实就保持未知。

大型依赖/模型下载前说明体积、许可和性能证据；不自动拉取模型。中文、英语、马来文和混说用真实授权样本验收并报告 WER/CER/建议错误率，未测试不能写“可用”。

## 交付与验证

先更新十项设计交付物，再小步实现，保留现有功能。每步区分“代码已写”“单元/合成媒体通过”“模拟器通过”“真实云端通过”。不得跳过权限或关闭断言来凑通过。第一增量与未完成项见 [AI Assisted Mix 实施计划](ai-assisted-mix-plan.md)。用户要求先放 GitHub，不自动部署收费资源。
