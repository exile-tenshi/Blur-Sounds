/**
 * Lightweight tests for clip voice phrase matching (no Windows speech required).
 * Run: node scripts/test-clip-voice.mjs
 */

function normalizeClipVoiceText(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const PHRASES = [
  'clip it blur',
  'blur clip it',
  'clip it blurr',
  'clip a blur',
  'clipped blur',
  'clip it blue',
  'blurred clip it',
  'blue clip it',
]

function isCompleteClipVoicePhrase(text) {
  const normalized = normalizeClipVoiceText(text)
  if (!normalized) {
    return false
  }
  if (PHRASES.some((phrase) => phrase === normalized)) {
    return true
  }
  if (/(?:^|\s)clip it blur(?:\s|$)/.test(normalized)) {
    return true
  }
  if (/(?:^|\s)blur clip it(?:\s|$)/.test(normalized)) {
    return true
  }
  if (/\bclip(?:ped)?\s+(?:it\s+)?(?:a\s+)?(?:blur+|blue)\b/.test(normalized)) {
    return true
  }
  if (/\b(?:blur+|blue|blurred)\s+clip(?:ped)?\s+it\b/.test(normalized)) {
    return true
  }
  return false
}

const cases = [
  ['clip it blur', true],
  ['blur clip it', true],
  ['Clip It Blur!', true],
  ['  blur   clip it  ', true],
  ['clip it blue', true],
  ['clip it blurr', true],
  ['clipped blur', true],
  ['hey clip it blur', true],
  ['clip it blur please', true],
  ['clip it', false],
  ['blur clip', false],
  ['clip it blu', false],
  ['', false],
  ['just talking about blur', false],
]

let failed = 0
for (const [input, expected] of cases) {
  const actual = isCompleteClipVoicePhrase(input)
  if (actual !== expected) {
    console.error(`FAIL: "${input}" expected ${expected}, got ${actual}`)
    failed += 1
  }
}

if (failed > 0) {
  console.error(`${failed} clip voice test(s) failed`)
  process.exit(1)
}

console.log(`clip voice phrase tests passed (${cases.length} cases)`)
