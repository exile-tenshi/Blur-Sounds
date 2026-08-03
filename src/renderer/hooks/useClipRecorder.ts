import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipControlApi, ClipRecordingStatus, ClipSource } from '../../shared/clipApi'
import { clipChannels } from '../../shared/clipApi'

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

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
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
    // Some window captures reject system audio — fall back to video-only.
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

export function useClipRecorder() {
  const clipControl = resolveClipControl()
  const [sources, setSources] = useState<ClipSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [status, setStatus] = useState<ClipRecordingStatus>({
    recording: false,
    elapsedMs: 0,
    outputFolder: '',
  })
  const [error, setError] = useState<string>()
  const [isBusy, setIsBusy] = useState(false)
  const [lastSavedPath, setLastSavedPath] = useState<string>()

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const startedAtRef = useRef<number | undefined>(undefined)
  const tickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const clearTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = undefined
    }
  }, [])

  const refreshSources = useCallback(async () => {
    if (!clipControl) {
      setError('Clip bridge did not load. Relaunch the Electron app.')
      return
    }

    try {
      const nextSources = await clipControl.listSources()
      setSources(nextSources)
      setSelectedSourceId((current) => {
        if (current && nextSources.some((source) => source.id === current)) {
          return current
        }
        return nextSources[0]?.id ?? ''
      })
      const nextStatus = await clipControl.getStatus()
      setStatus(nextStatus)
      setError(undefined)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to list clip sources.')
    }
  }, [clipControl])

  useEffect(() => {
    void refreshSources()
    void clipControl?.ensureOutputFolder().then((folder) => {
      setStatus((current) => ({ ...current, outputFolder: folder }))
    })

    return () => {
      clearTick()
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      stopTracks()
    }
  }, [clearTick, clipControl, refreshSources, stopTracks])

  const startRecording = useCallback(async () => {
    if (!clipControl || isBusy || status.recording) {
      return
    }

    const source = sources.find((item) => item.id === selectedSourceId)
    if (!source) {
      setError('Select a desktop or game window to clip.')
      return
    }

    const mimeType = pickRecorderMimeType()
    if (!mimeType) {
      setError('This system cannot record video clips (no MediaRecorder codecs).')
      return
    }

    setIsBusy(true)
    setError(undefined)

    try {
      await clipControl.ensureOutputFolder()
      const stream = await captureDesktopStream(source.id)
      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 8_000_000,
      })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        setError('Clip recording failed.')
        clearTick()
        stopTracks()
        void clipControl.notifyRecordingState({
          recording: false,
          sourceId: source.id,
          sourceName: source.name,
          error: 'Clip recording failed.',
        })
      }

      recorder.start(1000)
      startedAtRef.current = Date.now()
      const nextStatus = await clipControl.notifyRecordingState({
        recording: true,
        sourceId: source.id,
        sourceName: source.name,
      })
      setStatus(nextStatus)

      clearTick()
      tickRef.current = setInterval(() => {
        const startedAt = startedAtRef.current
        if (!startedAt) {
          return
        }
        setStatus((current) => ({
          ...current,
          recording: true,
          elapsedMs: Date.now() - startedAt,
        }))
      }, 250)
    } catch (startError) {
      stopTracks()
      setError(
        startError instanceof Error
          ? startError.message
          : 'Unable to start clip recording for that source.',
      )
      await clipControl.notifyRecordingState({
        recording: false,
        error: 'Unable to start clip recording.',
      })
    } finally {
      setIsBusy(false)
    }
  }, [
    clearTick,
    clipControl,
    isBusy,
    selectedSourceId,
    sources,
    status.recording,
    stopTracks,
  ])

  const stopRecording = useCallback(async () => {
    if (!clipControl || !mediaRecorderRef.current) {
      return
    }

    const recorder = mediaRecorderRef.current
    const sourceName =
      sources.find((source) => source.id === selectedSourceId)?.name ?? status.sourceName

    setIsBusy(true)

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      if (recorder.state !== 'inactive') {
        recorder.stop()
      } else {
        resolve()
      }
    })

    clearTick()
    stopTracks()
    mediaRecorderRef.current = null

    try {
      const mimeType = pickRecorderMimeType() || 'video/mp4'
      const blob = new Blob(chunksRef.current, { type: mimeType })
      chunksRef.current = []
      const buffer = await blob.arrayBuffer()
      const saved = await clipControl.saveClip({
        data: buffer,
        mimeType: blob.type || mimeType,
        sourceName,
      })
      setLastSavedPath(saved.path)
      const nextStatus = await clipControl.getStatus()
      setStatus(nextStatus)
      setError(undefined)
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Unable to save clip.')
      await clipControl.notifyRecordingState({
        recording: false,
        error: 'Unable to save clip.',
      })
    } finally {
      setIsBusy(false)
    }
  }, [
    clearTick,
    clipControl,
    selectedSourceId,
    sources,
    status.sourceName,
    stopTracks,
  ])

  const openOutputFolder = useCallback(async () => {
    if (!clipControl) {
      return
    }
    const folder = await clipControl.openOutputFolder()
    setStatus((current) => ({ ...current, outputFolder: folder }))
  }, [clipControl])

  return {
    sources,
    selectedSourceId,
    setSelectedSourceId,
    status,
    error,
    isBusy,
    lastSavedPath,
    refreshSources,
    startRecording,
    stopRecording,
    openOutputFolder,
    formatElapsed,
  }
}
