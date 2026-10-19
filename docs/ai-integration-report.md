# Recordly AI integration audit and delivery plan

Audit date: 2026-10-19 (Asia/Singapore). This is an incremental extension of the existing application, not a replacement recorder. See [open-source audit](../OPEN_SOURCE_AUDIT.md), [license review](../LICENSE_COMPLIANCE.md) and [model licenses](../MODEL_LICENSES.md).

## Existing architecture

| Area | Repository evidence | Integration decision |
| --- | --- | --- |
| Desktop/runtime | Electron 43, TypeScript main process, typed preload IPC (`electron/preload.ts`, `electron/electron-env.d.ts`) | Keep approval of local media paths in main process; models run in owned cancellable child processes. |
| Frontend | React 19, Vite, HeroUI, Tailwind; `src/components/video-editor` | Extend existing lazy-loaded AutoEditPanel and editor history. |
| Recording | `electron/ipc/register/recording.ts`, native Windows WGC capture, microphone/system sidecars and timing diagnostics | Preserve existing screen selection, capture and mouse telemetry. Missing audio cannot be reconstructed. |
| Storage | `electron/ipc/project/manager.ts`, `atomicSave.ts`, recording sessions and `.recordly` projects | Reuse local files and approved media registry. No new database/cloud migration. |
| Accounts/cloud | `src/lib/auth/recordlyAuth.ts` uses optional Supabase; desktop root dependencies do not initialize Firestore. Existing `cloud/functions` contains Firebase Admin/Functions/Tasks, rules and schemas; `cloud/worker/media.py` already has FFmpeg/OpenCV/PySceneDetect/faster-whisper CPU adapters. `cloud/validation.json` records historical local/mock checks, not a live deployment | Preserve this optional backend and its interfaces. Offline editing uses local storage and stays signed-out; no deployment, upload or new account requirement. Do not rerun production cloud operations. |
| Player/timeline | Existing clip sequences, source timestamps, speed regions, captions, annotations, zoom, cursor effects and history | Cuts alter source references, not media bytes. Captions stay in source time and project through edited clips. |
| Render/export | Pixi scene/effects, browser media decoding, Mediabunny/WebCodecs plus existing native/FFmpeg paths | Keep working compositor/export rather than replacing effect rendering with a second FFmpeg timeline. Verify exported H.264/AAC and caption timing. |
| FFmpeg | `ffmpeg-static` 5.3.0 supplies FFmpeg 6.1.1 Windows Gyan essentials; getFfmpegBinaryPath/getFfprobeBinaryPath | Reuse for metadata, PCM extraction, silence/freeze evidence and output checks. Actual binary enables GPL/version3/x264/x265. |
| Existing AI | Rule-based safe silence+static cuts, click zooms, bundled Qwen3-VL-2B via llama.cpp, caption pipeline for whisper.cpp | Bundle multilingual speech model and standalone whisper CLI; reuse Qwen for grounded transcript reasoning. |
| Build | tsc + Vite + normalized Electron CJS + electron-builder/NSIS; platform native helper scripts | Separate `electron-builder.speech.json5` output avoids replacing open preview. No Vite/runtime compilation required for customer package. |

## Minimal first integration

Approved local recording + approved aligned audio sidecars → FFmpeg evidence → bundled multilingual Whisper small Q5_1 + DTW/acoustic phrase alignment → source-timed captions + real token probabilities → exact lexical repeat/prefix candidates → bounded contextual review using bundled Qwen → validated candidate approvals → non-destructive trim/caption/visual suggestions → existing timeline/history → existing project save and MP4 export.

ASR and language/vision inference run sequentially to avoid loading both large models concurrently. No customer Python, Ollama, model download, key or AI service. Startup only checks assets; inference starts on demand. Analysis can be canceled and temporary audio removed. Whole-frame preservation remains the default. The automatic-draft checkbox controls whether validated unprotected edits are applied immediately; it can be disabled for review first. Multi-video draft replacement will always require explicit approval.

The first semantic cut policy is deliberately narrow: an earlier repeated take or false start must match the complete words/prefix of a later retained take, with usable recognition confidence. Unique facts, corrections, uncertain recognition, missing alignment and existing effects protect content. This is not general narrative intelligence or a guarantee of correct recognition. Visual samples cannot prove every interaction or motion event.

## Phased scope and acceptance gates

1. **Audit:** repository/dependency matrix, exact licenses and models. Identify closed-source distribution blockers separately from technical progress.
2. **Automatic cutting:** retain existing silence+identical-frame evidence and click protection; add explicit Light/Balanced/Aggressive/Custom policies only after screen-action regression tests. Do not delete silent meaningful actions merely to meet a target duration.
3. **Speech-aware edit (current implementation):** offline recognition, editable source-timed subtitles, grounded repeat/false-start drafts, automatic-apply option, cancel/resource cleanup. Existing `cloud/worker` faster-whisper adapter is retained. Compare that CPU int8 path in a future reproducible local test before adding its Python/CTranslate2 distribution to the Windows customer bundle.
4. **Timeline/export validation:** actual generated media through import, draft, apply, Undo, save/reopen and MP4 output. Keep existing `.recordly` compatibility. Preserve full export resolution regardless of preview setting.
5. **Highlights/search:** scene boundaries, representative thumbnail/text index, keyword relevance and optional embeddings. Present timestamps, reasons and uncertainty; no fake search results or completion buttons.
6. **Screen-aware motion:** actual cursor metadata first, confidence-tagged visual estimates otherwise; never invent clicks. Preserve essential UI/taskbar/full monitor when requested.
7. **Multi-video mixing/stock:** canonical project asset references and proposed draft, source provenance and explicit replacement approval. Network stock search and any cloud processing remain deferred per user instruction.
8. **Advanced audio/performance/commercial readiness:** measured proxies/cache/resource limits, normalization/ducking, template and audio quality evaluation; audited release notices/source obligations/signing and clean-machine install checks.

Only completed, tested paths should be exposed as working features. Highlights, semantic search, AI mixing, stock discovery, general OCR/embeddings and advanced denoising are not delivered by adding the speech button. Their separate tests and integration work remain required.

## Validation and performance baseline

The previous visual-only edition passed packaged apply/save/reopen/Undo/MP4 tests; that does not verify the new speech edition. Previous actual capture reached about 48.6 FPS with a 60 FPS capture request; the synthetic animation averaged about 58.8 FPS over a measurement window that also included the countdown. Stable 60 FPS is unresolved. The attempted preview-filter optimization was reverted because repeated A/B tests showed no reliable benefit. Speech-specific outcomes belong in a separate validation receipt after the current build/tests, not copied from previous edition results.

Both native model builds currently enable AVX2, FMA, F16C, BMI2 and SSE4.2 on Windows x64. Their static runtime imports are limited to Windows/UCRT system libraries; this avoids a separate VC redistributable installation for those two model components, but is not a clean-machine verification of all existing recorder dependencies.

The speech configuration extends the offline configuration. The inherited visual-asset filter selects the root model/projector/manifest/notices and `runtime-static/**`; it does not include `speech/**`. The speech configuration adds that directory once at `resources/offline-ai/speech`. Inherited wallpapers and application license resources remain separate. Actual packaged files and manifests must still be checked after building.

The preceding visual-only installer measured 1,693,821,125 bytes. The three model files together total 1,742,548,655 bytes before runtime/application files and compression. Neither number establishes the new speech installer's size. Measure the final installer and compressed payload against the 2 GiB NSIS boundary; unpacked installed size is a different measurement. No sub-2-GiB claim is made for an unfinished build.

Do not benchmark while native compilation, ASR, export or installer compression is active. Protect original profiles, recordings and unsaved projects; tests use synthetic media and separate directories. No private audio/video or diagnostics are added to Git.
