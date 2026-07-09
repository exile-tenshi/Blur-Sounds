import type { AudioDevice } from './audioTypes.js'

import { isSelectableMicrophoneDevice } from './audioLabels.js'



export interface DeviceGroup {

  label: string

  devices: AudioDevice[]

}



function uniqueDevices(devices: AudioDevice[]): AudioDevice[] {

  const seen = new Set<string>()

  const unique: AudioDevice[] = []



  for (const device of devices) {

    if (seen.has(device.id)) {

      continue

    }



    seen.add(device.id)

    unique.push(device)

  }



  return unique

}



function groupDevices(devices: AudioDevice[], rules: Array<{ label: string; test: RegExp }>): DeviceGroup[] {

  const remaining = [...devices]

  const groups: DeviceGroup[] = []



  for (const rule of rules) {

    const matched = remaining.filter((device) => rule.test.test(device.name))

    if (matched.length === 0) {

      continue

    }



    groups.push({ label: rule.label, devices: matched })

    for (const device of matched) {

      const index = remaining.indexOf(device)

      if (index >= 0) {

        remaining.splice(index, 1)

      }

    }

  }



  if (remaining.length > 0) {

    groups.push({ label: 'Other', devices: remaining })

  }



  return groups

}



export function groupMicrophoneDevices(devices: AudioDevice[]): DeviceGroup[] {
  const microphones = uniqueDevices(devices).filter(
    (device) => device.kind === 'input' && isSelectableMicrophoneDevice(device.name),
  )

  if (microphones.length === 0) {
    return []
  }

  return groupDevices(microphones, [
    { label: 'VR & headsets', test: /vive|htc|valve index|oculus|meta quest|quest|headset|reverb|pimax/i },
    { label: 'USB & wireless mics', test: /microphone|\bmic\b|hyperx|fox|steelseries|webcam|usb/i },
    { label: 'Other capture devices', test: /.*/ },
  ])
}



export function groupRecordingDevices(devices: AudioDevice[]): DeviceGroup[] {

  return groupDevices(uniqueDevices(devices), [

    { label: 'VB-Audio Hi-Fi Cable', test: /hi-?fi.*cable\s+output|cable\s+output.*hi-?fi/i },

    { label: 'Voicemeeter A buses', test: /voicemeeter out a\d/i },

    { label: 'Voicemeeter B buses', test: /voicemeeter out b\d/i },

    { label: 'Voicemeeter main outputs', test: /voicemeeter (output|aux output|vaio3 output)/i },

    { label: 'Microphones', test: /microphone|\bmic\b/i },

    { label: 'Other recording devices', test: /.*/ },

  ])

}



export function groupPlaybackDevices(devices: AudioDevice[]): DeviceGroup[] {

  return groupDevices(uniqueDevices(devices), [

    { label: 'VB-Audio Hi-Fi Cable', test: /hi-?fi.*cable\s+input|cable\s+input.*hi-?fi/i },

    { label: 'Voicemeeter extension buses', test: /voicemeeter in [ab]\d/i },

    { label: 'Voicemeeter inputs', test: /voicemeeter (input|aux input|vaio3 input|in \d)/i },

    { label: 'Speakers & headphones', test: /speaker|headphone|digital output|display|monitor|tv/i },

    { label: 'Other playback devices', test: /.*/ },

  ])

}



export function formatDeviceOptionLabel(device: AudioDevice): string {

  if (device.isAvailable) {

    return device.name

  }



  return `${device.name} (offline)`

}

