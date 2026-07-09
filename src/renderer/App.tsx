import './App.css'
import logoUrl from './assets/logo.svg?url'
import { normalizeMicrophoneSlots, hasActiveMicrophoneSlot } from '../shared/microphoneSlots'
import type { AudioSnapshot } from '../shared/audioTypes'
import {
  formatHifiCableDisabledMessage,
  getHifiCableSelectionDefaults,
  getHifiCableSetupSteps,
  HIFI_CABLE_QUALITY,
} from '../shared/hifiCable'
import { AppLibraryPanel } from './components/AppLibraryPanel'
import { AudioRoutingPanel } from './components/AudioRoutingPanel'
import { InputVolumeList } from './components/InputVolumeList'
import { useAudioControlState } from './hooks/useAudioControlState'

function shouldShowEngineNotice(engine: AudioSnapshot['engine']): boolean {
  if (!engine.message) {
    return false
  }

  return engine.state === 'error' || engine.state === 'starting' || engine.state === 'running'
}

function getEngineStatusLabel(engine: AudioSnapshot['engine']): string {
  if (!engine.helperConnected && engine.state === 'stopped') {
    return 'idle — click Start stream'
  }

  return engine.state
}

function App() {
  const {
    snapshot,
    isLoading,
    error,
    microphoneDevices,
    recordingDevices,
    playbackDevices,
    updateSelection,
    selectMicrophoneSlot,
    addMicrophoneSlotToSelection,
    removeMicrophoneSlotFromSelection,
    openHifiCablePlaybackSettings,
    openHifiCableRecordingSettings,
    applyHifiCableStudioSettings,
    toggleRoute,
    setRouteVolume,
    setRouteEqualizer,
    setRouteMuted,
    setMicrophoneMuted,
    setMicrophoneVolume,
    refreshSnapshot,
    startEngine,
    stopEngine,
    isEngineBusy,
  } = useAudioControlState()

  const isInitialLoading = isLoading && snapshot.devices.length === 0 && snapshot.applications.length === 0

  const isEngineActive =
    snapshot.engine.helperConnected &&
    (snapshot.engine.state === 'running' || snapshot.engine.state === 'starting')

  const microphoneSlots = normalizeMicrophoneSlots(snapshot.selection)

  const hasMixSources =
    hasActiveMicrophoneSlot(microphoneSlots) ||
    snapshot.routedInputs.some((route) => route.target === 'hifi-cable')

  const microphoneSources = microphoneSlots
    .filter((slot) => slot.deviceId)
    .map((slot) => ({
      slotId: slot.id,
      name:
        snapshot.devices.find((device) => device.id === slot.deviceId)?.name ??
        microphoneDevices.find((device) => device.id === slot.deviceId)?.name,
      level: snapshot.engine.microphoneLevel,
      ready: snapshot.engine.selectedMicrophoneReady,
      muted: slot.muted,
      volume: slot.volume,
      onSetMuted: (muted: boolean) => setMicrophoneMuted(slot.id, muted),
      onSetVolume: (volume: number) => setMicrophoneVolume(slot.id, volume),
    }))

  const cableDefaults = getHifiCableSelectionDefaults(snapshot.devices)
  const setupSteps = getHifiCableSetupSteps()

  return (
    <main className="shell">
      <header className="hero-header panel">
        <div>
          <div className="brand-lockup">
            <img className="brand-logo" src={logoUrl} alt="" />
            <div>
              <p className="eyebrow">Blur Sounds</p>
              <h1>Studio-quality audio through Hi-Fi Cable.</h1>
            </div>
          </div>
          <p className="hero-copy">
            Capture your microphone, mix in app audio, and send everything through VB-Audio Hi-Fi Cable
            at {HIFI_CABLE_QUALITY.label}.
          </p>
        </div>

        <div className="header-actions">
          <div className="status-card">
            <span className="status-dot" />
            <div>
              <strong>Audio Engine</strong>
              <p className="muted">
                {snapshot.engine.helperConnected ? 'Connected' : 'Offline'} ·{' '}
                {getEngineStatusLabel(snapshot.engine)} · output{' '}
                {Math.round(snapshot.engine.outputLevel * 100)}%
              </p>
            </div>
          </div>
          <div className="button-row">
            <button type="button" className="secondary-button" onClick={() => void stopEngine()} disabled={isEngineBusy}>
              Stop
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void startEngine()}
              disabled={isEngineBusy || !snapshot.hifiCable.playbackReady}
            >
              {isEngineBusy ? 'Starting...' : 'Start stream'}
            </button>
            <button type="button" className="secondary-button" onClick={() => void refreshSnapshot()} disabled={isEngineBusy}>
              Refresh
            </button>
          </div>
        </div>
      </header>

      {error ? <p className="notice error">{error}</p> : null}
      {!isInitialLoading && !snapshot.hifiCable.installed ? (
        <div className="notice dependency-notice">
          <strong>VB-Audio Hi-Fi Cable required</strong>
          <p>
            Blur Sounds requires{' '}
            <a href={snapshot.hifiCable.productUrl} target="_blank" rel="noreferrer">
              VB-Audio Hi-Fi Cable
            </a>
            . Download and install it, reboot if prompted, then click Refresh. Expected devices: Input →{' '}
            <strong>{cableDefaults.inputDeviceName}</strong> · Recording →{' '}
            <strong>{cableDefaults.recordingDeviceName}</strong>.
          </p>
          <div className="button-row hifi-settings-buttons">
            <a className="secondary-button dependency-download" href={snapshot.hifiCable.downloadUrl} target="_blank" rel="noreferrer">
              Download Hi-Fi Cable
            </a>
            <button type="button" className="primary-button" onClick={() => void applyHifiCableStudioSettings()}>
              Apply clean audio settings
            </button>
            <button type="button" className="secondary-button" onClick={() => void openHifiCablePlaybackSettings()}>
              Open Playback settings
            </button>
            <button type="button" className="secondary-button" onClick={() => void openHifiCableRecordingSettings()}>
              Open Recording settings
            </button>
          </div>
          <ol className="hifi-setup-steps-compact">
            {setupSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {!isInitialLoading && snapshot.hifiCable.installed && !snapshot.hifiCable.playbackReady ? (
        <div className="notice dependency-notice">
          <strong>Hi-Fi Cable is disabled</strong>
          <p>{formatHifiCableDisabledMessage()}</p>
          {snapshot.hifiCable.playbackDevices.length > 0 ? (
            <p>
              Detected:{' '}
              <strong>{snapshot.hifiCable.playbackDevices.join(', ')}</strong>
            </p>
          ) : null}
          <div className="button-row hifi-settings-buttons">
            <button type="button" className="primary-button" onClick={() => void refreshSnapshot()}>
              Refresh
            </button>
            <button type="button" className="secondary-button" onClick={() => void openHifiCablePlaybackSettings()}>
              Open Playback settings
            </button>
            <button type="button" className="secondary-button" onClick={() => void openHifiCableRecordingSettings()}>
              Open Recording settings
            </button>
          </div>
        </div>
      ) : null}
      {!isInitialLoading && snapshot.hifiCable.playbackReady && !snapshot.hifiCable.recordingReady ? (
        <p className="notice">
          Hi-Fi Cable Input is ready, but Hi-Fi Cable Output was not detected. Install the recording side,
          then click Refresh.
        </p>
      ) : null}
      {!isInitialLoading && hasMixSources && !isEngineActive ? (
        <p className="notice">
          Stream is stopped. Click <strong>Start stream</strong> to send audio to Hi-Fi Cable Input.
        </p>
      ) : null}
      {isInitialLoading ? (
        <section className="loading-shell panel">
          <div className="loading-copy">
            <p className="eyebrow">Loading</p>
            <h2>Scanning audio devices and apps</h2>
          </div>
        </section>
      ) : null}
      {shouldShowEngineNotice(snapshot.engine) ? (
        <p className={`notice${snapshot.engine.state === 'error' ? ' error' : ''}`}>
          {snapshot.engine.message}
        </p>
      ) : null}

      <AudioRoutingPanel
        selection={snapshot.selection}
        microphoneDevices={microphoneDevices}
        playbackDevices={playbackDevices}
        recordingDevices={recordingDevices}
        engine={snapshot.engine}
        engineActive={isEngineActive}
        hifiCable={snapshot.hifiCable}
        onApplyStudioSettings={() => void applyHifiCableStudioSettings()}
        onOpenPlaybackSettings={() => void openHifiCablePlaybackSettings()}
        onOpenRecordingSettings={() => void openHifiCableRecordingSettings()}
        onSelectMicrophoneSlot={selectMicrophoneSlot}
        onAddMicrophoneSlot={addMicrophoneSlotToSelection}
        onRemoveMicrophoneSlot={removeMicrophoneSlotFromSelection}
        onSelectInput={(deviceId) => updateSelection('inputDeviceId', deviceId)}
        onSelectRecording={(deviceId) => updateSelection('recordingDeviceId', deviceId)}
      />

      <section className="content-grid two-up">
        <AppLibraryPanel
          applications={snapshot.applications}
          routedInputs={snapshot.routedInputs}
          sessionLevels={snapshot.engine.sessionLevels}
          engineActive={isEngineActive}
          onToggleRoute={toggleRoute}
          onToggleRouteMuted={setRouteMuted}
        />

        <InputVolumeList
          routes={snapshot.routedInputs}
          applications={snapshot.applications}
          microphoneSources={microphoneSources}
          engineActive={isEngineActive}
          onSetRouteVolume={setRouteVolume}
          onSetRouteEqualizer={setRouteEqualizer}
          onSetRouteMuted={setRouteMuted}
          onRemoveRoute={(appId) => toggleRoute(appId, false)}
        />
      </section>
    </main>
  )
}

export default App
