import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

// ClearCast voice isolation, expressed as an FFmpeg audio filtergraph.
//
// Tuned for natural voice: one moderate RNNoise pass by default (full wet + a
// second pass sounds robotic). Echo removal uses a soft expander, not a second
// hard denoise. Gate stays gentle so consonants aren't chopped into "radio voice".

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

  // Keep more low-end body than before — high highpass + RNNoise = thin robot voice.
  const subCut = Math.round(lerp(30, 50, t))
  const highPass = Math.round(lerp(70, 95, t))

  // Soft gate: never slam shut. Longer release keeps natural decay.
  const gateThreshold = lerp(0.004, 0.018, t).toFixed(4)
  const gateRange = lerp(0.22, 0.08, t).toFixed(4)
  const gateRatio = lerp(1.6, 3.2, t).toFixed(2)
  const baseRelease = lerp(220, 140, t)
  const gateRelease = Math.round(deEcho ? baseRelease * 0.75 : baseRelease)

  const stages: string[] = [
    `asubcut=cutoff=${subCut}`,
    `highpass=f=${highPass}`,
  ]

  let usedRnnoise = false
  if (model) {
    usedRnnoise = true
    const escaped = escapeFilterPath(model)
    // Cap mix below 1.0 — full wet RNNoise is the main "robotic" artifact.
    const mix = lerp(0.45, 0.82, t).toFixed(3)
    stages.push(`arnndn=m='${escaped}':mix=${mix}`)
    // Optional light second pass only for strong de-echo — never mix=1.
    if (deEcho && t >= 0.8) {
      stages.push(`arnndn=m='${escaped}':mix=${lerp(0.35, 0.55, t).toFixed(3)}`)
    }
  } else {
    const nr = Math.round(lerp(8, 20, t))
    stages.push(`afftdn=nr=${nr}:nf=-30:tn=1`)
    stages.push(`anlmdn=s=0.0006:p=0.002:r=0.008`)
  }

  // De-echo: soft downward expander on late energy — not a hard chop.
  if (deEcho) {
    stages.push('agate=threshold=0.035:range=0.12:ratio=2:attack=6:release=90:knee=2')
  }

  stages.push(
    `agate=threshold=${gateThreshold}:range=${gateRange}:ratio=${gateRatio}:attack=8:release=${gateRelease}:knee=3.5`,
  )
  stages.push('deesser=i=0.25')
  // Milder speech normalize — aggressive speechnorm pumps and sounds processed.
  stages.push('speechnorm=e=6:r=0.00005:l=1')
  stages.push('alimiter=limit=0.97')

  return { filter: stages.join(','), usedRnnoise, usedDeEcho: deEcho }
}

export function clearCastModelAvailable(): boolean {
  return Boolean(resolveModelPath())
}
