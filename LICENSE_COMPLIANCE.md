# Distribution license review

Reviewed 2026-10-19 against this checkout and actual Windows binaries. This is an engineering compliance inventory, not legal clearance.

## Current blockers to a closed-source release

The repository's `LICENSE.md` is AGPL-3.0. Adding MIT/Apache AI components does not make the existing Recordly application permissively licensed. Preserve its copyright/license and satisfy applicable corresponding-source and network-use obligations. A closed-source product requires permission from all relevant rights holders or a properly separated independently implemented alternative reviewed for that purpose. Changing package branding or repository URL does not resolve this.

The installed `ffmpeg-static` package supplies `ffmpeg version 6.1.1-essentials_build-www.gyan.dev`, with `--enable-gpl --enable-version3 --enable-libx264 --enable-libx265`. Do not describe this executable as an LGPL-only build. [FFmpeg's official legal guidance](https://ffmpeg.org/legal.html) explains build-dependent obligations. Before external commercial distribution, provide the exact binary's matching complete source/build materials and required licenses/notices; a generic current FFmpeg Git URL is insufficient. Codec patent/licensing questions depend on markets and distribution/use, independently of open-source copyright licenses. Rebuilding an audited LGPL-compatible configuration and using permitted encoding paths is a possible future option, not a completed compliance fix.

## Current AI distribution inventory

- `scripts/offline-ai.lock.json`, `scripts/offline-ai-build.lock.json`: pinned Qwen/llama artifacts and portable compiler. Full model/runtime licenses accompany `resources/offline-ai`.
- `scripts/offline-speech.lock.json`: OpenAI Whisper multilingual small Q5_1, immutable conversion revision and SHA; MIT model notice separately from whisper.cpp code.
- `scripts/build-offline-whisper-runtime.mjs`: pinned whisper.cpp source, static Windows CPU build, bundled MIT/toolchain/embedded component notices. No copied proprietary Canvid implementation.
- Per-bundle manifests validate filenames, canonical paths, size and SHA. Source and build scripts stay in Git; weights/executables and private media stay ignored.

Preserve `THIRD_PARTY_NOTICES.md`, font/icon licenses, existing upstream notices and model licenses. Review all production/transitive dependency versions with an SBOM before a commercial release; the candidate research matrix is not a full npm/native/codec compliance certification. Deferred models must be separately reviewed before download/distribution; no gated model credentials or acceptance may be silently bypassed.

The existing offline preview is unsigned and has not passed a fresh-Windows-machine or old-CPU compatibility test. Both model runtimes are built for Windows x64 with AVX2, FMA, F16C, BMI2 and SSE4.2 enabled. Static linking removes non-system runtime DLL requirements from these two model executables; it does not certify the entire recorder on a clean machine. These are release gates, not proof that the current first integration cannot be tested locally.

The current package rules explicitly copy the application AGPL text and model/runtime license directories. Root audit Markdown documents and `THIRD_PARTY_NOTICES.md` are excluded from the application archive by the existing Markdown exclusion unless separately copied as resources. Before an external release, inspect the actual artifact for the required user-visible notices; this source inventory alone does not mean those documents are inside the installer.
