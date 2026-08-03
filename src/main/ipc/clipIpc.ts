import type { BrowserWindow } from 'electron'
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
    try {
      const preferredId = settings.get().clip.sourceId
      const { desktopCapturer } = await import('electron')
      const capturerSources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      })
      const match =
        (preferredId
          ? capturerSources.find((source) => source.id === preferredId)
          : undefined) ??
        capturerSources.find((source) => source.id.startsWith('screen:')) ??
        capturerSources[0]

      if (!match) {
        callback({})
        return
      }

      callback({
        video: match,
        audio: 'loopback',
      })
    } catch {
      callback({})
    }
  })

  ipcMain.handle(
    clipChannels.listSources,
    (_event, options?: { includeWindows?: boolean }) => recorder.listSources(options),
  )
  ipcMain.handle(clipChannels.getSourcePreview, (_event, sourceId: string) =>
    recorder.getSourcePreview(sourceId),
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
