import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CLIP_LOOKBACK_OPTIONS_SECONDS,
  forwardRollSeconds,
  formatLookbackLabel,
  totalClipSeconds,
  type ClipLookbackSeconds,
} from '../../shared/appSettings'
import type { ClipControlApi, ClipRecordingStatus, ClipSource } from '../../shared/clipApi'
import { clipChannels } from '../../shared/clipApi'

interface TimedChunk {
  blob: Blob
  at: number
}

/** Stable across renders — recreating this object was re-firing Clips refresh in a loop. */
let cachedClipControl: ClipControlApi | undefined

function resolveClipControl(): ClipControlApi | undefined {
  if (window.clipControl) {
    return window.clipControl
  }

  if (cachedClipControl) {
    return cachedClipControl
  }

  if (!window.require) {
    return undefined
  }

  const { ipcRenderer } = window.require('electron') as typeof import('electron')

  cachedClipControl = {
    listSources: (options) => ipcRenderer.invoke(clipChannels.listSources, options),
    getStatus: () => ipcRenderer.invoke(clipChannels.getStatus),
    ensureOutputFolder: () => ipcRenderer.invoke(clipChannels.ensureOutputFolder),
    saveClip: (payload) => ipcRenderer.invoke(clipChannels.saveClip, payload),
    openOutputFolder: () => ipcRenderer.invoke(clipChannels.openOutputFolder),
    notifyRecordingState: (payload) =>
      ipcRenderer.invoke(clipChannels.notifyRecordingState, payload),
    getSettings: () => ipcRenderer.invoke(clipChannels.getSettings),
    setSettings: (patch) => ipcRenderer.invoke(clipChannels.setSettings, patch),
    addKeybind: (accelerator) => ipcRenderer.invoke(clipChannels.addKeybind, accelerator),
    removeKeybind: (accelerator) => ipcRenderer.invoke(clipChannels.removeKeybind, accelerator),
    onTriggerClip: (listener) => {
      const wrapped = () => listener()
      ipcRenderer.on(clipChannels.subscribeTrigger, wrapped)
      return () => {
        ipcRenderer.removeListener(clipChannels.subscribeTrigger, wrapped)
      }
    },
  }
  return cachedClipControl
}

/** Bump when Clips picker behavior changes — shown in UI so we know the build is current. */
export const CLIPS_PICKER_BUILD = 9

function pickRecorderMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
  ]

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

async function captureDesktopStream(_sourceId: string): Promise<MediaStream> {
  // Keep getDisplayMedia constraints minimal — detailed width/height/frameRate objects
  // are rejected as "Invalid capture constraints" on some Electron/Chromium builds.
  // The main-process setDisplayMediaRequestHandler maps display:*/app:* to a real source.
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/invalid capture constraints/i.test(message)) {
      // Retry without audio — loopback can fail while video still works.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })
    } else {
      throw error
    }
  }

  for (const track of stream.getVideoTracks()) {
    const capabilities = track.getCapabilities?.() as
      | { width?: { max?: number }; height?: { max?: number }; frameRate?: { max?: number } }
      | undefined
    try {
      await track.applyConstraints({
        width: { ideal: 1280, max: Math.min(1280, capabilities?.width?.max ?? 1280) },
        height: { ideal: 720, max: Math.min(720, capabilities?.height?.max ?? 720) },
        frameRate: { ideal: 30, max: 30 },
      })
    } catch {
      // Constraints are best-effort after the stream exists.
    }
  }

  return stream
}

function pruneChunks(chunks: TimedChunk[], lookbackSeconds: number): TimedChunk[] {
  const cutoff = Date.now() - lookbackSeconds * 1000
  return chunks.filter((chunk) => chunk.at >= cutoff)
}

function estimateBufferedSeconds(chunks: TimedChunk[]): number {
  if (chunks.length === 0) {
    return 0
  }
  return Math.max(0, (Date.now() - chunks[0].at) / 1000)
}

export function useClipRecorder() {
  const clipControl = resolveClipControl()
  const [sources, setSources] = useState<ClipSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [lookbackSeconds, setLookbackSecondsState] = useState<ClipLookbackSeconds>(60)
  const [keybinds, setKeybinds] = useState<string[]>(['F8'])
  const [voiceCommandsEnabled, setVoiceCommandsEnabledState] = useState(true)
  const [bufferingEnabled, setBufferingEnabledState] = useState(false)
  const [status, setStatus] = useState<ClipRecordingStatus>({
    recording: false,
    buffering: false,
    bufferState: 'idle',
    elapsedMs: 0,
    bufferedSeconds: 0,
    lookbackSeconds: 60,
    forwardSeconds: 15,
    outputFolder: '',
    keybinds: ['F8'],
    voiceCommandsEnabled: true,
  })
  const [error, setError] = useState<string>()
  const [isBusy, setIsBusy] = useState(false)
  const [lastSavedPath, setLastSavedPath] = useState<string>()
  const [listeningForKeybind, setListeningForKeybind] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<TimedChunk[]>([])
  const lookbackRef = useRef<ClipLookbackSeconds>(60)
  const clippingRef = useRef(false)
  const forwardTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clipItRef = useRef<() => Promise<void>>(async () => {})
  const lastUiStatusAtRef = useRef(0)
  const startingRef = useRef(false)
  const refreshInFlightRef = useRef(false)
  const clipControlRef = useRef(clipControl)
  clipControlRef.current = clipControl

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const syncStatus = useCallback(
    async (
      patch?: Parameters<ClipControlApi['notifyRecordingState']>[0],
      options?: { forceUi?: boolean; skipIpc?: boolean },
    ) => {
      const bufferedSeconds =
        patch?.bufferedSeconds ?? estimateBufferedSeconds(chunksRef.current)
      const nextLocal: Partial<ClipRecordingStatus> = {
        recording: patch?.recording,
        buffering: patch?.buffering,
        bufferState: patch?.bufferState,
        sourceId: patch?.sourceId,
        sourceName: patch?.sourceName,
        bufferedSeconds,
        error: patch?.error,
      }

      const now = Date.now()
      const shouldUpdateUi =
        options?.forceUi ||
        patch?.bufferState === 'clipping' ||
        patch?.bufferState === 'error' ||
        patch?.bufferState === 'idle' ||
        now - lastUiStatusAtRef.current >= 2000

      if (shouldUpdateUi) {
        lastUiStatusAtRef.current = now
        setStatus((current) => ({
          ...current,
          ...Object.fromEntries(
            Object.entries(nextLocal).filter(([, value]) => value !== undefined),
          ),
        }))
      }

      if (!clipControl || options?.skipIpc) {
        return
      }

      // Avoid IPC spam for routine buffer ticks; keep main process updated less often.
      if (!options?.forceUi && now - lastUiStatusAtRef.current < 2000 && patch?.bufferState === 'buffering') {
        return
      }

      const next = await clipControl.notifyRecordingState(patch ?? {})
      if (shouldUpdateUi) {
        setStatus(next)
      }
    },
    [clipControl],
  )

  const applySourceSelection = useCallback(
    (nextSources: ClipSource[], preferredSourceId?: string) => {
      setSelectedSourceId((current) => {
        if (current && nextSources.some((source) => source.id === current)) {
          return current
        }
        if (preferredSourceId && nextSources.some((source) => source.id === preferredSourceId)) {
          return preferredSourceId
        }
        return nextSources[0]?.id ?? ''
      })
    },
    [],
  )

  /** Instant display list — never touches desktopCapturer on open. */
  const refreshSources = useCallback(async () => {
    const control = clipControlRef.current
    if (!control) {
      setError('Clip bridge did not load. Relaunch the Electron app.')
      return
    }
    if (refreshInFlightRef.current) {
      return
    }

    refreshInFlightRef.current = true
    try {
      const clipSettings = await control.getSettings()
      setLookbackSecondsState(clipSettings.lookbackSeconds)
      lookbackRef.current = clipSettings.lookbackSeconds
      setKeybinds(clipSettings.keybinds)
      setVoiceCommandsEnabledState(clipSettings.voiceCommandsEnabled !== false)
      setBufferingEnabledState(clipSettings.bufferingEnabled)

      // Screens + live games/apps (process list). No desktopCapturer freeze on open.
      const nextSources = await control.listSources({ includeWindows: false })
      setSources(nextSources)

      const preferred =
        clipSettings.sourceId?.startsWith('display:') ||
        clipSettings.sourceId?.startsWith('window:') ||
        clipSettings.sourceId?.startsWith('app:')
          ? clipSettings.sourceId
          : nextSources[0]?.id
      applySourceSelection(nextSources, preferred)
      if (preferred?.startsWith('display:') && preferred !== clipSettings.sourceId) {
        await control.setSettings({ sourceId: preferred })
      }

      const nextStatus = await control.getStatus()
      setStatus(nextStatus)
      setError(undefined)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to list clip sources.')
    } finally {
      refreshInFlightRef.current = false
    }
  }, [applySourceSelection])

  /** Refresh games/apps list; optional capturer window pass for titles capturer knows. */
  const loadWindowSources = useCallback(async () => {
    const control = clipControlRef.current
    if (!control) {
      return
    }

    setIsBusy(true)
    try {
      const all = await control.listSources({ includeWindows: true })
      setSources(all)
      setError(undefined)
    } catch (loadError) {
      // Still try the non-capturer game list so the dropdown isn't empty.
      try {
        const fallback = await control.listSources({ includeWindows: false })
        setSources(fallback)
      } catch {
        // ignore
      }
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Extra window scan timed out. Games from the app list are still available.',
      )
    } finally {
      setIsBusy(false)
    }
  }, [])

  const stopBuffering = useCallback(async () => {
    if (forwardTimerRef.current) {
      clearTimeout(forwardTimerRef.current)
      forwardTimerRef.current = undefined
    }
    clippingRef.current = false
    startingRef.current = false
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null
    stopTracks()
    chunksRef.current = []
    await syncStatus(
      {
        recording: false,
        buffering: false,
        bufferState: 'idle',
        bufferedSeconds: 0,
      },
      { forceUi: true },
    )
  }, [stopTracks, syncStatus])

  const startBuffering = useCallback(
    async (sourceId = selectedSourceId) => {
      if (!clipControl || !sourceId || !bufferingEnabled || startingRef.current) {
        return
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        return
      }

      // Source list may be empty until Clips opens — capture only needs the saved source id.
      const source = sources.find((item) => item.id === sourceId)
      const sourceName = source?.name ?? status.sourceName ?? 'Desktop'

      const mimeType = pickRecorderMimeType()
      if (!mimeType) {
        setError('This system cannot record video clips.')
        return
      }

      startingRef.current = true
      setIsBusy(true)
      setError(undefined)

      try {
        await clipControl.ensureOutputFolder()
        await clipControl.setSettings({ sourceId })
        const stream = await captureDesktopStream(sourceId)
        streamRef.current = stream
        chunksRef.current = []

        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 2_500_000,
          audioBitsPerSecond: 96_000,
        })
        mediaRecorderRef.current = recorder

        recorder.ondataavailable = (event) => {
          if (event.data.size <= 0) {
            return
          }
          chunksRef.current.push({ blob: event.data, at: Date.now() })
          chunksRef.current = pruneChunks(chunksRef.current, lookbackRef.current)
          void syncStatus(
            {
              buffering: true,
              bufferState: clippingRef.current ? 'clipping' : 'buffering',
              sourceId,
              sourceName,
              bufferedSeconds: estimateBufferedSeconds(chunksRef.current),
            },
            { skipIpc: !clippingRef.current },
          )
        }

        recorder.onerror = () => {
          setError('Background clip buffer failed.')
          void stopBuffering()
        }

        recorder.start(2000)
        await syncStatus(
          {
            buffering: true,
            bufferState: 'buffering',
            sourceId,
            sourceName,
            bufferedSeconds: 0,
          },
          { forceUi: true },
        )
      } catch (startError) {
        stopTracks()
        const raw =
          startError instanceof Error
            ? startError.message
            : 'Unable to start background clip buffer.'
        const message = /invalid capture constraints/i.test(raw)
          ? 'Unable to start clip buffer (capture rejected). Pick a Desktop source, or Refresh games and try again.'
          : raw
        setError(message)
        await syncStatus(
          {
            buffering: false,
            bufferState: 'error',
            error: message,
          },
          { forceUi: true },
        )
      } finally {
        startingRef.current = false
        setIsBusy(false)
      }
    },
    [
      bufferingEnabled,
      clipControl,
      selectedSourceId,
      sources,
      status.sourceName,
      stopBuffering,
      stopTracks,
      syncStatus,
    ],
  )

  const finalizeClip = useCallback(async () => {
    if (!clipControl) {
      return
    }

    const mimeType = pickRecorderMimeType() || 'video/webm'
    const sourceName =
      sources.find((source) => source.id === selectedSourceId)?.name ?? status.sourceName
    const blob = new Blob(
      chunksRef.current.map((chunk) => chunk.blob),
      { type: mimeType },
    )
    chunksRef.current = pruneChunks(chunksRef.current, lookbackRef.current)
    clippingRef.current = false

    try {
      const buffer = await blob.arrayBuffer()
      const saved = await clipControl.saveClip({
        data: buffer,
        mimeType: blob.type || mimeType,
        sourceName,
      })
      setLastSavedPath(saved.path)
      await syncStatus(
        {
          buffering: Boolean(mediaRecorderRef.current),
          bufferState: mediaRecorderRef.current ? 'buffering' : 'idle',
          bufferedSeconds: estimateBufferedSeconds(chunksRef.current),
        },
        { forceUi: true },
      )
      setError(undefined)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save clip.')
      await syncStatus(
        {
          bufferState: 'error',
          error: 'Unable to save clip.',
        },
        { forceUi: true },
      )
    } finally {
      setIsBusy(false)
    }
  }, [clipControl, selectedSourceId, sources, status.sourceName, syncStatus])

  const clipIt = useCallback(async () => {
    if (!clipControl || clippingRef.current) {
      return
    }

    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      setError('Turn on background buffering in Clips before using Clip it.')
      return
    }

    clippingRef.current = true
    setIsBusy(true)
    setError(undefined)
    await syncStatus(
      {
        recording: true,
        buffering: true,
        bufferState: 'clipping',
      },
      { forceUi: true },
    )

    const forwardMs = forwardRollSeconds(lookbackRef.current) * 1000
    if (forwardTimerRef.current) {
      clearTimeout(forwardTimerRef.current)
    }
    forwardTimerRef.current = setTimeout(() => {
      void finalizeClip()
    }, forwardMs)
  }, [clipControl, finalizeClip, syncStatus])

  clipItRef.current = clipIt

  const setLookbackSeconds = useCallback(
    async (seconds: ClipLookbackSeconds) => {
      lookbackRef.current = seconds
      setLookbackSecondsState(seconds)
      chunksRef.current = pruneChunks(chunksRef.current, seconds)
      if (clipControl) {
        await clipControl.setSettings({ lookbackSeconds: seconds })
        await syncStatus(
          {
            bufferedSeconds: estimateBufferedSeconds(chunksRef.current),
          },
          { forceUi: true },
        )
      }
    },
    [clipControl, syncStatus],
  )

  const setBufferingEnabled = useCallback(
    async (enabled: boolean) => {
      setBufferingEnabledState(enabled)
      if (clipControl) {
        await clipControl.setSettings({ bufferingEnabled: enabled })
      }
      if (enabled) {
        await startBuffering()
      } else {
        await stopBuffering()
      }
    },
    [clipControl, startBuffering, stopBuffering],
  )

  const setVoiceCommandsEnabled = useCallback(
    async (enabled: boolean) => {
      setVoiceCommandsEnabledState(enabled)
      if (clipControl) {
        await clipControl.setSettings({ voiceCommandsEnabled: enabled })
      }
    },
    [clipControl],
  )

  const selectSource = useCallback(
    async (sourceId: string) => {
      setSelectedSourceId(sourceId)
      if (clipControl) {
        await clipControl.setSettings({ sourceId })
      }
      if (bufferingEnabled) {
        await stopBuffering()
        await startBuffering(sourceId)
      }
    },
    [bufferingEnabled, clipControl, startBuffering, stopBuffering],
  )

  const addKeybindFromCapture = useCallback(async () => {
    setListeningForKeybind(true)
  }, [])

  const removeKeybind = useCallback(
    async (accelerator: string) => {
      if (!clipControl) {
        return
      }
      const next = await clipControl.removeKeybind(accelerator)
      setKeybinds(next.keybinds)
      await syncStatus(undefined, { forceUi: true })
    },
    [clipControl, syncStatus],
  )

  useEffect(() => {
    // Lightweight boot: settings/status only. Window thumbnails are loaded when Clips opens.
    void (async () => {
      if (!clipControl) {
        return
      }
      try {
        const [clipSettings, nextStatus, folder] = await Promise.all([
          clipControl.getSettings(),
          clipControl.getStatus(),
          clipControl.ensureOutputFolder(),
        ])
        setLookbackSecondsState(clipSettings.lookbackSeconds)
        lookbackRef.current = clipSettings.lookbackSeconds
        setKeybinds(clipSettings.keybinds)
        setVoiceCommandsEnabledState(clipSettings.voiceCommandsEnabled !== false)
        setBufferingEnabledState(clipSettings.bufferingEnabled)
        setSelectedSourceId(clipSettings.sourceId ?? '')
        setStatus({ ...nextStatus, outputFolder: folder })
      } catch {
        // Ignore boot errors; Clips section can retry.
      }
    })()

    const unsubscribe = clipControl?.onTriggerClip(() => {
      void clipItRef.current()
    })

    return () => {
      unsubscribe?.()
      if (forwardTimerRef.current) {
        clearTimeout(forwardTimerRef.current)
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      stopTracks()
    }
  }, [clipControl, stopTracks])

  useEffect(() => {
    if (!listeningForKeybind) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const parts: string[] = []
      if (event.ctrlKey || event.metaKey) {
        parts.push('CommandOrControl')
      }
      if (event.altKey) {
        parts.push('Alt')
      }
      if (event.shiftKey) {
        parts.push('Shift')
      }

      const key = event.key
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
        return
      }

      const mapped =
        key.length === 1
          ? key.toUpperCase()
          : key === ' '
            ? 'Space'
            : key.startsWith('Arrow')
              ? key.replace('Arrow', '')
              : key

      parts.push(mapped)
      const accelerator = parts.join('+')
      setListeningForKeybind(false)
      void (async () => {
        if (!clipControl) {
          return
        }
        const next = await clipControl.addKeybind(accelerator)
        setKeybinds(next.keybinds)
      })()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [clipControl, listeningForKeybind])

  // Only auto-start when the user has buffering enabled; never thrash on callback identity changes.
  useEffect(() => {
    if (!bufferingEnabled || !selectedSourceId) {
      return
    }
    if (mediaRecorderRef.current || startingRef.current) {
      return
    }
    void startBuffering(selectedSourceId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally stable start conditions only
  }, [bufferingEnabled, selectedSourceId])

  return {
    sources,
    selectedSourceId,
    selectSource,
    lookbackSeconds,
    setLookbackSeconds,
    lookbackOptions: CLIP_LOOKBACK_OPTIONS_SECONDS,
    forwardSeconds: forwardRollSeconds(lookbackSeconds),
    totalSeconds: totalClipSeconds(lookbackSeconds),
    formatLookbackLabel,
    keybinds,
    addKeybindFromCapture,
    removeKeybind,
    listeningForKeybind,
    voiceCommandsEnabled,
    setVoiceCommandsEnabled,
    bufferingEnabled,
    setBufferingEnabled,
    status,
    error,
    isBusy,
    lastSavedPath,
    refreshSources,
    loadWindowSources,
    startBuffering,
    stopBuffering,
    clipIt,
    openOutputFolder: async () => {
      if (!clipControl) {
        return
      }
      const folder = await clipControl.openOutputFolder()
      setStatus((current) => ({ ...current, outputFolder: folder }))
    },
  }
}
