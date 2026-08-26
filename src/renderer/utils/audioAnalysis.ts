import type { AudioAnalysis, HighlightMarker, SilenceRange } from '../../shared/videoStudio'

// Local, model-free audio analysis: an RMS energy envelope drives voice-activity
// style dead-air detection and audio-spike auto-highlights. This is the testable
// stand-in for the Silero/WebRTC VAD + spike-detection features on the roadmap;
// it needs no network and no ML weights.

const WINDOW_SECONDS = 0.05
const SILENCE_RMS_THRESHOLD = 0.015
const MIN_SILENCE_SECONDS = 0.6
const HIGHLIGHT_MIN_GAP_SECONDS = 3

export async function analyzeAudio(bytes: Uint8Array, mimeType: string): Promise<AudioAnalysis> {
  const AudioCtx: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const context = new AudioCtx()

  try {
    const copy = bytes.slice().buffer
    void mimeType
    const audioBuffer = await context.decodeAudioData(copy)
    return analyzeBuffer(audioBuffer)
  } finally {
    void context.close()
  }
}

function analyzeBuffer(audioBuffer: AudioBuffer): AudioAnalysis {
  const { sampleRate, duration } = audioBuffer
  const channel = audioBuffer.getChannelData(0)
  const windowSize = Math.max(1, Math.floor(sampleRate * WINDOW_SECONDS))
  const windowCount = Math.floor(channel.length / windowSize)

  const envelope = new Float32Array(windowCount)
  let peak = 0
  for (let w = 0; w < windowCount; w += 1) {
    let sum = 0
    const start = w * windowSize
    for (let i = 0; i < windowSize; i += 1) {
      const sample = channel[start + i]
      sum += sample * sample
    }
    const rms = Math.sqrt(sum / windowSize)
    envelope[w] = rms
    if (rms > peak) {
      peak = rms
    }
  }

  const silences = detectSilences(envelope, windowCount)
  const highlights = detectHighlights(envelope, peak)

  return { silences, highlights, durationSeconds: duration }
}

function detectSilences(envelope: Float32Array, windowCount: number): SilenceRange[] {
  const silences: SilenceRange[] = []
  let runStart = -1
  for (let w = 0; w < windowCount; w += 1) {
    const isSilent = envelope[w] < SILENCE_RMS_THRESHOLD
    if (isSilent && runStart < 0) {
      runStart = w
    } else if (!isSilent && runStart >= 0) {
      pushSilence(silences, runStart, w)
      runStart = -1
    }
  }
  if (runStart >= 0) {
    pushSilence(silences, runStart, windowCount)
  }
  return silences
}

function pushSilence(silences: SilenceRange[], startWindow: number, endWindow: number): void {
  const start = startWindow * WINDOW_SECONDS
  const end = endWindow * WINDOW_SECONDS
  if (end - start >= MIN_SILENCE_SECONDS) {
    silences.push({ start: Number(start.toFixed(2)), end: Number(end.toFixed(2)) })
  }
}

function detectHighlights(envelope: Float32Array, peak: number): HighlightMarker[] {
  if (peak <= 0) {
    return []
  }
  const threshold = peak * 0.7
  const markers: HighlightMarker[] = []
  let lastTime = -HIGHLIGHT_MIN_GAP_SECONDS
  for (let w = 1; w < envelope.length - 1; w += 1) {
    const value = envelope[w]
    const isLocalMax = value >= envelope[w - 1] && value >= envelope[w + 1]
    if (value >= threshold && isLocalMax) {
      const time = w * WINDOW_SECONDS
      if (time - lastTime >= HIGHLIGHT_MIN_GAP_SECONDS) {
        markers.push({ time: Number(time.toFixed(2)), score: Number((value / peak).toFixed(3)) })
        lastTime = time
      }
    }
  }
  return markers.slice(0, 20)
}
