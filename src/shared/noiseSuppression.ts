export interface NoiseSuppressionSettings {
  enabled: boolean
  /** 0–100: how hard background noise is cut */
  strength: number
  /** 0–100: gate sensitivity (higher = opens easier / more voice) */
  threshold: number
  /** High-pass cutoff in Hz */
  highPassHz: number
  /** 0–100: how quickly the gate opens */
  attack: number
  /** 0–100: how quickly the gate closes */
  release: number
}

export const DEFAULT_NOISE_SUPPRESSION: NoiseSuppressionSettings = {
  enabled: false,
  strength: 70,
  threshold: 55,
  highPassHz: 85,
  attack: 55,
  release: 40,
}

export function clampNoisePercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function clampHighPassHz(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_NOISE_SUPPRESSION.highPassHz
  }
  return Math.max(40, Math.min(220, Math.round(value)))
}

export function normalizeNoiseSuppression(
  partial?: Partial<NoiseSuppressionSettings> | boolean | null,
): NoiseSuppressionSettings {
  if (partial === true) {
    return { ...DEFAULT_NOISE_SUPPRESSION, enabled: true }
  }
  if (partial === false || partial == null) {
    return { ...DEFAULT_NOISE_SUPPRESSION }
  }

  return {
    enabled: Boolean(partial.enabled),
    strength: clampNoisePercent(partial.strength ?? DEFAULT_NOISE_SUPPRESSION.strength),
    threshold: clampNoisePercent(partial.threshold ?? DEFAULT_NOISE_SUPPRESSION.threshold),
    highPassHz: clampHighPassHz(partial.highPassHz ?? DEFAULT_NOISE_SUPPRESSION.highPassHz),
    attack: clampNoisePercent(partial.attack ?? DEFAULT_NOISE_SUPPRESSION.attack),
    release: clampNoisePercent(partial.release ?? DEFAULT_NOISE_SUPPRESSION.release),
  }
}
