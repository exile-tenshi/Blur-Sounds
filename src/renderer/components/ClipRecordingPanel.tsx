import { memo, useEffect, useMemo, useRef } from 'react'
import {
  CLIP_RESOLUTION_SPECS,
  type ClipLookbackSeconds,
  type ClipResolution,
} from '../../shared/appSettings'
import type { AudioApplication, AudioDevice } from '../../shared/audioTypes'
import { isHifiCableDeviceName } from '../../shared/hifiCable'
import { useClipRecorderContext } from '../context/ClipRecorderContext'
import { CLIPS_PICKER_BUILD } from '../hooks/useClipRecorder'

export const ClipRecordingPanel = memo(function ClipRecordingPanel({
  isActive = false,
  applications = [],
  microphoneDevices = [],
  onEnsureAppRouted,
}: {
  isActive?: boolean
  applications?: AudioApplication[]
  microphoneDevices?: AudioDevice[]
  /** When an app is checked for clip audio, keep it routed into the Blur mix. */
  onEnsureAppRouted?: (appId: string) => void
}) {
  const {
    sources,
    selectedSourceId,
    selectSource,
    lookbackSeconds,
    setLookbackSeconds,
    lookbackOptions,
    resolution,
    setResolution,
    resolutionOptions,
    forwardSeconds,
    totalSeconds,
    formatLookbackLabel,
    keybinds,
    addKeybindFromCapture,
    removeKeybind,
    listeningForKeybind,
    voiceCommandsEnabled,
    setVoiceCommandsEnabled,
    bufferingEnabled,
    setBufferingEnabled,
    audioApplicationIds,
    setAudioApplicationIds,
    audioMicrophoneIds,
    setAudioMicrophoneIds,
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

  const clipMicrophones = useMemo(
    () =>
      microphoneDevices.filter(
        (device) => device.id && !isHifiCableDeviceName(device.name || ''),
      ),
    [microphoneDevices],
  )

  useEffect(() => {
    if (!isActive) {
      return
    }
    void refreshSourcesRef.current()
  }, [isActive])

  const toggleAudioApp = (appId: string, checked: boolean) => {
    const next = checked
      ? [...audioApplicationIds, appId]
      : audioApplicationIds.filter((id) => id !== appId)
    if (checked) {
      onEnsureAppRouted?.(appId)
    }
    void setAudioApplicationIds(next)
  }

  const toggleAudioMic = (deviceId: string, checked: boolean) => {
    const next = checked
      ? [...audioMicrophoneIds, deviceId]
      : audioMicrophoneIds.filter((id) => id !== deviceId)
    void setAudioMicrophoneIds(next)
  }

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
              Game/app picks capture your primary desktop (works for fullscreen and VRChat). Prefer a
              Desktop source if the buffer will not start.
            </p>
          </div>
        </div>

        <div className="clip-controls">
          <label className="field-label" htmlFor="clip-source">
            Video source
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

          <div className="clip-audio-block">
            <p className="field-label">Clip audio</p>
            <p className="muted">
              Choose which <strong>applications</strong> and <strong>microphones</strong> are mixed
              into the clip. App sound comes from the Blur / Hi-Fi Cable mix — keep the stream
              running and those apps routed in Mixer.
            </p>

            <div className="clip-audio-columns">
              <div className="clip-audio-column">
                <p className="field-label">Applications</p>
                {applications.length === 0 ? (
                  <p className="muted">No running apps found. Open a game, then refresh Mixer.</p>
                ) : (
                  <ul className="clip-audio-list">
                    {applications.map((app) => {
                      const checked = audioApplicationIds.includes(app.id)
                      return (
                        <li key={app.id}>
                          <label className="clip-audio-item">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isBusy || clipping}
                              onChange={(event) => toggleAudioApp(app.id, event.target.checked)}
                            />
                            <span>{app.displayName || app.processName || app.name}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <div className="clip-audio-column">
                <p className="field-label">Microphones</p>
                {clipMicrophones.length === 0 ? (
                  <p className="muted">No microphones found.</p>
                ) : (
                  <ul className="clip-audio-list">
                    {clipMicrophones.map((device) => {
                      const checked = audioMicrophoneIds.includes(device.id)
                      return (
                        <li key={device.id}>
                          <label className="clip-audio-item">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isBusy || clipping}
                              onChange={(event) => toggleAudioMic(device.id, event.target.checked)}
                            />
                            <span>{device.name}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>

            {audioApplicationIds.length === 0 && audioMicrophoneIds.length === 0 ? (
              <p className="muted clip-audio-warning">
                No clip audio selected — clips will be video-only until you check apps and/or mics.
              </p>
            ) : (
              <p className="muted">
                Recording:{' '}
                {audioApplicationIds.length > 0
                  ? `${audioApplicationIds.length} app${audioApplicationIds.length === 1 ? '' : 's'} (via Hi-Fi Cable)`
                  : 'no apps'}
                {' · '}
                {audioMicrophoneIds.length > 0
                  ? `${audioMicrophoneIds.length} mic${audioMicrophoneIds.length === 1 ? '' : 's'}`
                  : 'no mics'}
              </p>
            )}
          </div>

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

          <div className="clip-duration-block">
            <p className="field-label">Clip resolution</p>
            <div className="chip-row">
              {resolutionOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`chip-button${resolution === option ? ' active' : ''}`}
                  disabled={isBusy || clipping}
                  onClick={() => void setResolution(option as ClipResolution)}
                >
                  {CLIP_RESOLUTION_SPECS[option].label}
                </button>
              ))}
            </div>
            <p className="muted">
              Capture and encode at {CLIP_RESOLUTION_SPECS[resolution].label} (
              {CLIP_RESOLUTION_SPECS[resolution].width}×{CLIP_RESOLUTION_SPECS[resolution].height}).
              Changing this restarts the buffer if it is running.
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
            Starts with the app so Clip it and “clip it blur” are ready. Turn it off if you want to
            save GPU/CPU while only mixing.
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

          <label className="eq-toggle noise-toggle">
            <input
              type="checkbox"
              checked={voiceCommandsEnabled}
              disabled={clipping}
              onChange={(event) => void setVoiceCommandsEnabled(event.target.checked)}
            />
            <span className="eq-toggle-track" />
            <span>Voice clip commands</span>
          </label>
          <p className="muted">
            Say the full phrase <strong>clip it blur</strong> or <strong>blur clip it</strong>.
            Stopping after “clip it” will not save a clip. A toast pops up on the top-right when
            Blur hears the whole command. Windows speech uses your <strong>default recording
            mic</strong> (not Hi-Fi Cable) and needs an English speech pack.
          </p>
          <p className="muted">
            Voice listener:{' '}
            {status.voiceListener === 'ready'
              ? 'listening'
              : status.voiceListener === 'error'
                ? `error — ${status.voiceListenerError ?? 'check speech pack / default mic'}`
                : status.voiceListener === 'starting'
                  ? 'starting…'
                  : voiceCommandsEnabled
                    ? 'off'
                    : 'disabled'}
          </p>

          {error ? <p className="error-text">{error}</p> : null}
          {lastSavedPath ? (
            <p className="muted">
              Last clip: <code>{lastSavedPath}</code>
            </p>
          ) : null}
          <p className="muted">Clips build {CLIPS_PICKER_BUILD}</p>
        </div>
      </div>
    </section>
  )
})
