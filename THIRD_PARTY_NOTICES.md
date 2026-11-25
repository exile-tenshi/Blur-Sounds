# Third-party notices

Blur Sounds Pro release builds include these third-party components. They are downloaded or built by `scripts/fetch-deps.cjs` and restored by NuGet and npm, not committed to the repository.

- **FFmpeg 6.1.1**: GPL-3.0. Static Windows build from https://github.com/eugeneware/ffmpeg-static (release b6.1.1). Shipped as `resources/ffmpeg/ffmpeg.exe` with its license and README (`FFMPEG-LICENSE`, `FFMPEG-README`). FFmpeg source: https://ffmpeg.org/download.html. It runs as a separate program and is not linked into Blur Sounds Pro.
- **Vosk speech recognition**, Vosk API 0.3.38 (NuGet) and the vosk-model-small-en-us-0.15 model: Apache-2.0. https://alphacephei.com/vosk/
- **RNNoise 0.2**: BSD-3-Clause, Copyright Xiph.Org Foundation and contributors. https://github.com/xiph/rnnoise. Built from source as `rnnoise.dll`; the license is shipped as `RNNOISE-COPYING` next to it.
- **SpeexDSP 1.2.1**: BSD-3-Clause, Copyright Xiph.Org Foundation, Jean-Marc Valin and contributors. https://github.com/xiph/speexdsp. Built from source as `speexdsp.dll` (acoustic echo canceller + residual echo suppressor); the license is shipped as `SPEEXDSP-COPYING`.
- **DeepFilterNet 3** (libDF and the DeepFilterNet3 ONNX model): MIT OR Apache-2.0, Copyright Hendrik Schröter. https://github.com/Rikorose/DeepFilterNet. Built from source as `df.dll` (it statically includes Rust crates such as tract, ndarray and rustfft under MIT/Apache-2.0); the model ships in `resources/models/deepfilter` with both licenses.
- **.NET 8 runtime** (bundled inside `BspAudioHelper.exe`): MIT, Copyright .NET Foundation and Contributors. https://github.com/dotnet/runtime
- **NAudio 2.2.1**: MIT. https://github.com/naudio/NAudio
- **Electron, React, Vite**: MIT.
- **Natural-sounds classifier weights** (`helper/NatModel.cs`): trained by this project on the VocalSound dataset (Gong et al., ICASSP 2022, CC BY 4.0, https://github.com/YuanGongND/vocalsound), CMU ARCTIC speech (free use, Carnegie Mellon University) and LibriSpeech (CC BY 4.0). No audio from these datasets is included.
- **Weather data**: Open-Meteo (https://open-meteo.com), CC BY 4.0. IP location: ipwho.is and ip-api.com (free tiers).

## VB-Audio Hi-Fi Cable (not included)

The VB-Audio Hi-Fi Cable driver is **not** included or redistributed. When you click "Install Hi-Fi Cable", Blur Sounds Pro downloads the official package (`HiFiCableAsioBridgeSetup_v1007.zip`) from `download.vb-audio.com`, checks its SHA-256 and VB-Audio's Authenticode signature, and runs VB-Audio's own installer. Hi-Fi Cable & ASIO Bridge are © VB-Audio Software (Vincent Burel) and are donationware for end users: https://vb-audio.com/Cable/ · https://vb-audio.com/Voicemeeter/Donationware.htm
