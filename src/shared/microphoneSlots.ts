import { DEFAULT_INPUT_GAIN } from './audioConstants.js'
import { normalizeNoiseSuppression } from './noiseSuppression.js'
import type { DeviceSelection, MicrophoneSlot } from './audioTypes.js'

let slotCounter = 0

export function createMicrophoneSlot(partial?: Partial<MicrophoneSlot>): MicrophoneSlot {
  slotCounter += 1
  const noiseSuppressionSettings = normalizeNoiseSuppression(
    partial?.noiseSuppressionSettings ?? partial?.noiseSuppression,
  )
  return {
    id: partial?.id ?? `mic-slot-${slotCounter}`,
    deviceId: partial?.deviceId,
    muted: partial?.muted ?? false,
    volume: partial?.volume ?? DEFAULT_INPUT_GAIN,
    noiseSuppression: noiseSuppressionSettings.enabled,
    noiseSuppressionSettings,
  }
}

export function createDefaultMicrophoneSlots(): MicrophoneSlot[] {
  return [createMicrophoneSlot()]
}

export function normalizeMicrophoneSlots(selection: DeviceSelection): MicrophoneSlot[] {
  if (selection.microphones && selection.microphones.length > 0) {
    return selection.microphones.map((slot) => {
      const noiseSuppressionSettings = normalizeNoiseSuppression(
        slot.noiseSuppressionSettings ?? slot.noiseSuppression,
      )
      return {
        id: slot.id,
        deviceId: slot.deviceId,
        muted: slot.muted ?? false,
        volume: slot.volume ?? DEFAULT_INPUT_GAIN,
        noiseSuppression: noiseSuppressionSettings.enabled,
        noiseSuppressionSettings,
      }
    })
  }

  if (selection.microphoneId) {
    return [
      createMicrophoneSlot({
        id: 'mic-slot-legacy',
        deviceId: selection.microphoneId,
        muted: selection.microphoneMuted ?? false,
        volume: selection.microphoneVolume ?? DEFAULT_INPUT_GAIN,
      }),
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
  return slots.map((slot) => {
    if (slot.id !== slotId) {
      return slot
    }

    const merged = { ...slot, ...patch, id: slot.id }
    const noiseSuppressionSettings = normalizeNoiseSuppression(
      patch.noiseSuppressionSettings ??
        (patch.noiseSuppression !== undefined
          ? { ...slot.noiseSuppressionSettings, enabled: patch.noiseSuppression }
          : slot.noiseSuppressionSettings ?? slot.noiseSuppression),
    )
    return {
      ...merged,
      noiseSuppression: noiseSuppressionSettings.enabled,
      noiseSuppressionSettings,
    }
  })
}
