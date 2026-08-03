# AGENTS.md

## Cursor Cloud specific instructions

Blur Sounds is a **Windows-targeted Electron + React (Vite) desktop app** for routing mic/app audio through VB-Audio Hi-Fi Cable, with clip recording and mic noise suppression. Standard commands live in `README.md` and `package.json` scripts; only the non-obvious, Linux/cloud-specific caveats are captured here.

### What runs on the Linux cloud VM

- `npm install` — install JS deps (this is the only startup step needed; it's the update script).
- `npm run lint` — oxlint over `src` + `vite.config.ts` (emits warnings, exits 0).
- `npx vite build` — builds the renderer + Electron main/preload bundles. Use this to verify a cross-platform build. Do NOT run the full `npm run build` / `npm run dist` / `npm run portable` here: they invoke the PowerShell scripts in `scripts/` (installer/portable/engine publish) and require Windows + PowerShell + the .NET SDK.
- `npm run dev` — Vite starts and `vite-plugin-electron` auto-launches Electron against the dev server. A running X display is required; this VM already has `DISPLAY=:1`. Electron launches with `--no-sandbox` automatically here, so no extra flags are needed.

### Expected non-fatal behavior on Linux (NOT bugs)

The app is built for Windows, but the Electron shell and renderer run fine on Linux for UI development. Because Windows-only backends are absent, expect (and ignore) these:

- `PowerShell audio query failed: spawn powershell.exe ENOENT` — device/app enumeration in `src/main/audio/windowsAudioService.ts` shells out to `powershell.exe`. It is wrapped in try/catch and returns empty lists, so the Mixer shows "No devices found" and the Applications/Mix panels are empty. This is expected.
- The native `.NET` audio engine (`engine/VoiceMeeterEngine`, TFM `net8.0-windows10.0.19041.0`) is Windows-only and cannot be built or run on Linux. It is spawned lazily only when the user clicks **Start stream** (`engineBridge.ts`), so it never blocks app startup. "Start stream" and noise-suppression sliders that need an assigned mic will not function without Windows audio hardware.
- Harmless console noise: `dbus/bus.cc ... Failed to connect to the bus`, `WebGL blocklisted`, and the Electron insecure-CSP warning.

### Good Linux-safe smoke test (core functionality)

The **Clips** section works fully on Linux: toggle "Run buffer in background" (the main-process clip recorder starts and the top status bar counts up in real time) and change the lookback duration (a persisted setting). Settings persist across section navigation via the on-disk settings store. This exercises the renderer ↔ IPC ↔ main-process path without needing Windows audio.
