# AI Assisted Mix — Firebase 分阶段实施计划

规范入口：[Master Prompt](recordly-ai-studio-master-prompt.md)。架构、schema、Rules、Storage、Functions、Worker、API、搜索、Mix 与费用的十项交付物集中在 [Firebase 架构](firebase-ai-studio-architecture.md)。本轮是 **M1 后端基础增量**，不把尚未接入 UI 或真实服务验证的代码标为可商用成品。

## 保留的用户流程

Upload → Analyze → Search B-roll → Customer Approval → Editable Timeline → FFmpeg Render → MP4 Export。

现有桌面 Import video 仍是本地导入，不等同于 Cloud Studio Upload。当前不会自动给用户上传视频，不重新强制邮箱登录，不改动 `.recordly` 和 PixiJS 导出。Firebase Authentication 只用于未来可选的云端操作。

## M1 — 本轮实现

- 独立 `cloud/`，复用已有 project ID，不触碰 Hosting 配置或迁移数据。
- TypeScript Functions、Firestore/Storage Rules、复合/向量索引和 TTL/lifecycle/Tasks 配置草案。
- Auth/App Check 服务端入口、工作区权限、限流、每日配额/上传容量、审计与幂等账本。
- 上传 slot、分析/渲染任务、取消、租约、重试、一次性退款、残留任务回收。
- 素材 metadata 搜索适配器、人工审批记录、不可变 timeline version、乐观并发、审批撤销保护。
- Gemini embedding/画面描述适配器、tenant-scoped Firestore vector search、有限 keyword 层与可替换 SearchEngine。
- CPU Worker：FFmpeg/OpenCV/PySceneDetect/faster-whisper 接口、私有对象读取、派生对象写入、简化剪切拼接 MP4。
- 已编写 Emulator suite；本环境官方 Emulator JAR 下载 HTTP 403，故未执行成功。不能宣称 Rules 已通过。

**当前不做生产部署**：没有操作线上 Firebase 服务，没有生成真实供应商调用费用，没有复制 API Key 或下载模型。

## M1 验证完成后才可进入的门槛

1. 在可下载官方 Emulator 的环境运行隔离 Rules/transaction/storage tests，并解决所有失败；不能跳过这个门槛部署 Rules。
2. 用真实测试 Firebase 项目验证 Auth + App Check，包括客户端支持的 attestation；Electron 不能硬编码生产 debug token。
3. 在真实 Firestore 部署索引并测 vector queries；模拟器不算生产向量验收。
4. 核实当前 Bucket、数据库位置及 IAM；原有数据库/用户只读盘点，不自动迁移。
5. 审阅并实现当前 Pexels/Pixabay 的缓存/留存/归属要求；`STOCK_TERMS_REVIEWED` 默认 false。
6. 确认 Gemini 模型、地区/数据使用条款及价格；创建验证过的价格表/对账流程，不能把 unpriced 字段当零成本。
7. 预先核验并 provision faster-whisper 模型工件，记录 SHA256、体积和条款；不在 Worker 启动时下载。

## M2 — 云端前端、敏感信息检查及时间线适配

- 先实现并验证本地敏感信息 preflight：手机号、邮箱、SG NRIC/FIN、MY 身份证号、疑似密钥；有检测结果、误报/漏报说明及逐项确认。
- Cloud Studio 上传/披露：列出原视频到 Google 私有 Storage，抽样图像、转录及 query 到 Gemini，搜索词/预览到素材方；确认字段持久化。服务端 boolean 只记录声明，不能当成已扫描证据。
- Web Studio 可先采用 Firebase Auth + 正式 App Check；桌面可选登录与 attestation 另行验证，保持本地无账号模式。
- 上传状态、可取消分析、场景/转录/视频事件列表、混合关键词/向量结果。
- B-roll 候选显示来源、许可、限制和时间匹配；客户逐项批准后才允许下载。审批不等于自动认定人物肖像、商标和第三方版权都可用。
- AI Mix 只能从工作区视频及已批准素材构造合法片段引用，先展示差异；人工可调整顺序/起止点，保存 `expectedVersion`，冲突不覆盖。
- 明确 Cloud Mix v1 与 `ClipRegion` 的转换契约。未支持的 PixiJS 特效必须阻止云端导出或明确降级，不能静默丢效果；桌面原导出继续可用。
- 超过文档边界的大 timeline externalization、用户删除/Storage 清理/旧 analysis generation 清理与素材缓存遵约。

验收：客户不接受资产时不能下载/导出；被撤销资产不能签发新导出链接；跨租户读/写/搜索都失败；旧版本保存不会覆盖新版本；取消不应用半成品；任何云端调用前完成披露和检查。

## M3 — 私有 CPU 云端 staging 与真实语言样本

仅在用户批准具体部署目标/资源后创建收费服务。优先同一已确认地区，Run min=0/max=1/concurrency=1，Tasks 限并发，低配电脑只负责上传和编辑，不要求 GPU。

授权真实录屏：中文、英语、马来文、三语混说，每类至少 5 段作为 smoke 样本；正式质量门槛需更多不同说话人和场景。报告 ASR WER/CER（中文按字符）、画面 OCR/描述事实错误率、事件漏检、B-roll 建议接受/误匹配率、剪辑误删、字幕/音画同步、10 分钟 CPU 总耗时及实际费用。分语言报告，未测试写“未测试”，不能以平均值掩盖马来文差异。

## M4 — 商业化前加固

费率版本与 Billing 对账、Workspace/Admin UI、成员邀请/撤销、删除与保留、自助退款/失败恢复、配额运营、全链路压测、日志保留/审计、供应商条款复核、区域及大陆访问实测。无需要前不启用常驻 GPU、独立搜索引擎或其他数据库。

## 可验证结果与限制

本轮实际测试记录见 [cloud/README.md](../cloud/README.md)。真实 Gemini/Pexels/Pixabay、Whisper 模型推理、Auth/App Check tokens、生产向量索引、Cloud Run/Tasks/IAM 及真实新马样本都不能被本地合成测试替代。M1 完成后先提交 GitHub，等用户电脑下载再继续。
