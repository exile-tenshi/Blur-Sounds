import { memo } from 'react'

interface LevelMeterProps {
  level: number
  label?: string
  compact?: boolean
}

function LevelMeterInner({ level, label, compact = false }: LevelMeterProps) {
  const clampedLevel = Math.max(0, Math.min(1, level))
  const percentage = Math.round(clampedLevel * 100)

  return (
    <div
      className={`level-meter${compact ? ' level-meter-compact' : ''}`}
      aria-label={label ?? `Audio level ${percentage}%`}
    >
      <div className="level-meter-track">
        <div className="level-meter-fill" style={{ width: `${percentage}%` }} />
      </div>
      {!compact ? <span className="level-meter-value">{percentage}%</span> : null}
    </div>
  )
}

export const LevelMeter = memo(LevelMeterInner)
