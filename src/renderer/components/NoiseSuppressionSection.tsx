import { useEffect, useMemo, useRef, useState } from 'react'
import {
  applyNoisePreset,
  detectNoiseMicKind,
  micKindLabel,
  presetsForMic,
  recommendedPresetForMic,
} from '../../shared/noisePresets'
import { normalizeNoiseSuppression, type NoiseSuppressionSettings } from '../../shared/noiseSuppression'
import type { AudioDevice, MicrophoneSlot } from '../../shared/audioTypes'
import { normalizeMicrophoneSlots } from '../../shared/microphoneSlots'
import { LevelMeter } from './LevelMeter'

interface NoiseSuppressionSectionProps {
  selectionMicrophones: MicrophoneSlot[] | undefined
  microphoneDevices: AudioDevice[]
  microphoneLevel: number
  engineActive: boolean
  onEnsureDevice: (deviceId: string) => Promise<string | undefined>
  onChange: (slotId: string, settings: Partial<NoiseSuppressionSettings>) => Promise<void>
  onSelectDeviceForSlot: (slotId: string, deviceId: string) => Promise<void>
  onRemoveSlot?: (slotId: string) => Promise<void>
}

function PercentSlider({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const [localValue, setLocalValue] = useState(value)
  const localValueRef = useRef(value)
  const isDraggingRef = useRef(false)

  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(value)
      localValueRef.current = value
    }
  }, [value])

  const commitValue = (nextValue: number) => {
    localValueRef.current = nextValue
    onChange(nextValue)
  }

  return (
    <label className={`ns-slider sonar-strength${disabled ? ' disabled' : ''}`}>
      <span>
        {label}
        <strong>{localValue}</strong>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={localValue}
        disabled={disabled}
        onPointerDown={() => {
          isDraggingRef.current = true
        }}
        onPointerUp={() => {
          isDraggingRef.current = false
          commitValue(localValueRef.current)
        }}
        onPointerCancel={() => {
          isDraggingRef.current = false
          commitValue(localValueRef.current)
        }}
        onChange={(event) => {
          const nextValue = Number(event.target.value)
          localValueRef.current = nextValue
          setLocalValue(nextValue)
        }}
      />
    </label>
  )
}

function MicNoiseCard({
  slot,
  deviceName,
  devices,
  inUse,
  microphoneLevel,
  engineActive,
  onChange,
  onSelectDevice,
}: {
  slot: MicrophoneSlot
  deviceName: string
  devices: AudioDevice[]
  inUse: boolean
  microphoneLevel: number
  engineActive: boolean
  onChange: (settings: Partial<NoiseSuppressionSettings>) => Promise<void>
  onSelectDevice: (deviceId: string) => Promise<void>
}) {
  const settings = normalizeNoiseSuppression(slot.noiseSuppressionSettings ?? slot.noiseSuppression)
  const kind = detectNoiseMicKind(deviceName)
  const presets = presetsForMic(deviceName)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [activePresetId, setActivePresetId] = useState<string | null>(null)

  return (
    <article className={`noise-mic-card sonar-card${settings.enabled ? ' ns-on' : ''}${inUse ? ' in-use' : ''}`}>
      <div className="sonar-card-top">
        <div className="sonar-card-identity">
          <p className="eyebrow">{micKindLabel(kind)}</p>
          <h3>{deviceName || 'Select a microphone'}</h3>
          <p className="muted">
            RNNoise neural cleanup
            {settings.enabled ? ' · on' : ' · off'}
            {settings.noiseGateEnabled ? ' · gate' : ''}
          </p>
        </div>
        <label className="eq-toggle noise-toggle sonar-power">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={!slot.deviceId}
            onChange={(event) => {
              setActivePresetId(null)
              if (event.target.checked) {
                void onChange({ enabled: true })
              } else {
                // Full bypass — gate must also turn off or audio still ducks in/out.
                void onChange({ enabled: false, noiseGateEnabled: false })
              }
            }}
          />
          <span className="eq-toggle-track" />
          <span>{settings.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      <label className="field-label" htmlFor={`ns-device-${slot.id}`}>
        Device
      </label>
      <select
        id={`ns-device-${slot.id}`}
        value={slot.deviceId ?? ''}
        onChange={(event) => {
          setActivePresetId(null)
          void onSelectDevice(event.target.value)
        }}
      >
        <option value="">Select a microphone…</option>
        {devices.map((device) => (
          <option key={device.id} value={device.id} disabled={!device.isAvailable}>
            {device.name}
            {device.isDefault ? ' (default)' : ''}
            {!device.isAvailable ? ' (offline)' : ''}
          </option>
        ))}
      </select>

      <div className="sonar-meter-row">
        <LevelMeter
          level={engineActive && !slot.muted ? microphoneLevel : 0}
          label={`${deviceName || 'Microphone'} level`}
          idleLabel={
            !engineActive ? 'Start stream' : slot.muted ? 'Paused' : !slot.deviceId ? 'Pick mic' : undefined
          }
        />
      </div>

      <PercentSlider
        label="Strength"
        value={settings.strength}
        disabled={!settings.enabled || !slot.deviceId}
        onChange={(strength) => {
          setActivePresetId(null)
          void onChange({ strength })
        }}
      />

      <div className="noise-preset-row sonar-presets">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.hint}
            className={`chip-button${activePresetId === preset.id ? ' active' : ''}`}
            disabled={!slot.deviceId}
            onClick={() => {
              setActivePresetId(preset.id)
              void onChange(applyNoisePreset(preset))
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <p className="muted sonar-preset-hint">
        {presets.find((preset) => preset.id === activePresetId)?.hint ??
          'Pick a preset for your mic type. VR headsets get stronger fan cleanup.'}
      </p>

      <button
        type="button"
        className="secondary-button sonar-advanced-toggle"
        onClick={() => setShowAdvanced((value) => !value)}
      >
        {showAdvanced ? 'Hide gate' : 'Noise gate'}
      </button>

      {showAdvanced ? (
        <div className="noise-gate-block">
          <label className="eq-toggle noise-toggle">
            <input
              type="checkbox"
              checked={settings.noiseGateEnabled}
              disabled={!slot.deviceId}
              onChange={(event) => {
                setActivePresetId(null)
                void onChange({ noiseGateEnabled: event.target.checked })
              }}
            />
            <span className="eq-toggle-track" />
            <span>Hard mute when silent</span>
          </label>
          <PercentSlider
            label="Gate threshold"
            value={settings.noiseGateThreshold}
            disabled={!settings.noiseGateEnabled || !slot.deviceId}
            onChange={(noiseGateThreshold) => {
              setActivePresetId(null)
              void onChange({ noiseGateThreshold })
            }}
          />
          <p className="muted">Optional. Leave off if it clips the start of words.</p>
        </div>
      ) : null}
    </article>
  )
}

export function NoiseSuppressionSection({
  selectionMicrophones,
  microphoneDevices,
  microphoneLevel,
  engineActive,
  onEnsureDevice,
  onChange,
  onSelectDeviceForSlot,
}: NoiseSuppressionSectionProps) {
  const slots = useMemo(
    () => normalizeMicrophoneSlots({ microphones: selectionMicrophones }),
    [selectionMicrophones],
  )
  const trackedSlots = slots.filter((slot) => slot.deviceId)
  const primarySlot = trackedSlots[0] ?? slots[0]
  const [autoTrackedDefault, setAutoTrackedDefault] = useState(false)

  useEffect(() => {
    if (autoTrackedDefault || trackedSlots.length > 0 || microphoneDevices.length === 0) {
      return
    }

    const preferred =
      microphoneDevices.find((device) => device.isDefault && device.isAvailable) ??
      microphoneDevices.find((device) => device.isAvailable) ??
      microphoneDevices[0]

    if (!preferred) {
      return
    }

    setAutoTrackedDefault(true)
    const preset = recommendedPresetForMic(preferred.name)
    void onEnsureDevice(preferred.id).then(async (slotId) => {
      if (slotId) {
        await onChange(slotId, applyNoisePreset(preset))
      }
    })
  }, [autoTrackedDefault, microphoneDevices, onChange, onEnsureDevice, trackedSlots.length])

  return (
    <section className="panel noise-editor sonar-noise">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Noise</p>
          <h2>Noise cancellation</h2>
          <p className="section-help">
            Neural cleanup tuned per mic type (VR headsets, gaming headsets, USB, broadcast). Off means
            fully bypassed — no processing.
          </p>
        </div>
      </div>

      {!engineActive ? (
        <p className="notice">
          Stream is idle — pick a preset, then press <strong>Start stream</strong>.
        </p>
      ) : null}

      <div className="noise-mic-list">
        {!primarySlot ? (
          <p className="empty-state">No microphone hardware detected yet. Click Refresh.</p>
        ) : (
          <MicNoiseCard
            slot={primarySlot}
            deviceName={
              microphoneDevices.find((item) => item.id === primarySlot.deviceId)?.name ??
              (primarySlot.deviceId ? 'Unknown microphone' : '')
            }
            devices={microphoneDevices}
            inUse={Boolean(primarySlot.deviceId) && engineActive && !primarySlot.muted}
            microphoneLevel={microphoneLevel}
            engineActive={engineActive}
            onChange={(settings) => onChange(primarySlot.id, settings)}
            onSelectDevice={(deviceId) => onSelectDeviceForSlot(primarySlot.id, deviceId)}
          />
        )}
      </div>
    </section>
  )
}
