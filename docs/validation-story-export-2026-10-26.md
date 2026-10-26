# Story timeline: real MP4 export proof

This smoke exercises the existing application export pipeline in Chromium, without installing Electron or an AI model. It uses the repository's synthetic `tests/ui/fixtures/filmstrip.mp4` and a generated one-second tone WAV. It does **not** validate actual ASR, model storytelling, TTS voice quality, recording hardware, or Windows GPU encoders.

## Reproduce

Install the repository's existing development dependencies first. Use an already installed Chromium or Google Chrome with software H.264 WebCodecs support. The script does not download a browser, models or third-party repositories.

```text
node scripts/smoke-story-export.mjs --help
node scripts/smoke-story-export.mjs --run
```

Optional arguments:

```text
node scripts/smoke-story-export.mjs --run --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --out "C:\Temp\recordly-story-export" --port 5189
```

`RECORDLY_CHROMIUM_PATH` also selects the installed browser. `--out` must be a new artifact directory (an existing `story-final.mp4` is not overwritten). By default the script creates a fresh temporary directory. Choose an unused port. Do not run it concurrently with the Playwright UI suite on a computer short of memory. FFmpeg and FFprobe are resolved by the application's existing dependency/PATH logic.

## What is real

The script imports the actual `ModernVideoExporter`, which decodes the real fixture, renders the existing Pixi effects/annotations/captions and uses Chromium's real software H.264 encoder and application muxer. It supplies two edited timeline clips that reuse the same source footage, each with a different title, clip-bound subtitle and separate one-second tone placement.

When Chromium has no AAC encoder, it follows the application's existing `muxExportedVideoAudio` fallback. Only IPC transport and Electron `app.getPath` are replaced by a test shim; the real `muxExportedVideoAudioBuffer` and FFmpeg implementation process the actual encoded video and OfflineAudioContext mixture. The Node bundle preserves the FFmpeg helper's original module location so project-provided FFmpeg binaries resolve on Windows too. If Chromium supports AAC directly, the existing browser audio path can run instead; the report's `ffmpegMuxUsed` records which occurred. No alternative export pipeline is written.

Checks:

- Output codecs are H.264 and AAC, dimensions are 320×180, frame rate is 15 fps, and duration is approximately six seconds.
- Audio and video stream durations agree within 100 ms.
- FFmpeg fully decodes both streams without errors.
- Decoded audio contains signal at the intended two narration intervals (0.5–1.5 and 3.5–4.5 seconds), with silent gaps elsewhere.
- The script extracts `scene-first.png` at one second and `scene-second.png` at four seconds. Visually inspect the images to check that repeated source footage contains **Product introduction / First story line** first, and **Try it today / Second story line** second. This is a direct burned-in subtitle/annotation check, independent of README or button existence.

## Actual cloud result on 2026-10-26

A successful actual run used Linux Chromium's software H.264 encoder and the application's real FFmpeg AAC fallback. The produced MP4 was 387,383 bytes, H.264/AAC, 320×180, 15 fps, with both stream durations exactly `6.000000` seconds. Full decode passed. Signal windows at 0.7–1.2 and 3.7–4.2 seconds measured approximately −13.41 dB RMS; windows at 0–0.3, 2–2.5 and 5–5.5 seconds were silent. Both extracted images were inspected and showed the expected distinct scene titles and subtitles on identical reused source content.

The inspected artifacts are under `/tmp/recordly-real-story-export/` in that session: `story-final.mp4`, `validation.json`, `ffprobe.json`, `scene-first.png`, `scene-second.png` and `browser.log`. These temporary files are not committed. The portable script writes equivalent artifacts into its chosen output directory.

The committed portable script was then run separately with `--run --out /tmp/recordly-portable-story-proof`. It also succeeded using the real FFmpeg AAC fallback, with the same codecs, durations, byte count and audio-window results. Its log is `/tmp/recordly-portable-story-proof.log`; its own `validation.json` and images are in that output directory.

The initial harness needed proper HTTP byte-range responses for the synthetic WAV; the portable smoke includes those responses. A synthetic waveform is evidence that placement/mixing/export preserves audible audio, not proof of AI narration quality or measured human lip synchronization.
