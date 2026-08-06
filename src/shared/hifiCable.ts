import type { AudioDevice, HifiCableEndpointStatus, HifiCableInfo } from './audioTypes.js'

export const HIFI_CABLE_PRODUCT_URL = 'https://vb-audio.com/Cable/index.htm'
export const HIFI_CABLE_DOWNLOAD_URL =
  'http://vincent.burel.free.fr/VirtualAudioApps/HiFiCableAsioBridgeSetup_v1007.zip'

export const HIFI_CABLE_QUALITY = {
  sampleRateHz: 48000,
  bitsPerSample: 24,
  channels: 2 as const,
  label: '24 bit, 48000 Hz (Clean audio)',
  shortLabel: '48 kHz · 24-bit · stereo',
} as const

export const HIFI_CABLE_PLAYBACK_NAMES = [
  'Hi-Fi Cable Input',
  'CABLE Input (VB-Audio Hi-Fi Cable)',
] as const

export const HIFI_CABLE_RECORDING_NAMES = [
  'Hi-Fi Cable Output',
  'CABLE Output (VB-Audio Hi-Fi Cable)',
] as const

/** Matches VB-Audio Hi-Fi Cable naming (not regular Virtual Cable). */
export function isHifiCableDeviceName(deviceName: string): boolean {
  const normalized = deviceName.trim()
  return /hi-?fi/i.test(normalized) && /cable/i.test(normalized)
}

export function isHifiCablePlaybackDevice(deviceName: string): boolean {
  if (!isHifiCableDeviceName(deviceName)) {
    return false
  }

  const lower = deviceName.toLowerCase()

  if (/cable\s+output\b|hi-?fi\s+cable\s+output\b/.test(lower)) {
    return false
  }

  if (/cable\s+input\b|hi-?fi\s+cable\s+input\b/.test(lower)) {
    return true
  }

  return !/\boutput\b/.test(lower)
}

export function isHifiCableRecordingDevice(deviceName: string): boolean {
  if (!isHifiCableDeviceName(deviceName)) {
    return false
  }

  const lower = deviceName.toLowerCase()

  if (/cable\s+input\b|hi-?fi\s+cable\s+input\b/.test(lower)) {
    return false
  }

  if (/cable\s+output\b|hi-?fi\s+cable\s+output\b/.test(lower)) {
    return true
  }

  return /\boutput\b/.test(lower)
}

function namesMatch(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

function findDeviceByPreferredName(
  devices: AudioDevice[],
  preferredNames: readonly string[],
): AudioDevice | undefined {
  for (const preferredName of preferredNames) {
    const exact = devices.find((device) => namesMatch(device.name, preferredName))
    if (exact) {
      return exact
    }
  }

  for (const preferredName of preferredNames) {
    const preferredBase = preferredName.split('(')[0]?.trim() ?? preferredName
    const partial = devices.find((device) =>
      device.name.toLowerCase().includes(preferredBase.toLowerCase()),
    )
    if (partial) {
      return partial
    }
  }

  return undefined
}

export function findHifiCablePlaybackDevice(devices: AudioDevice[]): AudioDevice | undefined {
  const playbackDevices = devices.filter(
    (device) => device.kind === 'output' && isHifiCablePlaybackDevice(device.name),
  )
  const availableDevices = playbackDevices.filter((device) => device.isAvailable)

  return (
    findDeviceByPreferredName(availableDevices, HIFI_CABLE_PLAYBACK_NAMES) ??
    findDeviceByPreferredName(playbackDevices, HIFI_CABLE_PLAYBACK_NAMES) ??
    availableDevices[0] ??
    playbackDevices[0]
  )
}

export function findHifiCableRecordingDevice(
  devices: AudioDevice[],
  playbackDevice?: AudioDevice,
): AudioDevice | undefined {
  const recordingDevices = devices.filter(
    (device) => device.kind === 'input' && isHifiCableRecordingDevice(device.name),
  )
  const availableDevices = recordingDevices.filter((device) => device.isAvailable)

  if (playbackDevice) {
    const paired =
      findDeviceByPreferredName(availableDevices, HIFI_CABLE_RECORDING_NAMES) ??
      findDeviceByPreferredName(recordingDevices, HIFI_CABLE_RECORDING_NAMES)
    if (paired) {
      return paired
    }
  }

  return (
    findDeviceByPreferredName(availableDevices, HIFI_CABLE_RECORDING_NAMES) ??
    findDeviceByPreferredName(recordingDevices, HIFI_CABLE_RECORDING_NAMES) ??
    availableDevices[0] ??
    recordingDevices[0]
  )
}

export function getHifiCableSelectionDefaults(devices: AudioDevice[]): {
  inputDeviceId?: string
  recordingDeviceId?: string
  inputDeviceName: string
  recordingDeviceName: string
} {
  const preferredInput = findHifiCablePlaybackDevice(devices)
  const preferredRecording = findHifiCableRecordingDevice(devices, preferredInput)

  return {
    inputDeviceId: preferredInput?.id,
    recordingDeviceId: preferredRecording?.id,
    inputDeviceName: preferredInput?.name ?? HIFI_CABLE_PLAYBACK_NAMES[0],
    recordingDeviceName: preferredRecording?.name ?? HIFI_CABLE_RECORDING_NAMES[0],
  }
}

export function detectHifiCableDependency(devices: AudioDevice[]): HifiCableInfo {
  const playbackMatches = devices.filter(
    (device) => device.kind === 'output' && isHifiCablePlaybackDevice(device.name),
  )
  const recordingMatches = devices.filter(
    (device) => device.kind === 'input' && isHifiCableRecordingDevice(device.name),
  )

  const playbackDevices = playbackMatches
    .map((device) => device.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  const recordingDevices = recordingMatches
    .map((device) => device.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))

  const preferredPlayback = findHifiCablePlaybackDevice(devices)
  const playbackInstalled = playbackMatches.length > 0
  const playbackReady = playbackMatches.some((device) => device.isAvailable)
  const recordingReady = recordingMatches.some((device) => device.isAvailable)

  return {
    installed: playbackInstalled,
    playbackReady,
    recordingReady,
    playbackDevices,
    recordingDevices,
    preferredPlaybackDeviceId: preferredPlayback?.id,
    productUrl: HIFI_CABLE_PRODUCT_URL,
    downloadUrl: HIFI_CABLE_DOWNLOAD_URL,
    formatSpec: HIFI_CABLE_QUALITY.shortLabel,
    qualityLabel: HIFI_CABLE_QUALITY.label,
  }
}

export function mergeHifiCableFormatStatus(
  info: HifiCableInfo,
  result?: {
    playbackStatus?: HifiCableEndpointStatus
    recordingStatus?: HifiCableEndpointStatus
  },
): HifiCableInfo {
  if (!result?.playbackStatus && !result?.recordingStatus) {
    return info
  }

  const playbackAtStudioQuality = result.playbackStatus?.atStudioQuality
  const recordingAtStudioQuality = result.recordingStatus?.atStudioQuality

  return {
    ...info,
    playbackAtStudioQuality,
    recordingAtStudioQuality,
    playbackFormatLabel: result.playbackStatus?.formatLabel,
    recordingFormatLabel: result.recordingStatus?.formatLabel,
    // Shared mode is required — exclusive-allowed on either side is not "ready".
    exclusiveModeReady:
      result.playbackStatus?.exclusiveModeEnabled === false &&
      result.recordingStatus?.exclusiveModeEnabled === false,
  }
}

export function formatHifiCableMissingMessage(): string {
  return `Hi-Fi Cable Input is required. Download Hi-Fi Cable & ASIO Bridge from ${HIFI_CABLE_DOWNLOAD_URL}, install it, then click Refresh.`
}

export function formatHifiCableDisabledMessage(): string {
  return 'Hi-Fi Cable is installed but disabled. Open Windows Sound → Playback, right-click Hi-Fi Cable Input, choose Enable, then click Refresh.'
}

export function formatHifiCableUnavailableMessage(info: HifiCableInfo): string {
  if (info.installed && !info.playbackReady) {
    return formatHifiCableDisabledMessage()
  }

  return formatHifiCableMissingMessage()
}

export function formatHifiCableRecordingUnavailableMessage(): string {
  return 'Hi-Fi Cable Output (recording) is missing or disabled. Enable it under Windows Sound → Recording, then Refresh. Other apps listen on Output — without it the mix never leaves the cable.'
}

/**
 * Returns a hard-fail message when Hi-Fi Cable formats cannot carry audio.
 * MixFormat rates must match (bit-perfect). Prefer both at 48 kHz · 24-bit.
 */
export function describeHifiFormatStartBlocker(result: {
  playbackConfigured: boolean
  recordingConfigured: boolean
  playbackStatus?: HifiCableEndpointStatus
  recordingStatus?: HifiCableEndpointStatus
  message?: string
}): string | undefined {
  const playbackRate = result.playbackStatus?.sampleRate ?? 0
  const recordingRate = result.recordingStatus?.sampleRate ?? 0
  const playbackOk = result.playbackStatus?.atStudioQuality === true
  const recordingOk = result.recordingStatus?.atStudioQuality === true

  const exclusiveOn =
    result.playbackStatus?.exclusiveModeEnabled === true ||
    result.recordingStatus?.exclusiveModeEnabled === true
  if (exclusiveOn) {
    return (
      'Hi-Fi Cable still has exclusive mode enabled. In Windows Sound → Advanced on both ' +
      'Hi-Fi Cable Input and Output, uncheck Allow applications exclusive control, then ' +
      'click Apply clean audio settings and Start again.'
    )
  }

  // Ideal: both sides report clean 48 kHz MixFormat.
  if (playbackOk && recordingOk) {
    return undefined
  }

  // Also OK: both MixFormats match at any common rate (incl. legacy 384 kHz).
  if (playbackRate > 0 && recordingRate > 0 && playbackRate === recordingRate) {
    return undefined
  }

  if (playbackRate > 0 && recordingRate > 0 && playbackRate !== recordingRate) {
    return (
      `Hi-Fi Cable Input is ${playbackRate} Hz but Output is ${recordingRate} Hz. ` +
      'The cable is bit-perfect — mismatched rates are silent. ' +
      'In Setup click Apply clean audio settings, or set both Advanced formats to the same rate (48 kHz · 24-bit).'
    )
  }

  const inputLabel = result.playbackStatus?.formatLabel ?? 'unknown'
  const outputLabel = result.recordingStatus?.formatLabel ?? 'unknown'
  return (
    result.message ||
    `Hi-Fi Cable formats could not be verified (Input: ${inputLabel} · Output: ${outputLabel}). ` +
      'Open Setup → Apply clean audio settings, confirm both Windows Sound Advanced tabs match ' +
      '(48 kHz · 24-bit), then Start again.'
  )
}

/** @deprecated Use describeHifiFormatStartBlocker — Start must not soft-continue on format failure. */
export function describeHifiFormatStartWarning(
  result: Parameters<typeof describeHifiFormatStartBlocker>[0],
): string | undefined {
  return describeHifiFormatStartBlocker(result)
}

export function getHifiCableSetupSteps(): string[] {
  return [
    `Download and install Hi-Fi Cable & ASIO Bridge from ${HIFI_CABLE_DOWNLOAD_URL} (run setup as administrator, reboot if prompted).`,
    'Click Apply clean audio settings so Hi-Fi Cable Input and Output both use 24 bit, 48000 Hz (shared mode).',
    'On both Advanced tabs, uncheck Allow exclusive control and Give exclusive mode applications priority.',
    'Playback → Hi-Fi Cable Input: Levels tab not muted / not at 0%. Recording → Hi-Fi Cable Output: same.',
    'CRITICAL — Recording → Hi-Fi Cable Output → Listen tab: uncheck “Listen to this device”. If that is on, your speakers hear the full cable mix (mic + apps). Blur Sounds turns this off on Start when Windows allows it.',
    'ASIO Bridge: if a gold ASIO Bridge window is open, set PASS THRU (not ASIO / Direct), or close it. Direct mode also plays the cable through your headset.',
    'Click Test cable (plays tone). Watch Windows Recording → Hi-Fi Cable Output meter — it should jump. You should NOT hear the tone in your headset unless Listen/Direct is still on.',
    'Start stream in Blur Sounds — status should show Streaming when the mix is live.',
    `In Discord/OBS, set the input device to ${HIFI_CABLE_RECORDING_NAMES[0]} (not your real mic). Turn Discord Input Monitoring / sidetone OFF if you hear yourself locally.`,
  ]
}
