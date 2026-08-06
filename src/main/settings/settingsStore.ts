import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  APP_SETTINGS_VERSION,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CLIP_SETTINGS,
  normalizeClipLookback,
  normalizeClipResolution,
  type AppSettings,
  type AppSectionId,
  type ClipSettings,
} from '../../shared/appSettings.js'

type SettingsListener = (settings: AppSettings) => void

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function sanitizeKeybinds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_CLIP_SETTINGS.keybinds]
  }

  const unique = new Set<string>()
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      unique.add(item.trim())
    }
  }
  return unique.size > 0 ? [...unique] : [...DEFAULT_CLIP_SETTINGS.keybinds]
}

function normalizeSettings(raw: unknown): AppSettings {
  const input = raw && typeof raw === 'object' ? (raw as Partial<AppSettings>) : {}
  const clipInput = input.clip && typeof input.clip === 'object' ? input.clip : {}
  const section = input.activeSection
  const activeSection: AppSectionId =
    section === 'mixer' || section === 'noise' || section === 'clips' || section === 'setup'
      ? section
      : DEFAULT_APP_SETTINGS.activeSection

  const savedVersion =
    typeof input.settingsVersion === 'number' ? input.settingsVersion : 0
  // v2 turns off always-on desktop capture that was freezing machines.
  const forceBufferOff = savedVersion < 2

  const clip: ClipSettings = {
    lookbackSeconds: normalizeClipLookback(clipInput.lookbackSeconds),
    sourceId: typeof clipInput.sourceId === 'string' ? clipInput.sourceId : undefined,
    bufferingEnabled: forceBufferOff
      ? false
      : typeof clipInput.bufferingEnabled === 'boolean'
        ? clipInput.bufferingEnabled
        : DEFAULT_CLIP_SETTINGS.bufferingEnabled,
    keybinds: sanitizeKeybinds(clipInput.keybinds),
    voiceCommandsEnabled:
      typeof clipInput.voiceCommandsEnabled === 'boolean'
        ? clipInput.voiceCommandsEnabled
        : DEFAULT_CLIP_SETTINGS.voiceCommandsEnabled,
    resolution: normalizeClipResolution(clipInput.resolution),
  }

  return {
    settingsVersion: APP_SETTINGS_VERSION,
    activeSection,
    clip,
  }
}

export class SettingsStore {
  private settings: AppSettings
  private readonly listeners = new Set<SettingsListener>()

  constructor() {
    const loaded = this.load()
    this.settings = loaded
    // Persist migrated defaults (e.g. buffering forced off in v2).
    this.persist()
  }

  get(): AppSettings {
    return {
      activeSection: this.settings.activeSection,
      clip: { ...this.settings.clip, keybinds: [...this.settings.clip.keybinds] },
    }
  }

  set(patch: Partial<AppSettings> & { clip?: Partial<ClipSettings> }): AppSettings {
    const nextClip = {
      ...this.settings.clip,
      ...(patch.clip ?? {}),
    }
    this.settings = normalizeSettings({
      activeSection: patch.activeSection ?? this.settings.activeSection,
      clip: nextClip,
    })
    this.persist()
    this.emit()
    return this.get()
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    const snapshot = this.get()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private load(): AppSettings {
    try {
      const path = settingsPath()
      if (!existsSync(path)) {
        return normalizeSettings(DEFAULT_APP_SETTINGS)
      }
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
      return normalizeSettings(parsed)
    } catch {
      return normalizeSettings(DEFAULT_APP_SETTINGS)
    }
  }

  private persist(): void {
    try {
      const path = settingsPath()
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(path, JSON.stringify(this.settings, null, 2), 'utf8')
    } catch {
      // Best-effort persistence; ignore disk errors.
    }
  }
}
