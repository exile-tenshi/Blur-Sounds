# Blur Sounds

Mix your microphone and application audio through **VB-Audio Hi-Fi Cable** — built for clean routing into Discord, VRChat, and other apps.

**Download:** [Blur Sounds releases](https://github.com/exile-tenshi/Blur-Sounds/releases/latest)

---

## What’s new

- **Discord-style sidebar** — Mixer, Noise, Clips, and Setup sections.
- **Instant replay clips** — background buffer remembers your chosen lookback (e.g. 2 minutes). **Clip it** saves that prior window plus 25% forward. Multiple global keybinds supported. Files land in `Desktop\Blur Sounds Clips`.
- **Noise suppression editor** — SteelSeries-style controls for strength, voice threshold, high-pass, attack, and release.
- **Portable Desktop folder** — `npm run portable` builds the app and copies it to `Desktop\Blur Sounds`.

---

## Beta / Application Testers

Huge shoutout to the people who sat through the fails, the grit, and the late-night rebuilds:

### Compatibility testing team

- **sadpringles** — compatibility testing lead. Absolute legend.

### Huge shoutouts

- **mariposa**
- **where**
- the **black cat in VRChat**
- **faded staff** — for listening to the fails

Thank you for testing Blur Sounds when it was still breaking. This release exists because you kept listening.

---

## Requirements

- Windows 10/11
- [VB-Audio Hi-Fi Cable & ASIO Bridge](http://vincent.burel.free.fr/VirtualAudioApps/HiFiCableAsioBridgeSetup_v1007.zip) ([product page](https://vb-audio.com/Cable/index.htm))

## Quick start

1. Install [Hi-Fi Cable & ASIO Bridge](http://vincent.burel.free.fr/VirtualAudioApps/HiFiCableAsioBridgeSetup_v1007.zip)
2. Install [Blur Sounds](https://github.com/exile-tenshi/Blur-Sounds/releases/latest) — or run `npm run portable` to place a folder on your Desktop
3. Open the app → **Apply clean audio settings**
4. Pick your mic + apps, then **Start stream**
5. Set Discord / VRChat / etc. to **Hi-Fi Cable Output**
6. Optional: enable **Noise suppression** on your mic, or use **Clip recordings** to save desktop/game takes as MP4

## Build from source

```bash
npm install
npm run build:engine:release
npm run start
```

Installer:

```bash
npm run dist
```

Portable Desktop folder:

```bash
npm run portable
```
