/** Soft majestic clip confirmation tone (Web Audio — no asset file). */

let sharedContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) {
    return null
  }

  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new Ctx()
  }

  return sharedContext
}

/**
 * Warm major-chord chime with a gentle swell — confirmation that Clip it fired.
 */
export function playClipChime(): void {
  const context = getAudioContext()
  if (!context) {
    return
  }

  void context.resume().then(() => {
    const now = context.currentTime
    const master = context.createGain()
    master.gain.setValueAtTime(0.0001, now)
    master.gain.exponentialRampToValueAtTime(0.22, now + 0.08)
    master.gain.exponentialRampToValueAtTime(0.12, now + 0.45)
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.35)
    master.connect(context.destination)

    // Soft majestic C major triad + high sparkle (C4 E4 G4 C5), slightly detuned bells.
    const partials: Array<{ freq: number; gain: number; delay: number }> = [
      { freq: 261.63, gain: 0.55, delay: 0 },
      { freq: 329.63, gain: 0.42, delay: 0.04 },
      { freq: 392.0, gain: 0.38, delay: 0.08 },
      { freq: 523.25, gain: 0.28, delay: 0.14 },
      { freq: 659.25, gain: 0.16, delay: 0.2 },
    ]

    for (const partial of partials) {
      const start = now + partial.delay
      const osc = context.createOscillator()
      const gain = context.createGain()
      const filter = context.createBiquadFilter()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(partial.freq, start)
      // Tiny slow drift for a softer, less digital feel.
      osc.frequency.linearRampToValueAtTime(partial.freq * 1.003, start + 1.1)

      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(2400, start)
      filter.Q.setValueAtTime(0.7, start)

      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(partial.gain, start + 0.06)
      gain.gain.exponentialRampToValueAtTime(partial.gain * 0.45, start + 0.5)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.15)

      osc.connect(filter)
      filter.connect(gain)
      gain.connect(master)

      osc.start(start)
      osc.stop(start + 1.2)
    }
  })
}
