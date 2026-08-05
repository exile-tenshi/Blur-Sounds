import {
  DEFAULT_NOISE_SUPPRESSION,
  normalizeNoiseSuppression,
  type NoiseSuppressionSettings,
} from './noiseSuppression.js'

export type NoiseMicKind = 'vr-headset' | 'gaming-headset' | 'usb-condenser' | 'dynamic' | 'laptop' | 'generic'

export interface NoisePreset {
  id: string
  label: string
  hint: string
  kinds: NoiseMicKind[] | 'all'
  settings: Partial<NoiseSuppressionSettings> & { enabled: true }
}

export const NOISE_PRESETS: NoisePreset[] = [
  {
    id: 'vr-headset',
    label: 'VR headset',
    hint: 'Quest / Index / Vive / Pico — cuts HMD fan + room noise',
    kinds: ['vr-headset'],
    settings: {
      enabled: true,
      strength: 78,
      highPassHz: 95,
      attack: 60,
      release: 45,
      noiseGateEnabled: false,
      noiseGateThreshold: 35,
    },
  },
  {
    id: 'gaming-headset',
    label: 'Gaming headset',
    hint: 'HyperX / SteelSeries / Razer boom mics',
    kinds: ['gaming-headset'],
    settings: {
      enabled: true,
      strength: 68,
      highPassHz: 85,
      attack: 55,
      release: 40,
      noiseGateEnabled: false,
      noiseGateThreshold: 35,
    },
  },
  {
    id: 'usb-condenser',
    label: 'USB mic',
    hint: 'Desktop condensers pick up more room — moderate cleanup',
    kinds: ['usb-condenser'],
    settings: {
      enabled: true,
      strength: 55,
      highPassHz: 75,
      attack: 50,
      release: 35,
      noiseGateEnabled: false,
      noiseGateThreshold: 30,
    },
  },
  {
    id: 'dynamic',
    label: 'Dynamic / broadcast',
    hint: 'SM7B-style / XLR dynamics — lighter touch',
    kinds: ['dynamic'],
    settings: {
      enabled: true,
      strength: 42,
      highPassHz: 70,
      attack: 45,
      release: 30,
      noiseGateEnabled: false,
      noiseGateThreshold: 30,
    },
  },
  {
    id: 'soft',
    label: 'Soft',
    hint: 'Quiet room — keep voice natural',
    kinds: 'all',
    settings: {
      enabled: true,
      strength: 40,
      highPassHz: 70,
      noiseGateEnabled: false,
      noiseGateThreshold: 30,
    },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    hint: 'Default all-rounder',
    kinds: 'all',
    settings: {
      ...DEFAULT_NOISE_SUPPRESSION,
      enabled: true,
      strength: 65,
      highPassHz: 80,
      noiseGateEnabled: false,
    },
  },
  {
    id: 'aggressive',
    label: 'Aggressive',
    hint: 'Loud PC fans / keyboard — may sound processed',
    kinds: 'all',
    settings: {
      enabled: true,
      strength: 88,
      highPassHz: 100,
      attack: 65,
      release: 50,
      // Hard gate ducks speech — leave cleanup to RNNoise strength only.
      noiseGateEnabled: false,
      noiseGateThreshold: 38,
    },
  },
]

export function detectNoiseMicKind(deviceName: string): NoiseMicKind {
  const name = deviceName.trim()
  if (!name) {
    return 'generic'
  }

  if (/vive|htc|valve\s*index|oculus|meta\s*quest|\bquest\b|pico|pimax|reverb|varjo|hp\s*g2|vr\b|headset/i.test(name)) {
    return 'vr-headset'
  }

  if (/hyperx|steelseries|razer|logitech\s*g|corsair|arctis|cloud|turtle\s*beach|astro|gaming/i.test(name)) {
    return 'gaming-headset'
  }

  if (/sm7|sm58|sm57|rode\s*procaster|dynamic|xlr|focusrite|scarlett|quadcast/i.test(name)) {
    return 'dynamic'
  }

  if (/blue\s*yeti|yeti|snowball|fifine|elgato|wave|condenser|usb\s*mic|microphone\s*\(/i.test(name)) {
    return 'usb-condenser'
  }

  if (/realtek|laptop|internal|array|built-?in/i.test(name)) {
    return 'laptop'
  }

  return 'generic'
}

export function presetsForMic(deviceName: string): NoisePreset[] {
  const kind = detectNoiseMicKind(deviceName)
  const preferred = NOISE_PRESETS.filter(
    (preset) => preset.kinds === 'all' || preset.kinds.includes(kind),
  )
  // Put the mic-specific preset first when available.
  return preferred.sort((left, right) => {
    const leftSpecific = left.kinds !== 'all' && left.kinds.includes(kind) ? 0 : 1
    const rightSpecific = right.kinds !== 'all' && right.kinds.includes(kind) ? 0 : 1
    return leftSpecific - rightSpecific
  })
}

export function recommendedPresetForMic(deviceName: string): NoisePreset {
  const kind = detectNoiseMicKind(deviceName)
  return (
    NOISE_PRESETS.find((preset) => preset.kinds !== 'all' && preset.kinds.includes(kind)) ??
    NOISE_PRESETS.find((preset) => preset.id === 'balanced') ??
    NOISE_PRESETS[0]
  )
}

export function applyNoisePreset(preset: NoisePreset): NoiseSuppressionSettings {
  return normalizeNoiseSuppression(preset.settings)
}

export function micKindLabel(kind: NoiseMicKind): string {
  switch (kind) {
    case 'vr-headset':
      return 'VR headset mic'
    case 'gaming-headset':
      return 'Gaming headset mic'
    case 'usb-condenser':
      return 'USB / condenser mic'
    case 'dynamic':
      return 'Dynamic / broadcast mic'
    case 'laptop':
      return 'Laptop / built-in mic'
    default:
      return 'Microphone'
  }
}
