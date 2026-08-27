import { memo } from 'react'
import './App.css'
import logoUrl from './assets/logo.svg?url'
import { normalizeMicrophoneSlots, hasActiveMicrophoneSlot } from '../shared/microphoneSlots'
import type { AudioSnapshot } from '../shared/audioTypes'
import { HIFI_CABLE_QUALITY } from '../shared/hifiCable'
import { AppLibraryPanel } from './components/AppLibraryPanel'
import { AudioRoutingPanel } from './components/AudioRoutingPanel'
import { ClipRecordingPanel } from './components/ClipRecordingPanel'
import { ClipEditorPanel } from './components/ClipEditorPanel'
import { HifiSetupPanel } from './components/HifiSetupPanel'
import { VideoRecordingPanel } from './components/VideoRecordingPanel'
import { InputVolumeList } from './components/InputVolumeList'
import { NoiseSuppressionSection } from './components/NoiseSuppressionSection'
import { ClipRecorderProvider, useClipRecorderContext } from './context/ClipRecorderContext'
import { VideoRecorderProvider } from './context/VideoRecorderContext'
import { VideoEditorProvider } from './context/VideoEditorContext'
import { useAppSettings } from './hooks/useAppSettings'
import { useAudioControlState } from './hooks/useAudioControlState'
import { SidebarNav } from './layout/SidebarNav'

function shouldShowEngineNotice(engine: AudioSnapshot['engine']): boolean {
  if (!engine.message) {
    return false
  }

  // Start/error copy, plus Listen-through warnings while streaming.
  if (engine.state === 'error' || engine.state === 'starting') {
    return true
  }

  return (
    engine.state === 'running' &&
    /listen to this device|speakers will hear|asio bridge|direct mode|listening to hi-fi/i.test(
      engine.message,
    )
  )
}

/** Stable header label — live cable/output % belongs on meters, not this line. */
function getEngineStatusLabel(engine: AudioSnapshot['engine']): string {
  if (engine.state === 'starting') {
    return 'starting'
  }

  if (engine.state === 'error') {
    return 'error'
  }

  if (engine.hifiListenActive) {
    return engine.state === 'running' ? 'streaming · listening' : 'listening to cable'
  }

  if (engine.state === 'running') {
    return engine.hifiOutputActive === false ? 'running · output inactive' : 'streaming'
  }

  if (!engine.helperConnected) {
    return 'idle'
  }

  return engine.state === 'stopped' ? 'idle' : engine.state
}

function FeatureStatusStrip({
  isEngineActive,
  nsEnabledCount,
}: {
  isEngineActive: boolean
  nsEnabledCount: number
}) {
  const { status, clipIt, bufferingEnabled } = useClipRecorderContext()
  const clipping = status.bufferState === 'clipping'

  return (
    <div className="feature-status-strip panel">
      <div className="feature-status-item">
        <span className={`status-dot${isEngineActive ? '' : ' idle'}`} />
        <span>{isEngineActive ? 'Stream live' : 'Stream idle'}</span>
      </div>
      <div className="feature-status-item">
        <span className={`status-dot${nsEnabledCount > 0 ? '' : ' idle'}`} />
        <span>
          {nsEnabledCount > 0
            ? `Noise on · ${nsEnabledCount} mic${nsEnabledCount === 1 ? '' : 's'}`
            : 'Noise idle'}
        </span>
      </div>
      <div className="feature-status-item feature-status-clip">
        <span
          className={`status-dot${status.buffering || clipping ? '' : ' idle'}${clipping ? ' hot' : ''}`}
        />
        <span>
          {clipping
            ? 'Clipping…'
            : status.buffering
              ? `Clip buffer · ${Math.round(status.bufferedSeconds)}s`
              : bufferingEnabled
                ? 'Clip buffer arming'
                : 'Clip buffer off'}
        </span>
      </div>
      <button
        type="button"
        className="primary-button clip-it-button compact"
        disabled={!status.buffering || clipping}
        onClick={() => void clipIt()}
      >
        {clipping ? 'Clipping…' : 'Clip it'}
      </button>
    </div>
  )
}

const AppShell = memo(function AppShell() {
  const { activeSection, setActiveSection } = useAppSettings()
  const {
    snapshot,
    isLoading,
    error,
    microphoneDevices,
    recordingDevices,
    playbackDevices,
    updateSelection,
    selectMicrophoneSlot,
    ensureMicrophoneDevice,
    addMicrophoneSlotToSelection,
    removeMicrophoneSlotFromSelection,
    openHifiCablePlaybackSettings,
    openHifiCableRecordingSettings,
    applyHifiCableStudioSettings,
    probeHifiCable,
    setHifiListen,
    toggleRoute,
    setRouteVolume,
    setRouteEqualizer,
    setRouteMuted,
    setMicrophoneMuted,
    setMicrophoneVolume,
    setMicrophoneNoiseSuppression,
    setMicrophoneEqualizer,
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

  const nsEnabledCount = microphoneSlots.filter(
    (slot) => slot.deviceId && (slot.noiseSuppressionSettings?.enabled ?? slot.noiseSuppression),
  ).length

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
      noiseSuppression: slot.noiseSuppressionSettings?.enabled ?? slot.noiseSuppression ?? false,
      onSetMuted: (muted: boolean) => setMicrophoneMuted(slot.id, muted),
      onSetVolume: (volume: number) => setMicrophoneVolume(slot.id, volume),
    }))

  return (
    <div className="app-frame">
      <SidebarNav
        activeSection={activeSection}
        onSelect={(section) => void setActiveSection(section)}
        brandLogoUrl={logoUrl}
      />

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
              Mixer, noise suppression, and clips all stay active together — switch sections to edit
              them. Clean path: {HIFI_CABLE_QUALITY.label}.
            </p>
          </div>

          <div className="header-actions">
            <div className="status-card">
              <span className={`status-dot${isEngineActive ? '' : ' idle'}`} />
              <div className="status-card-copy">
                <strong>Audio Engine</strong>
                <p className="muted engine-status-line">
                  <span>{snapshot.engine.helperConnected ? 'Connected' : 'Offline'}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{getEngineStatusLabel(snapshot.engine)}</span>
                </p>
              </div>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void stopEngine()}
                disabled={isEngineBusy || !isEngineActive}
              >
                Stop
              </button>
              <button
                type="button"
                className="primary-button start-stream-button"
                onClick={() => void startEngine()}
                disabled={
                  isEngineBusy ||
                  isEngineActive ||
                  !snapshot.hifiCable.playbackReady ||
                  !snapshot.hifiCable.recordingReady
                }
                title={
                  isEngineActive
                    ? 'Stream is already running — press Stop to end it'
                    : !snapshot.hifiCable.playbackReady
                      ? 'Install or enable Hi-Fi Cable Input in Setup first'
                      : !snapshot.hifiCable.recordingReady
                        ? 'Enable Hi-Fi Cable Output under Windows Sound → Recording'
                        : 'Start the mix — meters and noise cleanup only move while streaming'
                }
              >
                {isEngineActive ? 'Streaming' : isEngineBusy ? 'Starting…' : 'Start stream'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void refreshSnapshot()}
                disabled={isEngineBusy}
              >
                Refresh
              </button>
            </div>
          </div>
        </header>

        <FeatureStatusStrip isEngineActive={isEngineActive} nsEnabledCount={nsEnabledCount} />

        <div className="notice-slot">
          {error ? <p className="notice error">{error}</p> : null}
          {shouldShowEngineNotice(snapshot.engine) ? (
            <p className={`notice${snapshot.engine.state === 'error' ? ' error' : ''}`}>
              {snapshot.engine.message}
            </p>
          ) : null}
          {!isInitialLoading && hasMixSources && !isEngineActive ? (
            <p className="notice">
              {!snapshot.hifiCable.playbackReady ? (
                <>
                  Hi-Fi Cable Input is missing or disabled — open <strong>Setup</strong>, install/enable
                  it, then click Refresh. Mic level meters stay at idle until the stream can start.
                </>
              ) : (
                <>
                  Stream is stopped — click <strong>Start stream</strong> so mic levels move when you
                  speak. Noise and clip settings can still be edited now.
                </>
              )}
            </p>
          ) : null}
        </div>
        {isInitialLoading ? (
          <section className="loading-shell panel">
            <div className="loading-copy">
              <p className="eyebrow">Loading</p>
              <h2>Scanning audio devices and apps</h2>
            </div>
          </section>
        ) : null}

        {activeSection === 'mixer' ? (
          <>
            <AudioRoutingPanel
              selection={snapshot.selection}
              microphoneDevices={microphoneDevices}
              playbackDevices={playbackDevices}
              recordingDevices={recordingDevices}
              engine={snapshot.engine}
              engineActive={isEngineActive}
              onSelectMicrophoneSlot={selectMicrophoneSlot}
              onAddMicrophoneSlot={addMicrophoneSlotToSelection}
              onRemoveMicrophoneSlot={removeMicrophoneSlotFromSelection}
              onSelectInput={(deviceId) => updateSelection('inputDeviceId', deviceId)}
              onSelectRecording={(deviceId) => updateSelection('recordingDeviceId', deviceId)}
              onOpenSetup={() => void setActiveSection('setup')}
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
          </>
        ) : null}

        {/* Stay mounted so EQ/ClearCast preset UI does not remount as Flat/suggested on tab change. */}
        {!isInitialLoading ? (
          <div
            className={activeSection === 'noise' ? undefined : 'section-hidden'}
            aria-hidden={activeSection !== 'noise'}
          >
            <NoiseSuppressionSection
              selectionMicrophones={snapshot.selection.microphones}
              microphoneDevices={microphoneDevices}
              microphoneLevel={snapshot.engine.microphoneLevel}
              engineActive={isEngineActive}
              isActive={activeSection === 'noise'}
              onEnsureDevice={ensureMicrophoneDevice}
              onChange={(slotId, settings) => setMicrophoneNoiseSuppression(slotId, settings)}
              onSelectDeviceForSlot={selectMicrophoneSlot}
              onSetEqualizer={setMicrophoneEqualizer}
              onRemoveSlot={removeMicrophoneSlotFromSelection}
            />
          </div>
        ) : null}

        {/* Heavy panels mount only while active — their state (clip buffer, in-progress
            recording, editor project + undo) lives in providers above, so nothing is lost
            on switch and no rendering/capture/decoding runs for inactive tabs. */}
        {activeSection === 'clips' ? (
          <ClipRecordingPanel
            isActive
            applications={snapshot.applications}
            microphoneDevices={microphoneDevices}
            onEnsureAppRouted={(appId) => void toggleRoute(appId, true)}
          />
        ) : null}
        {activeSection === 'record' ? <VideoRecordingPanel isActive /> : null}
        {activeSection === 'editor' ? <ClipEditorPanel isActive /> : null}

        {activeSection === 'setup' ? (
          <HifiSetupPanel
            selection={snapshot.selection}
            playbackDevices={playbackDevices}
            recordingDevices={recordingDevices}
            hifiCable={snapshot.hifiCable}
            engine={snapshot.engine}
            streamActive={isEngineActive}
            onApplyStudioSettings={() => void applyHifiCableStudioSettings()}
            onProbeHifiCable={probeHifiCable}
            onSetHifiListen={setHifiListen}
            onOpenPlaybackSettings={() => void openHifiCablePlaybackSettings()}
            onOpenRecordingSettings={() => void openHifiCableRecordingSettings()}
            onSelectInput={(deviceId) => updateSelection('inputDeviceId', deviceId)}
            onSelectRecording={(deviceId) => updateSelection('recordingDeviceId', deviceId)}
          />
        ) : null}
      </main>
    </div>
  )
})

function App() {
  return (
    <ClipRecorderProvider>
      <VideoRecorderProvider>
        <VideoEditorProvider>
          <AppShell />
        </VideoEditorProvider>
      </VideoRecorderProvider>
    </ClipRecorderProvider>
  )
}

export default App
