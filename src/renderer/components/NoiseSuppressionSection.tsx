import { useEffect, useMemo, useRef, useState } from 'react'
import {
  applyNoisePreset,
  detectNoiseMicKind,
  micKindLabel,
  NOISE_PRESETS,
  presetsForMic,
  recommendedPresetForMic,
} from '../../shared/noisePresets'
import { normalizeNoiseSuppression, type NoiseSuppressionSettings } from '../../shared/noiseSuppression'
import type { AudioDevice, MicrophoneSlot } from '../../shared/audioTypes'
import { normalizeMicrophoneSlots } from '../../shared/microphoneSlots'

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

function SonarToggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className={`clearcast-toggle${checked ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="clearcast-toggle-track" aria-hidden="true" />
      <span className="clearcast-toggle-label">{label}</span>
    </label>
  )
}

function IntensitySlider({
  value,
  disabled,
  onChange,
}: {
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

  return (
    <div className={`clearcast-intensity${disabled ? ' is-disabled' : ''}`}>
      <div className="clearcast-intensity-labels">
        <span>Min</span>
        <span>Intensity</span>
        <span>Max</span>
      </div>
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
          onChange(localValueRef.current)
        }}
        onPointerCancel={() => {
          isDraggingRef.current = false
          onChange(localValueRef.current)
        }}
        onChange={(event) => {
          const nextValue = Number(event.target.value)
          localValueRef.current = nextValue
          setLocalValue(nextValue)
        }}
      />
    </div>
  )
}

function WaveVisualizer({
  level,
  active,
}: {
  level: number
  active: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const levelRef = useRef(level)
  const phaseRef = useRef(0)
  const activeRef = useRef(active)

  useEffect(() => {
    levelRef.current = level
  }, [level])

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    let frameId = 0
    const draw = () => {
      const width = canvas.width
      const height = canvas.height
      context.clearRect(0, 0, width, height)

      const mid = height / 2
      const amplitude = activeRef.current
        ? Math.max(4, levelRef.current * (height * 0.42))
        : 3
      phaseRef.current += activeRef.current ? 0.18 + levelRef.current * 0.35 : 0.04

      context.beginPath()
      context.strokeStyle = activeRef.current ? '#4ade80' : '#475569'
      context.lineWidth = 2.5
      context.lineJoin = 'round'

      for (let x = 0; x < width; x += 2) {
        const wave =
          Math.sin(x * 0.045 + phaseRef.current) * amplitude +
          Math.sin(x * 0.11 + phaseRef.current * 1.7) * (amplitude * 0.35)
        const y = mid + wave
        if (x === 0) {
          context.moveTo(x, y)
        } else {
          context.lineTo(x, y)
        }
      }
      context.stroke()

      frameId = window.requestAnimationFrame(draw)
    }

    frameId = window.requestAnimationFrame(draw)
    return () => window.cancelAnimationFrame(frameId)
  }, [])

  return <canvas ref={canvasRef} className="clearcast-wave" width={220} height={72} aria-hidden="true" />
}

function MicNoiseCard({
  slot,
  deviceName,
  devices,
  microphoneLevel,
  engineActive,
  onChange,
  onSelectDevice,
}: {
  slot: MicrophoneSlot
  deviceName: string
  devices: AudioDevice[]
  microphoneLevel: number
  engineActive: boolean
  onChange: (settings: Partial<NoiseSuppressionSettings>) => Promise<void>
  onSelectDevice: (deviceId: string) => Promise<void>
}) {
  const settings = normalizeNoiseSuppression(slot.noiseSuppressionSettings ?? slot.noiseSuppression)
  const kind = detectNoiseMicKind(deviceName)
  const presets = presetsForMic(deviceName)
  const recommended = recommendedPresetForMic(deviceName)
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const liveLevel = engineActive && !slot.muted ? microphoneLevel : 0

  const selectedPresetId =
    activePresetId ??
    presets.find((preset) => preset.id === recommended.id)?.id ??
    presets[0]?.id ??
    ''

  return (
    <div className="clearcast-shell">
      <div className="clearcast-preset-bar">
        <label className="clearcast-preset-field">
          <span>Preset</span>
          <select
            value={selectedPresetId}
            disabled={!slot.deviceId}
            onChange={(event) => {
              const preset = NOISE_PRESETS.find((item) => item.id === event.target.value)
              if (!preset) {
                return
              }
              setActivePresetId(preset.id)
              void onChange(applyNoisePreset(preset))
            }}
          >
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
                {preset.id === recommended.id ? ' (suggested)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="clearcast-preset-field clearcast-device-field">
          <span>Microphone</span>
          <select
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
        </label>

        <p className="clearcast-mic-kind muted">{micKindLabel(kind)}</p>
      </div>

      <section className={`clearcast-ai-card${settings.enabled ? ' is-on' : ''}`}>
        <div className="clearcast-ai-header">
          <div>
            <p className="clearcast-kicker">ClearCast AI</p>
            <h3>AI noise cancellation</h3>
          </div>
          <SonarToggle
            checked={settings.enabled}
            disabled={!slot.deviceId}
            label={settings.enabled ? 'On' : 'Off'}
            onChange={(checked) => {
              setActivePresetId(null)
              if (checked) {
                void onChange({ enabled: true })
              } else {
                void onChange({ enabled: false, compressorEnabled: false })
              }
            }}
          />
        </div>

        <div className="clearcast-ai-body">
          <WaveVisualizer level={liveLevel} active={settings.enabled && engineActive} />
          <IntensitySlider
            value={settings.strength}
            disabled={!settings.enabled || !slot.deviceId}
            onChange={(strength) => {
              setActivePresetId(null)
              void onChange({ strength })
            }}
          />
        </div>
      </section>

      <section className={`clearcast-side-card${settings.enabled ? ' is-disabled-card' : ''}`}>
        <div className="clearcast-ai-header">
          <div>
            <h3>Noise reduction</h3>
            <p className="muted">
              {settings.enabled
                ? 'Disabled while ClearCast AI noise cancellation is active'
                : 'Legacy reduction — turn on ClearCast AI instead'}
            </p>
          </div>
          <SonarToggle checked={false} disabled label="Off" onChange={() => undefined} />
        </div>
      </section>

      <div className="clearcast-modules">
        <section className="clearcast-module">
          <div className="clearcast-ai-header">
            <h3>Noise gate</h3>
            <SonarToggle
              checked={settings.noiseGateEnabled}
              disabled={!slot.deviceId}
              label={settings.noiseGateEnabled ? 'On' : 'Off'}
              onChange={(checked) => {
                setActivePresetId(null)
                void onChange({ noiseGateEnabled: checked })
              }}
            />
          </div>
          <label className={`clearcast-module-slider${settings.noiseGateEnabled ? '' : ' is-disabled'}`}>
            <span>
              Threshold
              <strong>{settings.noiseGateThreshold}</strong>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.noiseGateThreshold}
              disabled={!settings.noiseGateEnabled || !slot.deviceId}
              onChange={(event) => {
                setActivePresetId(null)
                void onChange({ noiseGateThreshold: Number(event.target.value) })
              }}
            />
          </label>
          <p className="muted clearcast-module-note">Leave off unless you need silence between words.</p>
        </section>

        <section className="clearcast-module">
          <div className="clearcast-ai-header">
            <h3>Compressor</h3>
            <SonarToggle
              checked={settings.compressorEnabled}
              disabled={!slot.deviceId || !settings.enabled}
              label={settings.compressorEnabled ? 'On' : 'Off'}
              onChange={(checked) => {
                setActivePresetId(null)
                void onChange({ compressorEnabled: checked })
              }}
            />
          </div>
          <label
            className={`clearcast-module-slider${
              settings.compressorEnabled && settings.enabled ? '' : ' is-disabled'
            }`}
          >
            <span>
              Level
              <strong>{(settings.compressorLevel / 100).toFixed(2)}</strong>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.compressorLevel}
              disabled={!settings.compressorEnabled || !settings.enabled || !slot.deviceId}
              onChange={(event) => {
                setActivePresetId(null)
                void onChange({ compressorLevel: Number(event.target.value) })
              }}
            />
          </label>
          <p className="muted clearcast-module-note">Evens voice level after AI cleanup.</p>
        </section>
      </div>
    </div>
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
          <p className="eyebrow">Mic</p>
          <h2>ClearCast noise cancellation</h2>
          <p className="section-help">
            SteelSeries-style AI cleanup for your mic — intensity, gate, and compressor stay on this
            page while the stream is live.
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
