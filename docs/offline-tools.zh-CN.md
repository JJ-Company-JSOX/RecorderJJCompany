# 四项离线组件测试版

用户仓库：https://github.com/JJ-Company-JSOX/RecorderJJCompany ，分支 `jsox-preview`。

全部运行时与模型由开发机准备并随完整测试包提供，顾客不需要安装 Python、填写 API Key、启动服务或下载模型。打开编辑器的「AI 自动剪辑」后，展开「离线工具：降噪、场景、转录对比」。只在点击操作后分析，不在启动时运行模型。

- **Silero VAD 6.2.3**：使用与 Whisper 相同、已对齐的 16 kHz 单声道音频，保护语义剪切的两端。仅当 VAD 段与一个 DTW 句段独占对应、不碰相邻字幕且每侧扩展不超过 250 ms 时，边界可向外延伸以覆盖检出的实际句尾，绝不向内缩短。静音候选还必须避开讲话区间前后 200 ms。缺失或失败时不允许自动语义删句或静音编辑，但保留转录。VAD 不理解语义。
- **RNNoise**：默认处理麦克风音轨；没有麦克风分轨时，用户可明确选择包含人声的混合音频。先生成独立 WAV，再试听原音/降噪版，确认后应用。保留原音、音量、归一化和源时间偏移；不叠加第二份音频。编辑器 Undo 可恢复之前的设置。音乐、系统提示音不默认降噪。
- **sherpa-onnx 1.13.8 / Whisper base INT8**：可选较小模型转录对比。默认自动剪辑仍用 Whisper small；模型没有提供的置信度不伪造。缺少有效细分时间戳时明确标为 `audio-chunk`。结果须人工检查后才添加字幕，既有字幕不覆盖，不用此转录批准删句。长音频按 30 秒块识别，跨块句子准确度仍待更多中文实录评估。
- **PySceneDetect 0.7.2**：随包内置隔离 Python、OpenCV headless、NumPy。每三帧分析一帧，画面降采样用于分析；点击场景按钮在编辑器预览，源视频与导出画质不改变。边界是采样帧估计，不等于精彩片段或剪切建议。

支持范围：当前 Windows x64 测试包；分析最多十分钟。CPU 推理，当前笔记本 Core Ultra 7 155U、16 GB RAM 可运行；耗时和质量取决于录音、长度、语言与其他程序的内存占用。尚不能把打包成功当作预览帧率改善。

开发准备：依次运行 `prepare-offline-sherpa.mjs`、`prepare-offline-silero.mjs`、`build-offline-rnnoise.mjs`、`prepare-offline-scene.mjs`；锁文件固定下载版本和 SHA256。安装后不联网下载。Microsoft ONNX Runtime 1.28.0 的 CPU 依赖包含应用目录内的 VC++ DLL，开发准备器仅提取文件，不运行系统安装器。

许可：Silero MIT、RNNoise BSD-3-Clause（模型另见随包 MODEL-NOTICE）、sherpa-onnx Apache-2.0、Whisper 权重 MIT、PySceneDetect BSD-3-Clause、OpenCV Apache-2.0、NumPy BSD-3-Clause、Python PSF、ONNX Runtime MIT；具体依赖和工具链完整文本位于各组件目录。VC++ DLL 是 Microsoft 专有可再分发依赖，须遵守随包说明与 Microsoft 条款。项目本身 AGPL 和现有 FFmpeg 许可仍适用；这不是闭源商业分发的法律认证。

验证材料只用合成媒体。用户视频、录音、模型二进制、缓存及本机诊断不提交 Git。
