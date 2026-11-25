import { memo } from 'react'

interface LevelMeterProps {
  level: number
  label?: string
  compact?: boolean
  /** When set, meter is idle (e.g. stream stopped) — show hint instead of a dead 0%. */
  idleLabel?: string
}

function LevelMeterInner({ level, label, compact = false, idleLabel }: LevelMeterProps) {
  const isIdle = Boolean(idleLabel)
  const clampedLevel = Math.max(0, Math.min(1, isIdle ? 0 : level))
  const percentage = Math.round(clampedLevel * 100)

  return (
    <div
      className={`level-meter${compact ? ' level-meter-compact' : ''}${isIdle ? ' is-idle' : ''}`}
      aria-label={label ?? (isIdle ? idleLabel : `Audio level ${percentage}%`)}
    >
      <div className="level-meter-track">
        <div className="level-meter-fill" style={{ width: `${percentage}%` }} />
      </div>
      {!compact ? (
        <span className="level-meter-value">{isIdle ? idleLabel : `${percentage}%`}</span>
      ) : null}
    </div>
  )
}

export const LevelMeter = memo(LevelMeterInner)
