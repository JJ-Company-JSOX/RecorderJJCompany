# 03 — 功能比较矩阵

日期：2026-10-24。当前状态证据见 [01](01-current-project-audit.md)，外部固定 commit 源码见 [04](04-source-code-analysis.md)。下列“最佳参考”指最匹配本仓库的设计参考，不表示性能冠军或可直接复制。

| 功能 | 当前 Recordly / JSOX 状态 | 最佳参考项目 | 借鉴价值 | 整合难度 | 优先级/结论 |
|---|---|---|---|---|---|
| 屏幕／窗口原生录制 | WGC/helper与回退已实现；状态测试通过，Windows实录待验证 | OBS、wcap、ShareX | 设备丢失恢复、生命周期、统一时钟 | 高；保留后端 | P0 A/B |
| Windows 区域录制 | picker `allowArea`仅darwin；Windows未完整接通 | wcap | 物理矩形、捕获纹理crop、显示器坐标 | 中高，先DPI验收 | P2 C |
| 暂停／继续／停止 | 有native/browser控制与取消测试，物理同步待验证 | ShareX RecordingClock | QPC基准、暂停时长扣除 | 中 | P0 B |
| 系统音／麦克风 | sidecar、路由/重采样/同步底座已实现 | OBS、ShareX、wcap | WASAPI重启、设备故障隔离 | 高，不能换capture core | P0 B |
| 摄像头独立素材／布局 | 已接保存和合成；实录同步待验证 | Cap、BetterCapture | 单独时钟、写入器故障提示 | 中 | P2 B |
| 自动Zoom | 已有时空点击聚类、边界/平滑、可编辑片段 | Cap；Reframe（算法参考，license未清） | DPI规范、停留/点击候选合并与可解释参数 | 中 | P2 B，不重写 |
| 鼠标显示／大小／样式 | 真实UI/保存/预览/导出链；控件测试通过 | Cap、wcap | 物理/逻辑坐标边界、捕获时隐藏系统cursor | 中 | P1/P2 B |
| 点击光圈／声音 | 已有click style；音效与clip/speed同映射，WAV渲染测试通过 | 现有实现优先 | 保存自定义值，避免重复鼠标与重复事件 | 低中 | P1 A/B |
| 闲置隐藏／结束返回／角度 | 未找到完整独立参数链 | Cap/参考图需求（不复制FocuSee） | 独立可测试的cursor policy | 中 | P2 C |
| 烟花／节日鼠标效果 | 未实现，核心收益低 | 不推荐先做 | 增GPU/视觉噪声与素材许可负担 | 中 | P4 E |
| 背景/比例/边距/圆角/阴影/模糊 | 已连接持久化与两导出renderer；真正成片一致性待完整验证 | 现有Pixi；Cap、Better Shot布局思路 | 一套布局定义、golden frames、轻量预览 | 中 | P1 B，保留已有 |
| 文字／箭头／模糊遮罩 | 左侧入口、属性、保存/撤销UI通过；最终原片成片待验证 | ScreenToGif历史设计、现有annotationRenderer | 聚焦坐标/时间/图层序列化 | 中 | P1 B |
| 矩形／聚光灯／放大镜 | 未完整实现，figure当前主要是方向箭头 | 参考图功能需求，独立设计 | 新annotation类型必须同时支持preview/export/save | 中高 | P2 C |
| 裁剪／拆分／重新排序 | 已实现；3个renderer场景通过 | Kdenlive、Shotcut | 明确blank/ripple/track事务 | 中高 | P0/P1 B |
| 完整轨道锁定／静音／显示 | 音轨音量/用户clip静音已有，完整track管理部分缺失 | Kdenlive、Shotcut | 命令层统一约束，不能只禁用按钮 | 高 | P2 C |
| 代理预览／缓存预算 | 有预览质量选择/资源管理；完整代理缓存策略待审 | Kdenlive、Shotcut | 降低高分辨率解码负担 | 高 | P1 B，先测量 |
| 静音检测／裁剪 | FFmpeg/VAD/规则已有，并非缺失 | auto-editor、Better Shot、PySceneDetect | 自适应阈值、呼吸padding，非语义判断 | 中 | P3 B |
| 智能语义剪辑 | 本地ASR+LLM+基线保护/审阅/undo已有；模型效果待验证 | 现有实现优先 | 保留不确定/否定/数字，拒绝无依据剪切 | 高 | P3 B |
| 按文字删除视频 | textCuts + captionTimeline + applyEditPlan已有，fixture测试 | auto-editor timeline概念；现有实现 | 重复source在timeline多次出现的片段映射 | 中 | P3 B |
| 自动字幕／SRT／烧录 | 本地Whisper管线、style、字幕投影/sidecar已有 | whisper.cpp；faster-whisper做对照 | 识别语言与界面语言分离、真实对齐质量 | 中 | P1/P3 A/B |
| 场景检测 | 已有PySceneDetect离线工具适配，CPU worker也有 | PySceneDetect | 自适应content边界、采样误差说明 | 中 | P3 B |
| 本地解说词／配音 | Qwen + Kokoro/Piper/sherpa已有，voice许可需逐项 | llama.cpp、sherpa、Piper | 复用runtime、审批文本、音轨排程 | 中高 | P3 A/B |
| MP4硬件探针／CPU回退 | 已有短片真实probe和多路径；真实设备组合待验 | Mimo思路重叠；Cap output validation更值得学 | 统一完成验收/音轨/时长，而非再写encoder列表 | 高 | P0 B |
| 工程自动保存／恢复 | atomic queue/backup/autosave已有；future版本拒绝已补，relink/恢复UI缺 | Cap crash sentinel、ScreenToGif ActionStack | 用户可恢复的完整项目状态和资源引用 | 中高 | P0/P1 B/C |
| 本地视频检索 | 现有云端Firebase方案不等于本地索引已实现 | Faiss + 现有ASR/事件 | SearchAdapter，将索引与embedding分离 | 高 | P3 C，暂不引依赖 |
| 视频超分辨率 | 未实现 | Real-ESRGAN | 分块、取消和可估预算 | 高/资源重 | P4 E（当前） |
| 手机投屏／动画头像／3D | 未实现完整链，按需求延后 | 不选新大型栈 | 核心稳定后单独验收和许可研究 | 高 | P4 E（当前） |

## 逐类决策

- **A Keep Existing**：原生录制器、Pixi预览/导出合成、clipSequence、原子工程保存、Whisper/llama/sherpa/TTS后端。不是因为文件多，而是核心调用链和现有回归已覆盖，替换没有收益证据。
- **B Improve Existing**：统一成片验证、取消回收、DPI、事件日志、预览性能测量、字幕/语义质量、编辑参数持久化。
- **C Add New Feature**：relink/崩溃恢复交互、完整track锁定、未来本地检索、确有需求的新标注类型，采用独立模块。
- **D Replace Component**：本轮无足够证据建议替换。未来仅在同素材、同机器、同质量、可回滚的基准明确优于现组件时考虑局部替换。
- **E Reject**：WPF/Qt/MLT整应用迁移；旧录屏后端替换WGC；无license正文/自定义限制的代码直接合并；第二导出器；自动下载大型avatar/超分模型。
