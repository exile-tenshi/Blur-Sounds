import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_MIC_EQUALIZER,
  MIC_EQ_BAND_LABELS,
  MIC_EQ_PRESETS,
  MIC_EQ_REGION_LABELS,
  normalizeMicEqualizer,
  type RouteEqualizerSettings,
} from '../../shared/audioConstants'
import {
  applyNoisePreset,
  matchNoisePresetId,
  micKindLabel,
  NOISE_PRESETS,
  presetsForMic,
  recommendedPresetForMic,
} from '../../shared/noisePresets'
import { DEFAULT_NOISE_SUPPRESSION, normalizeNoiseSuppression, type NoiseSuppressionSettings } from '../../shared/noiseSuppression'
import type { AudioDevice, MicrophoneSlot } from '../../shared/audioTypes'
import { normalizeMicrophoneSlots } from '../../shared/microphoneSlots'
import { GraphicalEqualizer } from './GraphicalEqualizer'

interface NoiseSuppressionSectionProps {
  selectionMicrophones: MicrophoneSlot[] | undefined
  microphoneDevices: AudioDevice[]
  microphoneLevel: number
  engineActive: boolean
  isActive?: boolean
  onEnsureDevice: (deviceId: string) => Promise<string | undefined>
  onChange: (slotId: string, settings: Partial<NoiseSuppressionSettings>) => Promise<void>
  onSelectDeviceForSlot: (slotId: string, deviceId: string) => Promise<void>
  onSetEqualizer: (slotId: string, equalizer: RouteEqualizerSettings) => Promise<void>
  onRemoveSlot?: (slotId: string) => Promise<void>
}

const FAVORITES_KEY = 'blur-sounds.clearcast-favorites'
const FAVORITE_SLOTS = 9

function loadFavorites(): Array<string | null> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) {
      return Array.from({ length: FAVORITE_SLOTS }, () => null)
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return Array.from({ length: FAVORITE_SLOTS }, () => null)
    }
    return Array.from({ length: FAVORITE_SLOTS }, (_, index) =>
      typeof parsed[index] === 'string' ? parsed[index] : null,
    )
  } catch {
    return Array.from({ length: FAVORITE_SLOTS }, () => null)
  }
}

function saveFavorites(favorites: Array<string | null>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
}

/** Map 0–100 gate knob → Sonar-style dB readout. */
function gateThresholdToDb(percent: number): number {
  return -80 + percent * 0.6
}

function gateDbToThreshold(db: number): number {
  return Math.max(0, Math.min(100, Math.round((db + 80) / 0.6)))
}

function SonarToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
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
        <span>Max</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={localValue}
        disabled={disabled}
        aria-label="ClearCast AI intensity"
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
        ? Math.max(5, levelRef.current * (height * 0.44))
        : 2.5
      phaseRef.current += activeRef.current ? 0.2 + levelRef.current * 0.4 : 0.03

      context.beginPath()
      context.strokeStyle = activeRef.current ? '#3dd68c' : '#3f4b5a'
      context.lineWidth = 2.4
      context.lineJoin = 'round'
      context.shadowColor = activeRef.current ? 'rgba(61, 214, 140, 0.35)' : 'transparent'
      context.shadowBlur = activeRef.current ? 8 : 0

      for (let x = 0; x < width; x += 2) {
        const wave =
          Math.sin(x * 0.05 + phaseRef.current) * amplitude +
          Math.sin(x * 0.13 + phaseRef.current * 1.6) * (amplitude * 0.32)
        const y = mid + wave
        if (x === 0) {
          context.moveTo(x, y)
        } else {
          context.lineTo(x, y)
        }
      }
      context.stroke()
      context.shadowBlur = 0

      frameId = window.requestAnimationFrame(draw)
    }

    frameId = window.requestAnimationFrame(draw)
    return () => window.cancelAnimationFrame(frameId)
  }, [])

  return <canvas ref={canvasRef} className="clearcast-wave" width={260} height={80} aria-hidden="true" />
}

function ModuleSlider({
  label,
  valueLabel,
  formatValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  onChange,
}: {
  label: string
  valueLabel: string
  formatValue?: (value: number) => string
  value: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onChange?: (value: number) => void
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
    <label className={`clearcast-module-slider${disabled ? ' is-disabled' : ''}`}>
      <span>
        {label}
        <strong>{formatValue ? formatValue(localValue) : valueLabel}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={localValue}
        disabled={disabled || !onChange}
        onPointerDown={() => {
          isDraggingRef.current = true
        }}
        onPointerUp={() => {
          isDraggingRef.current = false
          onChange?.(localValueRef.current)
        }}
        onPointerCancel={() => {
          isDraggingRef.current = false
          onChange?.(localValueRef.current)
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

async function resolveBrowserMicId(deviceName: string): Promise<string | undefined> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return undefined
  }

  // Unlock labels in Chromium/Electron before matching by name.
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    probe.getTracks().forEach((track) => track.stop())
  } catch {
    // Continue — labels may still be empty, match will fall back to default.
  }

  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === 'audioinput',
  )
  if (inputs.length === 0) {
    return undefined
  }

  const normalized = deviceName.trim().toLowerCase()
  const exact = inputs.find((device) => device.label.trim().toLowerCase() === normalized)
  if (exact?.deviceId) {
    return exact.deviceId
  }

  const partial = inputs.find(
    (device) =>
      device.label &&
      (normalized.includes(device.label.trim().toLowerCase()) ||
        device.label.trim().toLowerCase().includes(normalized.split('(')[0]?.trim() ?? '')),
  )
  return partial?.deviceId ?? inputs[0]?.deviceId
}

function MicTestBox({
  deviceName,
  disabled,
}: {
  deviceName: string
  disabled?: boolean
}) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'ready' | 'playing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
      audioRef.current?.pause()
    }
  }, [])

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const startRecording = async () => {
    if (!deviceName || disabled) {
      return
    }

    setError(null)
    try {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
      audioRef.current?.pause()

      const browserDeviceId = await resolveBrowserMicId(deviceName)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(browserDeviceId ? { deviceId: { ideal: browserDeviceId } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      })
      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      recorder.onstop = () => {
        stopTracks()
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        objectUrlRef.current = URL.createObjectURL(blob)
        setPhase('ready')
      }
      recorder.start()
      setPhase('recording')

      window.setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop()
        }
      }, 3500)
    } catch {
      stopTracks()
      setPhase('idle')
      setError('Mic access blocked')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }

  const playRecording = async () => {
    if (!objectUrlRef.current) {
      return
    }
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    audio.src = objectUrlRef.current
    setPhase('playing')
    try {
      await audio.play()
      audio.onended = () => setPhase('ready')
    } catch {
      setPhase('ready')
      setError('Playback failed')
    }
  }

  return (
    <div className={`clearcast-test${disabled ? ' is-disabled' : ''}`}>
      <span className="clearcast-test-label">Test</span>
      <div className="clearcast-test-actions">
        <button
          type="button"
          className={`clearcast-test-record${phase === 'recording' ? ' is-active' : ''}`}
          disabled={disabled || !deviceName || phase === 'playing'}
          title={phase === 'recording' ? 'Stop test recording' : 'Record a short mic test'}
          aria-label={phase === 'recording' ? 'Stop test recording' : 'Record mic test'}
          onClick={() => {
            if (phase === 'recording') {
              stopRecording()
            } else {
              void startRecording()
            }
          }}
        />
        <button
          type="button"
          className="clearcast-test-play"
          disabled={disabled || (phase !== 'ready' && phase !== 'playing')}
          title="Play test recording"
          aria-label="Play test recording"
          onClick={() => {
            void playRecording()
          }}
        />
      </div>
      {error ? <p className="clearcast-test-error">{error}</p> : null}
    </div>
  )
}

function MicNoiseCard({
  slot,
  deviceName,
  devices,
  microphoneLevel,
  engineActive,
  onChange,
  onSelectDevice,
  onSetEqualizer,
}: {
  slot: MicrophoneSlot
  deviceName: string
  devices: AudioDevice[]
  microphoneLevel: number
  engineActive: boolean
  onChange: (settings: Partial<NoiseSuppressionSettings>) => Promise<void>
  onSelectDevice: (deviceId: string) => Promise<void>
  onSetEqualizer: (equalizer: RouteEqualizerSettings) => Promise<void>
}) {
  const settings = normalizeNoiseSuppression(slot.noiseSuppressionSettings ?? slot.noiseSuppression)
  const presets = presetsForMic(deviceName)
  const recommended = recommendedPresetForMic(deviceName)
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<Array<string | null>>(() => loadFavorites())
  const [autoGate, setAutoGate] = useState(false)
  const liveLevel = engineActive && !slot.muted ? microphoneLevel : 0
  const gateDb = gateThresholdToDb(settings.noiseGateThreshold)
  const favoriteCount = favorites.filter(Boolean).length

  const matchedPresetId = matchNoisePresetId(settings)
  const selectedPresetId = activePresetId ?? matchedPresetId
  const selectedPreset =
    NOISE_PRESETS.find((preset) => preset.id === selectedPresetId) ?? recommended
  /** Follow the chosen preset — not only auto-detected mic hardware. */
  const selectedPresetKindLabel =
    selectedPresetId === 'custom'
      ? 'Custom'
      : selectedPreset.kinds !== 'all' && selectedPreset.kinds.length > 0
        ? micKindLabel(selectedPreset.kinds[0])
        : selectedPreset.label

  const applyPresetId = (presetId: string) => {
    const preset = NOISE_PRESETS.find((item) => item.id === presetId)
    if (!preset) {
      return
    }
    setActivePresetId(preset.id)
    setAutoGate(false)
    void onChange(applyNoisePreset(preset))
    if (preset.equalizer) {
      void onSetEqualizer(normalizeMicEqualizer(preset.equalizer))
    }
  }

  const starCurrentPreset = () => {
    if (!selectedPresetId || selectedPresetId === 'custom') {
      return
    }
    const next = [...favorites]
    const existing = next.findIndex((id) => id === selectedPresetId)
    if (existing >= 0) {
      next[existing] = null
    } else {
      const empty = next.findIndex((id) => id == null)
      if (empty < 0) {
        return
      }
      next[empty] = selectedPresetId
    }
    setFavorites(next)
    saveFavorites(next)
  }

  return (
    <div className="clearcast-shell">
      <div className="clearcast-preset-bar">
        <label className="clearcast-preset-field">
          <span>Preset</span>
          <div className="clearcast-preset-select-row">
            <select
              value={selectedPresetId}
              disabled={!slot.deviceId}
              onChange={(event) => applyPresetId(event.target.value)}
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                  {preset.id === recommended.id ? ' (suggested)' : ''}
                </option>
              ))}
              {selectedPresetId === 'custom' ? (
                <option value="custom">Custom</option>
              ) : null}
            </select>
            <button
              type="button"
              className="clearcast-fav-star"
              disabled={!slot.deviceId || !selectedPresetId || selectedPresetId === 'custom'}
              title="Add preset to favorites"
              aria-label="Favorite preset"
              onClick={starCurrentPreset}
            >
              ★
            </button>
          </div>
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

        <div className="clearcast-favorites">
          <span>
            Favorites ({favoriteCount}/{FAVORITE_SLOTS})
          </span>
          <div className="clearcast-favorite-slots">
            {favorites.map((presetId, index) => {
              const preset = presetId ? NOISE_PRESETS.find((item) => item.id === presetId) : null
              return (
                <button
                  key={`fav-${index}`}
                  type="button"
                  className={`clearcast-favorite-slot${preset ? ' is-filled' : ''}${
                    preset && preset.id === selectedPresetId ? ' is-active' : ''
                  }`}
                  disabled={!preset || !slot.deviceId}
                  title={preset ? preset.label : 'Empty favorite'}
                  onClick={() => {
                    if (preset) {
                      applyPresetId(preset.id)
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    const next = [...favorites]
                    next[index] = null
                    setFavorites(next)
                    saveFavorites(next)
                  }}
                >
                  {preset ? preset.label.slice(0, 1) : null}
                </button>
              )
            })}
          </div>
        </div>

        <MicTestBox deviceName={deviceName} disabled={!slot.deviceId || !deviceName} />
      </div>

      <p className="clearcast-mic-kind muted" title={selectedPreset.hint}>
        {selectedPresetKindLabel}
      </p>

      <section className={`clearcast-ai-card${settings.enabled ? ' is-on' : ''}`}>
        <div className="clearcast-ai-header">
          <h3>ClearCast AI noise cancellation</h3>
          <SonarToggle
            checked={settings.enabled}
            disabled={!slot.deviceId}
            onChange={(checked) => {
              setActivePresetId(null)
              void onChange({ enabled: checked })
            }}
          />
        </div>

        <div className="clearcast-ai-body">
          <WaveVisualizer level={liveLevel} active={settings.enabled && engineActive} />
          <IntensitySlider
            value={settings.strength}
            disabled={!slot.deviceId}
            onChange={(strength) => {
              setActivePresetId(null)
              void onChange({ strength })
            }}
          />
        </div>
      </section>

      <div className="clearcast-modules clearcast-modules-top">
        <section className="clearcast-module">
          <div className="clearcast-ai-header">
            <div>
              <h3>Noise reduction</h3>
              <p className="muted clearcast-module-note">
                Background tames leftover fan / room tone after ClearCast. Keep it
                mid-range for a natural voice — high values can sound gated. 0 = quiet
                cleaned leftover. 100 = silence when idle. Impact = desk taps / keyboard.
              </p>
            </div>
            <SonarToggle
              checked={settings.threshold > 0 || settings.impact > 0}
              disabled={!slot.deviceId}
              onChange={(checked) => {
                setActivePresetId(null)
                if (checked) {
                  void onChange({
                    threshold: settings.threshold > 0 ? settings.threshold : DEFAULT_NOISE_SUPPRESSION.threshold,
                    impact: settings.impact,
                  })
                } else {
                  void onChange({ threshold: 0, impact: 0 })
                }
              }}
            />
          </div>
          <div className="clearcast-nr-sliders">
            <ModuleSlider
              label="Background"
              valueLabel={(settings.threshold / 100).toFixed(2)}
              formatValue={(threshold) => (threshold / 100).toFixed(2)}
              value={settings.threshold}
              disabled={!slot.deviceId}
              onChange={(threshold) => {
                setActivePresetId(null)
                void onChange({ threshold })
              }}
            />
            <ModuleSlider
              label="Impact"
              valueLabel={(settings.impact / 100).toFixed(2)}
              formatValue={(impact) => (impact / 100).toFixed(2)}
              value={settings.impact}
              disabled={!slot.deviceId}
              onChange={(impact) => {
                setActivePresetId(null)
                void onChange({ impact })
              }}
            />
            <p className="muted clearcast-module-note">
              Background 0 = cleaned leftover when idle (fans stay suppressed). Background 100
              = no leftover noise when idle. Talking stays on ClearCast. Impact 0 keeps real
              taps; raise it to strip desk / keyboard hits.
            </p>
          </div>
        </section>

        <section className="clearcast-module">
          <div className="clearcast-ai-header">
            <div>
              <h3>Echo removal</h3>
              <p className="muted clearcast-module-note">
                Cuts room reverb / slap-echo tails after you stop talking. Keep on for live
                rooms. Use headphones if you also use Listen to Hi-Fi Cable — speakers will
                feed your mic and sound like echo.
              </p>
            </div>
            <SonarToggle
              checked={settings.deEcho}
              disabled={!slot.deviceId}
              onChange={(checked) => {
                setActivePresetId(null)
                void onChange({ deEcho: checked })
              }}
            />
          </div>
        </section>

        <section className="clearcast-module">
          <div className="clearcast-ai-header">
            <h3>Noise gate</h3>
            <SonarToggle
              checked={settings.noiseGateEnabled}
              disabled={!slot.deviceId}
              onChange={(checked) => {
                setActivePresetId(null)
                void onChange({ noiseGateEnabled: checked })
              }}
            />
          </div>
          <ModuleSlider
            label="Threshold"
            valueLabel={`${gateDb.toFixed(1)} dB`}
            value={settings.noiseGateThreshold}
            disabled={!slot.deviceId || autoGate}
            onChange={(noiseGateThreshold) => {
              setActivePresetId(null)
              setAutoGate(false)
              void onChange({ noiseGateThreshold })
            }}
          />
          <label className="clearcast-auto-gate">
            <input
              type="checkbox"
              checked={autoGate}
              disabled={!slot.deviceId}
              onChange={(event) => {
                const next = event.target.checked
                setAutoGate(next)
                if (next) {
                  const levelDb = -60 + liveLevel * 40
                  const suggested = gateDbToThreshold(Math.max(-72, Math.min(-28, levelDb - 12)))
                  setActivePresetId(null)
                  void onChange({ noiseGateThreshold: suggested })
                }
              }}
            />
            <span>Automatically compute the threshold for the noise gate effect.</span>
          </label>
        </section>
      </div>

      <section className="clearcast-module clearcast-compressor">
        <div className="clearcast-ai-header">
          <h3>Compressor</h3>
          <SonarToggle
            checked={settings.compressorEnabled}
            disabled={!slot.deviceId}
            onChange={(checked) => {
              setActivePresetId(null)
              void onChange({ compressorEnabled: checked })
            }}
          />
        </div>
        <ModuleSlider
          label="Level"
          valueLabel={(settings.compressorLevel / 100).toFixed(2)}
          value={settings.compressorLevel}
          disabled={!slot.deviceId}
          onChange={(compressorLevel) => {
            setActivePresetId(null)
            void onChange({ compressorLevel })
          }}
        />
      </section>

      <section className="clearcast-module clearcast-equalizer">
        <GraphicalEqualizer
          title="Equalizer"
          value={normalizeMicEqualizer(slot.equalizer ?? DEFAULT_MIC_EQUALIZER)}
          disabled={!slot.deviceId}
          alwaysEditable
          bandLabels={MIC_EQ_BAND_LABELS}
          regionLabels={MIC_EQ_REGION_LABELS}
          presets={MIC_EQ_PRESETS}
          onChange={(equalizer) => {
            setActivePresetId(null)
            void onSetEqualizer(equalizer)
          }}
        />
      </section>
    </div>
  )
}

export function NoiseSuppressionSection({
  selectionMicrophones,
  microphoneDevices,
  microphoneLevel,
  engineActive,
  isActive = true,
  onEnsureDevice,
  onChange,
  onSelectDeviceForSlot,
  onSetEqualizer,
}: NoiseSuppressionSectionProps) {
  const slots = useMemo(
    () => normalizeMicrophoneSlots({ microphones: selectionMicrophones }),
    [selectionMicrophones],
  )
  const trackedSlots = slots.filter((slot) => slot.deviceId)
  const primarySlot = trackedSlots[0] ?? slots[0]
  const [autoTrackedDefault, setAutoTrackedDefault] = useState(false)

  useEffect(() => {
    if (!isActive || autoTrackedDefault || trackedSlots.length > 0 || microphoneDevices.length === 0) {
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
        if (preset.equalizer) {
          await onSetEqualizer(slotId, normalizeMicEqualizer(preset.equalizer))
        }
      }
    })
  }, [
    autoTrackedDefault,
    isActive,
    microphoneDevices,
    onChange,
    onEnsureDevice,
    onSetEqualizer,
    trackedSlots.length,
  ])

  return (
    <section className="panel noise-editor sonar-noise">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Mic</p>
          <h2>Noise suppression</h2>
        </div>
      </div>

      {!engineActive ? (
        <p className="notice">
          Stream is idle — pick a preset, then press <strong>Start stream</strong> to hear ClearCast on
          the cable.
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
            onSetEqualizer={(equalizer) => onSetEqualizer(primarySlot.id, equalizer)}
          />
        )}
      </div>
    </section>
  )
}
