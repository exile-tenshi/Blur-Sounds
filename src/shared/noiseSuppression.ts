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
  /**
   * 0–100: room echo / reverb-tail kill after speech.
   * 0 = off. ~40–55 natural. High values can sound processed/robotic.
   */
  deEcho: number
  /** Optional noise gate */
  noiseGateEnabled: boolean
  /** 0–100: gate sensitivity */
  noiseGateThreshold: number
  /** Optional soft compressor after AI cleanup */
  compressorEnabled: boolean
  /** 0–100: compressor amount (Sonar “Level”) */
  compressorLevel: number
}

/**
 * Sonar-competitive defaults: strong AI + Background kills room/fans,
 * Impact kills keyboard/desk. Echo mid so rooms don't ring.
 */
export const DEFAULT_NOISE_SUPPRESSION: NoiseSuppressionSettings = {
  enabled: false,
  strength: 90,
  threshold: 78,
  impact: 72,
  highPassHz: 95,
  attack: 58,
  release: 44,
  deEcho: 48,
  noiseGateEnabled: false,
  noiseGateThreshold: 40,
  compressorEnabled: false,
  compressorLevel: 28,
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

/** Accept legacy boolean deEcho from older installs. */
export function normalizeDeEchoAmount(raw: unknown): number {
  if (typeof raw === 'boolean') {
    return raw ? 55 : 0
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return clampNoisePercent(raw)
  }
  return DEFAULT_NOISE_SUPPRESSION.deEcho
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
    deEcho: normalizeDeEchoAmount(
      partial.deEcho !== undefined ? partial.deEcho : DEFAULT_NOISE_SUPPRESSION.deEcho,
    ),
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
