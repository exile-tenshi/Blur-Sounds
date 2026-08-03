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

function resolveClipControl(): ClipControlApi | undefined {
  if (window.clipControl) {
    return window.clipControl
  }

  if (!window.require) {
    return undefined
  }

  const { ipcRenderer } = window.require('electron') as typeof import('electron')

  return {
    listSources: () => ipcRenderer.invoke(clipChannels.listSources),
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
}

function pickRecorderMimeType(): string {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

async function captureDesktopStream(sourceId: string): Promise<MediaStream> {
  const constraints = {
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
      },
    },
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        minWidth: 1280,
        maxWidth: 1920,
        minHeight: 720,
        maxHeight: 1080,
        maxFrameRate: 60,
      },
    },
  }

  try {
    return await navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints)
  } catch {
    const videoOnly = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080,
          maxFrameRate: 60,
        },
      },
    }
    return navigator.mediaDevices.getUserMedia(videoOnly as MediaStreamConstraints)
  }
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
  const [lookbackSeconds, setLookbackSecondsState] = useState<ClipLookbackSeconds>(120)
  const [keybinds, setKeybinds] = useState<string[]>(['F8'])
  const [bufferingEnabled, setBufferingEnabledState] = useState(true)
  const [status, setStatus] = useState<ClipRecordingStatus>({
    recording: false,
    buffering: false,
    bufferState: 'idle',
    elapsedMs: 0,
    bufferedSeconds: 0,
    lookbackSeconds: 120,
    forwardSeconds: 30,
    outputFolder: '',
    keybinds: ['F8'],
  })
  const [error, setError] = useState<string>()
  const [isBusy, setIsBusy] = useState(false)
  const [lastSavedPath, setLastSavedPath] = useState<string>()
  const [listeningForKeybind, setListeningForKeybind] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<TimedChunk[]>([])
  const lookbackRef = useRef<ClipLookbackSeconds>(120)
  const clippingRef = useRef(false)
  const forwardTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clipItRef = useRef<() => Promise<void>>(async () => {})

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const syncStatus = useCallback(
    async (patch?: Parameters<ClipControlApi['notifyRecordingState']>[0]) => {
      if (!clipControl) {
        return
      }
      const next = patch
        ? await clipControl.notifyRecordingState(patch)
        : await clipControl.getStatus()
      setStatus(next)
    },
    [clipControl],
  )

  const refreshSources = useCallback(async () => {
    if (!clipControl) {
      setError('Clip bridge did not load. Relaunch the Electron app.')
      return
    }

    try {
      const [nextSources, clipSettings] = await Promise.all([
        clipControl.listSources(),
        clipControl.getSettings(),
      ])
      setSources(nextSources)
      setLookbackSecondsState(clipSettings.lookbackSeconds)
      lookbackRef.current = clipSettings.lookbackSeconds
      setKeybinds(clipSettings.keybinds)
      setBufferingEnabledState(clipSettings.bufferingEnabled)

      setSelectedSourceId((current) => {
        if (current && nextSources.some((source) => source.id === current)) {
          return current
        }
        if (clipSettings.sourceId && nextSources.some((source) => source.id === clipSettings.sourceId)) {
          return clipSettings.sourceId
        }
        return nextSources[0]?.id ?? ''
      })
      await syncStatus()
      setError(undefined)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to list clip sources.')
    }
  }, [clipControl, syncStatus])

  const stopBuffering = useCallback(async () => {
    if (forwardTimerRef.current) {
      clearTimeout(forwardTimerRef.current)
      forwardTimerRef.current = undefined
    }
    clippingRef.current = false
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null
    stopTracks()
    chunksRef.current = []
    await syncStatus({
      recording: false,
      buffering: false,
      bufferState: 'idle',
      bufferedSeconds: 0,
    })
  }, [stopTracks, syncStatus])

  const startBuffering = useCallback(
    async (sourceId = selectedSourceId) => {
      if (!clipControl || !sourceId || !bufferingEnabled) {
        return
      }

      const source = sources.find((item) => item.id === sourceId)
      if (!source) {
        return
      }

      const mimeType = pickRecorderMimeType()
      if (!mimeType) {
        setError('This system cannot record video clips.')
        return
      }

      await stopBuffering()
      setIsBusy(true)
      setError(undefined)

      try {
        await clipControl.ensureOutputFolder()
        await clipControl.setSettings({ sourceId })
        const stream = await captureDesktopStream(source.id)
        streamRef.current = stream
        chunksRef.current = []

        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 8_000_000,
        })
        mediaRecorderRef.current = recorder

        recorder.ondataavailable = (event) => {
          if (event.data.size <= 0) {
            return
          }
          chunksRef.current.push({ blob: event.data, at: Date.now() })
          chunksRef.current = pruneChunks(chunksRef.current, lookbackRef.current)
          void syncStatus({
            buffering: true,
            bufferState: clippingRef.current ? 'clipping' : 'buffering',
            sourceId: source.id,
            sourceName: source.name,
            bufferedSeconds: estimateBufferedSeconds(chunksRef.current),
          })
        }

        recorder.onerror = () => {
          setError('Background clip buffer failed.')
          void stopBuffering()
        }

        recorder.start(1000)
        await syncStatus({
          buffering: true,
          bufferState: 'buffering',
          sourceId: source.id,
          sourceName: source.name,
          bufferedSeconds: 0,
        })
      } catch (startError) {
        stopTracks()
        setError(
          startError instanceof Error
            ? startError.message
            : 'Unable to start background clip buffer.',
        )
        await syncStatus({
          buffering: false,
          bufferState: 'error',
          error: 'Unable to start background clip buffer.',
        })
      } finally {
        setIsBusy(false)
      }
    },
    [
      bufferingEnabled,
      clipControl,
      selectedSourceId,
      sources,
      stopBuffering,
      stopTracks,
      syncStatus,
    ],
  )

  const finalizeClip = useCallback(async () => {
    if (!clipControl) {
      return
    }

    const mimeType = pickRecorderMimeType() || 'video/mp4'
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
      await syncStatus({
        buffering: Boolean(mediaRecorderRef.current),
        bufferState: mediaRecorderRef.current ? 'buffering' : 'idle',
        bufferedSeconds: estimateBufferedSeconds(chunksRef.current),
      })
      setError(undefined)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save clip.')
      await syncStatus({
        bufferState: 'error',
        error: 'Unable to save clip.',
      })
    } finally {
      setIsBusy(false)
    }
  }, [clipControl, selectedSourceId, sources, status.sourceName, syncStatus])

  const clipIt = useCallback(async () => {
    if (!clipControl || clippingRef.current) {
      return
    }

    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      setError('Start background buffering before clipping.')
      return
    }

    clippingRef.current = true
    setIsBusy(true)
    setError(undefined)
    await syncStatus({
      recording: true,
      buffering: true,
      bufferState: 'clipping',
    })

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
        await syncStatus({
          bufferedSeconds: estimateBufferedSeconds(chunksRef.current),
        })
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

  const selectSource = useCallback(
    async (sourceId: string) => {
      setSelectedSourceId(sourceId)
      if (clipControl) {
        await clipControl.setSettings({ sourceId })
      }
      if (bufferingEnabled) {
        await startBuffering(sourceId)
      }
    },
    [bufferingEnabled, clipControl, startBuffering],
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
      await syncStatus()
    },
    [clipControl, syncStatus],
  )

  useEffect(() => {
    void refreshSources()
    void clipControl?.ensureOutputFolder().then((folder) => {
      setStatus((current) => ({ ...current, outputFolder: folder }))
    })

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
  }, [clipControl, refreshSources, stopTracks])

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
        await syncStatus()
      })()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [clipControl, listeningForKeybind, syncStatus])

  useEffect(() => {
    if (bufferingEnabled && selectedSourceId && !mediaRecorderRef.current) {
      void startBuffering(selectedSourceId)
    }
  }, [bufferingEnabled, selectedSourceId, startBuffering])

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
    bufferingEnabled,
    setBufferingEnabled,
    status,
    error,
    isBusy,
    lastSavedPath,
    refreshSources,
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
