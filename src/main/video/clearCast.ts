import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

// ClearCast voice isolation, expressed as an FFmpeg audio filtergraph.
//
// Chain (strongest → weakest by stage):
//   asubcut/highpass  → remove subsonic rumble, desk thumps, low "body" noise (fart/AC)
//   arnndn (RNNoise)  → ML speech-vs-noise separation: fans, hum, hiss, keyboard, taps
//   agate             → close hard between words to kill residual room tone + echo tails
//   deesser           → tame harsh sibilance the gate/RNN can exaggerate
//   speechnorm        → even out level so the isolated voice sits consistently
//
// RNNoise is the key to "only the voice": it is trained specifically to keep speech and
// drop everything else. If the bundled model is unavailable we fall back to an FFT +
// non-local-means denoiser, which is weaker but still model-free.

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
}

/**
 * Build the ClearCast audio filter chain. `strength` is 0–100.
 * Returns undefined when disabled.
 */
export function buildClearCastFilter(strength: number): ClearCastFilterResult {
  const t = Math.min(1, Math.max(0, strength / 100))
  const model = resolveModelPath()

  // Subsonic + high-pass: stronger strength trims more low-end rumble.
  const subCut = Math.round(lerp(35, 65, t))
  const highPass = Math.round(lerp(80, 110, t))

  // Gate: higher strength closes sooner (higher threshold) and deeper (lower range).
  const gateThreshold = lerp(0.008, 0.035, t).toFixed(4)
  const gateRange = lerp(0.12, 0.02, t).toFixed(4)
  const gateRatio = lerp(2.5, 6, t).toFixed(2)
  const gateRelease = Math.round(lerp(180, 90, t))

  const stages: string[] = [
    `asubcut=cutoff=${subCut}`,
    `highpass=f=${highPass}`,
  ]

  let usedRnnoise = false
  if (model) {
    usedRnnoise = true
    const escaped = escapeFilterPath(model)
    // RNNoise "mix" blends dry/denoised; a 2nd pass at high strength cleans residual.
    const mix = lerp(0.6, 1, t).toFixed(3)
    stages.push(`arnndn=m='${escaped}':mix=${mix}`)
    if (t >= 0.7) {
      stages.push(`arnndn=m='${escaped}':mix=1`)
    }
  } else {
    // Model-free fallback denoise.
    const nr = Math.round(lerp(12, 30, t))
    stages.push(`afftdn=nr=${nr}:nf=-28:tn=1`)
    stages.push(`anlmdn=s=0.0008:p=0.002:r=0.006`)
  }

  stages.push(
    `agate=threshold=${gateThreshold}:range=${gateRange}:ratio=${gateRatio}:attack=5:release=${gateRelease}:knee=2.83`,
  )
  stages.push('deesser=i=0.4')
  stages.push('speechnorm=e=12.5:r=0.0001:l=1')
  stages.push('alimiter=limit=0.97')

  return { filter: stages.join(','), usedRnnoise }
}

export function clearCastModelAvailable(): boolean {
  return Boolean(resolveModelPath())
}
