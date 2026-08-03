import { contextBridge, ipcRenderer } from 'electron'
import { audioChannels, type AudioControlApi } from '../shared/audioApi.js'
import { clipChannels, type ClipControlApi } from '../shared/clipApi.js'
import { settingsChannels, type SettingsControlApi } from '../shared/settingsApi.js'

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
  setMicrophoneNoiseSuppression: (
    payload: Parameters<AudioControlApi['setMicrophoneNoiseSuppression']>[0],
  ) => ipcRenderer.invoke(audioChannels.setMicrophoneNoiseSuppression, payload),
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

const clipControlApi: ClipControlApi = {
  listSources: () => ipcRenderer.invoke(clipChannels.listSources),
  getStatus: () => ipcRenderer.invoke(clipChannels.getStatus),
  ensureOutputFolder: () => ipcRenderer.invoke(clipChannels.ensureOutputFolder),
  saveClip: (payload) => ipcRenderer.invoke(clipChannels.saveClip, payload),
  openOutputFolder: () => ipcRenderer.invoke(clipChannels.openOutputFolder),
  notifyRecordingState: (payload) => ipcRenderer.invoke(clipChannels.notifyRecordingState, payload),
  getSettings: () => ipcRenderer.invoke(clipChannels.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(clipChannels.setSettings, patch),
  addKeybind: (accelerator) => ipcRenderer.invoke(clipChannels.addKeybind, accelerator),
  removeKeybind: (accelerator) => ipcRenderer.invoke(clipChannels.removeKeybind, accelerator),
  onTriggerClip: (listener) => {
    const wrapped = () => listener()
    ipcRenderer.on(clipChannels.subscribeTrigger, wrapped)
    return () => {
      ipcRenderer.removeListener(clipChannels.subscribeTrigger, wrapped)
    }
  },
}

const settingsControlApi: SettingsControlApi = {
  get: () => ipcRenderer.invoke(settingsChannels.get),
  set: (patch) => ipcRenderer.invoke(settingsChannels.set, patch),
  subscribe: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, settings: Parameters<typeof listener>[0]) => {
      listener(settings)
    }
    ipcRenderer.on(settingsChannels.subscribe, wrapped)
    return () => {
      ipcRenderer.removeListener(settingsChannels.subscribe, wrapped)
    }
  },
}

contextBridge.exposeInMainWorld('audioControl', audioControlApi)
contextBridge.exposeInMainWorld('clipControl', clipControlApi)
contextBridge.exposeInMainWorld('settingsControl', settingsControlApi)
