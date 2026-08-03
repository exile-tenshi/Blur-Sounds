export type ClipSourceKind = 'screen' | 'window'

export interface ClipSource {
  id: string
  name: string
  kind: ClipSourceKind
  displayId?: string
  thumbnailDataUrl?: string
}

export interface ClipRecordingStatus {
  recording: boolean
  sourceId?: string
  sourceName?: string
  startedAt?: string
  elapsedMs: number
  outputFolder: string
  lastClipPath?: string
  error?: string
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
} as const

export interface ClipControlApi {
  listSources: () => Promise<ClipSource[]>
  getStatus: () => Promise<ClipRecordingStatus>
  ensureOutputFolder: () => Promise<string>
  saveClip: (payload: SaveClipPayload) => Promise<SaveClipResult>
  openOutputFolder: () => Promise<string>
  notifyRecordingState: (payload: {
    recording: boolean
    sourceId?: string
    sourceName?: string
    error?: string
  }) => Promise<ClipRecordingStatus>
}
