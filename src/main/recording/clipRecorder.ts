import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, desktopCapturer, shell } from 'electron'
import type {
  ClipRecordingStatus,
  ClipSource,
  SaveClipPayload,
  SaveClipResult,
} from '../../shared/clipApi.js'

const CLIPS_FOLDER_NAME = 'Blur Sounds Clips'

function sanitizeFilePart(value: string): string {
  return value
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

export class ClipRecorderService {
  private recording = false
  private sourceId?: string
  private sourceName?: string
  private startedAt?: number
  private lastClipPath?: string
  private error?: string

  getOutputFolder(): string {
    return join(app.getPath('desktop'), CLIPS_FOLDER_NAME)
  }

  ensureOutputFolder(): string {
    const folder = this.getOutputFolder()
    mkdirSync(folder, { recursive: true })
    return folder
  }

  getStatus(): ClipRecordingStatus {
    const startedAt = this.startedAt
    return {
      recording: this.recording,
      sourceId: this.sourceId,
      sourceName: this.sourceName,
      startedAt: startedAt ? new Date(startedAt).toISOString() : undefined,
      elapsedMs: this.recording && startedAt ? Date.now() - startedAt : 0,
      outputFolder: this.getOutputFolder(),
      lastClipPath: this.lastClipPath,
      error: this.error,
    }
  }

  async listSources(): Promise<ClipSource[]> {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    })

    return sources
      .filter((source) => source.name.trim().length > 0)
      .map((source) => {
        const isScreen = source.id.startsWith('screen:')
        return {
          id: source.id,
          name: source.name,
          kind: isScreen ? 'screen' : 'window',
          displayId: source.display_id || undefined,
          thumbnailDataUrl: source.thumbnail.isEmpty()
            ? undefined
            : source.thumbnail.toDataURL(),
        } satisfies ClipSource
      })
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === 'screen' ? -1 : 1
        }
        return left.name.localeCompare(right.name)
      })
  }

  setRecordingState(payload: {
    recording: boolean
    sourceId?: string
    sourceName?: string
    error?: string
  }): ClipRecordingStatus {
    this.recording = payload.recording
    this.sourceId = payload.sourceId
    this.sourceName = payload.sourceName
    this.error = payload.error

    if (payload.recording) {
      this.startedAt = Date.now()
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
    const fileName = `Blur-Clip_${sourcePart}_${stamp}.${extension}`
    const filePath = join(folder, fileName)
    const bytes = Buffer.from(
      payload.data instanceof Uint8Array ? payload.data : new Uint8Array(payload.data),
    )

    writeFileSync(filePath, bytes)
    this.lastClipPath = filePath
    this.recording = false
    this.startedAt = undefined
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
}
