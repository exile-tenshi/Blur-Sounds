export type AudioDeviceKind = 'input' | 'output'

export type RouteTarget = 'hifi-cable'

export type BackendMode = 'native-engine'

export type EngineState = 'stopped' | 'starting' | 'running' | 'error'

export type RouteState = 'detached' | 'attaching' | 'live' | 'error'

export interface AudioDevice {
  id: string
  name: string
  kind: AudioDeviceKind
  isAvailable: boolean
  isDefault: boolean
}

export interface AudioApplication {
  id: string
  processId: number
  processName: string
  displayName: string
  executablePath?: string
  hasVisibleWindow: boolean
}

export interface RoutedInput {
  routeId: string
  appId: string
  processName?: string
  target: RouteTarget
  volume: number
  level: number
  muted: boolean
  eqEnabled?: boolean
  band60Db?: number
  band150Db?: number
  band400Db?: number
  band1000Db?: number
  band2400Db?: number
  band15000Db?: number
  /** @deprecated legacy 3-band */
  bassDb?: number
  /** @deprecated legacy 3-band */
  midDb?: number
  /** @deprecated legacy 3-band */
  trebleDb?: number
  state: RouteState
  lastError?: string
}

export interface MicrophoneSlot {
  id: string
  deviceId?: string
  muted: boolean
  volume: number
}

export interface DeviceSelection {
  microphones?: MicrophoneSlot[]
  /** @deprecated use microphones[] */
  microphoneId?: string
  inputDeviceId?: string
  recordingDeviceId?: string
  /** @deprecated use microphones[] */
  microphoneMuted?: boolean
  /** @deprecated use microphones[] */
  microphoneVolume?: number
}

export interface AudioSnapshot {
  devices: AudioDevice[]
  applications: AudioApplication[]
  routedInputs: RoutedInput[]
  selection: DeviceSelection
  backendMode: BackendMode
  engine: EngineStatus
  hifiCable: HifiCableInfo
  lastUpdatedAt: string
}

export interface HifiCableEndpointStatus {
  deviceName: string
  sampleRate: number
  bitsPerSample: number
  exclusiveModeEnabled: boolean
  atStudioQuality: boolean
  formatLabel: string
}

export interface HifiCableInfo {
  installed: boolean
  playbackReady: boolean
  recordingReady: boolean
  playbackDevices: string[]
  recordingDevices: string[]
  preferredPlaybackDeviceId?: string
  productUrl: string
  downloadUrl: string
  formatSpec: string
  qualityLabel: string
  playbackAtStudioQuality?: boolean
  recordingAtStudioQuality?: boolean
  playbackFormatLabel?: string
  recordingFormatLabel?: string
  exclusiveModeReady?: boolean
}

export interface EngineSessionLevel {
  processId: number
  peak: number
}

export interface EngineStatus {
  state: EngineState
  helperConnected: boolean
  message?: string
  latencyMs: number
  underrunCount: number
  selectedMicrophoneReady: boolean
  selectedInputReady: boolean
  outputLevel: number
  outputPullLevel?: number
  mixPullLevel?: number
  microphoneLevel: number
  sessionLevels: EngineSessionLevel[]
}

export interface EngineRouteTelemetry {
  appId: string
  level: number
  state: RouteState
  lastError?: string
}

export interface SetDeviceSelectionPayload {
  microphones?: MicrophoneSlot[]
  microphoneId?: string
  inputDeviceId?: string
  recordingDeviceId?: string
  microphoneMuted?: boolean
  microphoneVolume?: number
}

export interface SetMicrophoneSlotPayload {
  slotId: string
  deviceId?: string
  muted?: boolean
  volume?: number
}

export interface SetMicrophoneMutedPayload {
  slotId?: string
  muted: boolean
}

export interface SetMicrophoneVolumePayload {
  slotId?: string
  volume: number
}

export interface SetRouteVolumePayload {
  routeId: string
  volume: number
}

import type { RouteEqualizerSettings } from './audioConstants.js'

export interface SetRouteEqualizerPayload {
  routeId: string
  equalizer: RouteEqualizerSettings
}

export interface SetRouteMutedPayload {
  routeId: string
  muted: boolean
}

export interface SetRouteAssignmentPayload {
  appId: string
  target: RouteTarget
  enabled: boolean
}

export interface EngineCommandPayload {
  selection: DeviceSelection
  routes: RoutedInput[]
}
