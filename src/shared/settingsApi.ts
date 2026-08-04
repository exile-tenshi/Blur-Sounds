import type { AppSettings, AppSectionId, ClipSettings } from './appSettings.js'

export const settingsChannels = {
  get: 'settings:get',
  set: 'settings:set',
  subscribe: 'settings:subscribe',
} as const

export interface SettingsControlApi {
  get: () => Promise<AppSettings>
  set: (patch: Partial<AppSettings> & { clip?: Partial<ClipSettings> }) => Promise<AppSettings>
  subscribe: (listener: (settings: AppSettings) => void) => () => void
}

export type { AppSettings, AppSectionId, ClipSettings }
