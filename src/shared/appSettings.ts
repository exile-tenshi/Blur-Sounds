export type AppSectionId = 'mixer' | 'noise' | 'clips' | 'setup'

export const CLIP_LOOKBACK_OPTIONS_SECONDS = [
  15,
  30,
  60,
  120,
  180,
  300,
  600,
  1200,
] as const

export type ClipLookbackSeconds = (typeof CLIP_LOOKBACK_OPTIONS_SECONDS)[number]

export interface ClipSettings {
  lookbackSeconds: ClipLookbackSeconds
  sourceId?: string
  bufferingEnabled: boolean
  keybinds: string[]
  /** Listen for “clip it blur” / “blur clip it” and trigger Clip it. */
  voiceCommandsEnabled: boolean
}

export interface AppSettings {
  /** Bumped when defaults must override older saved prefs for performance. */
  settingsVersion?: number
  activeSection: AppSectionId
  clip: ClipSettings
}

export const APP_SETTINGS_VERSION = 2

export const DEFAULT_CLIP_SETTINGS: ClipSettings = {
  lookbackSeconds: 60,
  /** Off by default — desktop capture is expensive; user opts in from Clips. */
  bufferingEnabled: false,
  keybinds: ['F8'],
  voiceCommandsEnabled: true,
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  settingsVersion: APP_SETTINGS_VERSION,
  activeSection: 'mixer',
  clip: { ...DEFAULT_CLIP_SETTINGS },
}

export function normalizeClipLookback(value: unknown): ClipLookbackSeconds {
  const numeric = Number(value)
  if ((CLIP_LOOKBACK_OPTIONS_SECONDS as readonly number[]).includes(numeric)) {
    return numeric as ClipLookbackSeconds
  }
  return DEFAULT_CLIP_SETTINGS.lookbackSeconds
}

export function forwardRollSeconds(lookbackSeconds: number): number {
  // Cap forward roll so 10m/20m lookbacks don't wait minutes after Clip it.
  return Math.min(30, Math.max(1, Math.round(lookbackSeconds * 0.25)))
}

export function totalClipSeconds(lookbackSeconds: number): number {
  return lookbackSeconds + forwardRollSeconds(lookbackSeconds)
}

export function formatLookbackLabel(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = seconds / 60
  return Number.isInteger(minutes) ? `${minutes}m` : `${minutes.toFixed(1)}m`
}
