export const MIN_INPUT_GAIN = 0
export const MAX_INPUT_GAIN = 4
export const DEFAULT_INPUT_GAIN = 1

export const MIN_EQ_DB = -12
export const MAX_EQ_DB = 12
export const DEFAULT_EQ_DB = 0

export const EQ_BAND_FREQUENCIES = [60, 150, 400, 1000, 2400, 15000] as const

export const EQ_BAND_KEYS = [
  'band60Db',
  'band150Db',
  'band400Db',
  'band1000Db',
  'band2400Db',
  'band15000Db',
] as const

export type EqBandKey = (typeof EQ_BAND_KEYS)[number]

export const EQ_BAND_LABELS = ['60Hz', '150Hz', '400Hz', '1KHz', '2.4KHz', '15KHz'] as const

export interface RouteEqualizerSettings {
  enabled: boolean
  band60Db: number
  band150Db: number
  band400Db: number
  band1000Db: number
  band2400Db: number
  band15000Db: number
}

export const DEFAULT_ROUTE_EQUALIZER: RouteEqualizerSettings = {
  enabled: true,
  band60Db: DEFAULT_EQ_DB,
  band150Db: DEFAULT_EQ_DB,
  band400Db: DEFAULT_EQ_DB,
  band1000Db: DEFAULT_EQ_DB,
  band2400Db: DEFAULT_EQ_DB,
  band15000Db: DEFAULT_EQ_DB,
}

export interface EqPreset {
  id: string
  name: string
  settings: RouteEqualizerSettings
}

function preset(
  id: string,
  name: string,
  bands: Partial<Record<EqBandKey, number>>,
): EqPreset {
  return {
    id,
    name,
    settings: {
      enabled: true,
      ...DEFAULT_ROUTE_EQUALIZER,
      ...bands,
    },
  }
}

export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'Flat', settings: { ...DEFAULT_ROUTE_EQUALIZER } },
  preset('bass-booster', 'Bass booster', {
    band60Db: 8,
    band150Db: 6,
    band400Db: -1,
    band1000Db: -2,
    band2400Db: -3,
    band15000Db: -4,
  }),
  preset('treble-boost', 'Treble boost', {
    band60Db: -2,
    band150Db: -1,
    band400Db: 0,
    band1000Db: 2,
    band2400Db: 5,
    band15000Db: 7,
  }),
  preset('vocal', 'Vocal', {
    band60Db: -3,
    band150Db: -1,
    band400Db: 2,
    band1000Db: 4,
    band2400Db: 3,
    band15000Db: 1,
  }),
  preset('rock', 'Rock', {
    band60Db: 5,
    band150Db: 3,
    band400Db: -1,
    band1000Db: 1,
    band2400Db: 4,
    band15000Db: 5,
  }),
  preset('electronic', 'Electronic', {
    band60Db: 6,
    band150Db: 4,
    band400Db: 0,
    band1000Db: -1,
    band2400Db: 2,
    band15000Db: 6,
  }),
]

export function clampInputGain(volume: number): number {
  if (!Number.isFinite(volume)) {
    return DEFAULT_INPUT_GAIN
  }

  return Math.max(MIN_INPUT_GAIN, Math.min(MAX_INPUT_GAIN, volume))
}

export function formatInputGain(volume: number): string {
  return `${Math.round(clampInputGain(volume) * 100)}%`
}

export function clampEqDb(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_EQ_DB
  }

  return Math.max(MIN_EQ_DB, Math.min(MAX_EQ_DB, value))
}

export function readRouteEqualizer(route: {
  eqEnabled?: boolean
  band60Db?: number
  band150Db?: number
  band400Db?: number
  band1000Db?: number
  band2400Db?: number
  band15000Db?: number
  bassDb?: number
  midDb?: number
  trebleDb?: number
}): RouteEqualizerSettings {
  if (route.band60Db !== undefined || route.band150Db !== undefined) {
    return {
      enabled: route.eqEnabled ?? true,
      band60Db: clampEqDb(route.band60Db ?? DEFAULT_EQ_DB),
      band150Db: clampEqDb(route.band150Db ?? DEFAULT_EQ_DB),
      band400Db: clampEqDb(route.band400Db ?? DEFAULT_EQ_DB),
      band1000Db: clampEqDb(route.band1000Db ?? DEFAULT_EQ_DB),
      band2400Db: clampEqDb(route.band2400Db ?? DEFAULT_EQ_DB),
      band15000Db: clampEqDb(route.band15000Db ?? DEFAULT_EQ_DB),
    }
  }

  const bass = clampEqDb(route.bassDb ?? DEFAULT_EQ_DB)
  const mid = clampEqDb(route.midDb ?? DEFAULT_EQ_DB)
  const treble = clampEqDb(route.trebleDb ?? DEFAULT_EQ_DB)

  return {
    enabled: route.eqEnabled ?? true,
    band60Db: bass,
    band150Db: Math.round(bass * 0.7),
    band400Db: mid,
    band1000Db: mid,
    band2400Db: treble,
    band15000Db: treble,
  }
}

export function equalizerSettingsToPayload(settings: RouteEqualizerSettings): RouteEqualizerSettings {
  return {
    enabled: settings.enabled,
    band60Db: clampEqDb(settings.band60Db),
    band150Db: clampEqDb(settings.band150Db),
    band400Db: clampEqDb(settings.band400Db),
    band1000Db: clampEqDb(settings.band1000Db),
    band2400Db: clampEqDb(settings.band2400Db),
    band15000Db: clampEqDb(settings.band15000Db),
  }
}

export function routeEqualizersEqual(
  left: RouteEqualizerSettings,
  right: RouteEqualizerSettings,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.band60Db === right.band60Db &&
    left.band150Db === right.band150Db &&
    left.band400Db === right.band400Db &&
    left.band1000Db === right.band1000Db &&
    left.band2400Db === right.band2400Db &&
    left.band15000Db === right.band15000Db
  )
}
