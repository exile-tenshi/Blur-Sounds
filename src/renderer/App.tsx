import { memo } from 'react'
import './App.css'
import logoUrl from './assets/logo.svg?url'
import { normalizeMicrophoneSlots, hasActiveMicrophoneSlot } from '../shared/microphoneSlots'
import type { AudioSnapshot } from '../shared/audioTypes'
import { HIFI_CABLE_QUALITY } from '../shared/hifiCable'
import { AppLibraryPanel } from './components/AppLibraryPanel'
import { AudioRoutingPanel } from './components/AudioRoutingPanel'
import { ClipRecordingPanel } from './components/ClipRecordingPanel'
import { HifiSetupPanel } from './components/HifiSetupPanel'
import { InputVolumeList } from './components/InputVolumeList'
import { NoiseSuppressionSection } from './components/NoiseSuppressionSection'
import { ClipRecorderProvider, useClipRecorderContext } from './context/ClipRecorderContext'
import { useAppSettings } from './hooks/useAppSettings'
import { useAudioControlState } from './hooks/useAudioControlState'
import { SidebarNav } from './layout/SidebarNav'

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
      <div className="feature-status-item">
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
    toggleRoute,
    setRouteVolume,
    setRouteEqualizer,
    setRouteMuted,
    setMicrophoneMuted,
    setMicrophoneVolume,
    setMicrophoneNoiseSuppression,
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
              <button
                type="button"
                className="secondary-button"
                onClick={() => void stopEngine()}
                disabled={isEngineBusy}
              >
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

        {error ? <p className="notice error">{error}</p> : null}
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
        {!isInitialLoading && hasMixSources && !isEngineActive ? (
          <p className="notice">
            Stream is stopped. Click <strong>Start stream</strong> to send audio to Hi-Fi Cable Input.
            Noise and clip buffer can still be configured now.
          </p>
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

        {activeSection === 'noise' ? (
          <NoiseSuppressionSection
            selectionMicrophones={snapshot.selection.microphones}
            microphoneDevices={microphoneDevices}
            microphoneLevel={snapshot.engine.microphoneLevel}
            engineActive={isEngineActive}
            onEnsureDevice={ensureMicrophoneDevice}
            onChange={(slotId, settings) => setMicrophoneNoiseSuppression(slotId, settings)}
            onSelectDeviceForSlot={selectMicrophoneSlot}
            onRemoveSlot={removeMicrophoneSlotFromSelection}
          />
        ) : null}

        {/* Keep clip UI mounted so background buffer + hotkeys never stop when changing sections. */}
        <div className={activeSection === 'clips' ? undefined : 'section-hidden'} aria-hidden={activeSection !== 'clips'}>
          <ClipRecordingPanel isActive={activeSection === 'clips'} />
        </div>

        {activeSection === 'setup' ? (
          <HifiSetupPanel
            selection={snapshot.selection}
            playbackDevices={playbackDevices}
            recordingDevices={recordingDevices}
            hifiCable={snapshot.hifiCable}
            onApplyStudioSettings={() => void applyHifiCableStudioSettings()}
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
      <AppShell />
    </ClipRecorderProvider>
  )
}

export default App
