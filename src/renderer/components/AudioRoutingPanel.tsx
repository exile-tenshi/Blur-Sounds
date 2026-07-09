import { memo } from 'react'
import type { AudioDevice, DeviceSelection, EngineStatus, HifiCableInfo, MicrophoneSlot } from '../../shared/audioTypes'
import { groupMicrophoneDevices, groupPlaybackDevices, groupRecordingDevices } from '../../shared/deviceGroups'
import {
  describeInputDevice,
  describeMicrophoneDevice,
  describeRecordingDevice,
  findMatchingRecordingDevice,
  getMatchingRecordingDeviceName,
} from '../../shared/audioLabels'
import { normalizeMicrophoneSlots } from '../../shared/microphoneSlots'
import { getVoicemeeterRoutingSteps, isVoicemeeterInputDevice } from '../../shared/voicemeeterBus'
import {
  getHifiCableSelectionDefaults,
  getHifiCableSetupSteps,
  HIFI_CABLE_QUALITY,
  isHifiCablePlaybackDevice,
} from '../../shared/hifiCable'
import { DeviceSelect, findDevice } from './DeviceSelect'
import { LevelMeter } from './LevelMeter'

interface AudioRoutingPanelProps {
  selection: DeviceSelection
  microphoneDevices: AudioDevice[]
  playbackDevices: AudioDevice[]
  recordingDevices: AudioDevice[]
  engine: EngineStatus
  engineActive: boolean
  hifiCable: HifiCableInfo
  onApplyStudioSettings: () => void
  onOpenPlaybackSettings: () => void
  onOpenRecordingSettings: () => void
  onSelectMicrophoneSlot: (slotId: string, deviceId: string) => Promise<void>
  onAddMicrophoneSlot: () => Promise<void>
  onRemoveMicrophoneSlot: (slotId: string) => Promise<void>
  onSelectInput: (deviceId: string) => Promise<void>
  onSelectRecording: (deviceId: string) => Promise<void>
}

function AudioRoutingPanelInner({
  selection,
  microphoneDevices,
  playbackDevices,
  recordingDevices,
  engine,
  engineActive,
  hifiCable,
  onApplyStudioSettings,
  onOpenPlaybackSettings,
  onOpenRecordingSettings,
  onSelectMicrophoneSlot,
  onAddMicrophoneSlot,
  onRemoveMicrophoneSlot,
  onSelectInput,
  onSelectRecording,
}: AudioRoutingPanelProps) {
  const microphoneGroups = groupMicrophoneDevices(microphoneDevices)
  const inputGroups = groupPlaybackDevices(playbackDevices)
  const recordingGroups = groupRecordingDevices(recordingDevices)
  const microphoneSlots = normalizeMicrophoneSlots(selection)
  const selectedInput = findDevice(inputGroups, selection.inputDeviceId)
  const selectedRecording = findDevice(recordingGroups, selection.recordingDeviceId)
  const cableDefaults = getHifiCableSelectionDefaults([...playbackDevices, ...recordingDevices])
  const suggestedRecordingDevice = selectedInput
    ? findMatchingRecordingDevice(selectedInput.name, recordingDevices)
    : undefined
  const recordingDeviceName =
    selectedRecording?.name ??
    suggestedRecordingDevice?.name ??
    (selectedInput ? getMatchingRecordingDeviceName(selectedInput.name) : cableDefaults.recordingDeviceName)
  const showVoicemeeterRoutingHelp =
    selectedInput &&
    isVoicemeeterInputDevice(selectedInput.name) &&
    engineActive &&
    engine.selectedInputReady
  const showHifiRoutingHelp =
    selectedInput &&
    isHifiCablePlaybackDevice(selectedInput.name) &&
    engineActive &&
    engine.selectedInputReady
  const voicemeeterRoutingSteps = selectedInput
    ? getVoicemeeterRoutingSteps(selectedInput.name, recordingDeviceName)
    : []
  const hifiSetupSteps = getHifiCableSetupSteps()
  const hasSelectedMicrophone = microphoneSlots.some((slot) => Boolean(slot.deviceId))

  return (
    <section className="panel routing-section audio-routing-panel">
      <div className="panel-header routing-header">
        <div>
          <p className="eyebrow">Audio route</p>
          <h2>Microphone → Hi-Fi Cable Input → Hi-Fi Cable Output</h2>
          <p className="muted section-help">
            Blur Sounds uses VB-Audio Hi-Fi Cable only. Configure both sides to{' '}
            {HIFI_CABLE_QUALITY.label} for clean routing.
          </p>
        </div>
      </div>

      <div className="cable-product-summary">
        <strong>Hi-Fi Cable route</strong>
        <p className="muted">
          Input → <span>{selectedInput?.name ?? cableDefaults.inputDeviceName}</span> · Recording →{' '}
          <span>{selectedRecording?.name ?? cableDefaults.recordingDeviceName}</span> · {hifiCable.formatSpec}
        </p>
        {hifiCable.playbackFormatLabel || hifiCable.recordingFormatLabel ? (
          <ul className="hifi-format-status">
            <li className={hifiCable.playbackAtStudioQuality ? 'is-ready' : 'needs-attention'}>
              Input: {hifiCable.playbackFormatLabel ?? 'unknown'}
              {hifiCable.playbackAtStudioQuality ? ' · ready' : ''}
            </li>
            <li className={hifiCable.recordingAtStudioQuality ? 'is-ready' : 'needs-attention'}>
              Output: {hifiCable.recordingFormatLabel ?? 'unknown'}
              {hifiCable.recordingAtStudioQuality ? ' · ready' : ''}
            </li>
          </ul>
        ) : null}
        <div className="button-row hifi-settings-buttons">
          <button type="button" className="primary-button" onClick={onApplyStudioSettings}>
            Apply clean audio settings
          </button>
          <button type="button" className="secondary-button" onClick={onOpenPlaybackSettings}>
            Open Playback sound settings
          </button>
          <button type="button" className="secondary-button" onClick={onOpenRecordingSettings}>
            Open Recording sound settings
          </button>
        </div>
      </div>

      <div className="routing-checklist hifi-setup-checklist">
        <strong>Hi-Fi Cable setup</strong>
        <p className="muted">
          Click <strong>Apply clean audio settings</strong> to reset Hi-Fi Cable Input and Output to{' '}
          <strong>{HIFI_CABLE_QUALITY.label}</strong> with exclusive mode enabled. Use the buttons
          below to verify in Windows Sound if needed.
        </p>
        <ol>
          {hifiSetupSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="routing-flow">
        <article className="device-card">
          <div className="device-card-heading mic-card-heading">
            <div>
              <span className="device-kind-badge recording">Microphone</span>
              <h3>Microphone</h3>
            </div>
            <button
              type="button"
              className="icon-button add-mic-button"
              onClick={() => void onAddMicrophoneSlot()}
              aria-label="Add microphone"
              title="Add microphone"
            >
              +
            </button>
          </div>
          <p className="muted device-help">What you speak into. Add more microphones with +.</p>

          <div className="mic-slot-list">
            {microphoneSlots.map((slot, index) => (
              <MicrophoneSlotRow
                key={slot.id}
                slot={slot}
                index={index}
                totalSlots={microphoneSlots.length}
                microphoneGroups={microphoneGroups}
                onSelect={(deviceId) => void onSelectMicrophoneSlot(slot.id, deviceId)}
                onRemove={() => void onRemoveMicrophoneSlot(slot.id)}
              />
            ))}
          </div>

          <p className="muted device-status">
            {engineActive
              ? hasSelectedMicrophone
                ? engine.selectedMicrophoneReady
                  ? 'listening'
                  : 'waiting'
                : 'no microphone selected'
              : 'stopped'}
          </p>
        </article>

        <div className="routing-arrow" aria-hidden="true">
          <span>→</span>
        </div>

        <article className="device-card">
          <div className="device-card-heading">
            <span className="device-kind-badge playback">Input</span>
            <h3>Hi-Fi Cable Input</h3>
          </div>
          <p className="muted device-help">Where the mix is sent (Windows Sound → Playback).</p>
          <label className="field">
            <span>Device</span>
            <DeviceSelect
              value={selection.inputDeviceId ?? ''}
              groups={inputGroups}
              placeholder="Choose Hi-Fi Cable Input"
              onChange={(deviceId) => void onSelectInput(deviceId)}
            />
          </label>
          {selectedInput ? (
            <p className="muted device-footnote">{describeInputDevice(selectedInput.name)}</p>
          ) : null}
          <p className="muted device-status">
            {engineActive ? (engine.selectedInputReady ? 'sending' : 'waiting') : 'stopped'}
          </p>
        </article>

        <div className="routing-arrow" aria-hidden="true">
          <span>→</span>
        </div>

        <article className="device-card routing-output-card">
          <div className="device-card-heading">
            <span className="device-kind-badge recording">Recording</span>
            <h3>Hi-Fi Cable Output</h3>
          </div>
          <p className="muted device-help">What other apps listen on — the output of this route.</p>
          <label className="field">
            <span>Device</span>
            <DeviceSelect
              value={selection.recordingDeviceId ?? ''}
              groups={recordingGroups}
              placeholder="Choose Hi-Fi Cable Output"
              onChange={(deviceId) => void onSelectRecording(deviceId)}
            />
          </label>
          {selectedRecording ? (
            <p className="muted device-footnote">{describeRecordingDevice(selectedRecording.name)}</p>
          ) : recordingDeviceName ? (
            <p className="muted device-footnote">Suggested: {recordingDeviceName}</p>
          ) : (
            <p className="muted device-footnote">Select Hi-Fi Cable Output for other apps to listen on.</p>
          )}
        </article>
      </div>

      <div className="playback-meter">
        <div className="playback-meter-copy">
          <strong>Transport level</strong>
          <p className="muted">
            Level being sent from the mix to Hi-Fi Cable Input. Blur Sounds also opens Hi-Fi Cable
            Output while streaming so other apps can capture it.
          </p>
        </div>
        <LevelMeter
          level={
            engineActive
              ? Math.max(engine.outputPullLevel ?? 0, engine.mixPullLevel ?? 0, engine.outputLevel)
              : 0
          }
          label="Route output level"
        />
      </div>

      {showHifiRoutingHelp ? (
        <div className="routing-checklist">
          <strong>Hi-Fi Cable is live</strong>
          <p className="muted">
            Blur Sounds streams clean {HIFI_CABLE_QUALITY.shortLabel} audio to your Hi-Fi Cable Input. Other apps should
            capture from Hi-Fi Cable Output at {HIFI_CABLE_QUALITY.label}.
          </p>
        </div>
      ) : null}

      {showVoicemeeterRoutingHelp ? (
        <div className="routing-checklist">
          <strong>Voicemeeter routing required</strong>
          <p className="muted">
            Playback shows signal on your Input, but Recording devices stay silent until Voicemeeter
            routes that strip to the output bus.
          </p>
          <ol>
            {voicemeeterRoutingSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}

function MicrophoneSlotRow({
  slot,
  index,
  totalSlots,
  microphoneGroups,
  onSelect,
  onRemove,
}: {
  slot: MicrophoneSlot
  index: number
  totalSlots: number
  microphoneGroups: ReturnType<typeof groupMicrophoneDevices>
  onSelect: (deviceId: string) => void
  onRemove: () => void
}) {
  const selectedMicrophone = findDevice(microphoneGroups, slot.deviceId)

  return (
    <div className="mic-slot-row">
      <label className="field mic-slot-field">
        <span>{totalSlots > 1 ? `Mic ${index + 1}` : 'Device'}</span>
        <DeviceSelect
          value={slot.deviceId ?? ''}
          groups={microphoneGroups}
          placeholder="Choose a microphone"
          onChange={onSelect}
        />
      </label>
      <button
        type="button"
        className="icon-button remove-mic-button"
        onClick={onRemove}
        aria-label={totalSlots > 1 ? `Remove microphone ${index + 1}` : 'Clear microphone'}
        title={totalSlots > 1 ? 'Remove microphone' : 'Clear microphone'}
      >
        ×
      </button>
      {selectedMicrophone ? (
        <p className="muted device-footnote mic-slot-footnote">
          {describeMicrophoneDevice(selectedMicrophone.name)}
        </p>
      ) : null}
    </div>
  )
}

export const AudioRoutingPanel = memo(AudioRoutingPanelInner)
