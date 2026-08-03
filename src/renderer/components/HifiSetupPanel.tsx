import type { AudioDevice, DeviceSelection, HifiCableInfo } from '../../shared/audioTypes'
import { groupPlaybackDevices, groupRecordingDevices } from '../../shared/deviceGroups'
import {
  formatHifiCableDisabledMessage,
  getHifiCableSelectionDefaults,
  getHifiCableSetupSteps,
  HIFI_CABLE_DOWNLOAD_URL,
  HIFI_CABLE_QUALITY,
} from '../../shared/hifiCable'
import { DeviceSelect, findDevice } from './DeviceSelect'

interface HifiSetupPanelProps {
  selection: DeviceSelection
  playbackDevices: AudioDevice[]
  recordingDevices: AudioDevice[]
  hifiCable: HifiCableInfo
  onApplyStudioSettings: () => void
  onOpenPlaybackSettings: () => void
  onOpenRecordingSettings: () => void
  onSelectInput: (deviceId: string) => Promise<void>
  onSelectRecording: (deviceId: string) => Promise<void>
}

export function HifiSetupPanel({
  selection,
  playbackDevices,
  recordingDevices,
  hifiCable,
  onApplyStudioSettings,
  onOpenPlaybackSettings,
  onOpenRecordingSettings,
  onSelectInput,
  onSelectRecording,
}: HifiSetupPanelProps) {
  const inputGroups = groupPlaybackDevices(playbackDevices)
  const recordingGroups = groupRecordingDevices(recordingDevices)
  const selectedInput = findDevice(inputGroups, selection.inputDeviceId)
  const selectedRecording = findDevice(recordingGroups, selection.recordingDeviceId)
  const cableDefaults = getHifiCableSelectionDefaults([...playbackDevices, ...recordingDevices])
  const setupSteps = getHifiCableSetupSteps()

  return (
    <section className="panel routing-section hifi-setup-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Setup</p>
          <h2>Hi-Fi Cable</h2>
          <p className="section-help">
            Microphone → Hi-Fi Cable Input → Hi-Fi Cable Output. Blur Sounds requires VB-Audio Hi-Fi
            Cable & ASIO Bridge at {HIFI_CABLE_QUALITY.label}.
          </p>
        </div>
      </div>

      {!hifiCable.installed ? (
        <div className="notice dependency-notice">
          <strong>VB-Audio Hi-Fi Cable required</strong>
          <p>
            Expected devices: Input → <strong>{cableDefaults.inputDeviceName}</strong> · Recording →{' '}
            <strong>{cableDefaults.recordingDeviceName}</strong>.
          </p>
        </div>
      ) : null}
      {hifiCable.installed && !hifiCable.playbackReady ? (
        <div className="notice dependency-notice">
          <strong>Hi-Fi Cable is disabled</strong>
          <p>{formatHifiCableDisabledMessage()}</p>
        </div>
      ) : null}

      <div className="cable-product-summary">
        <strong>Hi-Fi Cable route</strong>
        <p className="muted">
          Input → <span>{selectedInput?.name ?? cableDefaults.inputDeviceName}</span> · Recording →{' '}
          <span>{selectedRecording?.name ?? cableDefaults.recordingDeviceName}</span> ·{' '}
          {hifiCable.formatSpec}
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

        <div className="routing-flow setup-device-flow">
          <label className="field">
            <span>Hi-Fi Cable Input (Playback)</span>
            <DeviceSelect
              value={selection.inputDeviceId ?? ''}
              groups={inputGroups}
              placeholder="Choose Hi-Fi Cable Input"
              onChange={(deviceId) => void onSelectInput(deviceId)}
            />
          </label>
          <label className="field">
            <span>Hi-Fi Cable Output (Recording)</span>
            <DeviceSelect
              value={selection.recordingDeviceId ?? ''}
              groups={recordingGroups}
              placeholder="Choose Hi-Fi Cable Output"
              onChange={(deviceId) => void onSelectRecording(deviceId)}
            />
          </label>
        </div>

        <div className="button-row hifi-settings-buttons">
          <a
            className="secondary-button dependency-download"
            href={HIFI_CABLE_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
          >
            Download Hi-Fi Cable & ASIO Bridge
          </a>
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
          above to verify in Windows Sound if needed.
        </p>
        <ol>
          {setupSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </section>
  )
}
