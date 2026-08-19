import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { app, shell } from 'electron'
import type {
  SaveRecordingPayload,
  SaveRecordingResult,
} from '../../shared/videoStudio.js'
import { transcodeToMp4 } from './ffmpegRunner.js'

const RECORDINGS_FOLDER_NAME = 'Blur Sounds Recordings'

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
      .slice(0, 80) || 'recording'
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
  return 'webm'
}

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace(/Z$/, '')
}

export class RecordingStore {
  getOutputFolder(): string {
    return join(app.getPath('desktop'), RECORDINGS_FOLDER_NAME)
  }

  ensureOutputFolder(): string {
    const folder = this.getOutputFolder()
    mkdirSync(folder, { recursive: true })
    return folder
  }

  async openOutputFolder(): Promise<string> {
    const folder = this.ensureOutputFolder()
    await shell.openPath(folder)
    return folder
  }

  async saveRecording(payload: SaveRecordingPayload): Promise<SaveRecordingResult> {
    const folder = this.ensureOutputFolder()
    const sourcePart = sanitizeFilePart(payload.sourceName ?? 'screen')
    const stamp = timestamp()
    const rawExtension = extensionForMime(payload.mimeType)
    const bytes = Buffer.from(
      payload.data instanceof Uint8Array ? payload.data : new Uint8Array(payload.data),
    )

    const rawFileName = `Blur-Rec_${sourcePart}_${stamp}.${rawExtension}`
    const shouldTranscode =
      payload.settings.transcodeToMp4 && rawExtension !== 'mp4'

    if (!shouldTranscode) {
      const filePath = join(folder, rawFileName)
      writeFileSync(filePath, bytes)
      return {
        path: filePath,
        fileName: rawFileName,
        folder,
        transcoded: false,
        container: rawExtension,
        encoderUsed: 'copy',
      }
    }

    // Write the raw capture to a temp file, then transcode into the recordings folder as MP4.
    const tempPath = join(tmpdir(), `blur-rec-${Date.now()}.${rawExtension}`)
    writeFileSync(tempPath, bytes)
    const mp4FileName = `Blur-Rec_${sourcePart}_${stamp}.mp4`
    const mp4Path = join(folder, mp4FileName)

    try {
      const result = await transcodeToMp4(tempPath, mp4Path, {
        encoder: payload.settings.encoder,
        videoBitrateKbps: payload.settings.videoBitrateKbps,
        audioBitrateKbps: payload.settings.audioBitrateKbps,
      })
      return {
        path: mp4Path,
        fileName: mp4FileName,
        folder,
        transcoded: true,
        container: 'mp4',
        encoderUsed: result.encoderUsed,
      }
    } catch {
      // Transcode failed → keep the raw capture so the take is never lost.
      const fallbackPath = join(folder, rawFileName)
      writeFileSync(fallbackPath, bytes)
      return {
        path: fallbackPath,
        fileName: rawFileName,
        folder,
        transcoded: false,
        container: rawExtension,
        encoderUsed: 'copy',
      }
    } finally {
      try {
        rmSync(tempPath, { force: true })
      } catch {
        // ignore temp cleanup errors
      }
    }
  }
}
