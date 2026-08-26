import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  ENCODER_OPTIONS,
  type ColorGrade,
  type GradeParam,
} from '../../shared/videoStudio'
import { useVideoEditorContext } from '../context/VideoEditorContext'
import { clipDuration } from '../hooks/useVideoEditor'
import { PreviewRenderer } from '../utils/webglPreview'
import { parseCubeLut } from '../utils/cubeLut'
import { resolveGradeAtTime } from '../utils/keyframes'

interface GradeSlider {
  param: GradeParam
  label: string
  min: number
  max: number
  step: number
}

const GRADE_SLIDERS: GradeSlider[] = [
  { param: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.01 },
  { param: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.01 },
  { param: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 },
  { param: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01 },
  { param: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01 },
  { param: 'lift', label: 'Lift (shadows)', min: -1, max: 1, step: 0.01 },
  { param: 'gamma', label: 'Gamma (mids)', min: 0.2, max: 3, step: 0.01 },
  { param: 'gain', label: 'Gain (highlights)', min: 0, max: 2, step: 0.01 },
]

function formatTime(seconds: number): string {
  const total = Math.max(0, seconds)
  const minutes = Math.floor(total / 60)
  const secs = Math.floor(total % 60)
  const frames = Math.floor((total - Math.floor(total)) * 100)
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${frames
    .toString()
    .padStart(2, '0')}`
}

export const ClipEditorPanel = memo(function ClipEditorPanel({
  isActive = false,
}: {
  isActive?: boolean
}) {
  const editor = useVideoEditorContext()
  const {
    available,
    ensureLoaded,
    clips,
    selectedClip,
    selectedClipId,
    playhead,
    duration,
    isBusy,
    error,
    info,
    analysis,
    exportResult,
    exportEncoder,
    availableEncoders,
    clearCast,
    setClearCast,
    mediaUrlFor,
    setPlayhead,
    selectClip,
    importMedia,
    splitAtPlayhead,
    deleteSelected,
    trimSelected,
    setGrade,
    resetGrade,
    addKeyframeAtPlayhead,
    loadLut,
    clearLut,
    setLutIntensity,
    runUndo,
    runRedo,
    canUndo,
    canRedo,
    analyzeSelected,
    trimDeadAir,
    setExportEncoder,
    exportSelected,
    saveProject,
    loadProject,
  } = editor

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<PreviewRenderer | null>(null)
  const rafRef = useRef<number>(0)
  const loadedLutPathRef = useRef<string | undefined>(undefined)
  const lastRenderSigRef = useRef('')
  const [pxPerSec, setPxPerSec] = useState(48)
  const [isPlaying, setIsPlaying] = useState(false)
  const playingRef = useRef(false)
  playingRef.current = isPlaying

  const selectedUrl = selectedClip ? mediaUrlFor(selectedClip.sourcePath) : undefined

  // Keep refs of the latest values the render loop reads without re-subscribing rAF.
  const stateRef = useRef({ selectedClip, playhead })
  stateRef.current = { selectedClip, playhead }

  // Trigger the editor's lazy init (encoder detection) only when the tab opens.
  useEffect(() => {
    ensureLoaded()
  }, [ensureLoaded])

  // Set up the WebGL preview renderer once the canvas mounts.
  useEffect(() => {
    if (!canvasRef.current || rendererRef.current) {
      return
    }
    try {
      rendererRef.current = new PreviewRenderer(canvasRef.current)
    } catch {
      rendererRef.current = null
    }
    return () => {
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  // Load/parse the selected clip's LUT when it changes.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) {
      return
    }
    const path = selectedClip?.lutPath
    if (path === loadedLutPathRef.current) {
      return
    }
    loadedLutPathRef.current = path
    if (!path) {
      renderer.setLut(null)
      return
    }
    void (async () => {
      try {
        const text = await window.videoStudioControl?.readTextFile(path)
        if (text) {
          renderer.setLut(parseCubeLut(text))
        }
      } catch {
        renderer.setLut(null)
      }
    })()
  }, [selectedClip?.lutPath])

  // Continuous preview + playhead sync loop.
  useEffect(() => {
    if (!isActive) {
      return
    }
    const tick = () => {
      const video = videoRef.current
      const renderer = rendererRef.current
      const { selectedClip: clip, playhead: head } = stateRef.current

      if (video && clip) {
        const localTime = Math.max(0, Math.min(head - clip.timelineStart, clipDuration(clip)))
        const targetSource = clip.inPoint + localTime

        if (playingRef.current) {
          // While playing, the playhead follows the video; stop at the out-point.
          if (video.paused) {
            void video.play().catch(() => undefined)
          }
          const timelinePos = clip.timelineStart + (video.currentTime - clip.inPoint)
          if (video.currentTime >= clip.outPoint) {
            video.pause()
            setIsPlaying(false)
          } else {
            setPlayhead(timelinePos)
          }
        } else if (Math.abs(video.currentTime - targetSource) > 0.08) {
          // While scrubbing, the video follows the playhead.
          video.currentTime = targetSource
        }

        if (renderer && video.readyState >= 2 && video.videoWidth > 0) {
          const grade = resolveGradeAtTime(clip.grade, clip.curves, localTime)
          // Skip redundant GPU draws when idle: only redraw when playing or when the
          // frame/grade/LUT actually changed. Keeps the paused editor near-zero GPU cost.
          const g = grade
          const sig = `${video.currentTime.toFixed(3)}|${clip.id}|${clip.lutPath ?? ''}|${clip.lutIntensity}|${g.exposure},${g.contrast},${g.saturation},${g.temperature},${g.tint},${g.lift},${g.gamma},${g.gain}`
          if (playingRef.current || sig !== lastRenderSigRef.current) {
            lastRenderSigRef.current = sig
            renderer.render(video, grade, clip.lutIntensity)
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isActive, setPlayhead])

  const displayGrade: ColorGrade | undefined = useMemo(() => {
    if (!selectedClip) {
      return undefined
    }
    const localTime = Math.max(0, playhead - selectedClip.timelineStart)
    return resolveGradeAtTime(selectedClip.grade, selectedClip.curves, localTime)
  }, [playhead, selectedClip])

  const timelineWidth = Math.max(320, duration * pxPerSec)

  const handleTimelineClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left + event.currentTarget.scrollLeft
    setPlayhead(x / pxPerSec)
    setIsPlaying(false)
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) {
      return
    }
    if (isPlaying) {
      video.pause()
      setIsPlaying(false)
    } else {
      setIsPlaying(true)
    }
  }

  return (
    <section className="panel editor-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Clip editing</p>
          <h2>Editor</h2>
          <p className="section-help">
            Trim, split, color grade (WebGL + .cube LUTs), keyframe, auto-cut dead air, and export
            through FFmpeg. Projects save as <code>.blurproj</code>.
          </p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary-button" disabled={!canUndo} onClick={runUndo}>
            Undo
          </button>
          <button type="button" className="secondary-button" disabled={!canRedo} onClick={runRedo}>
            Redo
          </button>
        </div>
      </div>

      {!available ? (
        <p className="notice error">
          Video bridge did not load. Relaunch the Electron app to enable the editor.
        </p>
      ) : null}

      <div className="editor-toolbar button-row">
        <button
          type="button"
          className="primary-button"
          disabled={!available || isBusy}
          onClick={() => void importMedia()}
        >
          Import video
        </button>
        <button type="button" className="secondary-button" onClick={() => void saveProject()}>
          Save project
        </button>
        <button type="button" className="secondary-button" onClick={() => void loadProject()}>
          Open project
        </button>
      </div>

      <div className="editor-stage">
        <div className="editor-preview">
          <canvas ref={canvasRef} className="editor-preview-canvas" />
          {!selectedUrl ? (
            <div className="editor-preview-empty">
              <p>Import a video to start editing.</p>
              <p className="muted">Recordings live in Desktop/Blur Sounds Recordings.</p>
            </div>
          ) : null}
          <video
            ref={videoRef}
            src={selectedUrl}
            className="editor-hidden-video"
            muted
            playsInline
            preload="auto"
          />
          <div className="editor-transport">
            <button type="button" className="secondary-button" onClick={togglePlay} disabled={!selectedClip}>
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <span className="timecode">
              {formatTime(playhead)} / {formatTime(duration)}
            </span>
            <div className="zoom-row">
              <button
                type="button"
                className="chip-button"
                onClick={() => setPxPerSec((value) => Math.max(12, value - 12))}
              >
                −
              </button>
              <span className="muted">{pxPerSec}px/s</span>
              <button
                type="button"
                className="chip-button"
                onClick={() => setPxPerSec((value) => Math.min(160, value + 12))}
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div className="editor-inspector">
          <div className="panel-header compact">
            <p className="field-label">Selected clip</p>
          </div>
          {selectedClip ? (
            <>
              <p className="muted editor-clip-name">{selectedClip.name}</p>
              <div className="button-row wrap">
                <button type="button" className="secondary-button" onClick={splitAtPlayhead}>
                  Split at playhead
                </button>
                <button type="button" className="secondary-button danger" onClick={deleteSelected}>
                  Delete
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => trimSelected('in', selectedClip.inPoint + Math.max(0, playhead - selectedClip.timelineStart))}
                >
                  Set in @ playhead
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => trimSelected('out', selectedClip.inPoint + Math.max(0, playhead - selectedClip.timelineStart))}
                >
                  Set out @ playhead
                </button>
              </div>
              <p className="muted">
                In {selectedClip.inPoint.toFixed(2)}s · Out {selectedClip.outPoint.toFixed(2)}s ·
                Len {clipDuration(selectedClip).toFixed(2)}s
              </p>

              <div className="grade-block">
                <div className="panel-header compact">
                  <p className="field-label">Color grade</p>
                  <button type="button" className="secondary-button" onClick={resetGrade}>
                    Reset
                  </button>
                </div>
                {GRADE_SLIDERS.map((slider) => (
                  <div key={slider.param} className="grade-row">
                    <label className="grade-label" htmlFor={`grade-${slider.param}`}>
                      {slider.label}
                      <span className="grade-value">
                        {(displayGrade?.[slider.param] ?? selectedClip.grade[slider.param]).toFixed(2)}
                      </span>
                    </label>
                    <div className="grade-input-row">
                      <input
                        id={`grade-${slider.param}`}
                        type="range"
                        min={slider.min}
                        max={slider.max}
                        step={slider.step}
                        value={selectedClip.grade[slider.param]}
                        onChange={(event) =>
                          setGrade({ [slider.param]: Number(event.target.value) } as Partial<ColorGrade>)
                        }
                      />
                      <button
                        type="button"
                        className="chip-button keyframe-button"
                        title="Add keyframe at playhead"
                        onClick={() => addKeyframeAtPlayhead(slider.param)}
                      >
                        ◆
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="lut-block">
                <div className="panel-header compact">
                  <p className="field-label">3D LUT (.cube)</p>
                </div>
                <div className="button-row wrap">
                  <button type="button" className="secondary-button" onClick={() => void loadLut()}>
                    Load .cube
                  </button>
                  {selectedClip.lutPath ? (
                    <button type="button" className="secondary-button" onClick={clearLut}>
                      Clear
                    </button>
                  ) : null}
                </div>
                {selectedClip.lutPath ? (
                  <>
                    <p className="muted">{selectedClip.lutName}</p>
                    <label className="grade-label" htmlFor="lut-intensity">
                      Intensity
                      <span className="grade-value">{selectedClip.lutIntensity.toFixed(2)}</span>
                    </label>
                    <input
                      id="lut-intensity"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={selectedClip.lutIntensity}
                      onChange={(event) => setLutIntensity(Number(event.target.value))}
                    />
                  </>
                ) : (
                  <p className="muted">No LUT applied.</p>
                )}
              </div>

              <div className="smart-block">
                <div className="panel-header compact">
                  <p className="field-label">Smart tools</p>
                </div>
                <div className="button-row wrap">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={isBusy}
                    onClick={() => void analyzeSelected()}
                  >
                    {isBusy ? 'Analyzing…' : 'Analyze audio'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!analysis}
                    onClick={trimDeadAir}
                  >
                    Trim dead air
                  </button>
                </div>
                {analysis ? (
                  <div className="analysis-results">
                    <p className="muted">
                      {analysis.silences.length} dead-air span(s), {analysis.highlights.length}{' '}
                      highlight(s)
                    </p>
                    <div className="marker-row">
                      {analysis.highlights.map((marker) => (
                        <button
                          key={marker.time}
                          type="button"
                          className="chip-button"
                          title={`Score ${marker.score}`}
                          onClick={() => {
                            if (selectedClip) {
                              setPlayhead(selectedClip.timelineStart + (marker.time - selectedClip.inPoint))
                            }
                          }}
                        >
                          ★ {marker.time.toFixed(1)}s
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="smart-block">
                <div className="panel-header compact">
                  <p className="field-label">ClearCast voice isolation</p>
                </div>
                <label className="eq-toggle noise-toggle">
                  <input
                    type="checkbox"
                    checked={clearCast.enabled}
                    onChange={(event) => setClearCast({ enabled: event.target.checked })}
                  />
                  <span className="eq-toggle-track" />
                  <span>{clearCast.enabled ? 'On — voice only' : 'Off'}</span>
                </label>
                <p className="muted">
                  Removes fans and room tone while keeping voice natural. High strength
                  can sound processed — start around 60–70.
                  remains (RNNoise). Applied to the exported clip's audio.
                </p>
                {clearCast.enabled ? (
                  <>
                    <label className="grade-label" htmlFor="clearcast-strength">
                      Strength
                      <span className="grade-value">{clearCast.strength}</span>
                    </label>
                    <input
                      id="clearcast-strength"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={clearCast.strength}
                      onChange={(event) => setClearCast({ strength: Number(event.target.value) })}
                    />
                    <label className="eq-toggle noise-toggle">
                      <input
                        type="checkbox"
                        checked={clearCast.deEcho}
                        onChange={(event) => setClearCast({ deEcho: event.target.checked })}
                      />
                      <span className="eq-toggle-track" />
                      <span>Echo removal (de-reverb)</span>
                    </label>
                    <p className="muted">
                      Extra suppression of room echo / reverb for people talking in an echoey
                      space — cuts the reflected tail so only the direct voice comes through.
                    </p>
                  </>
                ) : null}
              </div>

              <div className="export-block">
                <div className="panel-header compact">
                  <p className="field-label">Export</p>
                </div>
                <select
                  value={exportEncoder}
                  onChange={(event) =>
                    setExportEncoder(event.target.value as typeof exportEncoder)
                  }
                >
                  {ENCODER_OPTIONS.map((option) => {
                    const enabled = availableEncoders.includes(option.id)
                    return (
                      <option key={option.id} value={option.id} disabled={!enabled}>
                        {option.label}
                        {enabled ? '' : ' (unavailable)'}
                      </option>
                    )
                  })}
                </select>
                <button
                  type="button"
                  className="primary-button"
                  disabled={isBusy}
                  onClick={() => void exportSelected()}
                >
                  {isBusy ? 'Exporting…' : 'Export clip (MP4)'}
                </button>
                {exportResult ? (
                  <p className="notice success">
                    Exported ({exportResult.encoderUsed}): {exportResult.path}
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <p className="muted">Select a clip on the timeline to edit it.</p>
          )}
        </div>
      </div>

      <div className="timeline-block">
        <div className="timeline-ruler-wrap" onClick={handleTimelineClick}>
          <div className="timeline-track" style={{ width: timelineWidth }}>
            {clips.map((clip) => {
              const left = clip.timelineStart * pxPerSec
              const width = Math.max(24, clipDuration(clip) * pxPerSec)
              return (
                <button
                  key={clip.id}
                  type="button"
                  className={`timeline-clip${clip.id === selectedClipId ? ' selected' : ''}`}
                  style={{ left, width }}
                  onClick={(event) => {
                    event.stopPropagation()
                    selectClip(clip.id)
                  }}
                >
                  <span className="timeline-clip-name">{clip.name}</span>
                </button>
              )
            })}
            {analysis && selectedClip
              ? analysis.silences.map((range, index) => {
                  const start = selectedClip.timelineStart + (range.start - selectedClip.inPoint)
                  const width = Math.max(2, (range.end - range.start) * pxPerSec)
                  return (
                    <div
                      key={`silence-${index}`}
                      className="timeline-silence"
                      style={{ left: start * pxPerSec, width }}
                      title={`Dead air ${range.start.toFixed(1)}–${range.end.toFixed(1)}s`}
                    />
                  )
                })
              : null}
            <div className="timeline-playhead" style={{ left: playhead * pxPerSec }} />
          </div>
        </div>
      </div>

      {info ? <p className="notice">{info}</p> : null}
      {error ? <p className="notice error">{error}</p> : null}
    </section>
  )
})
