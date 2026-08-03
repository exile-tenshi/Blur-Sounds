import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_NOISE_SUPPRESSION,
  normalizeNoiseSuppression,
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
  onEnsureDevice: (deviceId: string) => Promise<string | undefined>
  onChange: (slotId: string, settings: Partial<NoiseSuppressionSettings>) => Promise<void>
  onSelectDeviceForSlot: (slotId: string, deviceId: string) => Promise<void>
  onAddSlot: () => Promise<void>
  onRemoveSlot: (slotId: string) => Promise<void>
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
    <label className={`ns-slider${disabled ? ' disabled' : ''}`}>
      <span>
        {label}
        <strong>
          {localValue}
          {suffix ?? ''}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
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
        onKeyUp={(event) => {
          if (
            event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight' ||
            event.key === 'Home' ||
            event.key === 'End'
          ) {
            commitValue(localValueRef.current)
          }
        }}
      />
    </label>
  )
}

function MicEditorCard({
  slot,
  deviceName,
  devices,
  inUse,
  isDefault,
  microphoneLevel,
  engineActive,
  expanded,
  onExpand,
  onChange,
  onSelectDevice,
  onRemove,
}: {
  slot: MicrophoneSlot
  deviceName: string
  devices: AudioDevice[]
  inUse: boolean
  isDefault: boolean
  microphoneLevel: number
  engineActive: boolean
  expanded: boolean
  onExpand: () => void
  onChange: (settings: Partial<NoiseSuppressionSettings>) => Promise<void>
  onSelectDevice: (deviceId: string) => Promise<void>
  onRemove: () => Promise<void>
}) {
  const settings = normalizeNoiseSuppression(slot.noiseSuppressionSettings ?? slot.noiseSuppression)

  return (
    <article className={`noise-mic-card${expanded ? ' expanded' : ''}${inUse ? ' in-use' : ''}`}>
      <div className="noise-mic-card-header">
        <button type="button" className="noise-mic-card-title" onClick={onExpand}>
          <div>
            <h3>{deviceName || 'Unassigned microphone'}</h3>
            <p className="muted">
              {inUse ? 'In use · auto-tracked' : isDefault ? 'Default device' : 'Available'}
              {settings.enabled ? ' · suppression on' : ' · suppression off'}
            </p>
          </div>
        </button>
        <div className="noise-mic-card-actions">
          <label className="eq-toggle noise-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={!slot.deviceId}
              onChange={(event) => void onChange({ enabled: event.target.checked })}
            />
            <span className="eq-toggle-track" />
            <span>{settings.enabled ? 'On' : 'Off'}</span>
          </label>
          <button type="button" className="secondary-button" onClick={onExpand}>
            {expanded ? 'Hide' : 'Edit'}
          </button>
          <button type="button" className="remove-button" onClick={() => void onRemove()}>
            Remove
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="noise-editor-grid">
          <div className="noise-editor-main">
            <label className="field-label" htmlFor={`ns-device-${slot.id}`}>
              Microphone device
            </label>
            <select
              id={`ns-device-${slot.id}`}
              value={slot.deviceId ?? ''}
              onChange={(event) => void onSelectDevice(event.target.value)}
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

            <SliderField
              label="Strength"
              value={settings.strength}
              min={0}
              max={100}
              disabled={!settings.enabled || !slot.deviceId}
              onChange={(strength) => void onChange({ strength })}
            />
            <SliderField
              label="Voice threshold"
              value={settings.threshold}
              min={0}
              max={100}
              disabled={!settings.enabled || !slot.deviceId}
              onChange={(threshold) => void onChange({ threshold })}
            />
            <SliderField
              label="High-pass"
              value={settings.highPassHz}
              min={40}
              max={220}
              suffix=" Hz"
              disabled={!settings.enabled || !slot.deviceId}
              onChange={(highPassHz) => void onChange({ highPassHz })}
            />
            <SliderField
              label="Attack"
              value={settings.attack}
              min={0}
              max={100}
              disabled={!settings.enabled || !slot.deviceId}
              onChange={(attack) => void onChange({ attack })}
            />
            <SliderField
              label="Release"
              value={settings.release}
              min={0}
              max={100}
              disabled={!settings.enabled || !slot.deviceId}
              onChange={(release) => void onChange({ release })}
            />
          </div>

          <aside className="noise-editor-side">
            <div className="noise-meter-card">
              <p className="field-label">Live mic level</p>
              <LevelMeter
                level={engineActive && !slot.muted ? microphoneLevel : 0}
                label={`${deviceName || 'Microphone'} level`}
              />
              <p className="muted">
                Each mic has its own suppression settings. Mixer, clips, and this editor all stay
                active together.
              </p>
            </div>
            <div className="noise-preset-row">
              <button
                type="button"
                className="secondary-button"
                disabled={!slot.deviceId}
                onClick={() =>
                  void onChange({ ...DEFAULT_NOISE_SUPPRESSION, enabled: true })
                }
              >
                Balanced
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!slot.deviceId}
                onClick={() =>
                  void onChange({
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
                disabled={!slot.deviceId}
                onClick={() =>
                  void onChange({
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
  onAddSlot,
  onRemoveSlot,
}: NoiseSuppressionSectionProps) {
  const slots = useMemo(
    () => normalizeMicrophoneSlots({ microphones: selectionMicrophones }),
    [selectionMicrophones],
  )
  const trackedSlots = slots.filter((slot) => slot.deviceId)
  const [expandedSlotId, setExpandedSlotId] = useState(trackedSlots[0]?.id ?? slots[0]?.id ?? '')
  const [pickDeviceId, setPickDeviceId] = useState('')
  const [autoTrackedDefault, setAutoTrackedDefault] = useState(false)

  const usedDeviceIds = new Set(trackedSlots.map((slot) => slot.deviceId).filter(Boolean))
  const availableToAdd = microphoneDevices.filter((device) => !usedDeviceIds.has(device.id))

  // Auto-track default / first mic so Noise never starts empty when hardware exists.
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
    void onEnsureDevice(preferred.id).then(async (slotId) => {
      if (slotId) {
        setExpandedSlotId(slotId)
        await onChange(slotId, { enabled: true })
      }
    })
  }, [autoTrackedDefault, microphoneDevices, onChange, onEnsureDevice, trackedSlots.length])

  // Keep expanded card pointed at a real slot when mixer/noise adds or removes mics.
  useEffect(() => {
    if (expandedSlotId && slots.some((slot) => slot.id === expandedSlotId)) {
      return
    }
    setExpandedSlotId(trackedSlots[0]?.id ?? slots[0]?.id ?? '')
  }, [expandedSlotId, slots, trackedSlots])

  return (
    <section className="panel noise-editor">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Noise suppression</p>
          <h2>Microphone cleanup</h2>
          <p className="section-help">
            Pick any mic here — it does not need to be chosen in Mixer first. Multiple mics are
            supported, and mics already in use are auto-tracked. Start the stream for live cleanup
            and level meters.
          </p>
        </div>
        <span className="badge">{trackedSlots.length} tracked</span>
      </div>

      {!engineActive ? (
        <p className="notice">
          Stream is idle — select your mic and turn suppression on, then press <strong>Start stream</strong>
          in Mixer so the app captures that microphone.
        </p>
      ) : null}

      <div className="noise-add-row">
        <label className="field-label" htmlFor="ns-add-device">
          Add microphone
        </label>
        <div className="button-row">
          <select
            id="ns-add-device"
            value={pickDeviceId}
            onChange={(event) => setPickDeviceId(event.target.value)}
          >
            <option value="">Choose a microphone…</option>
            {availableToAdd.map((device) => (
              <option key={device.id} value={device.id} disabled={!device.isAvailable}>
                {device.name}
                {device.isDefault ? ' (default)' : ''}
                {!device.isAvailable ? ' (offline)' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary-button"
            disabled={!pickDeviceId}
            onClick={() => {
              const deviceId = pickDeviceId
              setPickDeviceId('')
              void onEnsureDevice(deviceId).then(async (slotId) => {
                if (slotId) {
                  setExpandedSlotId(slotId)
                  // Turn NS on when tracking so the mic is actively cleaned up.
                  await onChange(slotId, { enabled: true })
                }
              })
            }}
          >
            Track mic
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void onAddSlot().then(() => {
                const nextSlots = normalizeMicrophoneSlots({
                  microphones: selectionMicrophones,
                })
                // expanded id updates via effect after snapshot refresh
                setExpandedSlotId(nextSlots[nextSlots.length - 1]?.id ?? expandedSlotId)
              })
            }}
          >
            Add empty slot
          </button>
        </div>
      </div>

      <div className="noise-mic-list">
        {slots.length === 0 ? (
          <p className="empty-state">No microphone hardware detected yet. Click Refresh.</p>
        ) : (
          slots.map((slot) => {
            const device = microphoneDevices.find((item) => item.id === slot.deviceId)
            return (
              <MicEditorCard
                key={slot.id}
                slot={slot}
                deviceName={device?.name ?? (slot.deviceId ? 'Unknown microphone' : '')}
                devices={microphoneDevices}
                inUse={Boolean(slot.deviceId) && engineActive && !slot.muted}
                isDefault={Boolean(device?.isDefault)}
                microphoneLevel={microphoneLevel}
                engineActive={engineActive}
                expanded={expandedSlotId === slot.id}
                onExpand={() => setExpandedSlotId(slot.id)}
                onChange={(settings) => onChange(slot.id, settings)}
                onSelectDevice={(deviceId) => onSelectDeviceForSlot(slot.id, deviceId)}
                onRemove={() => onRemoveSlot(slot.id)}
              />
            )
          })
        )}
      </div>
    </section>
  )
}
