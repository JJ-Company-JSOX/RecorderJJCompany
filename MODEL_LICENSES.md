# Offline model inventory

The customer edition uses preinstalled local assets; build-time downloads are not customer setup.

| Model | Purpose | License and immutable provenance | Packaging |
| --- | --- | --- | --- |
| Qwen3-VL-2B-Instruct Q4_K_M + Q8 visual projector | sparse screen observations and bounded transcript reasoning | Apache-2.0 model license; exact revision, files and SHA in `scripts/offline-ai.lock.json`; runtime license is separate | `offline-ai/model.gguf`, `vision.gguf`, `MODEL-LICENSE.txt` and NOTICE |
| OpenAI Whisper small multilingual Q5_1 | offline en/zh/ms/auto speech recognition | [OpenAI Whisper MIT code/weight terms](https://github.com/openai/whisper); conversion repository `ggerganov/whisper.cpp` revision `c521a4b02f422512d734391fdf08bb08c0862f68`; SHA `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb`; original license pinned in speech lock | 190085487 bytes, `offline-ai/speech/ggml-small-q5_1.bin`, MODEL-LICENSE and NOTICE |

Small multilingual support does not guarantee accurate recognition of accents, noisy recordings or every language. Local synthetic English and Chinese smoke tests passed; Malay and real customer audio quality remain unverified. Recognition probabilities are model signals, not calibrated guarantees. Uncertain cuts must remain protected. Word timing is Whisper-estimated; forced alignment/diarization and translation are not included.

Silero, WhisperX aligners/diarization, OpenCLIP, PaddleOCR, MediaPipe and Demucs models are **not shipped** by this integration. Review the exact checkpoint's license/model card/dataset conditions before adopting it; the library license alone does not authorize arbitrary weight redistribution.
