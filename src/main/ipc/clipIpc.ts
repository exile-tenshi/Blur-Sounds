import type { BrowserWindow, DesktopCapturerSource } from 'electron'
import { ipcMain, session } from 'electron'
import { clipChannels } from '../../shared/clipApi.js'
import type { SaveClipPayload, ClipOverlayPayload } from '../../shared/clipApi.js'
import type { ClipSettings } from '../../shared/appSettings.js'
import { ClipRecorderService } from '../recording/clipRecorder.js'
import { ClipKeybindService } from '../recording/clipKeybinds.js'
import { ClipVoiceCommandService } from '../recording/clipVoiceCommands.js'
import { showClipOverlay } from '../recording/clipOverlay.js'
import type { SettingsStore } from '../settings/settingsStore.js'

function keybindsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  return left.every((item, index) => item === right[index])
}

export function registerClipIpc(
  mainWindow: BrowserWindow,
  settings: SettingsStore,
  keybinds: ClipKeybindService,
  voiceCommands?: ClipVoiceCommandService,
): ClipRecorderService {
  const recorder = new ClipRecorderService(settings)
  keybinds.setMainWindow(mainWindow)
  keybinds.setClipGate(() => {
    const status = recorder.getStatus()
    if (status.bufferState === 'clipping') {
      return { ok: false, reason: 'A clip is already saving — wait a moment.' }
    }
    if (!status.buffering || status.bufferState === 'idle' || status.bufferState === 'error') {
      return {
        ok: false,
        reason: 'Turn on “Run buffer in background” on the Clips tab first.',
      }
    }
    return { ok: true }
  })
  keybinds.refresh()
  voiceCommands?.refresh()

  let trackedKeybinds = [...settings.get().clip.keybinds]
  let trackedVoiceEnabled = settings.get().clip.voiceCommandsEnabled !== false

  settings.subscribe((next) => {
    const nextKeybinds = next.clip.keybinds
    const nextVoiceEnabled = next.clip.voiceCommandsEnabled !== false

    if (!keybindsEqual(trackedKeybinds, nextKeybinds)) {
      trackedKeybinds = [...nextKeybinds]
      keybinds.refresh()
    }

    if (nextVoiceEnabled !== trackedVoiceEnabled) {
      trackedVoiceEnabled = nextVoiceEnabled
      voiceCommands?.refresh()
    }
  })

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (
      permission === 'media' ||
      permission === 'display-capture' ||
      permission === 'mediaKeySystem'
    ) {
      callback(true)
      return
    }

    callback(false)
  })

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return (
      permission === 'media' ||
      permission === 'display-capture' ||
      permission === 'fullscreen' ||
      permission === 'clipboard-sanitized-write'
    )
  })

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const grant = (source: DesktopCapturerSource) => {
      // Video-only. Screen + loopback audio is rejected as "Could not start video source"
      // on several Windows/Electron builds. Clip audio is optional; the mix is Hi-Fi Cable.
      callback({ video: source })
    }

    try {
      const preferredId = settings.get().clip.sourceId
      const match = await recorder.resolveCaptureSource(preferredId)
      if (match) {
        grant(match)
        return
      }

      const fallback = await recorder.resolveScreenSource()
      if (fallback) {
        grant(fallback)
        return
      }

      callback({})
    } catch {
      try {
        const fallback = await recorder.resolveScreenSource()
        if (fallback) {
          grant(fallback)
          return
        }
      } catch {
        // Last resort below.
      }

      // Empty grant rejects getDisplayMedia — prefer that over freezing forever.
      callback({})
    }
  })

  const withVoiceStatus = () => {
    const status = recorder.getStatus()
    return {
      ...status,
      voiceListener: voiceCommands?.getState() ?? (status.voiceCommandsEnabled ? 'starting' : 'off'),
      voiceListenerError: voiceCommands?.getError(),
    }
  }

  ipcMain.handle(
    clipChannels.listSources,
    (_event, options?: { includeWindows?: boolean }) => recorder.listSources(options),
  )
  ipcMain.handle(clipChannels.getStatus, () => withVoiceStatus())
  ipcMain.handle(clipChannels.ensureOutputFolder, () => recorder.ensureOutputFolder())
  ipcMain.handle(clipChannels.openOutputFolder, () => recorder.openOutputFolder())
  ipcMain.handle(clipChannels.saveClip, (_event, payload: SaveClipPayload) =>
    recorder.saveClip(payload),
  )
  ipcMain.handle(clipChannels.notifyRecordingState, (_event, payload) => {
    recorder.setRecordingState(payload)
    return withVoiceStatus()
  })
  ipcMain.handle(clipChannels.getSettings, () => settings.get().clip)
  ipcMain.handle(clipChannels.setSettings, (_event, patch: Partial<ClipSettings>) => {
    const next = settings.set({ clip: patch })
    if (patch.keybinds) {
      keybinds.refresh()
    }
    if (typeof patch.voiceCommandsEnabled === 'boolean') {
      voiceCommands?.refresh()
    }
    return next.clip
  })
  ipcMain.handle(clipChannels.addKeybind, (_event, accelerator: string) => {
    const current = settings.get().clip.keybinds
    if (!accelerator?.trim()) {
      return settings.get().clip
    }
    if (current.includes(accelerator.trim())) {
      return settings.get().clip
    }
    const next = settings.set({
      clip: { keybinds: [...current, accelerator.trim()] },
    })
    keybinds.refresh()
    return next.clip
  })
  ipcMain.handle(clipChannels.removeKeybind, (_event, accelerator: string) => {
    const next = settings.set({
      clip: {
        keybinds: settings.get().clip.keybinds.filter((item) => item !== accelerator),
      },
    })
    keybinds.refresh()
    return next.clip
  })
  ipcMain.handle(clipChannels.showOverlay, (_event, payload: ClipOverlayPayload) => {
    showClipOverlay(payload)
  })
  ipcMain.handle(clipChannels.triggerClip, () => {
    keybinds.triggerClip('ui')
    return recorder.getStatus()
  })

  return recorder
}
