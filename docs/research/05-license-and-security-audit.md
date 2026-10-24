# 05 — 开源许可与安全审计

日期：2026-10-24。审计是源码/清单/registry advisory检查，不是法律合规认证或完整渗透测试。未复制外部源码、未运行第三方代码。当前工程为AGPL-3.0主文，原有品牌/署名文字需保留并在分发前核验；不能把LICENSE的简短summary扩张解释成任何内部改动都必须向全世界公开。

## 许可兼容决策

| 许可证 | 对AGPL-3.0工程的判断 | 学习 / 复制 / 链接 / 打包义务 |
|---|---|---|
| MIT、BSD-2-Clause/3-Clause | 通常可纳入，非无条件 | 保留版权、许可、免责声明，第三方notice随二进制分发；BSD-4-Clause不能混同 |
| Apache-2.0 | 通常可与GPLv3/AGPLv3组合 | 保留NOTICE/修改标记/版权与专利条款，模型和代码分别核实 |
| GPL-2.0-only | 不能直接假设与AGPLv3组合兼容 | vokoscreenNG所读文件明确v2，当前拒绝复制进组合；独立进程是否可分离须按实际分发/耦合评估 |
| GPL-2.0-or-later | 可按允许选v3再审组合 | 必须核验具体文件/例外，不能根据根GitHub的GPL-2.0标签做决定 |
| GPL-3.0 / AGPL-3.0 | 相应v3组合通常可行，义务保留 | GPLv3 §13与AGPLv3 §13相关；保留源代码提供、安装信息等适用义务，网络使用按适用条款向相关用户提供修改源码 |
| LGPL-2.1/3.0 | 取决链接方式和具体版本 | 不只放一个license；静态链接通常需可重链接材料/对象等，动态链接也有notice/库源码要求 |
| MPL-2.0 | 文件级copyleft；secondary license/Excluded Source Code影响组合 | 核验文件头、Exhibit B和secondary license资格，不一概称可闭源或可任意合并 |
| MS-PL | 不视为GPL/AGPL组合兼容许可 | ScreenToGif优先仅学动作历史/UX设计，不直接复制或链接其源文件；需要独立兼容评估 |
| Unlicense | 代码层通常可复用 | wcap/auto-editor仍依赖Windows SDK或FFmpeg/codec等；无许可证义务不等于无专利/再分发约束 |
| 自定义 / NOASSERTION | 必须读取正文、逐组件分析 | Remotion有组织规模与派生销售限制，不能标成MIT；本轮拒绝直接整合 |
| README/package.json声称MIT但无正文 | Unverified，不复制 | Reframe/Focra/Mimo需许可证正文和权利链，不使用徽章代替授权 |

**重要：** 学设计/抽象算法不等于可逐行翻译代码；修改和复制仍受原许可约束。CLI、sidecar、子进程不是自动豁免，打包再分发的程序、库、voice、模型和素材都要逐项履约。

### 仓库中的实际许可例外

- Cap根LICENSE：cap-camera*/scap-*家族MIT，其余AGPLv3，第三方保留各自许可；不整体叫MIT。
- Better Shot根为BSD-3-Clause，但明确Cap 3D adaptations为AGPL-3.0-only；不把3D代码视为BSD。
- ScreenToGif根MS-PL，不是MIT。
- ShareX根GPLv3；所读新录制文件region标题GPL v3但正文说v2-or-later。保守按文件正文/选择v3及权利链审，不直接统一改license头。
- Kdenlive所读timelinemodel.cpp为`GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL`；Shotcut所读文件GPL-3.0-or-later。
- upstream Recordly根除AGPL正文还有名称、署名文字，保留源代码历史/现有署名，不改成自有独占代码。
- Qwen、Whisper、Kokoro/Piper/sherpa voice的代码/权重/语料声明不能互相代替；现有lock中的revision、SHA、license需进入实际Windows制品核验。

具体固定commit LICENSE和源码链接见[02](02-open-source-repository-catalog.md)、[04](04-source-code-analysis.md)。本轮未审查每一传递依赖、字体、图标及codec专利；发布前仍需要SBOM与实际安装包notice检查。

## 本轮实际依赖安全检查

运行 `NODE_USE_ENV_PROXY=1 npm audit --package-lock-only --json --cache /workspace/.npm-cache`，读取现有lock，**未安装依赖、未改lock、未运行audit fix**。registry返回：**32个受影响包条目（2 critical、25 high、4 moderate、1 low）**，包含传递/meta vulnerabilities，不等于32个独立可利用漏洞，也不是本产品已被攻破。

运行路径是否可达需逐项判定。Electron虽写在devDependencies中，仍是桌面包运行时；Vitest/tinypool通常是开发/CI工具，不能因此把它们的critical直接说成用户安装版存在同等远程RCE。

| 包 | lock版本 | audit严重度 | 范围与修复代价 |
|---|---|---|---|
| electron | 43.1.0 | high | 有修复版本提示；必须验证native ABI/构建/更新兼容 |
| electron-updater | 6.8.3 | high | 有修复版本提示；必须验证native ABI/构建/更新兼容 |
| electron-builder | 26.7.0 | high | 有修复版本提示；必须验证native ABI/构建/更新兼容 |
| postcss | 8.5.16 | high | 有修复版本提示；必须验证native ABI/构建/更新兼容 |
| vite | 5.4.21 | high | registry建议涉及主版本升级；不能直接audit fix --force |
| vitest | 3.2.7 | critical | registry建议涉及主版本升级；不能直接audit fix --force |
| tinypool | 1.1.1 | critical | registry建议涉及主版本升级；不能直接audit fix --force |

实际registry advisory依据（本轮没有重现攻击）：
- electron: [Electron: Windows opened from a sandboxed top-level document do not inherit its sandbox restrictions](https://github.com/advisories/GHSA-gr2m-v5gq-v685)，registry影响范围 `>=43.0.0-alpha.1 <43.4.1`。
- electron: [Electron: File and HTTP protocol handlers allow cross-origin reads without corsEnabled](https://github.com/advisories/GHSA-j84w-jfhq-vhvj)，registry影响范围 `>=43.0.0-alpha.1 <43.4.1`。
- electron: [Electron: Sandboxed preload code cache can be poisoned by a compromised renderer](https://github.com/advisories/GHSA-qmv3-fv6v-rmhq)，registry影响范围 `>=43.0.0-beta.1 <43.5.0`。
- electron: [Electron: <webview> can enable Node.js integration in Web Workers despite embedder restrictions](https://github.com/advisories/GHSA-9qh4-3jw8-366w)，registry影响范围 `>=43.0.0-alpha.1 <43.4.1`。
- electron: [Electron: HID and USB permission checks can be attributed to the wrong origin](https://github.com/advisories/GHSA-fw47-9c62-h3vw)，registry影响范围 `>=43.0.0-alpha.1 <43.7.0`。
- electron: [Electron: SameSite cookie restrictions are not applied to windows opened from links](https://github.com/advisories/GHSA-2p8c-gr87-2676)，registry影响范围 `>=43.0.0-alpha.1 <43.7.0`。
- electron: [Electron: Pointer lock permission requests can be attributed to the wrong frame](https://github.com/advisories/GHSA-x562-297c-g43g)，registry影响范围 `>=43.0.0-alpha.1 <43.7.6`。
- electron: [Electron: Extension tabs.query returns tab URLs and titles without the tabs permission](https://github.com/advisories/GHSA-98mx-cjp9-gchm)，registry影响范围 `>=43.0.0-alpha.1 <43.5.1`。
- electron: [Electron: Frame subscription trusts GPU-supplied frame geometry](https://github.com/advisories/GHSA-3qxv-5xgr-q7w9)，registry影响范围 `>=43.0.0-alpha.1 <43.7.3`。
- electron: [Electron: Off-screen rendering on macOS trusts GPU-supplied frame geometry](https://github.com/advisories/GHSA-h3v5-h239-pg29)，registry影响范围 `>=43.0.0-alpha.1 <43.7.3`。
- electron: [Electron: openExternal permission requests can be attributed to the wrong origin](https://github.com/advisories/GHSA-997q-gvvc-jwmx)，registry影响范围 `>=43.0.0-alpha.1 <43.7.0`。
- electron: [Electron: Mitigation for compromised eMudhra intermediate certificates](https://github.com/advisories/GHSA-jr5w-w6x2-84p9)，registry影响范围 `>=43.0.0-alpha.1 <43.8.1`。
- postcss: [PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp)，registry影响范围 `<=8.5.22`。
- postcss: [PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure](https://github.com/advisories/GHSA-r28c-9q8g-f849)，registry影响范围 `<=8.5.17`。
- vite: [Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)，registry影响范围 `<=6.4.1`。
- vite: [launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)，registry影响范围 `<=6.4.2`。
- vite: [vite: `server.fs.deny` bypass on Windows alternate paths](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)，registry影响范围 `<=6.4.2`。
- vite: [launch-editor: escapeCmdArgs() omits % escaping on Windows](https://github.com/advisories/GHSA-698v-4r3x-3vcv)，registry影响范围 `<=6.4.3`。
- vite: [launch-editor: Editor CLI flag misinterpretation causing arbitrary command execution for some editors](https://github.com/advisories/GHSA-r825-w8mm-5pxw)，registry影响范围 `<=6.4.3`。
- vite: [launch-editor: `fs.existsSync()` existence check can be bypassed on Windows](https://github.com/advisories/GHSA-587h-7wmj-h5pm)，registry影响范围 `<=6.4.3`。
- vite: [Vite: Cross origin script execution through Vite custom middleware](https://github.com/advisories/GHSA-9jrq-w75r-8gcw)，registry影响范围 `<=6.4.3`。
- vite: [Vite: Files outside `server.fs.allow` could be served when project paths match system paths on non-Windows machine](https://github.com/advisories/GHSA-rq7h-c2jc-7f22)，registry影响范围 `<=6.4.3`。
- vitest: [Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)，registry影响范围 `>=2.1.0 <4.1.11`。
- tinypool: [Tinypool: Prototype Pollution gadget in worker options leads to Remote Code Execution](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)，registry影响范围 `<=2.1.0`。
- tinypool: [Tinypool: Prototype Pollution Gadget to RCE in run() options](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)，registry影响范围 `<2.1.2`。

原始audit JSON在临时研究目录。后续P0需要按生产/开发可达性分批升级并重跑native helpers/干净Windows包，不能用“当前所有单元通过”免除依赖漏洞，也不应在这轮研究里未经评测强制升级Vite/Vitest大版本。

## 实际源码安全边界

| 编号 | 依据 | 已有保护 | 尚需工作 / 结论 |
|---|---|---|---|
| A-01 工程未来版本 | projectPersistence `validateProjectData`、manager `isLoadableProjectData` 原来只检查number | 本轮共享version守卫已补；拒绝发生在媒体授权/会话切换前；字节保留回归通过 | 已修复；仍需完整迁移策略，不自动迁移旧数据 |
| S-01 HUD跨源边界 | electron/windows.ts HUD `webSecurity:false` | nodeIntegration:false、contextIsolation:true，主进程导航策略 | 复核本地媒体协议/CORS需求后再收紧，不能不测直接翻开关；未证明外部网页可利用 |
| S-02 loopback媒体 | mediaServer.ts bind127.0.0.1、approved realpath、范围请求；CORS '*' | 未批准路径403；symlink解析；端口随机 | 评估允许Origin与请求token，防猜测已批准媒体；不是“任意文件读取”结论 |
| S-03 IPC授权 | preload大接口；register handlers中有approved local path / payload校验，部分缺统一senderFrame校验 | auto-edit owner map、参数/模型ID限制；新增setup IPC验证HUD sender | 建立allowlisted origin/sender和schema层，区分renderer compromise与普通本地使用；没有复现任意命令执行 |
| S-04 FFmpeg/CLI | native-video spawn/execFile(argv)，类型化选项 | 不拼shell命令，绑定helper路径，许多输入路径已审批 | media协议、输出路径、bounded args、untrusted malformed container/timeouts仍要核验；argv不消除恶意媒体漏洞 |
| S-05 供应链/模型 | bundle lock有revision/size/SHA、license manifest；通用whisper下载URL为main | 显式下载、取消/部分文件清理 | 通用下载固定revision/hash；helper/voice/codec不可只核验一个顶层LICENSE；不要执行外部README脚本 |
| S-06 更新/分发 | electron-updater + existing signing/release scripts | 有checksum和资源检查基础 | 本次无签名安装包/干净Windows验收；需实际验证签名、feed、回滚、notice在制品中可见 |
| S-07 资源拒绝服务 | 大媒体/字幕/模型/解码队列 | 10分钟AI上限、有界抽帧、队列/取消/超时与模型内存阈值 | 做超大尺寸、损坏容器、低磁盘、长音频的有界故障测试，不声称任意媒体都安全 |

## 下一步安全修复纪律

只处理有证据的可达问题；依赖升级单独分批，有锁文件diff与Windows回归。不得自动执行 `npm audit fix --force`、替换renderer架构或下载扫描工具/模型。对可变模型源/IPC origin/媒体server收紧先构造失败用例与兼容性验收，保留工程与原媒体。商业分发前完成许可、SBOM、签名及更新链审阅。
