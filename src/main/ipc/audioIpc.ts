import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { audioChannels } from '../../shared/audioApi.js'
import type {
  AudioSnapshot,
  SetDeviceSelectionPayload,
  SetMicrophoneMutedPayload,
  SetMicrophoneNoiseSuppressionPayload,
  SetMicrophoneVolumePayload,
  SetRouteAssignmentPayload,
  SetRouteEqualizerPayload,
  SetRouteMutedPayload,
  SetRouteVolumePayload,
} from '../../shared/audioTypes.js'
import { RoutingStore } from '../audio/routingStore.js'
import { openWindowsSoundSettings } from '../system/openSoundSettings.js'

export function registerAudioIpc(mainWindow: BrowserWindow): RoutingStore {
  const store = new RoutingStore()

  const publishSnapshot = (snapshot: AudioSnapshot): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(audioChannels.subscribeSnapshot, snapshot)
    }
  }

  store.subscribe(publishSnapshot)

  ipcMain.handle(audioChannels.getSnapshot, () => store.getSnapshot())
  ipcMain.handle(audioChannels.refreshSnapshot, () => store.refresh())
  ipcMain.handle(audioChannels.startEngine, () => store.startEngine())
  ipcMain.handle(audioChannels.stopEngine, () => store.stopEngine())
  ipcMain.handle(audioChannels.setDeviceSelection, (_event, payload: SetDeviceSelectionPayload) =>
    store.setDeviceSelection(payload),
  )
  ipcMain.handle(audioChannels.setRouteAssignment, (_event, payload: SetRouteAssignmentPayload) =>
    store.setRouteAssignment(payload),
  )
  ipcMain.handle(audioChannels.setRouteVolume, (_event, payload: SetRouteVolumePayload) =>
    store.setRouteVolume(payload),
  )
  ipcMain.handle(audioChannels.setRouteEqualizer, (_event, payload: SetRouteEqualizerPayload) =>
    store.setRouteEqualizer(payload),
  )
  ipcMain.handle(audioChannels.setRouteMuted, (_event, payload: SetRouteMutedPayload) =>
    store.setRouteMuted(payload),
  )
  ipcMain.handle(audioChannels.setMicrophoneMuted, (_event, payload: SetMicrophoneMutedPayload) =>
    store.setMicrophoneMuted(payload),
  )
  ipcMain.handle(audioChannels.setMicrophoneVolume, (_event, payload: SetMicrophoneVolumePayload) =>
    store.setMicrophoneVolume(payload),
  )
  ipcMain.handle(
    audioChannels.setMicrophoneNoiseSuppression,
    (_event, payload: SetMicrophoneNoiseSuppressionPayload) =>
      store.setMicrophoneNoiseSuppression(payload),
  )
  ipcMain.handle(audioChannels.openHifiCablePlaybackSettings, () =>
    openWindowsSoundSettings('playback'),
  )
  ipcMain.handle(audioChannels.openHifiCableRecordingSettings, () =>
    openWindowsSoundSettings('recording'),
  )
  ipcMain.handle(audioChannels.applyHifiCableStudioSettings, () =>
    store.applyHifiCableStudioSettings(),
  )

  return store
}
