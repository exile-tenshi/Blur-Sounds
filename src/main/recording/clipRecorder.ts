import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, desktopCapturer, shell } from 'electron'
import {
  forwardRollSeconds,
  type ClipLookbackSeconds,
} from '../../shared/appSettings.js'
import type {
  ClipBufferState,
  ClipRecordingStatus,
  ClipSource,
  SaveClipPayload,
  SaveClipResult,
} from '../../shared/clipApi.js'
import type { SettingsStore } from '../settings/settingsStore.js'

const CLIPS_FOLDER_NAME = 'Blur Sounds Clips'
const MAX_WINDOW_SOURCES = 40

function sanitizeFilePart(value: string): string {
  return (
    value
      .split('')
      .map((char) => {
        const code = char.charCodeAt(0)
        if (code < 32 || '<>:"/\\|?*'.includes(char)) {
          return ''
        }
        return char
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'clip'
  )
}

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('mp4')) {
    return 'mp4'
  }
  if (normalized.includes('webm')) {
    return 'webm'
  }
  return 'mp4'
}

function mapSources(
  sources: Electron.DesktopCapturerSource[],
  kindFilter?: ClipSource['kind'],
): ClipSource[] {
  return sources
    .filter((source) => source.name.trim().length > 0)
    .map((source) => {
      const isScreen = source.id.startsWith('screen:')
      return {
        id: source.id,
        name: source.name,
        kind: isScreen ? ('screen' as const) : ('window' as const),
        displayId: source.display_id || undefined,
      } satisfies ClipSource
    })
    .filter((source) => (kindFilter ? source.kind === kindFilter : true))
    .filter((source) => !/blur sounds/i.test(source.name))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export class ClipRecorderService {
  private recording = false
  private buffering = false
  private bufferState: ClipBufferState = 'idle'
  private sourceId?: string
  private sourceName?: string
  private startedAt?: number
  private bufferedSeconds = 0
  private lastClipPath?: string
  private error?: string
  private listSourcesInFlight = new Map<string, Promise<ClipSource[]>>()

  constructor(private readonly settings: SettingsStore) {}

  getOutputFolder(): string {
    return join(app.getPath('desktop'), CLIPS_FOLDER_NAME)
  }

  ensureOutputFolder(): string {
    const folder = this.getOutputFolder()
    mkdirSync(folder, { recursive: true })
    return folder
  }

  getStatus(): ClipRecordingStatus {
    const clip = this.settings.get().clip
    const startedAt = this.startedAt
    return {
      recording: this.recording,
      buffering: this.buffering,
      bufferState: this.bufferState,
      sourceId: this.sourceId ?? clip.sourceId,
      sourceName: this.sourceName,
      startedAt: startedAt ? new Date(startedAt).toISOString() : undefined,
      elapsedMs: this.recording && startedAt ? Date.now() - startedAt : 0,
      bufferedSeconds: this.bufferedSeconds,
      lookbackSeconds: clip.lookbackSeconds,
      forwardSeconds: forwardRollSeconds(clip.lookbackSeconds),
      outputFolder: this.getOutputFolder(),
      lastClipPath: this.lastClipPath,
      error: this.error,
      keybinds: [...clip.keybinds],
    }
  }

  /**
   * Names-only source list. Never generates thumbnails — batch toDataURL freezes Electron.
   * Screens first (fast), then a capped window list.
   */
  async listSources(options?: {
    includeThumbnails?: boolean
    includeWindows?: boolean
  }): Promise<ClipSource[]> {
    const includeWindows = options?.includeWindows !== false
    const cacheKey = includeWindows ? 'all' : 'screens'
    const existing = this.listSourcesInFlight.get(cacheKey)
    if (existing) {
      return existing
    }

    const pending = this.listSourcesInternal({ includeWindows }).finally(() => {
      this.listSourcesInFlight.delete(cacheKey)
    })
    this.listSourcesInFlight.set(cacheKey, pending)
    return pending
  }

  private async listSourcesInternal(options?: {
    includeWindows?: boolean
  }): Promise<ClipSource[]> {
    const includeWindows = options?.includeWindows !== false

    // Screens-only is cheap. Window enumeration is what freezes busy desktops.
    const screenSources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    })
    const screens = mapSources(screenSources, 'screen')

    if (!includeWindows) {
      return screens
    }

    const windowSources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    })
    const windows = mapSources(windowSources, 'window').slice(0, MAX_WINDOW_SOURCES)
    return [...screens, ...windows]
  }

  /** One small JPEG preview for the selected source — never for the whole list. */
  async getSourcePreview(sourceId: string): Promise<string | undefined> {
    if (!sourceId) {
      return undefined
    }

    const types: Array<'screen' | 'window'> = sourceId.startsWith('screen:')
      ? ['screen']
      : ['window']

    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width: 240, height: 135 },
      fetchWindowIcons: false,
    })
    const match = sources.find((source) => source.id === sourceId)
    if (!match || match.thumbnail.isEmpty()) {
      return undefined
    }

    try {
      return `data:image/jpeg;base64,${match.thumbnail.toJPEG(62).toString('base64')}`
    } catch {
      return undefined
    }
  }

  setRecordingState(payload: {
    recording?: boolean
    buffering?: boolean
    bufferState?: ClipBufferState
    sourceId?: string
    sourceName?: string
    bufferedSeconds?: number
    error?: string
  }): ClipRecordingStatus {
    if (payload.recording !== undefined) {
      this.recording = payload.recording
    }
    if (payload.buffering !== undefined) {
      this.buffering = payload.buffering
    }
    if (payload.bufferState) {
      this.bufferState = payload.bufferState
    }
    if (payload.sourceId !== undefined) {
      this.sourceId = payload.sourceId
    }
    if (payload.sourceName !== undefined) {
      this.sourceName = payload.sourceName
    }
    if (payload.bufferedSeconds !== undefined) {
      this.bufferedSeconds = payload.bufferedSeconds
    }
    this.error = payload.error

    if (payload.recording || payload.buffering) {
      this.startedAt ??= Date.now()
    } else if (!payload.error) {
      this.startedAt = undefined
    }

    return this.getStatus()
  }

  saveClip(payload: SaveClipPayload): SaveClipResult {
    const folder = this.ensureOutputFolder()
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace(/Z$/, '')
    const sourcePart = sanitizeFilePart(payload.sourceName ?? 'desktop')
    const extension = extensionForMime(payload.mimeType)
    const lookback = this.settings.get().clip.lookbackSeconds
    const fileName = `Blur-Clip_${sourcePart}_${lookback}s_${stamp}.${extension}`
    const filePath = join(folder, fileName)
    const bytes = Buffer.from(
      payload.data instanceof Uint8Array ? payload.data : new Uint8Array(payload.data),
    )

    writeFileSync(filePath, bytes)
    this.lastClipPath = filePath
    this.recording = false
    this.bufferState = this.buffering ? 'buffering' : 'idle'
    this.error = undefined

    return {
      path: filePath,
      fileName,
      folder,
    }
  }

  async openOutputFolder(): Promise<string> {
    const folder = this.ensureOutputFolder()
    await shell.openPath(folder)
    return folder
  }

  getLookbackSeconds(): ClipLookbackSeconds {
    return this.settings.get().clip.lookbackSeconds
  }
}
