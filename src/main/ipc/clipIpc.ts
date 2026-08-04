import type { BrowserWindow, DesktopCapturerSource } from 'electron'
import { ipcMain, session } from 'electron'
import { clipChannels } from '../../shared/clipApi.js'
import type { SaveClipPayload } from '../../shared/clipApi.js'
import type { ClipSettings } from '../../shared/appSettings.js'
import { ClipRecorderService } from '../recording/clipRecorder.js'
import { ClipKeybindService } from '../recording/clipKeybinds.js'
import type { SettingsStore } from '../settings/settingsStore.js'

export function registerClipIpc(
  mainWindow: BrowserWindow,
  settings: SettingsStore,
  keybinds: ClipKeybindService,
): ClipRecorderService {
  const recorder = new ClipRecorderService(settings)
  keybinds.setMainWindow(mainWindow)
  keybinds.refresh()

  settings.subscribe(() => {
    keybinds.refresh()
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

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const grant = (source: DesktopCapturerSource) => {
      const isScreen = source.id.startsWith('screen:')
      // System loopback is reliable with screen capture; window + loopback is
      // rejected as "Invalid capture constraints" on some Electron builds.
      callback(
        isScreen
          ? { video: source, audio: 'loopback' }
          : { video: source },
      )
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

  ipcMain.handle(
    clipChannels.listSources,
    (_event, options?: { includeWindows?: boolean }) => recorder.listSources(options),
  )
  ipcMain.handle(clipChannels.getStatus, () => recorder.getStatus())
  ipcMain.handle(clipChannels.ensureOutputFolder, () => recorder.ensureOutputFolder())
  ipcMain.handle(clipChannels.openOutputFolder, () => recorder.openOutputFolder())
  ipcMain.handle(clipChannels.saveClip, (_event, payload: SaveClipPayload) =>
    recorder.saveClip(payload),
  )
  ipcMain.handle(clipChannels.notifyRecordingState, (_event, payload) =>
    recorder.setRecordingState(payload),
  )
  ipcMain.handle(clipChannels.getSettings, () => settings.get().clip)
  ipcMain.handle(clipChannels.setSettings, (_event, patch: Partial<ClipSettings>) => {
    const next = settings.set({ clip: patch })
    keybinds.refresh()
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
  ipcMain.handle(clipChannels.triggerClip, () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(clipChannels.subscribeTrigger)
    }
    return recorder.getStatus()
  })

  return recorder
}
