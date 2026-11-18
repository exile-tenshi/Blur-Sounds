import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  DEFAULT_RECORDING_SETTINGS,
  normalizeRecordingSettings,
  type RecordingSettings,
} from '../../shared/videoStudio.js'

// Kept in its own file (video-settings.json) so it never interferes with the
// audio/clip settings migration logic in the main SettingsStore.
function settingsPath(): string {
  return join(app.getPath('userData'), 'video-settings.json')
}

export class VideoSettingsStore {
  private settings: RecordingSettings

  constructor() {
    this.settings = this.load()
  }

  get(): RecordingSettings {
    return { ...this.settings }
  }

  set(patch: Partial<RecordingSettings>): RecordingSettings {
    this.settings = normalizeRecordingSettings({ ...this.settings, ...patch })
    this.persist()
    return this.get()
  }

  private load(): RecordingSettings {
    try {
      const path = settingsPath()
      if (!existsSync(path)) {
        return { ...DEFAULT_RECORDING_SETTINGS }
      }
      return normalizeRecordingSettings(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      return { ...DEFAULT_RECORDING_SETTINGS }
    }
  }

  private persist(): void {
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(settingsPath(), JSON.stringify(this.settings, null, 2), 'utf8')
    } catch {
      // Best-effort persistence.
    }
  }
}
