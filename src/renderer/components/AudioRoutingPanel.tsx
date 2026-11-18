import { memo } from 'react'
import type { AudioDevice, DeviceSelection, EngineStatus, MicrophoneSlot } from '../../shared/audioTypes'
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
  onSelectMicrophoneSlot: (slotId: string, deviceId: string) => Promise<void>
  onAddMicrophoneSlot: () => Promise<void>
  onRemoveMicrophoneSlot: (slotId: string) => Promise<void>
  onSelectInput: (deviceId: string) => Promise<void>
  onSelectRecording: (deviceId: string) => Promise<void>
  onOpenSetup: () => void
}

function AudioRoutingPanelInner({
  selection,
  microphoneDevices,
  playbackDevices,
  recordingDevices,
  engine,
  engineActive,
  onSelectMicrophoneSlot,
  onAddMicrophoneSlot,
  onRemoveMicrophoneSlot,
  onSelectInput,
  onSelectRecording,
  onOpenSetup,
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
  const hasSelectedMicrophone = microphoneSlots.some((slot) => Boolean(slot.deviceId))

  return (
    <section className="panel routing-section audio-routing-panel">
      <div className="panel-header routing-header">
        <div>
          <p className="eyebrow">Mixer</p>
          <h2>Route devices</h2>
          <p className="muted section-help">
            Choose the mic(s) and Hi-Fi Cable endpoints for this mix. Install and format Hi-Fi Cable
            in <strong>Setup</strong>.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={onOpenSetup}>
          Open Setup
        </button>
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
          <strong>Cable Input write level</strong>
          <p className="muted">
            Bytes actually written to Hi-Fi Cable Input. If this stays at 0 while sources are live,
            the mix is silent. If it moves but Discord is silent, check Output format / device
            selection (Pass-Through needs matching Input/Output rates).
          </p>
        </div>
        <LevelMeter
          level={engineActive ? (engine.outputPullLevel ?? 0) : 0}
          label="Hi-Fi Cable Input write level"
          idleLabel={!engineActive ? 'Start stream' : undefined}
        />
        {engineActive && engine.audioFormat?.outputBinding ? (
          <p className="muted device-footnote">Bound: {engine.audioFormat.outputBinding}</p>
        ) : null}
      </div>

      {showHifiRoutingHelp ? (
        <div className="routing-checklist">
          <strong>Hi-Fi Cable is live</strong>
          <p className="muted">
            Streaming clean {HIFI_CABLE_QUALITY.shortLabel} audio to Hi-Fi Cable Input. Other apps
            should capture from Hi-Fi Cable Output.
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
