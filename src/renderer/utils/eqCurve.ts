import {
  EQ_BAND_FREQUENCIES,
  EQ_BAND_KEYS,
  MAX_EQ_DB,
  MIN_EQ_DB,
  type RouteEqualizerSettings,
} from '../../shared/audioConstants'

export const GRAPH_WIDTH = 560
export const GRAPH_HEIGHT = 168
export const GRAPH_PADDING_X = 28
export const GRAPH_PADDING_Y = 18

const MIN_FREQ = EQ_BAND_FREQUENCIES[0]
const MAX_FREQ = EQ_BAND_FREQUENCIES[EQ_BAND_FREQUENCIES.length - 1]

export function freqToX(freq: number, width = GRAPH_WIDTH): number {
  const minLog = Math.log10(MIN_FREQ)
  const maxLog = Math.log10(MAX_FREQ)
  const usable = width - GRAPH_PADDING_X * 2
  return GRAPH_PADDING_X + ((Math.log10(freq) - minLog) / (maxLog - minLog)) * usable
}

export function dbToY(db: number, height = GRAPH_HEIGHT): number {
  const usable = height - GRAPH_PADDING_Y * 2
  const ratio = (MAX_EQ_DB - db) / (MAX_EQ_DB - MIN_EQ_DB)
  return GRAPH_PADDING_Y + ratio * usable
}

export function getBandValues(settings: RouteEqualizerSettings): number[] {
  return EQ_BAND_KEYS.map((key) => settings[key])
}

export function buildSmoothCurvePath(values: number[], width = GRAPH_WIDTH, height = GRAPH_HEIGHT): string {
  const points = EQ_BAND_FREQUENCIES.map((freq, index) => ({
    x: freqToX(freq, width),
    y: dbToY(values[index] ?? 0, height),
  }))

  if (points.length === 0) {
    return ''
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`
  }

  let path = `M ${points[0].x} ${points[0].y}`

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const controlX = (current.x + next.x) / 2
    path += ` C ${controlX} ${current.y}, ${controlX} ${next.y}, ${next.x} ${next.y}`
  }

  return path
}

export function buildFilledCurvePath(values: number[], width = GRAPH_WIDTH, height = GRAPH_HEIGHT): string {
  const zeroY = dbToY(0, height)
  const curve = buildSmoothCurvePath(values, width, height)
  const firstX = freqToX(EQ_BAND_FREQUENCIES[0], width)
  const lastX = freqToX(EQ_BAND_FREQUENCIES[EQ_BAND_FREQUENCIES.length - 1], width)
  return `${curve} L ${lastX} ${zeroY} L ${firstX} ${zeroY} Z`
}
