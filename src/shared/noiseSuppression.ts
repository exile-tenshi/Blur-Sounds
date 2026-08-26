export interface NoiseSuppressionSettings {
  enabled: boolean
  /** 0–100: ClearCast AI intensity (Min → Max) */
  strength: number
  /** 0–100: classic Noise reduction → Background (Sonar-style) */
  threshold: number
  /** 0–100: classic Noise reduction → Impact (Sonar-style) */
  impact: number
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

/** Natural-first defaults — high strength + high Background made ClearCast robotic. */
export const DEFAULT_NOISE_SUPPRESSION: NoiseSuppressionSettings = {
  enabled: false,
  strength: 70,
  threshold: 42,
  impact: 0,
  highPassHz: 80,
  attack: 55,
  release: 40,
  noiseGateEnabled: false,
  noiseGateThreshold: 36,
  compressorEnabled: false,
  compressorLevel: 24,
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
    impact: clampNoisePercent(partial.impact ?? DEFAULT_NOISE_SUPPRESSION.impact),
    highPassHz: clampHighPassHz(partial.highPassHz ?? DEFAULT_NOISE_SUPPRESSION.highPassHz),
    attack: clampNoisePercent(partial.attack ?? DEFAULT_NOISE_SUPPRESSION.attack),
    release: clampNoisePercent(partial.release ?? DEFAULT_NOISE_SUPPRESSION.release),
    noiseGateEnabled: Boolean(partial.noiseGateEnabled),
    noiseGateThreshold: clampNoisePercent(
      partial.noiseGateThreshold ?? DEFAULT_NOISE_SUPPRESSION.noiseGateThreshold,
    ),
    compressorEnabled: Boolean(partial.compressorEnabled),
    compressorLevel: clampNoisePercent(
      partial.compressorLevel ?? DEFAULT_NOISE_SUPPRESSION.compressorLevel,
    ),
  }
}
