import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AudioControlApi } from '../../shared/audioApi'
import { audioChannels } from '../../shared/audioApi'
import { DEFAULT_INPUT_GAIN, type RouteEqualizerSettings } from '../../shared/audioConstants'
import { createDefaultEngineStatus } from '../../shared/engineStatus'
import {
  addMicrophoneSlot,
  createDefaultMicrophoneSlots,
  hasActiveMicrophoneSlot,
  normalizeMicrophoneSlots,
  removeMicrophoneSlot,
  updateMicrophoneSlot,
} from '../../shared/microphoneSlots'
import {
  getHifiCablePlaybackPriority,
  getMicrophonePriority,
  getVoicemeeterOutputPriority,
  isSelectableMicrophoneDevice,
  isRecordingEndpointDevice,
  sortVoicemeeterDevices,
} from '../../shared/audioLabels'
import type { AudioSnapshot } from '../../shared/audioTypes'
import type { NoiseSuppressionSettings } from '../../shared/noiseSuppression'
import {
  HIFI_CABLE_DOWNLOAD_URL,
  HIFI_CABLE_PRODUCT_URL,
  HIFI_CABLE_QUALITY,
} from '../../shared/hifiCable'

function createEmptySnapshot(): AudioSnapshot {
  return {
    devices: [],
    applications: [],
    routedInputs: [],
    selection: {
      microphones: createDefaultMicrophoneSlots(),
    },
    backendMode: 'native-engine',
    engine: createDefaultEngineStatus(),
    hifiCable: {
      installed: false,
      playbackReady: false,
      recordingReady: false,
      playbackDevices: [],
      recordingDevices: [],
      productUrl: HIFI_CABLE_PRODUCT_URL,
      downloadUrl: HIFI_CABLE_DOWNLOAD_URL,
      formatSpec: HIFI_CABLE_QUALITY.shortLabel,
      qualityLabel: HIFI_CABLE_QUALITY.label,
    },
    lastUpdatedAt: new Date(0).toISOString(),
  }
}

function resolveAudioControl(): AudioControlApi | undefined {
  if (window.audioControl) {
    return window.audioControl
  }

  if (!window.require) {
    return undefined
  }

  const { ipcRenderer } = window.require('electron') as typeof import('electron')

  return {
    getSnapshot: () => ipcRenderer.invoke(audioChannels.getSnapshot),
    refreshSnapshot: () => ipcRenderer.invoke(audioChannels.refreshSnapshot),
    startEngine: () => ipcRenderer.invoke(audioChannels.startEngine),
    stopEngine: () => ipcRenderer.invoke(audioChannels.stopEngine),
    setDeviceSelection: (payload) => ipcRenderer.invoke(audioChannels.setDeviceSelection, payload),
    setRouteAssignment: (payload) => ipcRenderer.invoke(audioChannels.setRouteAssignment, payload),
    setRouteVolume: (payload) => ipcRenderer.invoke(audioChannels.setRouteVolume, payload),
    setRouteEqualizer: (payload) => ipcRenderer.invoke(audioChannels.setRouteEqualizer, payload),
    setRouteMuted: (payload) => ipcRenderer.invoke(audioChannels.setRouteMuted, payload),
    setMicrophoneMuted: (payload) => ipcRenderer.invoke(audioChannels.setMicrophoneMuted, payload),
    setMicrophoneVolume: (payload) => ipcRenderer.invoke(audioChannels.setMicrophoneVolume, payload),
    setMicrophoneNoiseSuppression: (payload) =>
      ipcRenderer.invoke(audioChannels.setMicrophoneNoiseSuppression, payload),
    openHifiCablePlaybackSettings: () =>
      ipcRenderer.invoke(audioChannels.openHifiCablePlaybackSettings),
    openHifiCableRecordingSettings: () => ipcRenderer.invoke(audioChannels.openHifiCableRecordingSettings),
    applyHifiCableStudioSettings: () => ipcRenderer.invoke(audioChannels.applyHifiCableStudioSettings),
    subscribeSnapshot: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, snapshot: AudioSnapshot) => {
        listener(snapshot)
      }

      ipcRenderer.on(audioChannels.subscribeSnapshot, wrappedListener)

      return () => {
        ipcRenderer.removeListener(audioChannels.subscribeSnapshot, wrappedListener)
      }
    },
  }
}

export function useAudioControlState() {
  const [snapshot, setSnapshot] = useState<AudioSnapshot>(createEmptySnapshot)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [isEngineBusy, setIsEngineBusy] = useState(false)
  const lastTelemetryUiAtRef = useRef(0)
  const pendingTelemetryRef = useRef<AudioSnapshot | undefined>(undefined)
  const telemetryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let isMounted = true
    const audioControl = resolveAudioControl()

    const loadSnapshot = async () => {
      if (!audioControl) {
        if (isMounted) {
          setError('Desktop bridge did not load. Please relaunch the Electron app.')
          setIsLoading(false)
        }
        return
      }

      try {
        const nextSnapshot = await audioControl.getSnapshot()

        if (isMounted) {
          setSnapshot(nextSnapshot)
          setError(undefined)
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load audio snapshot.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadSnapshot()

    const flushTelemetry = () => {
      telemetryTimerRef.current = undefined
      const pending = pendingTelemetryRef.current
      pendingTelemetryRef.current = undefined
      if (pending && isMounted) {
        lastTelemetryUiAtRef.current = Date.now()
        setSnapshot(pending)
      }
    }

    const unsubscribe = audioControl
      ? audioControl.subscribeSnapshot((nextSnapshot) => {
          // Match main-process telemetry (~1s) so React isn't thrashing the UI.
          const now = Date.now()
          if (now - lastTelemetryUiAtRef.current >= 1000) {
            lastTelemetryUiAtRef.current = now
            setSnapshot(nextSnapshot)
            return
          }

          pendingTelemetryRef.current = nextSnapshot
          if (!telemetryTimerRef.current) {
            telemetryTimerRef.current = setTimeout(flushTelemetry, 1000)
          }
        })
      : () => {}

    return () => {
      isMounted = false
      unsubscribe()
      if (telemetryTimerRef.current) {
        clearTimeout(telemetryTimerRef.current)
      }
    }
  }, [])

  const microphoneDevices = useMemo(
    () =>
      [...snapshot.devices]
        .filter(
          (device) => device.kind === 'input' && isSelectableMicrophoneDevice(device.name),
        )
        .sort((left, right) => {
          if (left.isAvailable !== right.isAvailable) {
            return left.isAvailable ? -1 : 1
          }
          const priorityDifference = getMicrophonePriority(left.name) - getMicrophonePriority(right.name)
          return priorityDifference !== 0 ? priorityDifference : left.name.localeCompare(right.name)
        }),
    [snapshot.devices],
  )

  const recordingDevices = useMemo(
    () =>
      [...snapshot.devices]
        .filter(
          (device) => device.kind === 'input' && device.isAvailable && isRecordingEndpointDevice(device.name),
        )
        .sort((left, right) => sortVoicemeeterDevices(left.name, right.name)),
    [snapshot.devices],
  )

  const playbackDevices = useMemo(
    () =>
      [...snapshot.devices]
        .filter((device) => device.kind === 'output')
        .sort((left, right) => {
          const hifiLeft = getHifiCablePlaybackPriority(left.name)
          const hifiRight = getHifiCablePlaybackPriority(right.name)
          if (hifiLeft !== hifiRight) {
            return hifiLeft - hifiRight
          }

          const leftPriority = getVoicemeeterOutputPriority(left.name)
          const rightPriority = getVoicemeeterOutputPriority(right.name)
          if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority
          }

          if (/voicemeeter in/i.test(left.name) && /voicemeeter in/i.test(right.name)) {
            return sortVoicemeeterDevices(left.name.replace(/in/i, 'out'), right.name.replace(/in/i, 'out'))
          }

          return left.name.localeCompare(right.name)
        }),
    [snapshot.devices],
  )

  const selectMicrophoneSlot = useCallback(async (slotId: string, deviceId: string) => {
    const audioControl = resolveAudioControl()
    if (!audioControl) {
      return
    }

    const slots = normalizeMicrophoneSlots(snapshot.selection)
    setSnapshot(
      await audioControl.setDeviceSelection({
        microphones: updateMicrophoneSlot(slots, slotId, {
          deviceId: deviceId || undefined,
        }),
      }),
    )
  }, [snapshot.selection])

  const ensureMicrophoneDevice = useCallback(
    async (deviceId: string): Promise<string | undefined> => {
      const audioControl = resolveAudioControl()
      if (!audioControl || !deviceId) {
        return undefined
      }

      const slots = normalizeMicrophoneSlots(snapshot.selection)
      const existing = slots.find((slot) => slot.deviceId === deviceId)
      if (existing) {
        return existing.id
      }

      const emptySlot = slots.find((slot) => !slot.deviceId)
      if (emptySlot) {
        const next = await audioControl.setDeviceSelection({
          microphones: updateMicrophoneSlot(slots, emptySlot.id, { deviceId }),
        })
        setSnapshot(next)
        return emptySlot.id
      }

      const withNewSlot = addMicrophoneSlot(slots)
      const newSlot = withNewSlot[withNewSlot.length - 1]
      if (!newSlot) {
        return undefined
      }

      const next = await audioControl.setDeviceSelection({
        microphones: updateMicrophoneSlot(withNewSlot, newSlot.id, { deviceId }),
      })
      setSnapshot(next)
      return newSlot.id
    },
    [snapshot.selection],
  )

  const addMicrophoneSlotToSelection = useCallback(async () => {
    const audioControl = resolveAudioControl()
    if (!audioControl) {
      return
    }

    const slots = normalizeMicrophoneSlots(snapshot.selection)
    setSnapshot(
      await audioControl.setDeviceSelection({
        microphones: addMicrophoneSlot(slots),
      }),
    )
  }, [snapshot.selection])

  const removeMicrophoneSlotFromSelection = useCallback(async (slotId: string) => {
    const audioControl = resolveAudioControl()
    if (!audioControl) {
      return
    }

    const slots = normalizeMicrophoneSlots(snapshot.selection)
    setSnapshot(
      await audioControl.setDeviceSelection({
        microphones: removeMicrophoneSlot(slots, slotId),
      }),
    )
  }, [snapshot.selection])

  const updateSelection = useCallback(
    async (field: 'microphoneId' | 'inputDeviceId' | 'recordingDeviceId', value: string) => {
      const audioControl = resolveAudioControl()
      if (!audioControl) {
        return
      }

      const payload =
        field === 'microphoneId'
          ? { microphoneId: value }
          : field === 'inputDeviceId'
            ? { inputDeviceId: value }
            : { recordingDeviceId: value }

      setSnapshot(await audioControl.setDeviceSelection(payload))
    },
    [],
  )

  const openHifiCablePlaybackSettings = useCallback(async () => {
    const audioControl = resolveAudioControl()
    if (!audioControl) {
      return
    }

    await audioControl.openHifiCablePlaybackSettings()
  }, [])

  const openHifiCableRecordingSettings = useCallback(async () => {
    const audioControl = resolveAudioControl()
    if (!audioControl) {
      return
    }

    await audioControl.openHifiCableRecordingSettings()
  }, [])

  const applyHifiCableStudioSettings = useCallback(async () => {
    const audioControl = resolveAudioControl()
    if (!audioControl) {
      return
    }

    setSnapshot(await audioControl.applyHifiCableStudioSettings())
  }, [])

  const toggleRoute = useCallback(async (appId: string, enabled: boolean) => {
    const audioControl = resolveAudioControl()
    if (!audioControl) {
      return
    }
    setSnapshot(await audioControl.setRouteAssignment({ appId, target: 'hifi-cable', enabled }))
  }, [])

  const setRouteVolume = useCallback(async (routeId: string, volume: number) => {
    const audioControl = resolveAudioControl()
    if (!audioControl) {
      return
    }
    setSnapshot(await audioControl.setRouteVolume({ routeId, volume }))
  }, [])

  const setRouteEqualizer = useCallback(
    async (routeId: string, equalizer: RouteEqualizerSettings) => {
      const audioControl = resolveAudioControl()
      if (!audioControl) {
        return
      }
      setSnapshot(await audioControl.setRouteEqualizer({ routeId, equalizer }))
    },
    [],
  )

  const setRouteMuted = useCallback(async (routeId: string, muted: boolean) => {
    const audioControl = resolveAudioControl()
    if (!audioControl) {
      return
    }
    setSnapshot(await audioControl.setRouteMuted({ routeId, muted }))
  }, [])

  const setMicrophoneMuted = useCallback(async (slotId: string, muted: boolean) => {
    const audioControl = resolveAudioControl()
    if (!audioControl) {
      return
    }
    setSnapshot(await audioControl.setMicrophoneMuted({ slotId, muted }))
  }, [])

  const setMicrophoneVolume = useCallback(async (slotId: string, volume: number) => {
    const audioControl = resolveAudioControl()
    if (!audioControl) {
      return
    }
    setSnapshot(await audioControl.setMicrophoneVolume({ slotId, volume }))
  }, [])

  const setMicrophoneNoiseSuppression = useCallback(
    async (
      slotId: string,
      noiseSuppression: boolean | NoiseSuppressionSettings | Partial<NoiseSuppressionSettings>,
    ) => {
      const audioControl = resolveAudioControl()
      if (!audioControl) {
        return
      }

      if (typeof noiseSuppression === 'boolean') {
        setSnapshot(
          await audioControl.setMicrophoneNoiseSuppression({ slotId, noiseSuppression }),
        )
        return
      }

      setSnapshot(
        await audioControl.setMicrophoneNoiseSuppression({
          slotId,
          settings: noiseSuppression,
        }),
      )
    },
    [],
  )

  const refreshSnapshot = useCallback(async () => {
    const audioControl = resolveAudioControl()
    if (!audioControl) {
      return
    }
    setSnapshot(await audioControl.refreshSnapshot())
  }, [])

  const startEngine = useCallback(async () => {
    const audioControl = resolveAudioControl()
    if (!audioControl || isEngineBusy) {
      return
    }

    setIsEngineBusy(true)
    try {
      setSnapshot(await audioControl.startEngine())
      setError(undefined)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Unable to start the audio engine.')
    } finally {
      setIsEngineBusy(false)
    }
  }, [isEngineBusy])

  const stopEngine = useCallback(async () => {
    const audioControl = resolveAudioControl()
    if (!audioControl || isEngineBusy) {
      return
    }

    setIsEngineBusy(true)
    try {
      setSnapshot(await audioControl.stopEngine())
      setError(undefined)
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Unable to stop the audio engine.')
    } finally {
      setIsEngineBusy(false)
    }
  }, [isEngineBusy])

  return {
    snapshot,
    isLoading,
    error,
    microphoneDevices,
    recordingDevices,
    playbackDevices,
    updateSelection,
    selectMicrophoneSlot,
    ensureMicrophoneDevice,
    addMicrophoneSlotToSelection,
    removeMicrophoneSlotFromSelection,
    openHifiCablePlaybackSettings,
    openHifiCableRecordingSettings,
    applyHifiCableStudioSettings,
    toggleRoute,
    setRouteVolume,
    setRouteEqualizer,
    setRouteMuted,
    setMicrophoneMuted,
    setMicrophoneVolume,
    setMicrophoneNoiseSuppression,
    refreshSnapshot,
    startEngine,
    stopEngine,
    isEngineBusy,
  }
}
