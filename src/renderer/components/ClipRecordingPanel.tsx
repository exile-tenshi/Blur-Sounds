import type { ClipSource } from '../../shared/clipApi'
import { useClipRecorder } from '../hooks/useClipRecorder'

function SourceOption({ source }: { source: ClipSource }) {
  const label = source.kind === 'screen' ? 'Desktop' : 'Game / window'
  return (
    <option value={source.id}>
      [{label}] {source.name}
    </option>
  )
}

export function ClipRecordingPanel() {
  const {
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
  } = useClipRecorder()

  const desktopSources = sources.filter((source) => source.kind === 'screen')
  const windowSources = sources.filter((source) => source.kind === 'window')
  const selectedSource = sources.find((source) => source.id === selectedSourceId)

  return (
    <section className="panel clip-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Clip recordings</p>
          <h2>Capture desktop or games to MP4</h2>
          <p className="section-help">
            Clips save to a folder on your Desktop: <strong>Blur Sounds Clips</strong>
          </p>
        </div>
        <span className={`badge${status.recording ? ' recording' : ''}`}>
          {status.recording ? `Recording ${formatElapsed(status.elapsedMs)}` : 'Idle'}
        </span>
      </div>

      <div className="clip-layout">
        <div className="clip-preview">
          {selectedSource?.thumbnailDataUrl ? (
            <img src={selectedSource.thumbnailDataUrl} alt="" />
          ) : (
            <div className="clip-preview-empty">
              <p className="muted">Pick a desktop or game window to preview.</p>
            </div>
          )}
        </div>

        <div className="clip-controls">
          <label className="field-label" htmlFor="clip-source">
            Source
          </label>
          <select
            id="clip-source"
            value={selectedSourceId}
            disabled={status.recording || isBusy}
            onChange={(event) => setSelectedSourceId(event.target.value)}
          >
            {desktopSources.length === 0 && windowSources.length === 0 ? (
              <option value="">No capture sources found</option>
            ) : null}
            {desktopSources.length > 0 ? (
              <optgroup label="Desktop">
                {desktopSources.map((source) => (
                  <SourceOption key={source.id} source={source} />
                ))}
              </optgroup>
            ) : null}
            {windowSources.length > 0 ? (
              <optgroup label="Games & windows">
                {windowSources.map((source) => (
                  <SourceOption key={source.id} source={source} />
                ))}
              </optgroup>
            ) : null}
          </select>

          <div className="button-row">
            {status.recording ? (
              <button
                type="button"
                className="primary-button clip-stop"
                disabled={isBusy}
                onClick={() => void stopRecording()}
              >
                Stop & save MP4
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                disabled={isBusy || !selectedSourceId}
                onClick={() => void startRecording()}
              >
                Start clip
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={status.recording || isBusy}
              onClick={() => void refreshSources()}
            >
              Refresh sources
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={isBusy}
              onClick={() => void openOutputFolder()}
            >
              Open clips folder
            </button>
          </div>

          <p className="muted clip-folder">
            Save folder: {status.outputFolder || 'Desktop/Blur Sounds Clips'}
          </p>
          {lastSavedPath ? (
            <p className="notice success">Saved clip: {lastSavedPath}</p>
          ) : null}
          {error ? <p className="notice error">{error}</p> : null}
          {status.error ? <p className="notice error">{status.error}</p> : null}
        </div>
      </div>
    </section>
  )
}
