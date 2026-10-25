# Video story planning from a creative brief (2026-10-25)

Follow-up: [2026-10-26 workspace, subtitle context and reliability](feature-story-workspace-context-reliability-2026-10-26.md) implements draft persistence, opt-in subtitle evidence and related fixes; the limits below describe this initial delivery.

The user wants product storytelling matched to footage, not narration of individual clicks. The existing tutorial flow remains available. In AI auto edit → Ollama advanced → AI voice-over, choose **Narration task → Plan a whole-video story**.

The brief collects topic/product, audience, verified selling points, desired ending and scene notes. A single structured model call plans coherent stages, spoken lines and short on-screen headings for up to eight footage sections. A short video gets one section instead of simultaneous intro/outro lines. Source sampling respects kept clips, cuts, speed changes and timeline gaps. Generated timestamps are bound to the supplied footage spans, not trusted from model output. The user can edit each line, heading and time range, approve the result, then add titles, text-only subtitles or synthesized narration with spoken subtitles.

Two explicit evidence paths:

- Frame analysis: requires a locally installed model advertising `vision`. An example manual installation command is `ollama pull qwen2.5vl:3b`; select and check the installed model through the existing settings. No automatic model download. The main process resolves approved local media and uses existing FFmpeg helpers to extract at most eight 320×180 PNGs at real source times, then sends them to fixed-loopback Ollama in slot order. These are sparse low-resolution samples, not continuous video understanding; small labels may be unreadable. Actual sampling progress is reported before inference.
- Brief-only: turn off frame analysis to use a text model such as qwen3:4b. It receives the user's brief/notes and timeline slots, with an explicit instruction not to pretend to have watched the video. No source image, media path, transcript or recorded audio is sent to the model. The raw brief can contain user-entered product details; those go only to local Ollama.

The story request validates field lengths, scene IDs, finite timestamps, order and an eight-scene cap. Media must be approved before decoding. HTTP remains 127.0.0.1:11434 with no proxy/redirect; existing installed-model/license/cloud checks remain. The image request has a bounded 3 MB body (all existing calls retain 500 KB), 1 MB response cap and 120-second inference timeout. Context/output limits are 8192/3072 with `keep_alive: 0`. Existing per-editor task cancellation, concurrency lock, destruction cleanup and late-result rejection are reused. No dependencies or new recorder/export pipeline.

Generated title annotations, captions and audio use the existing timeline, undo, project serialization, preview and export inputs. Titles have normal text styling, layer and track indices. Subtitle-only insertion maps timeline time back to source time and preserves existing subtitles. Narration synthesis uses the existing local TTS engine and actual generated durations. Story audio must fit its approved scene; overly long lines fail with a request to shorten the line or extend the scene. Audio is never silently shifted to another shot. Original audio is preserved; the user can mute/lower it using existing track controls. Changing the brief or real video timing blocks stale insertion.

Validation:

- Production `npm run build:app` passed, including TypeScript and Electron main CJS normalization/smoke. Existing PostCSS/CSS warnings remain.

- 76 targeted unit tests passed across story request/timing/mapping, sample forwarding, text-model refusal, approved-media/concurrency/cancellation, existing narration/reviewer, subtitle mapping and audio/render paths. FFmpeg/model calls in new orchestration tests are mocked; no model-quality claim.
- Five existing Ollama-mode Chromium scenarios passed. All three new story Chromium scenarios passed in the final run: brief-only draft → edit text/title → add title/subtitle/audio → serialize/reload; explicit vision intent and cancel/late result; changed brief and invalid timing rejected before synthesis. WAV decoding and timeline/project transformations run in the actual renderer, while inference/TTS and filesystem IPC are fixtures. The first stale-input test exposed implicit textarea-label matching after controlled updates; brief fields now have explicit accessible labels. A later assertion was corrected to include the existing operation-failed prefix.
- Visual inspection: `/tmp/recordly-video-story.png` shows the editable scene/time/narration/title controls in the existing dark editor. Its color-bar footage is the test fixture, not production content or a model result.

Limits / follow-up:

- No actual Ollama vision/story quality, model download, Windows device capture or new final MP4 was verified in this cloud environment. Existing exporter paths were retained and related renderer/audio tests passed.
- Sampled scenes give an overview, not exhaustive frame-by-frame semantic segmentation or automatic rearrangement of source clips. Model writing still requires human fact review.
- The brief and uncommitted draft currently live in the open editor session. Added titles, subtitles and audio persist in the project. Persisting the raw creative brief, draft/revisions and re-generation links is follow-up work.
- Original audio-to-text remains the existing speech/subtitle workflow; this feature does not automatically transcribe recorded speech or feed it into story planning. Separate explicit transcript-consent integration, richer scene analysis and narration ducking are follow-up work.
- The new story planner is currently the Ollama path; the bundled tutorial narrator keeps its previous behavior. No paid lock, billing, cloud service or extra model installation was added.
