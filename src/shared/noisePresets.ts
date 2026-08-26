import {
  DEFAULT_NOISE_SUPPRESSION,
  normalizeNoiseSuppression,
  type NoiseSuppressionSettings,
} from './noiseSuppression.js'
import { MIC_EQ_PRESETS, type RouteEqualizerSettings } from './audioConstants.js'

export type NoiseMicKind =
  | 'vr-headset'
  | 'gaming-headset'
  | 'boom-arm'
  | 'desk-stand'
  | 'usb-condenser'
  | 'dynamic'
  | 'lapel'
  | 'laptop'
  | 'webcam'
  | 'generic'

export interface NoisePreset {
  id: string
  label: string
  hint: string
  kinds: NoiseMicKind[] | 'all'
  settings: Partial<NoiseSuppressionSettings> & { enabled: true }
  /** Optional mic EQ curve applied with this ClearCast preset. */
  equalizer?: RouteEqualizerSettings
}

function micEq(presetId: string): RouteEqualizerSettings | undefined {
  return MIC_EQ_PRESETS.find((preset) => preset.id === presetId)?.settings
}

/** Presets bias natural voice; Aggressive is the only near-max RNNoise option. */
export const NOISE_PRESETS: NoisePreset[] = [
  {
    id: 'vr-headset',
    label: 'VR headset',
    hint: 'Quest / Index / Vive / Pico — HMD fan cleanup without robotic voice',
    kinds: ['vr-headset'],
    settings: {
      enabled: true,
      deEcho: true,
      strength: 78,
      highPassHz: 95,
      attack: 58,
      release: 44,
      threshold: 55,
      impact: 40,
      noiseGateEnabled: false,
      noiseGateThreshold: 40,
      compressorEnabled: false,
      compressorLevel: 28,
    },
    equalizer: micEq('rumble-cut'),
  },
  {
    id: 'gaming-headset',
    label: 'Gaming headset',
    hint: 'HyperX / SteelSeries / Razer / Arctis boom mics',
    kinds: ['gaming-headset'],
    settings: {
      enabled: true,
      deEcho: true,
      strength: 72,
      highPassHz: 85,
      attack: 55,
      release: 42,
      threshold: 48,
      impact: 35,
      noiseGateEnabled: false,
      noiseGateThreshold: 38,
      compressorEnabled: false,
      compressorLevel: 26,
    },
    equalizer: micEq('headset'),
  },
  {
    id: 'boom-arm',
    label: 'Boom arm',
    hint: 'Mic on a boom over the desk — keyboard + PC fan pickup',
    kinds: ['boom-arm', 'usb-condenser', 'dynamic'],
    settings: {
      enabled: true,
      deEcho: true,
      strength: 70,
      highPassHz: 80,
      attack: 54,
      release: 40,
      threshold: 45,
      impact: 30,
      noiseGateEnabled: false,
      noiseGateThreshold: 36,
      compressorEnabled: false,
      compressorLevel: 24,
    },
    equalizer: micEq('boom-arm'),
  },
  {
    id: 'desk-stand',
    label: 'Desk stand',
    hint: 'Mic on the desk — more surface / keyboard noise',
    kinds: ['desk-stand', 'usb-condenser'],
    settings: {
      enabled: true,
      deEcho: true,
      strength: 74,
      highPassHz: 90,
      attack: 56,
      release: 42,
      threshold: 50,
      impact: 55,
      noiseGateEnabled: false,
      noiseGateThreshold: 38,
      compressorEnabled: false,
      compressorLevel: 26,
    },
    equalizer: micEq('broadcast'),
  },
  {
    id: 'usb-condenser',
    label: 'USB condenser',
    hint: 'Yeti / Wave / Fifine-style desktop condensers',
    kinds: ['usb-condenser'],
    settings: {
      enabled: true,
      deEcho: true,
      strength: 68,
      highPassHz: 80,
      attack: 52,
      release: 40,
      threshold: 45,
      impact: 20,
      noiseGateEnabled: false,
      noiseGateThreshold: 34,
      compressorEnabled: false,
      compressorLevel: 22,
    },
    equalizer: micEq('voice-clarity'),
  },
  {
    id: 'dynamic',
    label: 'Dynamic / XLR',
    hint: 'SM7B / SM58 / Procaster — lighter touch, already quiet',
    kinds: ['dynamic'],
    settings: {
      enabled: true,
      deEcho: true,
      strength: 58,
      highPassHz: 75,
      attack: 50,
      release: 36,
      threshold: 28,
      impact: 10,
      noiseGateEnabled: false,
      noiseGateThreshold: 30,
      compressorEnabled: false,
      compressorLevel: 20,
    },
    equalizer: micEq('warm'),
  },
  {
    id: 'lapel',
    label: 'Lapel / lav',
    hint: 'Clip-on lavaliers — clothing rustle + room tone',
    kinds: ['lapel'],
    settings: {
      enabled: true,
      deEcho: true,
      strength: 72,
      highPassHz: 90,
      attack: 56,
      release: 42,
      threshold: 48,
      impact: 15,
      noiseGateEnabled: false,
      noiseGateThreshold: 36,
      compressorEnabled: false,
      compressorLevel: 24,
    },
    equalizer: micEq('voice-clarity'),
  },
  {
    id: 'laptop',
    label: 'Laptop mic',
    hint: 'Built-in / Realtek array mics — lots of fan noise',
    kinds: ['laptop'],
    settings: {
      enabled: true,
      deEcho: true,
      strength: 80,
      highPassHz: 100,
      attack: 58,
      release: 46,
      threshold: 58,
      impact: 25,
      noiseGateEnabled: false,
      noiseGateThreshold: 40,
      compressorEnabled: false,
      compressorLevel: 28,
    },
    equalizer: micEq('rumble-cut'),
  },
  {
    id: 'webcam',
    label: 'Webcam / phone',
    hint: 'Camera or phone mics — thin and noisy',
    kinds: ['webcam'],
    settings: {
      enabled: true,
      deEcho: true,
      strength: 76,
      highPassHz: 95,
      attack: 56,
      release: 44,
      threshold: 52,
      impact: 20,
      noiseGateEnabled: false,
      noiseGateThreshold: 38,
      compressorEnabled: false,
      compressorLevel: 26,
    },
    equalizer: micEq('bright'),
  },
  {
    id: 'soft',
    label: 'Soft',
    hint: 'Quiet room — keep voice natural',
    kinds: 'all',
    settings: {
      enabled: true,
      deEcho: true,
      strength: 52,
      highPassHz: 70,
      threshold: 22,
      impact: 0,
      noiseGateEnabled: false,
      noiseGateThreshold: 28,
      compressorEnabled: false,
      compressorLevel: 18,
    },
    equalizer: micEq('flat'),
  },
  {
    id: 'balanced',
    label: 'Balanced',
    hint: 'Default all-rounder — natural voice, light noise cleanup',
    kinds: 'all',
    settings: {
      ...DEFAULT_NOISE_SUPPRESSION,
      enabled: true,
      deEcho: true,
      strength: 70,
      highPassHz: 80,
      threshold: 42,
      impact: 20,
      noiseGateEnabled: false,
      compressorEnabled: false,
      compressorLevel: 24,
    },
    equalizer: micEq('voice-clarity'),
  },
  {
    id: 'streaming',
    label: 'Streaming',
    hint: 'Discord / Twitch — clear voice over PC noise, still natural',
    kinds: 'all',
    settings: {
      enabled: true,
      deEcho: true,
      strength: 76,
      highPassHz: 88,
      attack: 56,
      release: 44,
      threshold: 50,
      impact: 40,
      noiseGateEnabled: false,
      noiseGateThreshold: 38,
      compressorEnabled: false,
      compressorLevel: 28,
    },
    equalizer: micEq('broadcast'),
  },
  {
    id: 'aggressive',
    label: 'Aggressive',
    hint: 'Loud fans / keyboard — stronger cleanup (more processed)',
    kinds: 'all',
    settings: {
      enabled: true,
      deEcho: true,
      strength: 90,
      highPassHz: 105,
      attack: 62,
      release: 48,
      threshold: 72,
      impact: 70,
      noiseGateEnabled: false,
      noiseGateThreshold: 42,
      compressorEnabled: true,
      compressorLevel: 32,
    },
    equalizer: micEq('rumble-cut'),
  },
]

export function detectNoiseMicKind(deviceName: string): NoiseMicKind {
  const name = deviceName.trim()
  if (!name) {
    return 'generic'
  }

  if (
    /vive|htc|valve\s*index|oculus|meta\s*quest|\bquest\b|pico|pimax|reverb|varjo|hp\s*g2|\bvr\b|virtual\s*desktop|steam\s*streaming/i.test(
      name,
    )
  ) {
    return 'vr-headset'
  }

  if (
    /hyperx|steelseries|razer|logitech\s*g|corsair|arctis|cloud|turtle\s*beach|astro|headset|earcup/i.test(
      name,
    )
  ) {
    return 'gaming-headset'
  }

  if (/lav|lapel|lavalier|collar|clip.?on/i.test(name)) {
    return 'lapel'
  }

  if (/webcam|camera|phone|iphone|android|facetime/i.test(name)) {
    return 'webcam'
  }

  if (/boom|arm\s*mic|podcast\s*arm/i.test(name)) {
    return 'boom-arm'
  }

  if (/desk|stand\s*mic|desktop\s*mic/i.test(name)) {
    return 'desk-stand'
  }

  if (/sm7|sm58|sm57|rode\s*procaster|dynamic|xlr|focusrite|scarlett|shure|electro.?voice/i.test(name)) {
    return 'dynamic'
  }

  if (/blue\s*yeti|yeti|snowball|fifine|elgato|wave|condenser|usb\s*mic|quadcast|atr/i.test(name)) {
    return 'usb-condenser'
  }

  if (/realtek|laptop|internal|array|built-?in|microphone\s*array/i.test(name)) {
    return 'laptop'
  }

  return 'generic'
}

export function micKindLabel(kind: NoiseMicKind): string {
  switch (kind) {
    case 'vr-headset':
      return 'VR headset mic'
    case 'gaming-headset':
      return 'Gaming headset mic'
    case 'boom-arm':
      return 'Boom arm mic'
    case 'desk-stand':
      return 'Desk stand mic'
    case 'usb-condenser':
      return 'USB / condenser mic'
    case 'dynamic':
      return 'Dynamic / XLR mic'
    case 'lapel':
      return 'Lapel / lav mic'
    case 'laptop':
      return 'Laptop / built-in mic'
    case 'webcam':
      return 'Webcam / phone mic'
    default:
      return 'Microphone'
  }
}

/** All presets, recommended mic-type first. */
export function presetsForMic(deviceName: string): NoisePreset[] {
  const kind = detectNoiseMicKind(deviceName)
  return [...NOISE_PRESETS].sort((left, right) => {
    const leftScore = presetSortScore(left, kind)
    const rightScore = presetSortScore(right, kind)
    if (leftScore !== rightScore) {
      return leftScore - rightScore
    }
    return left.label.localeCompare(right.label)
  })
}

function presetSortScore(preset: NoisePreset, kind: NoiseMicKind): number {
  if (preset.kinds !== 'all' && preset.kinds.includes(kind)) {
    return 0
  }
  if (preset.id === 'streaming') {
    return 1
  }
  if (preset.id === 'balanced') {
    return 2
  }
  if (preset.kinds === 'all') {
    return 3
  }
  return 4
}

export function recommendedPresetForMic(deviceName: string): NoisePreset {
  const kind = detectNoiseMicKind(deviceName)
  return (
    NOISE_PRESETS.find((preset) => preset.kinds !== 'all' && preset.kinds.includes(kind)) ??
    NOISE_PRESETS.find((preset) => preset.id === 'streaming') ??
    NOISE_PRESETS.find((preset) => preset.id === 'balanced') ??
    NOISE_PRESETS[0]
  )
}

export function applyNoisePreset(preset: NoisePreset): NoiseSuppressionSettings {
  return normalizeNoiseSuppression(preset.settings)
}

function noiseSettingsMatch(left: NoiseSuppressionSettings, right: NoiseSuppressionSettings): boolean {
  return (
    left.enabled === right.enabled &&
    left.strength === right.strength &&
    left.threshold === right.threshold &&
    left.impact === right.impact &&
    left.highPassHz === right.highPassHz &&
    left.attack === right.attack &&
    left.release === right.release &&
    left.deEcho === right.deEcho &&
    left.noiseGateEnabled === right.noiseGateEnabled &&
    left.noiseGateThreshold === right.noiseGateThreshold &&
    left.compressorEnabled === right.compressorEnabled &&
    left.compressorLevel === right.compressorLevel
  )
}

/** Resolve the ClearCast preset that matches saved settings, or custom after edits. */
export function matchNoisePresetId(settings: NoiseSuppressionSettings): string {
  const match = NOISE_PRESETS.find((preset) => noiseSettingsMatch(settings, applyNoisePreset(preset)))
  return match?.id ?? 'custom'
}
