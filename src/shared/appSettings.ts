export type AppSectionId = 'mixer' | 'noise' | 'clips' | 'record' | 'editor' | 'setup'

export const APP_SECTION_IDS: readonly AppSectionId[] = [
  'mixer',
  'noise',
  'clips',
  'record',
  'editor',
  'setup',
]

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

export const CLIP_RESOLUTION_OPTIONS = ['720p', '1080p', '1440p', '4k'] as const

export type ClipResolution = (typeof CLIP_RESOLUTION_OPTIONS)[number]

export interface ClipResolutionSpec {
  id: ClipResolution
  label: string
  width: number
  height: number
  /** Target encode bitrate for MediaRecorder. */
  videoBitsPerSecond: number
}

export const CLIP_RESOLUTION_SPECS: Record<ClipResolution, ClipResolutionSpec> = {
  '720p': {
    id: '720p',
    label: '720p',
    width: 1280,
    height: 720,
    videoBitsPerSecond: 2_500_000,
  },
  '1080p': {
    id: '1080p',
    label: '1080p',
    width: 1920,
    height: 1080,
    videoBitsPerSecond: 6_000_000,
  },
  '1440p': {
    id: '1440p',
    label: '1440p',
    width: 2560,
    height: 1440,
    videoBitsPerSecond: 10_000_000,
  },
  '4k': {
    id: '4k',
    label: '4K',
    width: 3840,
    height: 2160,
    videoBitsPerSecond: 18_000_000,
  },
}

export interface ClipSettings {
  lookbackSeconds: ClipLookbackSeconds
  sourceId?: string
  bufferingEnabled: boolean
  keybinds: string[]
  /** Listen for “clip it blur” / “blur clip it” and trigger Clip it. */
  voiceCommandsEnabled: boolean
  /** Capture / encode resolution for Clip it. */
  resolution: ClipResolution
  /**
   * Application ids whose audio should be in the clip (via the Blur / Hi-Fi Cable mix).
   * Keep these apps routed in Mixer and the stream running.
   */
  audioApplicationIds: string[]
  /** Microphone device ids to mix into the clip (raw capture). */
  audioMicrophoneIds: string[]
}

export interface AppSettings {
  /** Bumped when defaults must override older saved prefs for performance. */
  settingsVersion?: number
  activeSection: AppSectionId
  clip: ClipSettings
}

export const APP_SETTINGS_VERSION = 4

export const DEFAULT_CLIP_SETTINGS: ClipSettings = {
  lookbackSeconds: 60,
  /** On at launch so Clip it / “clip it blur” work without a extra toggle. */
  bufferingEnabled: true,
  keybinds: ['F8'],
  voiceCommandsEnabled: true,
  resolution: '1080p',
  audioApplicationIds: [],
  audioMicrophoneIds: [],
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

export function normalizeClipResolution(value: unknown): ClipResolution {
  if (typeof value === 'string' && (CLIP_RESOLUTION_OPTIONS as readonly string[]).includes(value)) {
    return value as ClipResolution
  }
  return DEFAULT_CLIP_SETTINGS.resolution
}

export function getClipResolutionSpec(resolution: ClipResolution): ClipResolutionSpec {
  return CLIP_RESOLUTION_SPECS[resolution] ?? CLIP_RESOLUTION_SPECS['1080p']
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

export function normalizeStringIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue
    }
    const id = entry.trim()
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    result.push(id)
  }
  return result
}
