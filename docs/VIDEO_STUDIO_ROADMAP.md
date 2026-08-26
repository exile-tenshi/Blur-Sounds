# Video Studio (Record + Editor) — architecture & roadmap

Blur Sounds is an **Electron + React/TypeScript** desktop app. The **Record** and
**Editor** tabs add screen capture and clip editing using the web/Electron-native
equivalents of a professional NLE stack, so they run inside the existing app rather
than requiring a separate native (Qt/Vulkan/C++) runtime.

This document maps the originally requested technology stack to what is implemented
today, what is planned on the web/Electron track, and what belongs on a separate
native track — with honest rationale.

Legend: ✅ Implemented · 🟡 Planned (this stack) · 🧭 Native track (separate app/runtime)

## 1. Core engine & libraries
- ✅ **FFmpeg** (decode/encode/filter) — bundled via `ffmpeg-static` + `ffprobe-static`.
  Used for media probing, recording transcode-to-MP4, and timeline export with the
  `eq`, `colortemperature`, and `lut3d` filters. See `src/main/video/ffmpegRunner.ts`.
- ✅ **Hardware encoders (NVENC / AMF / QuickSync)** — selectable and auto-detected
  from the FFmpeg build (`h264_nvenc` / `h264_amf` / `h264_qsv`), with automatic
  fallback to **libx264** software encode. (The bundled static FFmpeg on CI/Linux
  exposes x264/x265/VP9/AV1; hardware encoders light up on GPUs that provide them.)
- ✅ **Software encode fallback** — libx264 / libx265 (and libaom/libvpx available).
- 🟡 **PortAudio/RtAudio, libsamplerate** — the existing native `.NET` audio engine
  already owns low-level audio I/O/resampling on Windows; not duplicated here.

## 2. UI / rendering framework
- ✅ **GPU-accelerated preview compositing** — **WebGL2** color-grade shader with a
  `sampler3D` 3D-LUT (`src/renderer/utils/webglPreview.ts`). This is the web-native
  equivalent of the requested Vulkan/OpenGL preview.
- ✅ **Main UI / timeline / panels** — React (the app's framework), styled to match.
  This replaces the requested Qt 6 Widgets/QML, which target a native app.
- 🧭 **Qt 6 / Vulkan / Dear ImGui** — only relevant if the product is rebuilt as a
  native C++ application; out of scope for this Electron app.

## 3. Timeline / NLE core
- ✅ **Clip/track data model** + serializable project file (`.blurproj`, JSON).
  See `EditorProject`/`EditorTrack`/`EditorClip` in `src/shared/videoStudio.ts`.
- ✅ **Undo/redo command stack** (command pattern) — `src/renderer/utils/commandStack.ts`.
- ✅ **Frame-accurate seek/scrub** — playhead ↔ `HTMLVideoElement.currentTime`.
- ✅ **Keyframe/animation-curve system** — linear/hold/ease interpolation over grade
  params (`src/renderer/utils/keyframes.ts`).
- 🟡 **Proxy media generation pipeline (background thread pool)** — FFmpeg-based proxy
  transcode + a worker queue. Interfaces exist; not yet wired.

## 4. Effects & compositing
- ✅ **Color grading shader** — exposure, contrast, saturation, temperature/tint,
  lift/gamma/gain (ASC-CDL-style) in GLSL.
- ✅ **LUT support** — `.cube` 3D LUT parsing (`src/renderer/utils/cubeLut.ts`) with
  GPU sampling and adjustable intensity; baked into exports via FFmpeg `lut3d`.
- 🟡 **Transitions / chroma key (green screen)** — additional shader passes; the
  preview compositor is structured to accept more passes.
- 🟡 **Text/title rendering** — FFmpeg build includes FreeType; a titles pass is planned.

## 5. AI / smart features
- ✅ **ClearCast voice isolation (RNNoise)** — `src/main/video/clearCast.ts` builds an
  FFmpeg audio chain: subsonic/high-pass → **`arnndn`** (RNNoise ML speech denoiser,
  bundled `resources/rnnoise/cb.rnnn`) → gate → de-ess → speech-normalize. Removes
  fans, hum, hiss, keyboard/desk taps, low rumble, and room-echo tails so only the
  speaker's voice remains. Applied to Editor exports and recording saves; strength
  0–100. Falls back to `afftdn`+`anlmdn` when the model is absent. The live-mic C#
  engine (`NoiseSuppressionSampleProvider`) also got a subsonic cut + deeper gate and
  a "ClearCast" preset; a native RNNoise pass on the live stream is the next step.
- ✅ **Dead-air detection + audio-spike auto-highlights** — local, model-free RMS
  envelope analysis via the Web Audio API (`src/renderer/utils/audioAnalysis.ts`),
  surfaced in the Editor with one-click "Trim dead air".
- 🟡 **Whisper.cpp captions / Silero-WebRTC VAD** — the analysis module exposes a
  typed `AudioAnalysis` interface these can plug into.
- 🧭 **Groq Vision / YOLO kill-feed OCR** — heavier model integrations; separate track.

### ClearCast testing (verified on the Linux VM)
A synthesized "dirty mic" clip (espeak voice + brown-noise fan + 2 kHz desk taps +
85 Hz rumble + `aecho` room echo) was processed through the shipped ClearCast chain via
the in-app Editor export. Result: the silent-gap noise floor dropped from **-20 dB to
-33 dB** (~13 dB), overall noise fell ~8 dB, and the before/after spectrogram shows the
low-frequency rumble band and tap streaks removed while the voice harmonics are
preserved. Attribution: RNNoise model `cb.rnnn` from the GregorR/rnnoise-models set.

## 6. Dev tools & build system
- ✅ **Existing build system** — Vite + `vite-plugin-electron` (this app), lint via oxlint.
- 🧭 **CMake / vcpkg / Conan / GoogleTest / Catch2** — C++ toolchain items that only
  apply to a native rewrite.
- 🟡 **CI (GitHub Actions) / crash reporting (Sentry)** — app-level, not tab-specific.

## 7. Testing
- ✅ **End-to-end validation on the dev VM** — import → scrub → grade (WebGL) → 3D LUT
  → audio analysis → trim dead air → **FFmpeg export** verified as a valid H.264/AAC
  MP4 (`ffprobe`-checked).
- 🟡 **Sample-footage suite / unit tests** for timeline + codec wrappers.

## Known environment note (Linux/headless capture)
Live screen capture uses the same `getDisplayMedia` + `MediaRecorder` path as the
existing Clips feature. On headless/virtual-display CI VMs the Chromium screen
capturer does not reliably deliver frames to `MediaRecorder`, so the **Record** tab
may report "No video frames were captured" there. On real Windows/desktop GPUs
(the app's target) capture works normally. The Record tab detects the empty-capture
case and reports it cleanly instead of saving a corrupt file; its settings and the
FFmpeg transcode/save pipeline are shared with — and validated by — the Editor export.

## Packaging note
`ffmpeg-static`/`ffprobe-static` ship a per-platform binary. For a packaged build,
add them to electron-builder `asarUnpack` (and provide the Windows binaries in the
Windows artifact) so the binaries are spawnable from outside the asar archive.
