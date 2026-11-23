# Third-party notices

Blur Sounds Pro release builds include these third-party components. They are downloaded or built by `scripts/fetch-deps.cjs` and restored by NuGet and npm, not committed to the repository.

- **FFmpeg 6.1.1**: GPL-3.0. Static Windows build from https://github.com/eugeneware/ffmpeg-static (release b6.1.1). Shipped as `resources/ffmpeg/ffmpeg.exe` with its license and README (`FFMPEG-LICENSE`, `FFMPEG-README`). FFmpeg source: https://ffmpeg.org/download.html. It runs as a separate program and is not linked into Blur Sounds Pro.
- **Vosk speech recognition**, Vosk API 0.3.38 (NuGet) and the vosk-model-small-en-us-0.15 model: Apache-2.0. https://alphacephei.com/vosk/
- **RNNoise 0.2**: BSD-3-Clause, Copyright Xiph.Org Foundation and contributors. https://github.com/xiph/rnnoise. Built from source as `rnnoise.dll`; the license is shipped as `RNNOISE-COPYING`.
- **NAudio 2.2.1**: MIT. https://github.com/naudio/NAudio
- **Electron, React, Vite**: MIT.
- **Weather data**: Open-Meteo (https://open-meteo.com), CC BY 4.0. IP location: ipwho.is and ip-api.com (free tiers).
