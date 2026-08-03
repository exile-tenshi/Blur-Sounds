import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, desktopCapturer, screen, shell } from 'electron'
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
const CAPTURER_TIMEOUT_MS = 3000

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

export function toDisplaySourceId(displayId: number): string {
  return `display:${displayId}`
}

export function parseDisplaySourceId(sourceId: string | undefined): string | undefined {
  if (!sourceId?.startsWith('display:')) {
    return undefined
  }
  return sourceId.slice('display:'.length)
}

async function getSourcesWithTimeout(
  options: Electron.SourcesOptions,
  timeoutMs = CAPTURER_TIMEOUT_MS,
): Promise<Electron.DesktopCapturerSource[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      desktopCapturer.getSources(options),
      new Promise<Electron.DesktopCapturerSource[]>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Timed out while listing capture sources.'))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
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
   * Instant desktop list via Electron's screen API — never calls desktopCapturer.
   * Window listing is intentionally unsupported in the picker (freezes many PCs).
   */
  async listSources(options?: { includeWindows?: boolean }): Promise<ClipSource[]> {
    if (options?.includeWindows) {
      throw new Error(
        'Game/window scanning is disabled because it freezes this PC. Use a Desktop source.',
      )
    }

    const displays = screen.getAllDisplays()
    const primaryId = screen.getPrimaryDisplay().id

    return displays
      .slice()
      .sort((left, right) => {
        if (left.id === primaryId) {
          return -1
        }
        if (right.id === primaryId) {
          return 1
        }
        return left.bounds.x - right.bounds.x
      })
      .map((display, index) => {
        const isPrimary = display.id === primaryId
        return {
          id: toDisplaySourceId(display.id),
          name: isPrimary ? `Screen ${index + 1} (Primary)` : `Screen ${index + 1}`,
          kind: 'screen' as const,
          displayId: String(display.id),
        } satisfies ClipSource
      })
  }

  /**
   * Resolve a real DesktopCapturerSource for getDisplayMedia.
   * Only called when the user starts the buffer — not when opening Clips.
   */
  async resolveCaptureSource(
    preferredSourceId?: string,
  ): Promise<Electron.DesktopCapturerSource | undefined> {
    const displayId = parseDisplaySourceId(preferredSourceId)
    // 1x1 thumbs — some Electron builds hang on 0x0.
    const sources = await getSourcesWithTimeout({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false,
    })

    if (sources.length === 0) {
      return undefined
    }

    if (displayId) {
      const match = sources.find((source) => String(source.display_id) === displayId)
      if (match) {
        return match
      }
    }

    return sources.find((source) => source.id.startsWith('screen:')) ?? sources[0]
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
