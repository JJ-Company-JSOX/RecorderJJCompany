# Offline speech integration validation — 2026-10-19

This validates the first conservative speech-edit workflow, not the entire professional-editor roadmap. Synthetic recordings only; original user recordings/projects were not uploaded or overwritten.

## Results and evidence

Relevant unit tests: **187 passed / 23 files**, including caption generation/cancellation, DTW/acoustic alignment, candidate grounding, timeline projection, stale plans, unique-content protection, asset integrity, preview settings and offline update guard. TypeScript, Vite production build and Electron CJS load checks passed. Six Edge UI tests passed for automatic apply/Undo, review-only mode, late cancellation, missing models and existing visual-only flow; these UI tests use an explicit bridge mock and do not establish model quality.

The real packaged application used the included Whisper and Qwen models, actual typed IPC, real FFmpeg and existing editor/exporter. Native save/open choosers were directed to the test directory; AI replies and editing IPC were not mocked. External HTTP was blocked in this application's Chromium session, not across the entire computer.

| Check | Measured result |
| --- | --- |
| Input | 12.820 s synthetic English: repeated greeting, long pause, unique Save/full-screen instruction |
| Actual source removed | 2.089 s from the earlier repeated greeting; not merely playback acceleration |
| Result timeline | 10.049 s, including a separate 1.5× quiet interval |
| Captions | Three source-timed phrase cues, actual token-derived confidence 0.891 / 0.948 / 0.936; deleted-source caption is not rendered in retained clips |
| Unique instruction | Source interval 8.081–11.163 s remains wholly present in the final source ranges |
| Save / restore | Existing `.recordly` save/reopen preserved draft; single Undo restored original timeline |
| MP4 | Actual H.264 640×360 + AAC; container 10.067 s |
| Audio | Non-silent speech, mean −21.8 dB; audio/video stream-duration difference 17.992 ms |
| Analysis time | 69.318 s for this 12.820 s synthetic clip, one measured run |
| Editor ready | 4.725 s in this isolated launch, one measured run |
| Cleanup | This test app's Whisper/llama child processes exited after analysis |

Primary evidence remains ignored at `.tmp/offline-speech-smoke/run-9dQdQs/report.json`, project and actual MP4 beside it. A subsequent visual correction moves generated annotation boxes fully inside the recording; its final packaged rerun and installer hashes are recorded in the local delivery receipt. The initial exported-frame review exposed the annotation edge clipping; unit coverage now checks full box bounds.

The rerun at `run-HPHwbB` repeated the same 2.089 s semantic cut and explicitly verified the complete unique instruction was retained; analysis took 76.344 s in that run. Frame inspection then showed that even an in-bounds screen label could cover a control. Automatic speech drafts now omit generated screen-label annotations; the review-first flow still offers them. The reproducible packaged test asserts automatic drafts contain no such overlays. A later concurrent run hit one existing FFmpeg test's five-second timeout while installer compression/UI testing competed for CPU; its log was preserved and the unchanged assertion is rerun without that contention.

These are not controlled startup/RAM/FPS before/after benchmarks. Previously, visual-only inference sampled the same static frame four times; exact-JPEG per-job caching now invokes bundled vision once for identical samples while preserving all four timestamps (tested with actual FFmpeg extraction). Do not infer a general recording/preview FPS gain from this change.

The final package rerun, `run-ujPwmG`, passed all eight real-workflow checks after the overlay policy change. Analysis took **72.937 s**, editor readiness **6.848 s**, with the same 2.089 s earlier-take removal and 10.049 s timeline. The automatic draft contained no generated screen-label annotations; inspecting the actual export at 6.8 s confirmed the Save button remained visible and the spoken instruction appeared as a subtitle. During ASR, one instantaneous process snapshot measured Whisper at 497.3 MiB working set / 1,061.9 MiB private bytes, and five Electron processes at 985.2 MiB combined working set / 756.2 MiB private bytes. This is neither peak memory nor a before/after comparison; working sets can include shared pages. The previous timeout rerun passed all 187 tests without changing its timeout or assertion.

## Failures retained and fixes

1. First 9.885 s short-phrase fixture: recognition succeeded but word offsets entered silence/zero-length ranges and first-take confidence was below 0.85. Only pause acceleration occurred. The weak original end-to-end check was insufficient; source omission is now mandatory. Confidence was not relaxed.
2. DTW experiment: `-dtw small` alone was disabled by default flash attention. `-dtw small -nfa` produced useful lexical anchors; points are combined with measured acoustic components, never represented as exact word boundaries. Unsafe/multiple/shared components remain uncertain.
3. First 12.820 s stronger fixture: freely generated model output incorrectly grouped the two greetings with a different Save instruction. The validator rejected it. Candidate-first contextual approval now constrains the model to already verified exact word/prefix candidates; unknown/recombined IDs, unique facts, negations and numeric changes cannot create cuts.

English/Chinese standalone ASR smoke passed using the real bundled small model; these do not establish Chinese semantic-edit accuracy. Malay, actual microphone/system-audio capture on this laptop, noisy/accented customer samples, fresh Windows install, older CPUs and large/long recordings remain unverified for this edition. Full combined analysis is currently limited to 10 minutes and can miss distant repeats across bounded windows.

Stable 60 FPS capture remains unresolved; no recording-engine change or improvement is claimed. Multi-video mixing, full OCR/embeddings/search/highlights, advanced audio, cloud/LAN integration and closed-source commercial clearance are not completed by this delivery. See [integration stages](ai-integration-report.md) and [license review](../LICENSE_COMPLIANCE.md).
