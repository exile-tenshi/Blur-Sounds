import { useCallback, useMemo, useRef, useState } from 'react'
import {
  createEmptyProject,
  NEUTRAL_GRADE,
  videoStudioChannels,
  type AudioAnalysis,
  type ColorGrade,
  type EditorClip,
  type EditorProject,
  type EncoderPreference,
  type ExportResult,
  type GradeParam,
  type Keyframe,
  type MediaInfo,
  type VideoStudioApi,
} from '../../shared/videoStudio'
import {
  canRedo,
  canUndo,
  createInitialState,
  lastUndoLabel,
  nextRedoLabel,
  redo,
  runCommand,
  undo,
  type CommandStackState,
  type EditorCommand,
} from '../utils/commandStack'
import { analyzeAudio } from '../utils/audioAnalysis'
import { upsertKeyframe } from '../utils/keyframes'

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

let clipCounter = 0
function nextClipId(): string {
  clipCounter += 1
  return `clip-${Date.now()}-${clipCounter}`
}

export function clipDuration(clip: EditorClip): number {
  return Math.max(0, clip.outPoint - clip.inPoint)
}

function allClips(project: EditorProject): EditorClip[] {
  return project.tracks.flatMap((track) => track.clips)
}

export function timelineDuration(project: EditorProject): number {
  return allClips(project).reduce(
    (max, clip) => Math.max(max, clip.timelineStart + clipDuration(clip)),
    0,
  )
}

function getClip(project: EditorProject, clipId: string): EditorClip | undefined {
  return allClips(project).find((clip) => clip.id === clipId)
}

function firstVideoTrackId(project: EditorProject): string {
  return project.tracks.find((track) => track.kind === 'video')?.id ?? project.tracks[0]?.id
}

function mapClips(
  project: EditorProject,
  mapper: (clips: EditorClip[], track: EditorProject['tracks'][number]) => EditorClip[],
): EditorProject {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({ ...track, clips: mapper(track.clips, track) })),
  }
}

function replaceClipById(project: EditorProject, clipId: string, next: EditorClip): EditorProject {
  return mapClips(project, (clips) =>
    clips.map((clip) => (clip.id === clipId ? next : clip)),
  )
}

function removeClipById(project: EditorProject, clipId: string): EditorProject {
  return mapClips(project, (clips) => clips.filter((clip) => clip.id !== clipId))
}

function addClipToTrack(
  project: EditorProject,
  trackId: string,
  clip: EditorClip,
  index?: number,
): EditorProject {
  return {
    ...project,
    tracks: project.tracks.map((track) => {
      if (track.id !== trackId) {
        return track
      }
      const clips = [...track.clips]
      if (index === undefined || index >= clips.length) {
        clips.push(clip)
      } else {
        clips.splice(index, 0, clip)
      }
      return { ...track, clips }
    }),
  }
}

function findClipLocation(
  project: EditorProject,
  clipId: string,
): { trackId: string; index: number; clip: EditorClip } | undefined {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((clip) => clip.id === clipId)
    if (index >= 0) {
      return { trackId: track.id, index, clip: track.clips[index] }
    }
  }
  return undefined
}

export interface UseVideoEditor {
  available: boolean
  project: EditorProject
  clips: EditorClip[]
  selectedClipId: string | undefined
  selectedClip: EditorClip | undefined
  playhead: number
  duration: number
  isBusy: boolean
  error: string | undefined
  info: string | undefined
  analysis: AudioAnalysis | undefined
  exportResult: ExportResult | undefined
  exportEncoder: EncoderPreference
  availableEncoders: EncoderPreference[]
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | undefined
  redoLabel: string | undefined
  mediaUrlFor: (path: string) => string | undefined
  setPlayhead: (seconds: number) => void
  selectClip: (clipId: string) => void
  importMedia: () => Promise<void>
  trimSelected: (edge: 'in' | 'out', sourceSeconds: number) => void
  splitAtPlayhead: () => void
  deleteSelected: () => void
  setGrade: (patch: Partial<ColorGrade>) => void
  resetGrade: () => void
  addKeyframeAtPlayhead: (param: GradeParam) => void
  loadLut: () => Promise<void>
  clearLut: () => void
  setLutIntensity: (value: number) => void
  runUndo: () => void
  runRedo: () => void
  analyzeSelected: () => Promise<void>
  trimDeadAir: () => void
  setExportEncoder: (encoder: EncoderPreference) => void
  exportSelected: () => Promise<void>
  saveProject: () => Promise<void>
  loadProject: () => Promise<void>
}

export function useVideoEditor(): UseVideoEditor {
  const videoControl = useMemo(resolveVideoControl, [])
  const [stack, setStack] = useState<CommandStackState>(() =>
    createInitialState(createEmptyProject()),
  )
  const [selectedClipId, setSelectedClipId] = useState<string>()
  const [playhead, setPlayheadState] = useState(0)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [info, setInfo] = useState<string>()
  const [analysis, setAnalysis] = useState<AudioAnalysis>()
  const [exportResult, setExportResult] = useState<ExportResult>()
  const [exportEncoder, setExportEncoder] = useState<EncoderPreference>('auto')
  const [availableEncoders, setAvailableEncoders] = useState<EncoderPreference[]>(['auto', 'x264'])
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})

  const project = stack.project
  const clips = useMemo(() => allClips(project), [project])
  const selectedClip = selectedClipId ? getClip(project, selectedClipId) : undefined
  const duration = useMemo(() => timelineDuration(project), [project])

  const detectedEncodersRef = useRef(false)
  if (!detectedEncodersRef.current && videoControl) {
    detectedEncodersRef.current = true
    void videoControl.detectEncoders().then((encoders) => {
      if (encoders.length > 0) {
        setAvailableEncoders(encoders)
      }
    })
  }

  const dispatch = useCallback((command: EditorCommand) => {
    setStack((current) => runCommand(current, command))
  }, [])

  const setPlayhead = useCallback((seconds: number) => {
    setPlayheadState(Math.max(0, seconds))
  }, [])

  const selectClip = useCallback(
    (clipId: string) => {
      setSelectedClipId(clipId)
      setAnalysis(undefined)
      const clip = getClip(project, clipId)
      if (clip) {
        setPlayheadState(clip.timelineStart)
      }
    },
    [project],
  )

  const ensureMediaUrl = useCallback(
    async (path: string, mimeHint: string): Promise<void> => {
      if (!videoControl || mediaUrls[path]) {
        return
      }
      const bytes = await videoControl.readMediaFile(path)
      const blob = new Blob([bytes], { type: mimeHint })
      const url = URL.createObjectURL(blob)
      setMediaUrls((current) => ({ ...current, [path]: url }))
    },
    [mediaUrls, videoControl],
  )

  const importMedia = useCallback(async () => {
    if (!videoControl) {
      return
    }
    setIsBusy(true)
    setError(undefined)
    try {
      const media: MediaInfo | undefined = await videoControl.pickMediaFile()
      if (!media) {
        return
      }
      const mimeHint = media.fileName.toLowerCase().endsWith('.webm')
        ? 'video/webm'
        : 'video/mp4'
      await ensureMediaUrl(media.path, mimeHint)

      const clip: EditorClip = {
        id: nextClipId(),
        name: media.fileName,
        sourcePath: media.path,
        sourceDurationSeconds: media.durationSeconds,
        inPoint: 0,
        outPoint: media.durationSeconds || 5,
        timelineStart: timelineDuration(project),
        grade: { ...NEUTRAL_GRADE },
        curves: {},
        lutIntensity: 1,
        fps: media.fps || 30,
        width: media.width,
        height: media.height,
      }

      const trackId = firstVideoTrackId(project)
      dispatch({
        label: 'Add clip',
        apply: (p) => addClipToTrack(p, trackId, clip),
        invert: (p) => removeClipById(p, clip.id),
      })
      setSelectedClipId(clip.id)
      setPlayheadState(clip.timelineStart)
      setInfo(`Imported ${media.fileName} (${media.durationSeconds.toFixed(1)}s, ${media.width}×${media.height})`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Unable to import media.')
    } finally {
      setIsBusy(false)
    }
  }, [dispatch, ensureMediaUrl, project, videoControl])

  const trimSelected = useCallback(
    (edge: 'in' | 'out', sourceSeconds: number) => {
      if (!selectedClip) {
        return
      }
      const prev = selectedClip
      const next: EditorClip =
        edge === 'in'
          ? { ...prev, inPoint: Math.max(0, Math.min(sourceSeconds, prev.outPoint - 0.1)) }
          : {
              ...prev,
              outPoint: Math.min(
                prev.sourceDurationSeconds || sourceSeconds,
                Math.max(sourceSeconds, prev.inPoint + 0.1),
              ),
            }
      dispatch({
        label: `Trim ${edge}`,
        apply: (p) => replaceClipById(p, prev.id, next),
        invert: (p) => replaceClipById(p, prev.id, prev),
      })
    },
    [dispatch, selectedClip],
  )

  const splitAtPlayhead = useCallback(() => {
    if (!selectedClip) {
      return
    }
    const clip = selectedClip
    const localTime = playhead - clip.timelineStart
    const sourceTime = clip.inPoint + localTime
    if (localTime <= 0.05 || sourceTime >= clip.outPoint - 0.05) {
      setError('Move the playhead inside the selected clip to split.')
      return
    }
    const location = findClipLocation(project, clip.id)
    if (!location) {
      return
    }
    const left: EditorClip = { ...clip, outPoint: sourceTime }
    const right: EditorClip = {
      ...clip,
      id: nextClipId(),
      inPoint: sourceTime,
      timelineStart: clip.timelineStart + (sourceTime - clip.inPoint),
    }
    dispatch({
      label: 'Split clip',
      apply: (p) => addClipToTrack(replaceClipById(p, clip.id, left), location.trackId, right, location.index + 1),
      invert: (p) => replaceClipById(removeClipById(p, right.id), clip.id, clip),
    })
    setInfo('Split clip at playhead.')
  }, [dispatch, playhead, project, selectedClip])

  const deleteSelected = useCallback(() => {
    if (!selectedClip) {
      return
    }
    const location = findClipLocation(project, selectedClip.id)
    if (!location) {
      return
    }
    const removed = location.clip
    dispatch({
      label: 'Delete clip',
      apply: (p) => removeClipById(p, removed.id),
      invert: (p) => addClipToTrack(p, location.trackId, removed, location.index),
    })
    setSelectedClipId(undefined)
  }, [dispatch, project, selectedClip])

  const setGrade = useCallback(
    (patch: Partial<ColorGrade>) => {
      if (!selectedClip) {
        return
      }
      const prev = selectedClip
      const next: EditorClip = { ...prev, grade: { ...prev.grade, ...patch } }
      dispatch({
        label: 'Adjust grade',
        apply: (p) => replaceClipById(p, prev.id, next),
        invert: (p) => replaceClipById(p, prev.id, prev),
      })
    },
    [dispatch, selectedClip],
  )

  const resetGrade = useCallback(() => {
    if (!selectedClip) {
      return
    }
    const prev = selectedClip
    const next: EditorClip = { ...prev, grade: { ...NEUTRAL_GRADE }, curves: {} }
    dispatch({
      label: 'Reset grade',
      apply: (p) => replaceClipById(p, prev.id, next),
      invert: (p) => replaceClipById(p, prev.id, prev),
    })
  }, [dispatch, selectedClip])

  const addKeyframeAtPlayhead = useCallback(
    (param: GradeParam) => {
      if (!selectedClip) {
        return
      }
      const prev = selectedClip
      const localTime = Math.max(0, playhead - prev.timelineStart)
      const keyframe: Keyframe = {
        time: Number(localTime.toFixed(3)),
        value: prev.grade[param],
        interpolation: 'linear',
      }
      const next: EditorClip = { ...prev, curves: upsertKeyframe(prev.curves, param, keyframe) }
      dispatch({
        label: `Keyframe ${param}`,
        apply: (p) => replaceClipById(p, prev.id, next),
        invert: (p) => replaceClipById(p, prev.id, prev),
      })
      setInfo(`Added ${param} keyframe at ${localTime.toFixed(2)}s`)
    },
    [dispatch, playhead, selectedClip],
  )

  const loadLut = useCallback(async () => {
    if (!videoControl || !selectedClip) {
      return
    }
    try {
      const picked = await videoControl.pickLutFile()
      if (!picked) {
        return
      }
      const prev = selectedClip
      const next: EditorClip = { ...prev, lutPath: picked.path, lutName: picked.name }
      dispatch({
        label: 'Load LUT',
        apply: (p) => replaceClipById(p, prev.id, next),
        invert: (p) => replaceClipById(p, prev.id, prev),
      })
      setInfo(`Loaded LUT ${picked.name}`)
    } catch (lutError) {
      setError(lutError instanceof Error ? lutError.message : 'Unable to load LUT.')
    }
  }, [dispatch, selectedClip, videoControl])

  const clearLut = useCallback(() => {
    if (!selectedClip) {
      return
    }
    const prev = selectedClip
    const next: EditorClip = { ...prev, lutPath: undefined, lutName: undefined }
    dispatch({
      label: 'Clear LUT',
      apply: (p) => replaceClipById(p, prev.id, next),
      invert: (p) => replaceClipById(p, prev.id, prev),
    })
  }, [dispatch, selectedClip])

  const setLutIntensity = useCallback(
    (value: number) => {
      if (!selectedClip) {
        return
      }
      const prev = selectedClip
      const next: EditorClip = { ...prev, lutIntensity: Math.max(0, Math.min(1, value)) }
      dispatch({
        label: 'LUT intensity',
        apply: (p) => replaceClipById(p, prev.id, next),
        invert: (p) => replaceClipById(p, prev.id, prev),
      })
    },
    [dispatch, selectedClip],
  )

  const runUndo = useCallback(() => setStack((current) => undo(current)), [])
  const runRedo = useCallback(() => setStack((current) => redo(current)), [])

  const analyzeSelected = useCallback(async () => {
    if (!videoControl || !selectedClip) {
      return
    }
    setIsBusy(true)
    setError(undefined)
    try {
      const bytes = await videoControl.readMediaFile(selectedClip.sourcePath)
      const mimeHint = selectedClip.sourcePath.toLowerCase().endsWith('.webm')
        ? 'video/webm'
        : 'video/mp4'
      const result = await analyzeAudio(bytes, mimeHint)
      setAnalysis(result)
      setInfo(
        `Found ${result.silences.length} dead-air span(s) and ${result.highlights.length} highlight(s).`,
      )
    } catch (analyzeError) {
      setError(
        analyzeError instanceof Error
          ? `Audio analysis failed: ${analyzeError.message}`
          : 'Audio analysis failed.',
      )
    } finally {
      setIsBusy(false)
    }
  }, [selectedClip, videoControl])

  const trimDeadAir = useCallback(() => {
    if (!selectedClip || !analysis) {
      return
    }
    const prev = selectedClip
    let newIn = prev.inPoint
    let newOut = prev.outPoint
    const leadSilence = analysis.silences.find((range) => range.start <= 0.1)
    if (leadSilence && leadSilence.end < prev.outPoint) {
      newIn = Math.max(prev.inPoint, leadSilence.end)
    }
    const tailSilence = [...analysis.silences]
      .reverse()
      .find((range) => range.end >= analysis.durationSeconds - 0.15)
    if (tailSilence && tailSilence.start > newIn) {
      newOut = Math.min(prev.outPoint, tailSilence.start)
    }
    if (newIn === prev.inPoint && newOut === prev.outPoint) {
      setInfo('No leading/trailing dead air to trim.')
      return
    }
    const next: EditorClip = { ...prev, inPoint: newIn, outPoint: newOut }
    dispatch({
      label: 'Trim dead air',
      apply: (p) => replaceClipById(p, prev.id, next),
      invert: (p) => replaceClipById(p, prev.id, prev),
    })
    setInfo(`Trimmed dead air → in ${newIn.toFixed(2)}s, out ${newOut.toFixed(2)}s`)
  }, [analysis, dispatch, selectedClip])

  const exportSelected = useCallback(async () => {
    if (!videoControl || !selectedClip) {
      return
    }
    setIsBusy(true)
    setError(undefined)
    setExportResult(undefined)
    try {
      const result = await videoControl.exportClip({
        sourcePath: selectedClip.sourcePath,
        inPoint: selectedClip.inPoint,
        outPoint: selectedClip.outPoint,
        grade: selectedClip.grade,
        lutPath: selectedClip.lutPath,
        lutIntensity: selectedClip.lutIntensity,
        encoder: exportEncoder,
        videoBitrateKbps: 12_000,
        audioBitrateKbps: 160,
        width: selectedClip.width || undefined,
        height: selectedClip.height || undefined,
        outputName: selectedClip.name.replace(/\.[^.]+$/, ''),
      })
      setExportResult(result)
      setInfo(`Exported with ${result.encoderUsed}.`)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Export failed.')
    } finally {
      setIsBusy(false)
    }
  }, [exportEncoder, selectedClip, videoControl])

  const saveProject = useCallback(async () => {
    if (!videoControl) {
      return
    }
    const result = await videoControl.saveProject(project)
    if (result) {
      setInfo(`Saved project to ${result.path}`)
    }
  }, [project, videoControl])

  const loadProject = useCallback(async () => {
    if (!videoControl) {
      return
    }
    const result = await videoControl.loadProject()
    if (!result) {
      return
    }
    setStack(createInitialState(result.project))
    setSelectedClipId(undefined)
    setPlayheadState(0)
    // Preload media so imported clips can preview immediately.
    for (const clip of allClips(result.project)) {
      const mimeHint = clip.sourcePath.toLowerCase().endsWith('.webm')
        ? 'video/webm'
        : 'video/mp4'
      void ensureMediaUrl(clip.sourcePath, mimeHint).catch(() => undefined)
    }
    setInfo(`Loaded project from ${result.path}`)
  }, [ensureMediaUrl, videoControl])

  const mediaUrlFor = useCallback((path: string) => mediaUrls[path], [mediaUrls])

  return {
    available: Boolean(videoControl),
    project,
    clips,
    selectedClipId,
    selectedClip,
    playhead,
    duration,
    isBusy,
    error,
    info,
    analysis,
    exportResult,
    exportEncoder,
    availableEncoders,
    canUndo: canUndo(stack),
    canRedo: canRedo(stack),
    undoLabel: lastUndoLabel(stack),
    redoLabel: nextRedoLabel(stack),
    mediaUrlFor,
    setPlayhead,
    selectClip,
    importMedia,
    trimSelected,
    splitAtPlayhead,
    deleteSelected,
    setGrade,
    resetGrade,
    addKeyframeAtPlayhead,
    loadLut,
    clearLut,
    setLutIntensity,
    runUndo,
    runRedo,
    analyzeSelected,
    trimDeadAir,
    setExportEncoder,
    exportSelected,
    saveProject,
    loadProject,
  }
}
