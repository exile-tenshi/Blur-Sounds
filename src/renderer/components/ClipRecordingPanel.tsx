import { memo, useEffect, useRef } from 'react'
import type { ClipLookbackSeconds } from '../../shared/appSettings'
import { useClipRecorderContext } from '../context/ClipRecorderContext'
import { CLIPS_PICKER_BUILD } from '../hooks/useClipRecorder'

export const ClipRecordingPanel = memo(function ClipRecordingPanel({
  isActive = false,
}: {
  isActive?: boolean
}) {
  const {
    sources,
    selectedSourceId,
    selectSource,
    lookbackSeconds,
    setLookbackSeconds,
    lookbackOptions,
    forwardSeconds,
    totalSeconds,
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
    loadWindowSources,
    clipIt,
    openOutputFolder,
  } = useClipRecorderContext()

  const desktopSources = sources.filter((source) => source.kind === 'screen')
  const windowSources = sources.filter((source) => source.kind === 'window')
  const selectedSource = sources.find((source) => source.id === selectedSourceId)
  const clipping = status.bufferState === 'clipping'
  const refreshSourcesRef = useRef(refreshSources)
  refreshSourcesRef.current = refreshSources

  useEffect(() => {
    if (!isActive) {
      return
    }
    void refreshSourcesRef.current()
  }, [isActive])

  return (
    <section className="panel clip-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Instant replay</p>
          <h2>Clip it</h2>
          <p className="section-help">
            Keeps the last {formatLookbackLabel(lookbackSeconds)} in the background. When you hit
            Clip it, that buffer saves plus {formatLookbackLabel(forwardSeconds)} after the press
            (total {formatLookbackLabel(totalSeconds)}).
          </p>
        </div>
        <span className={`badge${status.buffering || clipping ? ' recording' : ''}`}>
          {clipping
            ? 'Clipping…'
            : status.buffering
              ? `Buffering ${Math.round(status.bufferedSeconds)}s`
              : 'Buffer idle'}
        </span>
      </div>

      <div className="clip-layout">
        <div className="clip-preview">
          <div className="clip-preview-empty">
            <p>
              {selectedSource
                ? selectedSource.kind === 'screen'
                  ? `Desktop · ${selectedSource.name}`
                  : `App · ${selectedSource.name}`
                : 'Pick a desktop or app source.'}
            </p>
            <p className="muted">
              Desktops and running games/apps load together. Fullscreen games can also use a Desktop
              source.
            </p>
          </div>
        </div>

        <div className="clip-controls">
          <label className="field-label" htmlFor="clip-source">
            Source
          </label>
          <select
            id="clip-source"
            value={selectedSourceId}
            disabled={isBusy || clipping}
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
          <p className="muted">
            Games come from apps currently running on your PC. Click <strong>Refresh games</strong>{' '}
            after launching a new title.
          </p>

          <div className="clip-duration-block">
            <p className="field-label">Remember prior</p>
            <div className="chip-row">
              {lookbackOptions.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  className={`chip-button${lookbackSeconds === seconds ? ' active' : ''}`}
                  disabled={clipping}
                  onClick={() => void setLookbackSeconds(seconds as ClipLookbackSeconds)}
                >
                  {formatLookbackLabel(seconds)}
                </button>
              ))}
            </div>
            <p className="muted">
              Saves last {formatLookbackLabel(lookbackSeconds)} + rolls{' '}
              {formatLookbackLabel(forwardSeconds)} forward.
            </p>
          </div>

          <label className="eq-toggle noise-toggle">
            <input
              type="checkbox"
              checked={bufferingEnabled}
              disabled={isBusy || clipping}
              onChange={(event) => void setBufferingEnabled(event.target.checked)}
            />
            <span className="eq-toggle-track" />
            <span>Run buffer in background</span>
          </label>
          <p className="muted">
            Keep this off unless you need Clip it. Background capture uses GPU/CPU — leave it off
            for normal chatting/mixing.
          </p>

          <div className="button-row">
            <button
              type="button"
              className="primary-button clip-it-button"
              disabled={isBusy || !selectedSourceId || !status.buffering || clipping}
              onClick={() => void clipIt()}
            >
              {clipping ? 'Clipping…' : 'Clip it'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={isBusy || clipping}
              onClick={() => void refreshSources()}
            >
              Refresh games
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={isBusy || clipping}
              onClick={() => void loadWindowSources()}
            >
              {isBusy ? 'Scanning…' : 'Deep window scan'}
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

          <div className="keybind-block">
            <div className="panel-header compact">
              <div>
                <p className="field-label">Clip keybinds</p>
                <p className="muted">Add as many shortcuts as you want. All trigger Clip it.</p>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={listeningForKeybind}
                onClick={() => void addKeybindFromCapture()}
              >
                {listeningForKeybind ? 'Press keys…' : 'Add keybind'}
              </button>
            </div>
            <ul className="keybind-list">
              {keybinds.map((accelerator) => (
                <li key={accelerator}>
                  <code>{accelerator}</code>
                  <button
                    type="button"
                    className="remove-button"
                    onClick={() => void removeKeybind(accelerator)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <p className="muted clip-folder">
            Save folder: {status.outputFolder || 'Desktop/Blur Sounds Clips'}
          </p>
          <p className="muted">Clips picker build {CLIPS_PICKER_BUILD}</p>
          {lastSavedPath ? <p className="notice success">Saved clip: {lastSavedPath}</p> : null}
          {error ? <p className="notice error">{error}</p> : null}
          {status.error ? <p className="notice error">{status.error}</p> : null}
        </div>
      </div>
    </section>
  )
})
