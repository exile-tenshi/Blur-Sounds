# Blur Sounds Pro

A SteelSeries Sonar–style audio app for Windows, built as the next version of Blur Sounds. It does per-app mixing, routes audio through virtual cables, has a Streamer mode, a mic chain and EQ, saves voice-activated clips, exports them for each platform, and includes a VRChat chatbox with 120+ options.

**Download:** grab `BlurSoundsPro-<version>-win-x64.zip` from the [latest release](https://github.com/exile-tenshi/Blur-Sounds/releases/latest), unzip it anywhere and run `BlurSoundsPro.exe`.

---

## Features

- **Sonar-style mixer.** Game, Chat, Media and Aux channels, plus your own channels. Each app is auto-assigned (VRChat goes to Game, Discord to Chat, Spotify and browsers to Media), and every channel and app has its own volume, mute and peak meters. A ChatMix slider sets the balance between game and chat.
- **Cables and routing.** Any channel can be sent to a real output or to a virtual cable such as VB-Audio Cable or Hi-Fi Cable. Audio is captured per process, so other apps don't leak in. **Reset routing** puts everything back on the Windows defaults. The app runs alongside SteelSeries Sonar without taking over Sonar's devices.
  - Windows won't create new audio endpoints without a signed kernel driver, so Blur Sounds Pro uses cable devices that are already installed.
- **Streamer mode.** Two mixes: a personal mix for your headphones and a stream mix sent to a cable for OBS, Discord or VRChat. Each channel has its own stream volume and mute.
- **EQ.** A 7-band parametric EQ on every channel, with presets.
- **Mic chain.** High-pass filter, echo cancellation, AI noise suppression (DeepFilterNet3 or RNNoise), voice gate, compressor, EQ and a ClearCast-style voice preset, with a Before/After A/B switch. The processed mic can be sent to a cable.
- **Voice changer (v2.5).** Real-time male → female and female → male on the **Voice** page, off until you turn it on. It sits in the mic chain after noise suppression and before the virtual mic.
  - **AI voice:** RVC v2 (ContentVec features, RMVPE pitch, NSF-HiFiGAN voice) on ONNX Runtime with DirectML (AMD, NVIDIA or Intel GPU) and a CPU fallback. Seven built-in voices from openly licensed speech corpora (LibriSpeech, VCTK), plus import of your own RVC v2 voice exported with `tools/rvc2onnx.py`.
  - **Auto pitch** learns your speaking pitch and moves it to where the voice naturally sits. There is also a fine-tune control, voice blending, an expressiveness control and a "follow my loudness" control.
  - **Models are downloaded on first use** (about 0.8 GB, from the official RVC repository and the `voice-models-v1` release) and each file is checked against a pinned SHA-256.
  - **Delay (v2.5.1):** about 240 ms (Fast), 310 ms (Natural, default) or 410 ms (Studio) on a fast GPU (block + look-ahead; slower GPUs add processing time). v2.5.1 trades about 90 ms for a much more natural voice (see below).
  - **Less robotic (v2.5.1).** The streaming engine now looks ahead a few frames, decodes with left context, and uses a slower, whole-utterance auto pitch so your intonation survives. "Follow my loudness" uses a 50 ms envelope instead of per-10 ms gains. Each voice has tuned defaults (expressiveness, loudness follow). Measured with UTMOS (a predicted 1–5 naturalness score) on the same input: Lyra 2.74 → 3.96, Rowan 3.96 → 4.42, Mia with heavily customized settings 3.83 → 4.29. Your existing voice files keep working; nothing new to download. Pitch error (median) roughly halved.
  - **Natural sounds (v2.5.1, on by default).** A small classifier (22 context features, about 600 weights, trained on VocalSound non-verbal sounds spliced into CMU Arctic and LibriSpeech speech) spots laughs, sniffles, breaths, sighs and coughs. Those moments blend toward your real sound, pitch- and formant-shifted to match the voice, instead of being forced through the AI voice. A blend slider controls how much. Speech is untouched: on held-out plain speech 0–0.2% of frames are flagged, and naturalness scores of plain speech are the same with it on or off.
  - **Calibrate from my voice (v2.5.3).** On the Voice page, read a few displayed sentences (20–30 s, with a level meter and too-quiet/clipping hints). Blur Sounds Pro measures your median pitch and range, your voice resonances (formants) and your room's noise floor, tries every downloaded voice on your sample, and ranks them, with a ▶ Before / ▶ After preview for each. Save a named personal preset per voice (pitch, formant, expressiveness, gate, quality mode), then use, rename, re-calibrate or delete it. The recording stays on your PC (in the app's data folder) and **Delete my recording** / **Delete everything** remove it. In tests (held-out speakers) calibrated presets scored UTMOS 4.16–4.21 vs 4.08–4.10 with plain auto pitch for male → female, and pitch tracking error fell by 25–65%; for female → male octave errors dropped from 1.3–1.4% to 0.1–0.6%. Calibration takes about 30–60 s on a fast GPU.
  - **Pitch & formant mode:** a PSOLA shifter with independent formant control. It needs no download and adds about 47 ms.
  - A/B switch to your real voice, a global hotkey, and "Hear myself".
- **Echo cancellation (v2.2).** Removes the sound of your speakers/headset from your mic: automatic delay tracking (GCC-PHAT), a SpeexDSP adaptive filter with residual echo suppression, double-talk detection so your voice isn't cut while others talk, and Mild / Strong / Max strength. Adds about 10 ms (about 40 ms total with DeepFilterNet3).
- **Broadcast guard (v2.2).** Keeps the Windows default output and per-app routes from pointing at the stream or virtual-mic cable, so muted apps can't leak into your broadcast. Includes a Reset routing option.
- **All-in-one output switch (v2.3).** Pick the headphones or speakers you want to listen on from the top bar, the Mixer, or the tray menu, and everything follows in one go: the Windows default (all roles), Blur Sounds' own "You hear" mix and mic monitor, the channels and per-app routes that were on the old device. Your stream cable and the broadcast guard are left alone, and a cable can never be picked as the listening device. Save named presets (e.g. Headphones / VR), cycle them with a global hotkey, and if a device is unplugged the app falls back to the Windows default and switches back when it returns.
  - Command line / Stream Deck: `BlurSoundsPro.exe --listen=next`, `--listen=<preset name>` or `--listen=<device name>` (sent to the running copy).
- **Hi-Fi Cable installer (v2.3).** If VB-Audio Hi-Fi Cable is missing, the Cables page (and a first-run prompt) can install it for you: it downloads the official package from vb-audio.com when you click, checks its SHA-256 and VB-Audio's code signature, runs the installer with a Windows admin (UAC) prompt, then detects the new devices and points your stream mix at it. It shows when it is already installed (with Reinstall / repair) and handles a reboot request. The driver is **not bundled**: VB-Audio's licence only allows redistributing the standard VB-CABLE package, so it always comes straight from VB-Audio.
- **Per-app meters (v2.3).** Every app row has its own live level bar driven by that app's own audio session (or the engine's capture of that exact process), so only the app making sound moves. Helper processes (WebView2, CEF, Qt WebEngine, Steam's web helper) are counted under the app that owns them. Muted apps and channels still show their activity in grey. Meters update about 30 times a second with fast attack and smooth fall-off.
- **Stream audio (v2.4.1).** A *Stream audio* row in the Mixer (and the wizard's Streaming step) shows where your app audio goes for Streamlabs / OBS, with a live meter and the exact capture steps. With a single virtual cable (that cable is your mic), the default is **Desktop audio**: Streamlabs / OBS capture *Desktop Audio = Default*, and your mic comes from *Mic/Aux = "Hi-Fi Cable Output"*. This works right away. For a separate stream mix with per-channel stream volumes, **Install VB-CABLE (free)** downloads VB-Audio's official package from vb-audio.com when you click, checks its hash and signature, and runs its installer. After a restart the stream mix goes to "CABLE Input" automatically (capture "CABLE Output" with *Audio Input Capture*). An unused digital/line output can also be picked. If streamer mode is on but the stream mix has no destination, or channels are set to broadcast while streaming is off, a red warning offers a one-click fix.
- **Voice pitch fix (v2.4.1).** Hi-Fi Cable has no sample-rate converter, so if its two sides run at different Windows formats (e.g. Input 48 kHz, Output 44.1 kHz), voices sound about 8% deeper (or higher). Blur Sounds Pro now detects this and sets both sides to 48 kHz, with a manual fallback shown in the Mic path. The engine's own conversion keeps pitch exact at any mic or cable rate (`BspAudioHelper.exe --pitchtest` checks 16/44.1/48/96 kHz in and out). **Reset mic chain** (Mic chain drawer) restores the safe processing defaults without touching your devices.
- **EQ you can hear (v2.4.2).** Every channel EQ now changes what you actually hear, live. Before, a Direct channel played straight from the app to your headphones, so its EQ only reached clips, recordings and the stream. Now, while a channel's EQ is on, Blur Sounds Pro turns that app down to 1% in Windows, captures it as float audio, scales it back up, applies the EQ and plays it on the same device (about 40 ms extra latency; turn the EQ off for the untouched direct path). Apps are only turned down once their capture is confirmed, and they're put back on quit or crash. Touching any band turns the EQ on. Presets: **Flat, Bass boost, Vocal clarity, Footsteps / FPS, Treble** (and more), plus **Reset**. `BspAudioHelper.exe --eqtest` checks that +6 dB bands boost by 6 dB for both the playback and mic EQ.
- **Mic + streamed apps on one cable (v2.4.2).** With only Hi-Fi Cable (no second cable), the stream option **Mic cable (Hi-Fi): mic + streamed apps** puts your processed mic *and* the apps set to broadcast into "Hi-Fi Cable Input". In Streamlabs / OBS set *Mic/Aux = "Hi-Fi Cable Output"* and *Desktop Audio = Disabled*. Discord and other voice-chat apps (VRChat, TeamSpeak, Mumble, Zoom…) are left out by default so people don't hear themselves; everyone in voice chat does hear the streamed apps. Mic processing applies to the mic only, and the apps have their own level on the cable.
- **In-app updates (v2.4.2).** Settings → Updates (and a header badge when a new version is out) checks this repository's latest GitHub release, shows its notes, downloads the Windows zip, verifies it against the published `.sha256` file, then closes, swaps the app folder (keeping the old one as "Blur Sounds Pro (previous version)"), and reopens. If the new version doesn't start, the old one is put back automatically. Settings in %APPDATA% are never touched. No account or token is used. Versions before 2.4.2 need one manual update to get this.
- **First-run setup (v2.4.0).** On a new PC, Blur Sounds Pro configures itself on first launch from what Windows reports on that PC. Nothing is copied from another PC. It picks your default speakers and microphone (skipping virtual cables and loopback devices) and sends your processed mic to any virtual cable it finds (Hi-Fi Cable, VB-CABLE, Voicemeeter). The stream mix goes to a second cable only if there is one; otherwise it stays off. *Mic on stream* is off, noise suppression is on, and echo cancellation is only on when you listen on speakers. VRChat OSC uses 127.0.0.1:9000. Running apps are sorted into channels without routing anything anywhere new. A **setup wizard** (Welcome → Speakers with a test sound → Microphone with a live meter → Virtual cable with a mic test and the one-click Hi-Fi installer → Discord / VRChat with a copy button → optional Streaming → VRChat chatbox test → Done) checks each step and shows a green check or a fix. You can skip it and run it again from Settings. Existing settings from older versions are kept and never show the wizard.
- **Self-heal on every startup.** Saved devices are remembered by name. If Windows gives a device a new ID (another PC, reinstalled driver, different USB port), it's found again silently. If a device is unplugged, its audio follows the Windows default and a banner says so until it's back.
- **Mic path & virtual mic (v2.3.1).** A Mic path row in the Mixer shows your input mic, the processed signal and the cable it goes to, each with a live meter, and tells you which device to pick as your microphone in Discord / VRChat (e.g. "Hi-Fi Cable Output"). If a virtual cable is already installed, a fresh setup sends your mic to it automatically. If none is installed, it offers the one-click Hi-Fi Cable installer. A **Mic test** records 3 s from the cable, exactly what other apps receive, and plays it back. Cables are found by name, so settings copied from another PC still work, and any cable sample rate or channel count is handled.
- **Mic on stream (v2.3.1, off by default).** Your processed mic always goes to your virtual mic cable for Discord / VRChat, but it is only mixed into the stream mix when you turn **Mic on stream** on (Mic path row or the Mic chain drawer). If your stream mix and your mic share the same cable, the Mic path row warns you and offers **Move stream mix** to another output; then capture that output in Streamlabs / OBS for the stream mix.
- **Slim chatbox & Tiny text (v2.3.1).** *Slim chatbox* (off by default) adds two invisible characters (`\u0003\u001f`) to make the VRChat chatbox bubble smaller; it uses 2 of the 144 characters and may no longer work since VRChat's Unity 6 update. *Tiny text* turns text into Superscript or Small caps, either for the whole message or only the secondary lines (time, weather, PC stats…). The 144-character limit is counted in UTF-16 units, so text is never cut off by VRChat.
- **Clips.** An instant-replay buffer (15 s to 5 min) captures the screen with AMD AMF or x264 and keeps desktop audio and the mic on separate tracks.
  - Save a clip with a hotkey or by saying **"clip it"**. Voice detection runs offline with Vosk.
  - The audio source can be your apps, a whole output device, or Auto, which falls back to the output device. Live meters show what is being recorded.
- **Recording.** Full-length screen and audio recording, plus a library with trim, rename and delete.
- **Share / export.** One-click presets for:
  - Discord 10 / 50 / 500 MB, with bitrate worked out from the clip length so the file fits the limit
  - TikTok, YouTube Shorts and Instagram Reels at 9:16 (blurred background, crop or black bars)
  - YouTube and Twitch at 16:9 1080p60
  - X (512 MB, 2:20 max)
  - Custom
  
  Before exporting you see the estimated size, and a progress bar runs while it encodes. It uses the AMD GPU first and falls back to x264 two-pass. Afterwards the file can be copied to the clipboard so Ctrl+V attaches it in Discord, shown in its folder, or the platform's upload page can be opened.
- **Soundboard.** Sounds with hotkeys, sent to a cable and optionally monitored in your headphones.
- **VRChat Magic Chatbox.** Sends over OSC to `/chatbox/input` and has 120+ options across 8 searchable categories:
  - **Weather.** Uses open-meteo, so no API key is needed. Location comes from your IP or a city you enter, and you can switch between °F and °C. Shows conditions with an emoji, high/low, feels-like, wind, humidity, rain and sunrise/sunset.
  - **PC & system.** CPU, GPU, VRAM and RAM, GPU temperatures on AMD cards, ping, uptime, battery, AFK, and the focused app with playtime.
  - **Time & timers.** Clocks, dates, a second time zone, countdown, stopwatch and session timer.
  - **Music.** Now playing with progress bars and layouts.
  - **VRChat.** World, instance and player count (read from the VRChat log), mute state and heart rate (via OSC avatar parameters).
  - **Streaming.** Twitch live status, viewers and uptime, and a TikTok handle.
  - **Text & style.** Unicode fonts, borders, emoji packs, per-module prefix and suffix, quotes and facts, a marquee and a typewriter effect.
  - **Behavior.** Pages and rotation, priority order and what happens past the 144-character limit, schedules, quick messages with hotkeys, a profanity filter, and profiles you can import and export.
  
  The 144-character limit and VRChat's rate limit are always respected. Existing MagicChatbox settings can be imported, read-only.

## Requirements

- Windows 10 or 11, 64-bit
- Nothing else to install: the audio engine ships with its own .NET 8 runtime (since 2.2.2)
- Optional: [VB-Audio Cable / Hi-Fi Cable](https://vb-audio.com/Cable/) for routing to other apps. Blur Sounds Pro can install Hi-Fi Cable for you (downloaded from VB-Audio at click time). VB-Audio's cables are donationware: if you use them, please consider [supporting VB-Audio](https://vb-audio.com/Voicemeeter/Donationware.htm).
- Optional: VRChat with OSC turned on (Action Menu → Options → OSC → Enabled) for the chatbox. Mute and heart rate need OSC output on port 9001 (configurable).
- Optional: an AMD GPU for hardware encoding. Without one, x264 is used.

Your settings are stored in `%APPDATA%\Blur Sounds Pro\settings.json`. If the audio engine won't start, the Mixer shows why, with a Retry button and an Open logs button (`%APPDATA%\Blur Sounds Pro\logs\helper.log`). Nothing personal is included in the app.

## Build from source

You can build on Windows, or on Linux by cross-building with Wine for electron-builder and `x86_64-w64-mingw32-gcc` for RNNoise and SpeexDSP. You need Node 20+, the .NET 8 SDK and Python 3. DeepFilterNet3 (`df.dll`) is built with Rust (`cargo`, plus the `x86_64-pc-windows-gnu` target when cross-building); without Rust the app falls back to RNNoise.

```bash
npm ci
npm run build        # fetch deps -> build helper -> build UI -> package -> zip
```

That produces `release/win-unpacked/` and `release/BlurSoundsPro-<version>-win-x64.zip`.

Individual steps:

```bash
npm run fetch-deps     # Vosk model, FFmpeg, RNNoise, SpeexDSP, DeepFilterNet3 (downloaded/built, not committed)
npm run build:helper   # .NET audio helper (self-contained, single file) -> helper-bin/
npm run build:renderer # React UI -> renderer/
npm run dev            # UI preview in a browser with mock data
```

### Third-party binaries

Large and third-party binaries are **not** committed. `scripts/fetch-deps.cjs` downloads them at build time:

| Component | Source | License |
|---|---|---|
| FFmpeg 6.1.1 (GPL build) | [eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1) | GPL-3.0 |
| Vosk small English model 0.15 | [alphacephei.com/vosk/models](https://alphacephei.com/vosk/models) | Apache-2.0 |
| RNNoise 0.2 (built from source with MinGW) | [xiph/rnnoise](https://github.com/xiph/rnnoise) | BSD-3-Clause |
| SpeexDSP 1.2.1 (built from source with MinGW) | [xiph/speexdsp](https://github.com/xiph/speexdsp) | BSD-3-Clause |
| DeepFilterNet3 model + libDF (`df.dll`, built with Rust) | [Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) | MIT / Apache-2.0 |
| NAudio, Vosk API, ONNX Runtime DirectML (NuGet) | restored by `dotnet publish` | MIT / Apache-2.0 |
| Voice changer models (downloaded by the app on first use, not bundled) | RMVPE: [lj1995/VoiceConversionWebUI](https://huggingface.co/lj1995/VoiceConversionWebUI); ContentVec and voices: [voice-models-v1 release](https://github.com/exile-tenshi/Blur-Sounds/releases/tag/voice-models-v1) (converted from RVC-Project, content-vec-best and KoeAI/llvc_models) | MIT; voices trained on LibriSpeech / VCTK (CC BY 4.0) |

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Project layout

```
electron/   main process: settings, chatbox engine + data sources, clips/recording, share/export
src/        React UI (Vite)
helper/     .NET 8 audio engine (WASAPI process loopback, mixer, DSP, Vosk, system stats)
scripts/    fetch-deps, chatbox option schema generator, zip packager
```

---

## Credits

### Beta / Application Testers

Huge shoutout to the people who sat through the fails, the grit, and the late-night rebuilds:

- **sadpringles**, compatibility testing lead. Absolute legend.
- **mariposa**
- **where**
- the **black cat in VRChat**
- **faded staff**, for listening to the fails

Thank you for testing Blur Sounds when it was still breaking. This release exists because you kept listening.

### Built with

Electron, React, Vite, NAudio, Vosk, ONNX Runtime, RVC / ContentVec / RMVPE, RNNoise, SpeexDSP, DeepFilterNet, FFmpeg, open-meteo, and the VRChat OSC chatbox protocol. The chatbox is inspired by MagicChatbox.
