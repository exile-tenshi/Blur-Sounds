import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipControlApi, ClipSource } from '../../shared/clipApi'
import { clipChannels } from '../../shared/clipApi'
import {
  DEFAULT_RECORDING_SETTINGS,
  VIDEO_RESOLUTION_PRESETS,
  videoStudioChannels,
  type EncoderPreference,
  type RecordingSettings,
  type SaveRecordingResult,
  type VideoStudioApi,
} from '../../shared/videoStudio'

function resolveClipControl(): ClipControlApi | undefined {
  if (window.clipControl) {
    return window.clipControl
  }
  if (!window.require) {
    return undefined
  }
  const { ipcRenderer } = window.require('electron') as typeof import('electron')
  return {
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
    onTriggerClip: () => () => {},
  }
}

function resolveVideoControl(): VideoStudioApi | undefined {
  if (window.videoStudioControl) {
    return window.videoStudioControl
  }
  if (!window.require) {
    return undefined
  }
  const { ipcRenderer } = window.require('electron') as typeof import('electron')
  return {
    getRecordingSettings: () => ipcRenderer.invoke(videoStudioChannels.getRecordingSettings),
    setRecordingSettings: (patch) =>
      ipcRenderer.invoke(videoStudioChannels.setRecordingSettings, patch),
    saveRecording: (payload) => ipcRenderer.invoke(videoStudioChannels.saveRecording, payload),
    openRecordingsFolder: () => ipcRenderer.invoke(videoStudioChannels.openRecordingsFolder),
    probeMedia: (path) => ipcRenderer.invoke(videoStudioChannels.probeMedia, path),
    pickMediaFile: () => ipcRenderer.invoke(videoStudioChannels.pickMediaFile),
    pickLutFile: () => ipcRenderer.invoke(videoStudioChannels.pickLutFile),
    readTextFile: (path) => ipcRenderer.invoke(videoStudioChannels.readTextFile, path),
    readMediaFile: (path) => ipcRenderer.invoke(videoStudioChannels.readMediaFile, path),
    exportClip: (request) => ipcRenderer.invoke(videoStudioChannels.exportClip, request),
    saveProject: (project) => ipcRenderer.invoke(videoStudioChannels.saveProject, project),
    loadProject: () => ipcRenderer.invoke(videoStudioChannels.loadProject),
    detectEncoders: () => ipcRenderer.invoke(videoStudioChannels.detectEncoders),
  }
}

function pickRecorderMimeType(): string {
  // Prefer VP8 first: it is the most broadly reliable MediaRecorder path (the existing
  // Clips capture uses it). VP9 encode can stall and emit no data on some software-GL /
  // headless GPU stacks, producing an empty recording.
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
  ]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

async function captureStream(settings: RecordingSettings): Promise<MediaStream> {
  const preset = VIDEO_RESOLUTION_PRESETS.find((item) => item.id === settings.resolution)
  // Use only `ideal` hints (no hard `max`): over-constraining the capturer can yield a
  // track that produces no frames on some displays/headless GPUs. Target size is enforced
  // best-effort below and, authoritatively, by the FFmpeg scale on export.
  const video: MediaTrackConstraints = {
    frameRate: { ideal: settings.fps },
  }
  if (preset?.width && preset.height) {
    video.width = { ideal: preset.width }
    video.height = { ideal: preset.height }
  }

  return navigator.mediaDevices.getDisplayMedia({
    video,
    audio: settings.captureAudio,
  })
}

export function useVideoRecorder() {
  const clipControl = resolveClipControl()
  const videoControl = resolveVideoControl()

  const [sources, setSources] = useState<ClipSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [settings, setSettings] = useState<RecordingSettings>(DEFAULT_RECORDING_SETTINGS)
  const [availableEncoders, setAvailableEncoders] = useState<EncoderPreference[]>(['auto', 'x264'])
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [lastSaved, setLastSaved] = useState<SaveRecordingResult>()
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const mimeRef = useRef('')
  const finalizingRef = useRef(false)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setPreviewStream(null)
  }, [])

  const refreshSources = useCallback(async () => {
    if (!clipControl) {
      return
    }
    try {
      const next = await clipControl.listSources({ includeWindows: false })
      setSources(next)
      setSelectedSourceId((current) =>
        current && next.some((source) => source.id === current)
          ? current
          : next[0]?.id ?? '',
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to list capture sources.')
    }
  }, [clipControl])

  useEffect(() => {
    void (async () => {
      if (videoControl) {
        try {
          const [loaded, encoders] = await Promise.all([
            videoControl.getRecordingSettings(),
            videoControl.detectEncoders(),
          ])
          setSettings(loaded)
          if (encoders.length > 0) {
            setAvailableEncoders(encoders)
          }
        } catch {
          // keep defaults
        }
      }
      await refreshSources()
    })()

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.onstop = null
        recorderRef.current.stop()
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [videoControl, refreshSources])

  const updateSettings = useCallback(
    async (patch: Partial<RecordingSettings>) => {
      setSettings((current) => ({ ...current, ...patch }))
      if (videoControl) {
        const next = await videoControl.setRecordingSettings(patch)
        setSettings(next)
      }
    },
    [videoControl],
  )

  const selectSource = useCallback(
    async (sourceId: string) => {
      setSelectedSourceId(sourceId)
      // The main-process display-media handler resolves this id when capture starts.
      if (clipControl) {
        await clipControl.setSettings({ sourceId })
      }
    },
    [clipControl],
  )

  const startRecording = useCallback(async () => {
    if (!videoControl || !clipControl || recording) {
      return
    }
    const mimeType = pickRecorderMimeType()
    if (!mimeType) {
      setError('This system cannot record video.')
      return
    }

    setIsBusy(true)
    setError(undefined)
    try {
      if (selectedSourceId) {
        await clipControl.setSettings({ sourceId: selectedSourceId })
      }
      const stream = await captureStream(settingsRef.current)
      streamRef.current = stream
      setPreviewStream(stream)
      chunksRef.current = []
      finalizingRef.current = false
      mimeRef.current = mimeType

      // Cap the software-encode bitrate: very high VP8 targets can stall the encoder on
      // software-GL / headless stacks and emit no data. FFmpeg re-encodes to the requested
      // bitrate on save, so quality is preserved.
      const videoBps = Math.min(settingsRef.current.videoBitrateKbps, 8_000) * 1000
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: videoBps,
        audioBitsPerSecond: settingsRef.current.audioBitrateKbps * 1000,
      })
      recorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      // The capture track ending (or the recorder stopping itself) must not lose the take:
      // finalize is idempotent and pulls from the collected timeslice chunks.
      recorder.onstop = () => {
        void finalizeRecording()
      }
      recorder.onerror = () => {
        void stopRecording()
      }
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          void stopRecording()
        }
      })

      recorder.start(2000)
      startedAtRef.current = Date.now()
      setElapsedMs(0)
      setRecording(true)
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current)
      }, 250)
    } catch (startError) {
      stopTracks()
      setError(
        startError instanceof Error ? startError.message : 'Unable to start screen recording.',
      )
    } finally {
      setIsBusy(false)
    }
    // finalizeRecording / stopRecording are declared below; captured lazily at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipControl, recording, selectedSourceId, stopTracks, videoControl])

  const finalizeRecording = useCallback(async () => {
    if (!videoControl || finalizingRef.current) {
      return
    }
    finalizingRef.current = true
    setIsBusy(true)

    const mimeType = mimeRef.current || 'video/webm'
    const durationMs = Date.now() - startedAtRef.current
    const sourceName = sources.find((source) => source.id === selectedSourceId)?.name ?? 'Screen'
    const blob = new Blob(chunksRef.current, { type: mimeType })
    chunksRef.current = []

    if (blob.size === 0) {
      setError('No video frames were captured. Try a Desktop source or a lower resolution/frame rate.')
      setIsBusy(false)
      return
    }

    try {
      const buffer = await blob.arrayBuffer()
      const saved = await videoControl.saveRecording({
        data: buffer,
        mimeType: blob.type || mimeType,
        sourceName,
        settings: settingsRef.current,
        durationMs,
      })
      setLastSaved(saved)
      setError(undefined)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save recording.')
    } finally {
      setIsBusy(false)
    }
  }, [selectedSourceId, sources, videoControl])

  const stopRecording = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = undefined
    }
    setRecording(false)
    const recorder = recorderRef.current
    recorderRef.current = null

    if (recorder && recorder.state !== 'inactive') {
      setIsBusy(true)
      try {
        recorder.requestData()
        recorder.stop()
      } catch {
        // fall through to chunk-based finalize
      }
      // Watchdog: if onstop does not arrive (headless capture quirks), finalize from chunks.
      setTimeout(() => {
        void finalizeRecording()
      }, 600)
    } else {
      // Recorder already stopped itself (e.g. the capture track ended) — save what we have.
      void finalizeRecording()
    }
    stopTracks()
  }, [finalizeRecording, stopTracks])

  const openRecordingsFolder = useCallback(async () => {
    await videoControl?.openRecordingsFolder()
  }, [videoControl])

  return {
    available: Boolean(videoControl),
    sources,
    selectedSourceId,
    selectSource,
    settings,
    updateSettings,
    availableEncoders,
    recording,
    elapsedMs,
    isBusy,
    error,
    lastSaved,
    previewStream,
    refreshSources,
    startRecording,
    stopRecording,
    openRecordingsFolder,
  }
}
