import { contextBridge, ipcRenderer } from 'electron'
import { audioChannels, type AudioControlApi } from '../shared/audioApi.js'

const audioControlApi: AudioControlApi = {
  getSnapshot: () => ipcRenderer.invoke(audioChannels.getSnapshot),
  refreshSnapshot: () => ipcRenderer.invoke(audioChannels.refreshSnapshot),
  startEngine: () => ipcRenderer.invoke(audioChannels.startEngine),
  stopEngine: () => ipcRenderer.invoke(audioChannels.stopEngine),
  setDeviceSelection: (payload: Parameters<AudioControlApi['setDeviceSelection']>[0]) =>
    ipcRenderer.invoke(audioChannels.setDeviceSelection, payload),
  setRouteAssignment: (payload: Parameters<AudioControlApi['setRouteAssignment']>[0]) =>
    ipcRenderer.invoke(audioChannels.setRouteAssignment, payload),
  setRouteVolume: (payload: Parameters<AudioControlApi['setRouteVolume']>[0]) =>
    ipcRenderer.invoke(audioChannels.setRouteVolume, payload),
  setRouteEqualizer: (payload: Parameters<AudioControlApi['setRouteEqualizer']>[0]) =>
    ipcRenderer.invoke(audioChannels.setRouteEqualizer, payload),
  setRouteMuted: (payload: Parameters<AudioControlApi['setRouteMuted']>[0]) =>
    ipcRenderer.invoke(audioChannels.setRouteMuted, payload),
  setMicrophoneMuted: (payload: Parameters<AudioControlApi['setMicrophoneMuted']>[0]) =>
    ipcRenderer.invoke(audioChannels.setMicrophoneMuted, payload),
  setMicrophoneVolume: (payload: Parameters<AudioControlApi['setMicrophoneVolume']>[0]) =>
    ipcRenderer.invoke(audioChannels.setMicrophoneVolume, payload),
  openHifiCablePlaybackSettings: () => ipcRenderer.invoke(audioChannels.openHifiCablePlaybackSettings),
  openHifiCableRecordingSettings: () => ipcRenderer.invoke(audioChannels.openHifiCableRecordingSettings),
  applyHifiCableStudioSettings: () => ipcRenderer.invoke(audioChannels.applyHifiCableStudioSettings),
  subscribeSnapshot: (listener: Parameters<AudioControlApi['subscribeSnapshot']>[0]) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof listener>[0]) => {
      listener(snapshot)
    }

    ipcRenderer.on(audioChannels.subscribeSnapshot, wrappedListener)

    return () => {
      ipcRenderer.removeListener(audioChannels.subscribeSnapshot, wrappedListener)
    }
  },
}

contextBridge.exposeInMainWorld('audioControl', audioControlApi)
