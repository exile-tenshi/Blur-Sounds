import {
  NEUTRAL_GRADE,
  type AnimationCurves,
  type ColorGrade,
  type GradeParam,
  type Keyframe,
} from '../../shared/videoStudio'

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/** Sample a single keyframed parameter at a clip-relative time (seconds). */
export function sampleCurve(keyframes: Keyframe[], time: number, fallback: number): number {
  if (keyframes.length === 0) {
    return fallback
  }
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)
  if (time <= sorted[0].time) {
    return sorted[0].value
  }
  const last = sorted[sorted.length - 1]
  if (time >= last.time) {
    return last.value
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index]
    const next = sorted[index + 1]
    if (time >= current.time && time <= next.time) {
      if (current.interpolation === 'hold') {
        return current.value
      }
      const span = next.time - current.time
      const raw = span <= 0 ? 0 : (time - current.time) / span
      const t = current.interpolation === 'ease' ? easeInOut(raw) : raw
      return current.value + (next.value - current.value) * t
    }
  }
  return fallback
}

/** Resolve the effective grade at a clip-relative time, blending static + keyframes. */
export function resolveGradeAtTime(
  staticGrade: ColorGrade,
  curves: AnimationCurves,
  time: number,
): ColorGrade {
  const params = Object.keys(NEUTRAL_GRADE) as GradeParam[]
  const resolved = { ...staticGrade }
  for (const param of params) {
    const keyframes = curves[param]
    if (keyframes && keyframes.length > 0) {
      resolved[param] = sampleCurve(keyframes, time, staticGrade[param])
    }
  }
  return resolved
}

export function upsertKeyframe(
  curves: AnimationCurves,
  param: GradeParam,
  keyframe: Keyframe,
): AnimationCurves {
  const existing = curves[param] ?? []
  const withoutSameTime = existing.filter((item) => Math.abs(item.time - keyframe.time) > 0.001)
  return {
    ...curves,
    [param]: [...withoutSameTime, keyframe].sort((a, b) => a.time - b.time),
  }
}

export function removeKeyframesForParam(
  curves: AnimationCurves,
  param: GradeParam,
): AnimationCurves {
  const next = { ...curves }
  delete next[param]
  return next
}

export function countKeyframes(curves: AnimationCurves): number {
  return Object.values(curves).reduce((total, list) => total + (list?.length ?? 0), 0)
}
