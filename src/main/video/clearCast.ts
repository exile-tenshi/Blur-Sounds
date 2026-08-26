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

  // Subsonic + high-pass: stronger strength trims more low-end rumble.
  const subCut = Math.round(lerp(35, 65, t))
  const highPass = Math.round(lerp(80, 110, t))

  // Gate: higher strength closes sooner (higher threshold) and deeper (lower range).
  // De-echo shortens the release so reverb tails are cut instead of ringing out.
  const gateThreshold = lerp(0.008, 0.035, t).toFixed(4)
  const gateRange = lerp(0.12, 0.02, t).toFixed(4)
  const gateRatio = lerp(2.5, 6, t).toFixed(2)
  const baseRelease = lerp(180, 90, t)
  const gateRelease = Math.round(deEcho ? baseRelease * 0.55 : baseRelease)

  const stages: string[] = [
    `asubcut=cutoff=${subCut}`,
    `highpass=f=${highPass}`,
  ]

  let usedRnnoise = false
  if (model) {
    usedRnnoise = true
    const escaped = escapeFilterPath(model)
    // RNNoise "mix" blends dry/denoised; a 2nd pass cleans residual noise + late reverb.
    // RNNoise noticeably suppresses reverberation, so de-echo always runs the 2nd pass.
    const mix = lerp(0.6, 1, t).toFixed(3)
    stages.push(`arnndn=m='${escaped}':mix=${mix}`)
    if (t >= 0.7 || deEcho) {
      stages.push(`arnndn=m='${escaped}':mix=1`)
    }
  } else {
    // Model-free fallback denoise.
    const nr = Math.round(lerp(12, 30, t))
    stages.push(`afftdn=nr=${nr}:nf=-28:tn=1`)
    stages.push(`anlmdn=s=0.0008:p=0.002:r=0.006`)
  }

  // De-echo: a downward expander keyed above the noise floor. Room reflections/echo
  // sit below the direct voice, so expanding that mid band pushes the reverb wash and
  // repeated slap-echo down while leaving the direct speech untouched.
  if (deEcho) {
    stages.push('agate=threshold=0.055:range=0.05:ratio=3:attack=4:release=55:knee=1')
  }

  stages.push(
    `agate=threshold=${gateThreshold}:range=${gateRange}:ratio=${gateRatio}:attack=5:release=${gateRelease}:knee=2.83`,
  )
  stages.push('deesser=i=0.4')
  stages.push('speechnorm=e=12.5:r=0.0001:l=1')
  stages.push('alimiter=limit=0.97')

  return { filter: stages.join(','), usedRnnoise, usedDeEcho: deEcho }
}

export function clearCastModelAvailable(): boolean {
  return Boolean(resolveModelPath())
}
