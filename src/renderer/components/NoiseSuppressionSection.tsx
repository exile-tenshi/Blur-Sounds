import { useMemo, useState } from 'react'
import {
  DEFAULT_NOISE_SUPPRESSION,
  type NoiseSuppressionSettings,
} from '../../shared/noiseSuppression'
import type { AudioDevice, MicrophoneSlot } from '../../shared/audioTypes'
import { normalizeMicrophoneSlots } from '../../shared/microphoneSlots'
import { LevelMeter } from './LevelMeter'

interface NoiseSuppressionSectionProps {
  selectionMicrophones: MicrophoneSlot[] | undefined
  microphoneDevices: AudioDevice[]
  microphoneLevel: number
  engineActive: boolean
  onChange: (slotId: string, settings: Partial<NoiseSuppressionSettings>) => Promise<void>
}

function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className={`ns-slider${disabled ? ' disabled' : ''}`}>
      <span>
        {label}
        <strong>
          {value}
          {suffix ?? ''}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

export function NoiseSuppressionSection({
  selectionMicrophones,
  microphoneDevices,
  microphoneLevel,
  engineActive,
  onChange,
}: NoiseSuppressionSectionProps) {
  const slots = useMemo(
    () => normalizeMicrophoneSlots({ microphones: selectionMicrophones }),
    [selectionMicrophones],
  )
  const activeSlots = slots.filter((slot) => slot.deviceId)
  const [selectedSlotId, setSelectedSlotId] = useState(activeSlots[0]?.id ?? '')

  const selectedSlot =
    activeSlots.find((slot) => slot.id === selectedSlotId) ?? activeSlots[0] ?? slots[0]

  const settings = selectedSlot?.noiseSuppressionSettings ?? DEFAULT_NOISE_SUPPRESSION
  const deviceName =
    microphoneDevices.find((device) => device.id === selectedSlot?.deviceId)?.name ??
    'No microphone selected'

  if (!selectedSlot?.deviceId) {
    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Noise suppression</p>
            <h2>Microphone cleanup</h2>
            <p className="section-help">
              Select a microphone in Mixer first, then shape noise suppression here.
            </p>
          </div>
        </div>
        <p className="empty-state">No microphone selected yet.</p>
      </section>
    )
  }

  return (
    <section className="panel noise-editor">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Noise suppression</p>
          <h2>Microphone cleanup</h2>
          <p className="section-help">
            Full editor for gate strength, voice threshold, high-pass, and timing — tuned live into
            the mix.
          </p>
        </div>
        <label className="eq-toggle noise-toggle">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) =>
              void onChange(selectedSlot.id, { enabled: event.target.checked })
            }
          />
          <span className="eq-toggle-track" />
          <span>{settings.enabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </div>

      <div className="noise-editor-grid">
        <div className="noise-editor-main">
          {activeSlots.length > 1 ? (
            <>
              <label className="field-label" htmlFor="ns-mic">
                Microphone
              </label>
              <select
                id="ns-mic"
                value={selectedSlot.id}
                onChange={(event) => setSelectedSlotId(event.target.value)}
              >
                {activeSlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {microphoneDevices.find((device) => device.id === slot.deviceId)?.name ??
                      slot.deviceId}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p className="muted">Editing: {deviceName}</p>
          )}

          <SliderField
            label="Strength"
            value={settings.strength}
            min={0}
            max={100}
            disabled={!settings.enabled}
            onChange={(strength) => void onChange(selectedSlot.id, { strength })}
          />
          <SliderField
            label="Voice threshold"
            value={settings.threshold}
            min={0}
            max={100}
            disabled={!settings.enabled}
            onChange={(threshold) => void onChange(selectedSlot.id, { threshold })}
          />
          <SliderField
            label="High-pass"
            value={settings.highPassHz}
            min={40}
            max={220}
            suffix=" Hz"
            disabled={!settings.enabled}
            onChange={(highPassHz) => void onChange(selectedSlot.id, { highPassHz })}
          />
          <SliderField
            label="Attack"
            value={settings.attack}
            min={0}
            max={100}
            disabled={!settings.enabled}
            onChange={(attack) => void onChange(selectedSlot.id, { attack })}
          />
          <SliderField
            label="Release"
            value={settings.release}
            min={0}
            max={100}
            disabled={!settings.enabled}
            onChange={(release) => void onChange(selectedSlot.id, { release })}
          />
        </div>

        <aside className="noise-editor-side">
          <div className="noise-meter-card">
            <p className="field-label">Live mic level</p>
            <LevelMeter
              level={engineActive && !selectedSlot.muted && settings.enabled ? microphoneLevel : engineActive && !selectedSlot.muted ? microphoneLevel : 0}
              label="Microphone level"
            />
            <p className="muted">
              Raise strength to cut room noise harder. Raise voice threshold if your voice gets
              gated.
            </p>
          </div>
          <div className="noise-preset-row">
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                void onChange(selectedSlot.id, { ...DEFAULT_NOISE_SUPPRESSION, enabled: true })
              }
            >
              Balanced
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                void onChange(selectedSlot.id, {
                  enabled: true,
                  strength: 90,
                  threshold: 45,
                  highPassHz: 100,
                  attack: 65,
                  release: 55,
                })
              }
            >
              Aggressive
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                void onChange(selectedSlot.id, {
                  enabled: true,
                  strength: 45,
                  threshold: 70,
                  highPassHz: 70,
                  attack: 40,
                  release: 30,
                })
              }
            >
              Soft
            </button>
          </div>
        </aside>
      </div>
    </section>
  )
}
