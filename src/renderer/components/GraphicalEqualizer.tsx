import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DEFAULT_ROUTE_EQUALIZER,
  EQ_BAND_FREQUENCIES,
  EQ_BAND_KEYS,
  EQ_BAND_LABELS,
  EQ_PRESETS,
  clampEqDb,
  equalizerSettingsToPayload,
  routeEqualizersEqual,
  type EqBandKey,
  type EqPreset,
  type RouteEqualizerSettings,
} from '../../shared/audioConstants'
import {
  GRAPH_HEIGHT,
  GRAPH_PADDING_X,
  GRAPH_PADDING_Y,
  GRAPH_WIDTH,
  buildFilledCurvePath,
  buildSmoothCurvePath,
  dbToY,
  freqToX,
  getBandValues,
} from '../utils/eqCurve'

interface GraphicalEqualizerProps {
  value: RouteEqualizerSettings
  disabled?: boolean
  title?: string
  /** Override band input labels (e.g. Sonar Sub bass…Highs). */
  bandLabels?: readonly string[]
  /** Optional region headers above the graph (SUB BASS…HIGHS). */
  regionLabels?: readonly string[]
  /** Preset list — defaults to music EQ_PRESETS; mic page passes MIC_EQ_PRESETS. */
  presets?: EqPreset[]
  /** When true, bands/presets stay editable even if the EQ toggle is off. */
  alwaysEditable?: boolean
  onChange: (value: RouteEqualizerSettings) => void
}

function formatBandInput(db: number): string {
  const clamped = clampEqDb(db)
  if (clamped === 0) {
    return '0'
  }

  const rounded = Math.round(clamped * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return rounded > 0 ? `+${text}` : text
}

function parseBandInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/db$/i, '').replace(/\s+/g, '')
  if (cleaned === '' || cleaned === '+' || cleaned === '-') {
    return null
  }

  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return clampEqDb(parsed)
}

function EqBandField({
  bandKey,
  label,
  value,
  disabled,
  focused,
  onFocus,
  onBlur,
  onCommit,
}: {
  bandKey: EqBandKey
  label: string
  value: number
  disabled: boolean
  focused: boolean
  onFocus: (bandKey: EqBandKey) => void
  onBlur: () => void
  onCommit: (bandKey: EqBandKey, db: number) => void
}) {
  const [text, setText] = useState(() => formatBandInput(value))
  const isEditingRef = useRef(false)
  const index = EQ_BAND_KEYS.indexOf(bandKey)
  const leftPercent = (freqToX(EQ_BAND_FREQUENCIES[index]) / GRAPH_WIDTH) * 100

  useEffect(() => {
    if (!isEditingRef.current) {
      setText(formatBandInput(value))
    }
  }, [value])

  const commit = () => {
    isEditingRef.current = false
    const parsed = parseBandInput(text)
    if (parsed === null) {
      setText(formatBandInput(value))
      onBlur()
      return
    }

    setText(formatBandInput(parsed))
    onCommit(bandKey, parsed)
    onBlur()
  }

  return (
    <label
      className={`eq-band-field${focused ? ' is-focused' : ''}`}
      style={{ left: `${leftPercent}%` }}
    >
      <span className="eq-band-field-label">{label}</span>
      <span className="eq-band-field-input-wrap">
        <input
          type="text"
          inputMode="decimal"
          className="eq-band-field-input"
          value={text}
          disabled={disabled}
          aria-label={`${label} gain in decibels`}
          onFocus={() => {
            isEditingRef.current = true
            onFocus(bandKey)
          }}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }

            if (event.key === 'Escape') {
              isEditingRef.current = false
              setText(formatBandInput(value))
              event.currentTarget.blur()
            }
          }}
        />
        <span className="eq-band-field-unit">dB</span>
      </span>
    </label>
  )
}

function GraphicalEqualizerInner({
  value,
  disabled = false,
  title = 'Equalizer',
  bandLabels = EQ_BAND_LABELS,
  regionLabels,
  presets = EQ_PRESETS,
  alwaysEditable = false,
  onChange,
}: GraphicalEqualizerProps) {
  const [settings, setSettings] = useState(value)
  const settingsRef = useRef(value)
  const [presetId, setPresetId] = useState('flat')
  const [focusedBand, setFocusedBand] = useState<EqBandKey | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const gradientId = useId().replace(/:/g, '')
  const pendingCommitRef = useRef<RouteEqualizerSettings | null>(null)

  useEffect(() => {
    if (!isExpanded) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExpanded(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isExpanded])

  useEffect(() => {
    if (pendingCommitRef.current) {
      if (routeEqualizersEqual(value, pendingCommitRef.current)) {
        pendingCommitRef.current = null
      } else {
        return
      }
    }

    if (routeEqualizersEqual(value, settingsRef.current)) {
      return
    }

    setSettings(value)
    settingsRef.current = value
  }, [value])

  const bandValues = useMemo(() => getBandValues(settings), [settings])
  const curvePath = useMemo(() => buildSmoothCurvePath(bandValues), [bandValues])
  const fillPath = useMemo(() => buildFilledCurvePath(bandValues), [bandValues])
  const isInteractive = !disabled && (alwaysEditable || settings.enabled)

  const commit = useCallback(
    (next: RouteEqualizerSettings) => {
      const payload = equalizerSettingsToPayload(next)
      pendingCommitRef.current = payload
      setSettings(payload)
      settingsRef.current = payload
      onChange(payload)
    },
    [onChange],
  )

  const commitBand = useCallback(
    (bandKey: EqBandKey, db: number) => {
      setPresetId('custom')
      commit({
        ...settingsRef.current,
        [bandKey]: db,
      })
    },
    [commit],
  )

  const applyPreset = (nextPresetId: string) => {
    const preset = presets.find((item) => item.id === nextPresetId)
    if (!preset) {
      return
    }

    setPresetId(nextPresetId)
    commit({ ...preset.settings, enabled: settingsRef.current.enabled || preset.settings.enabled })
  }

  const reset = () => {
    setPresetId('flat')
    commit({ ...DEFAULT_ROUTE_EQUALIZER, enabled: settings.enabled })
  }

  const toggleEnabled = () => {
    commit({ ...settingsRef.current, enabled: !settingsRef.current.enabled })
  }

  const closeExpanded = useCallback(() => {
    setIsExpanded(false)
  }, [])

  const panel = (
    <section
      className={`graphical-equalizer${settings.enabled ? '' : ' is-disabled'}${isExpanded ? ' is-expanded' : ''}`}
      aria-label={title}
    >
      {isExpanded ? (
        <button
          type="button"
          className="eq-close-button"
          aria-label="Close equalizer"
          onClick={closeExpanded}
        >
          ×
        </button>
      ) : null}

      <div className="graphical-equalizer-top">
        <div className="graphical-equalizer-title-row">
          <strong>{title}</strong>
          <div className="graphical-equalizer-title-actions">
            <button
              type="button"
              className="eq-size-button"
              onClick={() => setIsExpanded((expanded) => !expanded)}
            >
              {isExpanded ? 'Close' : 'Larger view'}
            </button>
              <label className="eq-toggle">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  disabled={disabled}
                  onChange={toggleEnabled}
                />
                <span className="eq-toggle-track" aria-hidden="true" />
              </label>
            </div>
          </div>

          <div className="graphical-equalizer-controls">
            <label className="eq-preset-field">
              <span>Presets</span>
              <select
                value={presetId}
                disabled={!isInteractive}
                onChange={(event) => applyPreset(event.target.value)}
              >
                {presetId === 'custom' ? <option value="custom">Custom</option> : null}
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="eq-reset-button" disabled={!isInteractive} onClick={reset}>
              Reset
            </button>
          </div>
        </div>

        {regionLabels && regionLabels.length > 0 ? (
          <div className="eq-region-labels" aria-hidden="true">
            {regionLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        ) : null}

        <div className="graphical-equalizer-stage">
        <svg
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          className="eq-graph"
          role="img"
          aria-label="Six band equalizer curve"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(76, 209, 106, 0.42)" />
              <stop offset="100%" stopColor="rgba(76, 209, 106, 0.04)" />
            </linearGradient>
          </defs>

          {[12, 6, 0, -6, -12].map((db) => (
            <g key={db} pointerEvents="none">
              <line
                x1={GRAPH_PADDING_X - 8}
                x2={GRAPH_WIDTH - GRAPH_PADDING_X + 8}
                y1={dbToY(db)}
                y2={dbToY(db)}
                className={db === 0 ? 'eq-grid-line eq-grid-line-zero' : 'eq-grid-line'}
              />
              <text x={8} y={dbToY(db) + 4} className="eq-axis-label">
                {db > 0 ? `+${db}` : db}dB
              </text>
            </g>
          ))}

          <path d={fillPath} className="eq-fill" fill={`url(#${gradientId})`} pointerEvents="none" />
          <path d={curvePath} className="eq-curve" pointerEvents="none" />

          {EQ_BAND_KEYS.map((bandKey, index) => {
            const x = freqToX(EQ_BAND_FREQUENCIES[index])
            const y = dbToY(settings[bandKey])
            const isFocused = focusedBand === bandKey
            return (
              <g key={bandKey} pointerEvents="none">
                {isFocused ? (
                  <line
                    x1={x}
                    x2={x}
                    y1={GRAPH_PADDING_Y}
                    y2={GRAPH_HEIGHT - GRAPH_PADDING_Y}
                    className="eq-band-guide"
                  />
                ) : null}
                <circle cx={x} cy={y} r={isFocused ? 7 : 6} className={`eq-handle${isFocused ? ' active' : ''}`} />
              </g>
            )
          })}
        </svg>

        <div className="eq-band-inputs">
          {EQ_BAND_KEYS.map((bandKey, index) => (
            <EqBandField
              key={bandKey}
              bandKey={bandKey}
              label={bandLabels[index] ?? EQ_BAND_LABELS[index]}
              value={settings[bandKey]}
              disabled={!isInteractive}
              focused={focusedBand === bandKey}
              onFocus={setFocusedBand}
              onBlur={() => setFocusedBand(null)}
              onCommit={commitBand}
            />
          ))}
        </div>
        </div>
      </section>
  )

  if (isExpanded) {
    return createPortal(
      <div className="eq-expand-layer">
        <button
          type="button"
          className="eq-expand-backdrop"
          aria-label="Close equalizer"
          onClick={closeExpanded}
        />
        {panel}
      </div>,
      document.body,
    )
  }

  return panel
}

function equalizerPropsEqual(
  previous: GraphicalEqualizerProps,
  next: GraphicalEqualizerProps,
): boolean {
  return (
    previous.disabled === next.disabled &&
    previous.title === next.title &&
    previous.onChange === next.onChange &&
    previous.alwaysEditable === next.alwaysEditable &&
    previous.presets === next.presets &&
    previous.bandLabels === next.bandLabels &&
    previous.regionLabels === next.regionLabels &&
    routeEqualizersEqual(previous.value, next.value)
  )
}

export const GraphicalEqualizer = memo(GraphicalEqualizerInner, equalizerPropsEqual)
