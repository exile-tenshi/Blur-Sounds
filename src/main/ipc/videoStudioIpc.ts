import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import {
  createEmptyProject,
  EDITOR_PROJECT_VERSION,
  videoStudioChannels,
  type EditorProject,
  type ExportClipRequest,
  type MediaInfo,
  type RecordingSettings,
  type SaveRecordingPayload,
} from '../../shared/videoStudio.js'
import { detectAvailableEncoders, exportClip, probeMedia } from '../video/ffmpegRunner.js'
import { RecordingStore } from '../video/recordingStore.js'
import { VideoSettingsStore } from '../video/videoSettingsStore.js'

const MEDIA_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v']

function editedFolder(recordings: RecordingStore): string {
  const folder = join(recordings.getOutputFolder(), 'Edited')
  mkdirSync(folder, { recursive: true })
  return folder
}

function normalizeLoadedProject(raw: unknown): EditorProject {
  const base = createEmptyProject()
  if (!raw || typeof raw !== 'object') {
    return base
  }
  const input = raw as Partial<EditorProject>
  return {
    version: EDITOR_PROJECT_VERSION,
    name: typeof input.name === 'string' ? input.name : base.name,
    fps: Number(input.fps) || base.fps,
    width: Number(input.width) || base.width,
    height: Number(input.height) || base.height,
    tracks: Array.isArray(input.tracks) ? (input.tracks as EditorProject['tracks']) : base.tracks,
  }
}

export function registerVideoStudioIpc(mainWindow: BrowserWindow): void {
  const settings = new VideoSettingsStore()
  const recordings = new RecordingStore()

  ipcMain.handle(videoStudioChannels.getRecordingSettings, () => settings.get())
  ipcMain.handle(
    videoStudioChannels.setRecordingSettings,
    (_event, patch: Partial<RecordingSettings>) => settings.set(patch),
  )

  ipcMain.handle(videoStudioChannels.saveRecording, (_event, payload: SaveRecordingPayload) =>
    recordings.saveRecording(payload),
  )
  ipcMain.handle(videoStudioChannels.openRecordingsFolder, () => recordings.openOutputFolder())

  ipcMain.handle(videoStudioChannels.detectEncoders, () => detectAvailableEncoders())

  ipcMain.handle(videoStudioChannels.probeMedia, (_event, path: string) =>
    probeMedia(path, basename(path)),
  )

  ipcMain.handle(videoStudioChannels.pickMediaFile, async (): Promise<MediaInfo | undefined> => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import video',
      properties: ['openFile'],
      defaultPath: recordings.getOutputFolder(),
      filters: [{ name: 'Video', extensions: MEDIA_EXTENSIONS }],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }
    const path = result.filePaths[0]
    return probeMedia(path, basename(path))
  })

  ipcMain.handle(videoStudioChannels.pickLutFile, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Load .cube LUT',
      properties: ['openFile'],
      defaultPath: recordings.getOutputFolder(),
      filters: [{ name: 'Cube LUT', extensions: ['cube', 'CUBE'] }],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }
    const path = result.filePaths[0]
    return { path, name: basename(path) }
  })

  ipcMain.handle(videoStudioChannels.readTextFile, (_event, path: string) =>
    readFileSync(path, 'utf8'),
  )

  ipcMain.handle(videoStudioChannels.readMediaFile, (_event, path: string) => {
    const buffer = readFileSync(path)
    return new Uint8Array(buffer)
  })

  ipcMain.handle(videoStudioChannels.exportClip, async (_event, request: ExportClipRequest) => {
    const folder = editedFolder(recordings)
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace(/Z$/, '')
    const baseName = (request.outputName || 'edit').replace(/[<>:"/\\|?*]+/g, '').slice(0, 80)
    const fileName = `Blur-Edit_${baseName || 'edit'}_${stamp}.mp4`
    const outputPath = join(folder, fileName)
    const result = await exportClip(request, outputPath)
    return {
      path: outputPath,
      fileName,
      folder,
      encoderUsed: result.encoderUsed,
      command: result.command,
    }
  })

  ipcMain.handle(videoStudioChannels.saveProject, async (_event, project: EditorProject) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save project',
      defaultPath: join(app.getPath('desktop'), `${project.name || 'project'}.blurproj`),
      filters: [{ name: 'Blur project', extensions: ['blurproj'] }],
    })
    if (result.canceled || !result.filePath) {
      return undefined
    }
    writeFileSync(result.filePath, JSON.stringify(project, null, 2), 'utf8')
    return { path: result.filePath }
  })

  ipcMain.handle(videoStudioChannels.loadProject, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open project',
      properties: ['openFile'],
      filters: [{ name: 'Blur project', extensions: ['blurproj'] }],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }
    const path = result.filePaths[0]
    const project = normalizeLoadedProject(JSON.parse(readFileSync(path, 'utf8')))
    return { project, path }
  })
}
