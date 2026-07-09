import { useEffect, useRef, useState } from 'react'
import { MAX_INPUT_GAIN, MIN_INPUT_GAIN } from '../../shared/audioConstants'

interface GainSliderProps {
  value: number
  disabled?: boolean
  onCommit: (value: number) => void
}

export function GainSlider({ value, disabled = false, onCommit }: GainSliderProps) {
  const [localValue, setLocalValue] = useState(value)
  const isDraggingRef = useRef(false)
  const localValueRef = useRef(value)

  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(value)
      localValueRef.current = value
    }
  }, [value])

  const commitValue = (nextValue: number) => {
    localValueRef.current = nextValue
    onCommit(nextValue)
  }

  return (
    <input
      type="range"
      min={MIN_INPUT_GAIN}
      max={MAX_INPUT_GAIN}
      step={0.05}
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
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
          commitValue(localValueRef.current)
        }
      }}
    />
  )
}
