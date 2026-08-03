import type { BrowserWindow } from 'electron'
import { ipcMain, session } from 'electron'
import { clipChannels } from '../../shared/clipApi.js'
import type { SaveClipPayload } from '../../shared/clipApi.js'
import { ClipRecorderService } from '../recording/clipRecorder.js'

export function registerClipIpc(_mainWindow: BrowserWindow): ClipRecorderService {
  const recorder = new ClipRecorderService()

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
      const sources = await recorder.listSources()
      const preferred =
        sources.find((source) => source.kind === 'screen') ?? sources[0]

      if (!preferred) {
        callback({})
        return
      }

      const { desktopCapturer } = await import('electron')
      const capturerSources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 1, height: 1 },
      })
      const match = capturerSources.find((source) => source.id === preferred.id)

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

  ipcMain.handle(clipChannels.listSources, () => recorder.listSources())
  ipcMain.handle(clipChannels.getStatus, () => recorder.getStatus())
  ipcMain.handle(clipChannels.ensureOutputFolder, () => recorder.ensureOutputFolder())
  ipcMain.handle(clipChannels.openOutputFolder, () => recorder.openOutputFolder())
  ipcMain.handle(clipChannels.saveClip, (_event, payload: SaveClipPayload) =>
    recorder.saveClip(payload),
  )
  ipcMain.handle(
    clipChannels.notifyRecordingState,
    (
      _event,
      payload: {
        recording: boolean
        sourceId?: string
        sourceName?: string
        error?: string
      },
    ) => recorder.setRecordingState(payload),
  )

  return recorder
}
