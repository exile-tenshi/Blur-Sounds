import { memo, useEffect, useRef } from 'react'
import {
  ENCODER_OPTIONS,
  VIDEO_FPS_OPTIONS,
  VIDEO_RESOLUTION_PRESETS,
  type VideoFps,
  type VideoResolutionId,
} from '../../shared/videoStudio'
import { useVideoRecorderContext } from '../context/VideoRecorderContext'

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export const VideoRecordingPanel = memo(function VideoRecordingPanel({
  isActive = false,
}: {
  isActive?: boolean
}) {
  const {
    available,
    ensureLoaded,
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
  } = useVideoRecorderContext()

  const videoRef = useRef<HTMLVideoElement>(null)
  const initRef = useRef(() => {
    void ensureLoaded()
    void refreshSources()
  })
  initRef.current = () => {
    void ensureLoaded()
    void refreshSources()
  }

  useEffect(() => {
    if (isActive) {
      initRef.current()
    }
  }, [isActive])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = previewStream
    }
  }, [previewStream])

  const desktopSources = sources.filter((source) => source.kind === 'screen')
  const windowSources = sources.filter((source) => source.kind === 'window')

  return (
    <section className="panel record-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Video recording</p>
          <h2>Record</h2>
          <p className="section-help">
            Capture a screen, game, or app to a full take. Saved to{' '}
            <strong>Desktop/Blur Sounds Recordings</strong> and transcoded through FFmpeg with your
            chosen encoder.
          </p>
        </div>
        <span className={`badge${recording ? ' recording' : ''}`}>
          {recording ? `Recording ${formatElapsed(elapsedMs)}` : 'Idle'}
        </span>
      </div>

      {!available ? (
        <p className="notice error">
          Video bridge did not load. Relaunch the Electron app to enable recording.
        </p>
      ) : null}

      <div className="record-layout">
        <div className="record-preview">
          <video
            ref={videoRef}
            className="record-preview-video"
            autoPlay
            muted
            playsInline
          />
          {!previewStream ? (
            <div className="record-preview-empty">
              <p>Preview appears here while recording.</p>
              <p className="muted">Pick a source and press Start recording.</p>
            </div>
          ) : null}
        </div>

        <div className="record-controls">
          <label className="field-label" htmlFor="record-source">
            Capture source
          </label>
          <select
            id="record-source"
            value={selectedSourceId}
            disabled={recording}
            onChange={(event) => void selectSource(event.target.value)}
          >
            {desktopSources.length === 0 && windowSources.length === 0 ? (
              <option value="">No capture sources found</option>
            ) : null}
            {desktopSources.length > 0 ? (
              <optgroup label="Desktop">
                {desktopSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    [Desktop] {source.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {windowSources.length > 0 ? (
              <optgroup label="Games & apps">
                {windowSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    [Game / app] {source.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>

          <div className="record-settings-grid">
            <div>
              <p className="field-label">Resolution</p>
              <div className="chip-row">
                {VIDEO_RESOLUTION_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`chip-button${settings.resolution === preset.id ? ' active' : ''}`}
                    disabled={recording}
                    onClick={() =>
                      void updateSettings({ resolution: preset.id as VideoResolutionId })
                    }
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="field-label">Frame rate</p>
              <div className="chip-row">
                {VIDEO_FPS_OPTIONS.map((fps) => (
                  <button
                    key={fps}
                    type="button"
                    className={`chip-button${settings.fps === fps ? ' active' : ''}`}
                    disabled={recording}
                    onClick={() => void updateSettings({ fps: fps as VideoFps })}
                  >
                    {fps} fps
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="field-label" htmlFor="record-encoder">
            Encoder
          </label>
          <select
            id="record-encoder"
            value={settings.encoder}
            disabled={recording}
            onChange={(event) =>
              void updateSettings({ encoder: event.target.value as typeof settings.encoder })
            }
          >
            {ENCODER_OPTIONS.map((option) => {
              const enabled = availableEncoders.includes(option.id)
              return (
                <option key={option.id} value={option.id} disabled={!enabled}>
                  {option.label} · {option.vendor}
                  {enabled ? '' : ' (unavailable)'}
                </option>
              )
            })}
          </select>
          <p className="muted">
            Hardware encoders (NVENC/AMF/QuickSync) are used when your GPU exposes them; otherwise
            recording falls back to x264 software encode.
          </p>

          <label className="field-label" htmlFor="record-bitrate">
            Video bitrate: {(settings.videoBitrateKbps / 1000).toFixed(1)} Mbps
          </label>
          <input
            id="record-bitrate"
            type="range"
            min={2000}
            max={60000}
            step={1000}
            value={settings.videoBitrateKbps}
            disabled={recording}
            onChange={(event) =>
              void updateSettings({ videoBitrateKbps: Number(event.target.value) })
            }
          />

          <label className="eq-toggle noise-toggle">
            <input
              type="checkbox"
              checked={settings.captureAudio}
              disabled={recording}
              onChange={(event) => void updateSettings({ captureAudio: event.target.checked })}
            />
            <span className="eq-toggle-track" />
            <span>Capture system audio</span>
          </label>

          <label className="eq-toggle noise-toggle">
            <input
              type="checkbox"
              checked={settings.transcodeToMp4}
              disabled={recording}
              onChange={(event) => void updateSettings({ transcodeToMp4: event.target.checked })}
            />
            <span className="eq-toggle-track" />
            <span>Transcode to MP4 on save (FFmpeg)</span>
          </label>

          <label className="eq-toggle noise-toggle">
            <input
              type="checkbox"
              checked={settings.clearCast.enabled}
              disabled={recording}
              onChange={(event) =>
                void updateSettings({
                  clearCast: { ...settings.clearCast, enabled: event.target.checked },
                })
              }
            />
            <span className="eq-toggle-track" />
            <span>ClearCast voice isolation (RNNoise)</span>
          </label>
          {settings.clearCast.enabled ? (
            <>
              <label className="field-label" htmlFor="record-clearcast">
                ClearCast strength: {settings.clearCast.strength}
              </label>
              <input
                id="record-clearcast"
                type="range"
                min={0}
                max={100}
                step={1}
                disabled={recording}
                value={settings.clearCast.strength}
                onChange={(event) =>
                  void updateSettings({
                    clearCast: { ...settings.clearCast, strength: Number(event.target.value) },
                  })
                }
              />
            </>
          ) : null}

          <div className="button-row">
            {recording ? (
              <button
                type="button"
                className="primary-button danger"
                onClick={() => void stopRecording()}
              >
                Stop &amp; save
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                disabled={!available || isBusy || !selectedSourceId}
                onClick={() => void startRecording()}
              >
                {isBusy ? 'Working…' : 'Start recording'}
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={recording}
              onClick={() => void refreshSources()}
            >
              Refresh sources
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void openRecordingsFolder()}
            >
              Open recordings folder
            </button>
          </div>

          {lastSaved ? (
            <p className="notice success">
              Saved {lastSaved.container.toUpperCase()} ({lastSaved.encoderUsed}): {lastSaved.path}
            </p>
          ) : null}
          {error ? <p className="notice error">{error}</p> : null}
        </div>
      </div>
    </section>
  )
})
