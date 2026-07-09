import {
  HIFI_CABLE_QUALITY,
  isHifiCablePlaybackDevice,
  isHifiCableRecordingDevice,
} from './hifiCable.js'
import type { AudioDevice } from './audioTypes.js'

export function isRecordingEndpointDevice(deviceName: string): boolean {
  return (
    isHifiCableRecordingDevice(deviceName) ||
    /voicemeeter out|voicemeeter output|voicemeeter aux output|voicemeeter vaio3 output/i.test(deviceName)
  )
}

export function isSelectableMicrophoneDevice(deviceName: string): boolean {
  return !isRecordingEndpointDevice(deviceName)
}

export function isMicrophoneCaptureDevice(deviceName: string): boolean {
  return isSelectableMicrophoneDevice(deviceName)
}

export function describeMicrophoneDevice(_name: string): string {
  return 'Captured and mixed into the route'
}

export function describeInputDevice(name: string): string {
  if (isHifiCablePlaybackDevice(name)) {
    return `Mix is sent into Hi-Fi Cable Input at ${HIFI_CABLE_QUALITY.shortLabel}`
  }

  if (/voicemeeter in [ab]\d/i.test(name)) {
    return 'Mix is sent into this Voicemeeter extension bus'
  }

  if (/voicemeeter input|voicemeeter aux input|voicemeeter vaio3 input|voicemeeter in \d/i.test(name)) {
    return 'Mix is sent into this Voicemeeter input'
  }

  return 'Mix is sent into this playback device'
}

export function findMatchingRecordingDevice(
  inputName: string,
  recordingDevices: AudioDevice[],
): AudioDevice | undefined {
  if (/voicemeeter aux input/i.test(inputName)) {
    return recordingDevices.find((device) => /voicemeeter aux output/i.test(device.name))
  }

  if (/voicemeeter vaio3 input/i.test(inputName)) {
    return recordingDevices.find((device) => /voicemeeter vaio3 output/i.test(device.name))
  }

  if (isHifiCablePlaybackDevice(inputName)) {
    return recordingDevices.find((device) => isHifiCableRecordingDevice(device.name))
  }

  return undefined
}

export function describeRecordingDevice(name: string): string {
  if (isHifiCableRecordingDevice(name)) {
    return 'Other apps capture from Hi-Fi Cable Output in Windows Sound → Recording'
  }

  if (/voicemeeter out [ab]\d/i.test(name)) {
    return 'Recording from a Voicemeeter extension bus'
  }

  if (/voicemeeter out/i.test(name)) {
    return 'Recording from a Voicemeeter bus'
  }

  return 'Microphone or line-in — audio listened to and mixed'
}

export function getMatchingRecordingDeviceName(inputName: string): string {
  if (isHifiCablePlaybackDevice(inputName)) {
    return 'Hi-Fi Cable Output'
  }

  if (/voicemeeter aux input/i.test(inputName)) {
    return 'Voicemeeter Aux Output (VB-Audio Voicemeeter AUX VAIO)'
  }

  if (/voicemeeter vaio3 input/i.test(inputName)) {
    return 'Voicemeeter VAIO3 Output (VB-Audio Voicemeeter VAIO)'
  }

  if (/voicemeeter input/i.test(inputName)) {
    return 'Voicemeeter Output (VB-Audio Voicemeeter VAIO)'
  }

  return 'Matching recording device in Windows Sound → Recording'
}

export function getHifiCablePlaybackPriority(deviceName: string): number {
  return isHifiCablePlaybackDevice(deviceName) ? 0 : 3
}

export function getVoicemeeterOutputPriority(deviceName: string): number {
  if (/voicemeeter input \(vb-audio voicemeeter vaio\)/i.test(deviceName)) {
    return 1
  }

  if (/voicemeeter aux input/i.test(deviceName)) {
    return 2
  }

  if (/voicemeeter vaio3 input/i.test(deviceName)) {
    return 3
  }

  if (/voicemeeter in [ab]\d/i.test(deviceName)) {
    return 4
  }

  if (/voicemeeter in \d/i.test(deviceName)) {
    return 5
  }

  return 6
}

export function sortVoicemeeterDevices(left: string, right: string): number {
  if (/voicemeeter out/i.test(left) && /voicemeeter out/i.test(right)) {
    return left.localeCompare(right, undefined, { numeric: true })
  }

  return left.localeCompare(right)
}

export function getMicrophonePriority(deviceName: string): number {
  if (/microphone \(fox\)/i.test(deviceName)) {
    return 1
  }

  if (/microphone \(hyperx|steelseries sonar - microphone|microphone/i.test(deviceName)) {
    return 2
  }

  if (/mic/i.test(deviceName)) {
    return 3
  }

  if (/voicemeeter out|hi-?fi cable/i.test(deviceName)) {
    return 5
  }

  return 4
}
