import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

// ClearCast voice isolation, expressed as an FFmpeg audio filtergraph.
//
// Natural voice during speech (moderate RNNoise mix). De-echo focuses on
// post-speech tails / room wash via a faster gate + soft expander — not a
// second full-wet RNNoise pass (that sounded robotic).

function resolveModelPath(): string | undefined {
  const candidates: string[] = []
  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, 'rnnoise', 'cb.rnnn'))
  }
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  candidates.push(join(projectRoot, 'resources', 'rnnoise', 'cb.rnnn'))
  return candidates.find((path) => existsSync(path))
}

/** Escape a path for use inside an FFmpeg filter option value. */
function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

export interface ClearCastFilterResult {
  filter: string
  usedRnnoise: boolean
  usedDeEcho: boolean
}

export interface ClearCastFilterOptions {
  /** Extra reverb/echo suppression for people talking in a live/echoey room. */
  deEcho?: boolean
}

/**
 * Build the ClearCast audio filter chain. `strength` is 0–100.
 */
export function buildClearCastFilter(
  strength: number,
  options: ClearCastFilterOptions = {},
): ClearCastFilterResult {
  const t = Math.min(1, Math.max(0, strength / 100))
  const deEcho = options.deEcho ?? false
  const model = resolveModelPath()

  const subCut = Math.round(lerp(30, 55, t))
  const highPass = Math.round(lerp(70, 100, t))

  // De-echo: faster close after words so reverb tails don't ring out.
  const gateThreshold = lerp(deEcho ? 0.008 : 0.004, deEcho ? 0.028 : 0.018, t).toFixed(4)
  const gateRange = lerp(deEcho ? 0.1 : 0.22, deEcho ? 0.03 : 0.08, t).toFixed(4)
  const gateRatio = lerp(deEcho ? 2.2 : 1.6, deEcho ? 4.5 : 3.2, t).toFixed(2)
  const baseRelease = lerp(deEcho ? 140 : 220, deEcho ? 70 : 140, t)
  const gateRelease = Math.round(baseRelease)

  const stages: string[] = [
    `asubcut=cutoff=${subCut}`,
    `highpass=f=${highPass}`,
  ]

  let usedRnnoise = false
  if (model) {
    usedRnnoise = true
    const escaped = escapeFilterPath(model)
    // Cap mix — full wet is robotic. De-echo adds a little more wet, still < 0.9.
    const mix = lerp(0.48, deEcho ? 0.88 : 0.82, t).toFixed(3)
    stages.push(`arnndn=m='${escaped}':mix=${mix}`)
  } else {
    const nr = Math.round(lerp(8, deEcho ? 24 : 20, t))
    stages.push(`afftdn=nr=${nr}:nf=-30:tn=1`)
    stages.push(`anlmdn=s=0.0006:p=0.002:r=0.008`)
  }

  // De-echo expander: crush late energy under the direct voice.
  if (deEcho) {
    stages.push('agate=threshold=0.04:range=0.06:ratio=2.8:attack=4:release=60:knee=1.5')
  }

  stages.push(
    `agate=threshold=${gateThreshold}:range=${gateRange}:ratio=${gateRatio}:attack=6:release=${gateRelease}:knee=3`,
  )
  stages.push('deesser=i=0.28')
  stages.push('speechnorm=e=7:r=0.00005:l=1')
  stages.push('alimiter=limit=0.97')

  return { filter: stages.join(','), usedRnnoise, usedDeEcho: deEcho }
}

export function clearCastModelAvailable(): boolean {
  return Boolean(resolveModelPath())
}
