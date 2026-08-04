import type { ClipLookbackSeconds, ClipSettings } from './appSettings.js'

export type ClipSourceKind = 'screen' | 'window'

export interface ClipSource {
  id: string
  name: string
  kind: ClipSourceKind
  displayId?: string
  thumbnailDataUrl?: string
  /** Present for app:/game sources from the live process list. */
  processName?: string
  processId?: number
}

export type ClipBufferState = 'idle' | 'buffering' | 'clipping' | 'error'

export interface ClipRecordingStatus {
  recording: boolean
  buffering: boolean
  bufferState: ClipBufferState
  sourceId?: string
  sourceName?: string
  startedAt?: string
  elapsedMs: number
  bufferedSeconds: number
  lookbackSeconds: ClipLookbackSeconds
  forwardSeconds: number
  outputFolder: string
  lastClipPath?: string
  error?: string
  keybinds: string[]
}

export interface SaveClipPayload {
  data: ArrayBuffer | Uint8Array
  mimeType: string
  sourceName?: string
}

export interface SaveClipResult {
  path: string
  fileName: string
  folder: string
}

export const clipChannels = {
  listSources: 'clip:listSources',
  getStatus: 'clip:getStatus',
  ensureOutputFolder: 'clip:ensureOutputFolder',
  saveClip: 'clip:saveClip',
  openOutputFolder: 'clip:openOutputFolder',
  notifyRecordingState: 'clip:notifyRecordingState',
  getSettings: 'clip:getSettings',
  setSettings: 'clip:setSettings',
  addKeybind: 'clip:addKeybind',
  removeKeybind: 'clip:removeKeybind',
  triggerClip: 'clip:triggerClip',
  subscribeTrigger: 'clip:subscribeTrigger',
} as const

export interface ClipControlApi {
  listSources: (options?: { includeWindows?: boolean }) => Promise<ClipSource[]>
  getStatus: () => Promise<ClipRecordingStatus>
  ensureOutputFolder: () => Promise<string>
  saveClip: (payload: SaveClipPayload) => Promise<SaveClipResult>
  openOutputFolder: () => Promise<string>
  notifyRecordingState: (payload: {
    recording?: boolean
    buffering?: boolean
    bufferState?: ClipBufferState
    sourceId?: string
    sourceName?: string
    bufferedSeconds?: number
    error?: string
  }) => Promise<ClipRecordingStatus>
  getSettings: () => Promise<ClipSettings>
  setSettings: (patch: Partial<ClipSettings>) => Promise<ClipSettings>
  addKeybind: (accelerator: string) => Promise<ClipSettings>
  removeKeybind: (accelerator: string) => Promise<ClipSettings>
  /** Ask the renderer to save an instant replay clip (also fired by hotkeys). */
  onTriggerClip: (listener: () => void) => () => void
}
