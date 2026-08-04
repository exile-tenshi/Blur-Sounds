import type {
  AudioSnapshot,
  HifiCableEndpointStatus,
  SetDeviceSelectionPayload,
  SetMicrophoneMutedPayload,
  SetMicrophoneNoiseSuppressionPayload,
  SetMicrophoneVolumePayload,
  SetRouteAssignmentPayload,
  SetRouteMutedPayload,
  SetRouteEqualizerPayload,
  SetRouteVolumePayload,
} from './audioTypes.js'

export const audioChannels = {
  getSnapshot: 'audio:getSnapshot',
  refreshSnapshot: 'audio:refreshSnapshot',
  startEngine: 'audio:startEngine',
  stopEngine: 'audio:stopEngine',
  setDeviceSelection: 'audio:setDeviceSelection',
  setRouteAssignment: 'audio:setRouteAssignment',
  setRouteVolume: 'audio:setRouteVolume',
  setRouteEqualizer: 'audio:setRouteEqualizer',
  setRouteMuted: 'audio:setRouteMuted',
  setMicrophoneMuted: 'audio:setMicrophoneMuted',
  setMicrophoneVolume: 'audio:setMicrophoneVolume',
  setMicrophoneNoiseSuppression: 'audio:setMicrophoneNoiseSuppression',
  subscribeSnapshot: 'audio:subscribeSnapshot',
  openHifiCablePlaybackSettings: 'system:openHifiCablePlaybackSettings',
  openHifiCableRecordingSettings: 'system:openHifiCableRecordingSettings',
  applyHifiCableStudioSettings: 'audio:applyHifiCableStudioSettings',
  probeHifiCable: 'audio:probeHifiCable',
} as const

export interface HifiCableFormatResult {
  playbackConfigured: boolean
  recordingConfigured: boolean
  playbackDeviceName?: string
  recordingDeviceName?: string
  playbackStatus?: HifiCableEndpointStatus
  recordingStatus?: HifiCableEndpointStatus
  message: string
}

export interface AudioControlApi {
  getSnapshot: () => Promise<AudioSnapshot>
  refreshSnapshot: () => Promise<AudioSnapshot>
  startEngine: () => Promise<AudioSnapshot>
  stopEngine: () => Promise<AudioSnapshot>
  setDeviceSelection: (payload: SetDeviceSelectionPayload) => Promise<AudioSnapshot>
  setRouteAssignment: (payload: SetRouteAssignmentPayload) => Promise<AudioSnapshot>
  setRouteVolume: (payload: SetRouteVolumePayload) => Promise<AudioSnapshot>
  setRouteEqualizer: (payload: SetRouteEqualizerPayload) => Promise<AudioSnapshot>
  setRouteMuted: (payload: SetRouteMutedPayload) => Promise<AudioSnapshot>
  setMicrophoneMuted: (payload: SetMicrophoneMutedPayload) => Promise<AudioSnapshot>
  setMicrophoneVolume: (payload: SetMicrophoneVolumePayload) => Promise<AudioSnapshot>
  setMicrophoneNoiseSuppression: (payload: SetMicrophoneNoiseSuppressionPayload) => Promise<AudioSnapshot>
  subscribeSnapshot: (listener: (snapshot: AudioSnapshot) => void) => () => void
  openHifiCablePlaybackSettings: () => Promise<void>
  openHifiCableRecordingSettings: () => Promise<void>
  applyHifiCableStudioSettings: () => Promise<HifiCableFormatResult>
  probeHifiCable: () => Promise<string>
}
