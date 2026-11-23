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
- **Mic chain.** Noise gate, RNNoise noise suppression, compressor, EQ and a ClearCast-style voice preset. The processed mic can be sent to a cable.
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
- [.NET 8 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/8.0) for the audio helper
- Optional: [VB-Audio Cable / Hi-Fi Cable](https://vb-audio.com/Cable/) for routing to other apps
- Optional: VRChat with OSC turned on (Action Menu → Options → OSC → Enabled) for the chatbox. Mute and heart rate need OSC output on port 9001 (configurable).
- Optional: an AMD GPU for hardware encoding. Without one, x264 is used.

Your settings are stored in `%APPDATA%\Blur Sounds Pro\settings.json`. Nothing personal is included in the app.

## Build from source

You can build on Windows, or on Linux by cross-building with Wine for electron-builder and `x86_64-w64-mingw32-gcc` for RNNoise. You need Node 20+, the .NET 8 SDK and Python 3.

```bash
npm ci
npm run build        # fetch deps -> build helper -> build UI -> package -> zip
```

That produces `release/win-unpacked/` and `release/BlurSoundsPro-<version>-win-x64.zip`.

Individual steps:

```bash
npm run fetch-deps     # Vosk model, FFmpeg, RNNoise (downloaded/built, not committed)
npm run build:helper   # .NET audio helper -> helper-bin/
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
| NAudio, Vosk API (NuGet) | restored by `dotnet publish` | MIT / Apache-2.0 |

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

Electron, React, Vite, NAudio, Vosk, RNNoise, FFmpeg, open-meteo, and the VRChat OSC chatbox protocol. The chatbox is inspired by MagicChatbox.
