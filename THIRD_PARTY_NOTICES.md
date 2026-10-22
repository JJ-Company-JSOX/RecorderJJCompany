# Third-party notices

## Complete offline tools test edition

The separate tools edition adds Silero VAD (MIT), RNNoise (BSD-3-Clause and its
bundled model notice), sherpa-onnx (Apache-2.0), ONNX Runtime CPU (MIT), Whisper
base INT8 weights (MIT), PySceneDetect (BSD-3-Clause), embedded Python (PSF),
OpenCV headless (Apache-2.0 and bundled decoder notices), NumPy (BSD-3-Clause),
Click (BSD-3-Clause), platformdirs (MIT), tqdm (MPL-2.0/MIT) and colorama
(BSD-3-Clause). Exact archives/revisions/hashes are pinned in the offline tools
lock files. Full package and dependency notices remain beside each bundled
runtime, including Python wheel `.dist-info` directories. No external customer
Python installation or runtime model download is required.

Microsoft VC++ app-local runtime DLLs are proprietary redistributable components,
not open source. Their official signed redistributable provenance and file hashes
are recorded in `scripts/offline-msvc.lock.json`, with MSVC notices in the Sherpa
and scene bundles. The preparer only extracts those files; it does not install a
system runtime. Existing application AGPL, FFmpeg and distribution obligations
still apply. See [tools scope and limitations](docs/offline-tools.zh-CN.md).

## Offline AI edition

The offline edition additionally distributes Qwen3-VL model weights (Apache-2.0),
OpenAI Whisper small multilingual weights (MIT), llama.cpp (MIT), whisper.cpp
(MIT), AISHELL-3 VITS voice weights (Apache-2.0), VITS LJSpeech English voice weights (MIT; LJSpeech
public domain), sherpa-onnx and its prebuilt
`sherpa-onnx-node` / `sherpa-onnx-win-x64` Node addon (Apache-2.0) and the ONNX
Runtime library bundled with that addon (MIT), plus Silero VAD (MIT), RNNoise
(BSD-3-Clause) and the shared sherpa-onnx C API runtime with its MSVC notices.
Its screen-text reader adds the PaddleOCR PP-OCRv6 small detection and
recognition weights (Apache-2.0, Baidu / PaddleOCR rights holders) in the ONNX
conversion distributed with RapidOCR 3.10.0 (Apache-2.0, copyright 2021 RapidOCR
Authors), whose pre- and post-processing `electron/ipc/autoEdit/ocr/` ports to
TypeScript with the upstream notices kept and the changes stated, and ONNX
Runtime Web 1.30.0 with onnxruntime-common (MIT, Microsoft Corporation; the
WebAssembly runtime ships with ONNX Runtime's `ThirdPartyNotices.txt`). Exact revisions, asset hashes and model notices are recorded in
[MODEL_LICENSES.md](MODEL_LICENSES.md) and the build lock files under `scripts/`.
The Windows resource bundles contain the complete model/runtime license texts,
embedded component notices and LLVM-MinGW toolchain notices. These permissive
component licenses do not change Recordly's AGPL-3.0 license or the actual shipped
FFmpeg executable's GPL obligations; see [LICENSE_COMPLIANCE.md](LICENSE_COMPLIANCE.md).

## Voom

Recordly Share includes code adapted from the Voom project:

- Project: [Voom](https://github.com/aritropaul/voom)
- Adapted component: `services/recordly-share/worker`
- License: MIT
- Copyright © 2026 Aritro Paul
- Upstream reference: `c1c0350ed610b0c9bc4a307fcc6a01aab0f926f9`

Recordly changes include product branding, desktop publishing integration,
authenticated commenting, local-development configuration, and viewer styling.

The Voom software is provided under the following license:

> MIT License
>
> Copyright (c) 2026 Aritro Paul
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Solar Icons

Solar Icon Set by 480 Design, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Source: https://github.com/480-Design/Solar-Icon-Set. Icons are rendered using the MIT-licensed `@solar-icons/react` package. The muted microphone adds a diagonal stroke.

## DM Sans

Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts).

DM Sans is licensed under the SIL Open Font License, Version 1.1. The unmodified regular and italic variable fonts are sourced from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/dmsans). The full license is included in [src/assets/fonts/dm-sans/OFL.txt](src/assets/fonts/dm-sans/OFL.txt).
