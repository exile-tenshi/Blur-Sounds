export interface NoiseSuppressionSettings {
  enabled: boolean
  /** 0–100: ClearCast AI intensity (Min → Max) */
  strength: number
  /** Legacy soft-expander knob — unused by RNNoise, kept for saved settings compat */
  threshold: number
  /** High-pass cut in Hz before RNNoise (rumble / fan thump) */
  highPassHz: number
  /** 0–100: optional hard-gate open speed */
  attack: number
  /** 0–100: optional hard-gate close speed */
  release: number
  /** Optional noise gate */
  noiseGateEnabled: boolean
  /** 0–100: gate sensitivity */
  noiseGateThreshold: number
  /** Optional soft compressor after AI cleanup */
  compressorEnabled: boolean
  /** 0–100: compressor amount (Sonar “Level”) */
  compressorLevel: number
}

export const DEFAULT_NOISE_SUPPRESSION: NoiseSuppressionSettings = {
  enabled: false,
  strength: 72,
  threshold: 55,
  highPassHz: 85,
  attack: 55,
  release: 40,
  noiseGateEnabled: false,
  noiseGateThreshold: 35,
  compressorEnabled: false,
  compressorLevel: 30,
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

  const enabled = Boolean(partial.enabled)
  return {
    enabled,
    strength: clampNoisePercent(partial.strength ?? DEFAULT_NOISE_SUPPRESSION.strength),
    threshold: clampNoisePercent(partial.threshold ?? DEFAULT_NOISE_SUPPRESSION.threshold),
    highPassHz: clampHighPassHz(partial.highPassHz ?? DEFAULT_NOISE_SUPPRESSION.highPassHz),
    attack: clampNoisePercent(partial.attack ?? DEFAULT_NOISE_SUPPRESSION.attack),
    release: clampNoisePercent(partial.release ?? DEFAULT_NOISE_SUPPRESSION.release),
    noiseGateEnabled: Boolean(partial.noiseGateEnabled),
    noiseGateThreshold: clampNoisePercent(
      partial.noiseGateThreshold ?? DEFAULT_NOISE_SUPPRESSION.noiseGateThreshold,
    ),
    compressorEnabled: enabled && Boolean(partial.compressorEnabled),
    compressorLevel: clampNoisePercent(
      partial.compressorLevel ?? DEFAULT_NOISE_SUPPRESSION.compressorLevel,
    ),
  }
}
