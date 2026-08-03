import { DEFAULT_INPUT_GAIN } from './audioConstants.js'
import type { DeviceSelection, MicrophoneSlot } from './audioTypes.js'

let slotCounter = 0

export function createMicrophoneSlot(partial?: Partial<MicrophoneSlot>): MicrophoneSlot {
  slotCounter += 1
  return {
    id: partial?.id ?? `mic-slot-${slotCounter}`,
    deviceId: partial?.deviceId,
    muted: partial?.muted ?? false,
    volume: partial?.volume ?? DEFAULT_INPUT_GAIN,
    noiseSuppression: partial?.noiseSuppression ?? false,
  }
}

export function createDefaultMicrophoneSlots(): MicrophoneSlot[] {
  return [createMicrophoneSlot()]
}

export function normalizeMicrophoneSlots(selection: DeviceSelection): MicrophoneSlot[] {
  if (selection.microphones && selection.microphones.length > 0) {
    return selection.microphones.map((slot) => ({
      id: slot.id,
      deviceId: slot.deviceId,
      muted: slot.muted ?? false,
      volume: slot.volume ?? DEFAULT_INPUT_GAIN,
      noiseSuppression: slot.noiseSuppression ?? false,
    }))
  }

  if (selection.microphoneId) {
    return [
      {
        id: 'mic-slot-legacy',
        deviceId: selection.microphoneId,
        muted: selection.microphoneMuted ?? false,
        volume: selection.microphoneVolume ?? DEFAULT_INPUT_GAIN,
        noiseSuppression: false,
      },
    ]
  }

  return createDefaultMicrophoneSlots()
}

export function hasActiveMicrophoneSlot(slots: MicrophoneSlot[]): boolean {
  return slots.some((slot) => Boolean(slot.deviceId))
}

export function addMicrophoneSlot(slots: MicrophoneSlot[]): MicrophoneSlot[] {
  return [...slots, createMicrophoneSlot()]
}

export function removeMicrophoneSlot(slots: MicrophoneSlot[], slotId: string): MicrophoneSlot[] {
  if (slots.length <= 1) {
    return [createMicrophoneSlot({ id: slots[0]?.id ?? 'mic-slot-1' })]
  }

  const next = slots.filter((slot) => slot.id !== slotId)
  return next.length > 0 ? next : createDefaultMicrophoneSlots()
}

export function updateMicrophoneSlot(
  slots: MicrophoneSlot[],
  slotId: string,
  patch: Partial<MicrophoneSlot>,
): MicrophoneSlot[] {
  return slots.map((slot) => (slot.id === slotId ? { ...slot, ...patch, id: slot.id } : slot))
}
