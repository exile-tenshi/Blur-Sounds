export interface NoiseSuppressionSettings {
  enabled: boolean
  /** 0–100: RNNoise dry/wet mix (100 = full neural cleanup) */
  strength: number
  /** Legacy soft-expander knob — unused by RNNoise, kept for saved settings compat */
  threshold: number
  /** Legacy high-pass Hz — unused by RNNoise, kept for saved settings compat */
  highPassHz: number
  /** 0–100: optional hard-gate open speed */
  attack: number
  /** 0–100: optional hard-gate close speed */
  release: number
  /** Optional hard noise gate — mutes the mic when you're silent */
  noiseGateEnabled: boolean
  /** 0–100: hard-gate sensitivity (higher = closes more / needs louder speech) */
  noiseGateThreshold: number
}

export const DEFAULT_NOISE_SUPPRESSION: NoiseSuppressionSettings = {
  enabled: false,
  strength: 65,
  threshold: 55,
  highPassHz: 80,
  attack: 55,
  release: 40,
  noiseGateEnabled: false,
  noiseGateThreshold: 35,
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
    noiseGateEnabled: Boolean(partial.noiseGateEnabled),
    noiseGateThreshold: clampNoisePercent(
      partial.noiseGateThreshold ?? DEFAULT_NOISE_SUPPRESSION.noiseGateThreshold,
    ),
  }
}
