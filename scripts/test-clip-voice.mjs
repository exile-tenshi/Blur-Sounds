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

const PHRASES = ['clip it blur', 'blur clip it']

function isCompleteClipVoicePhrase(text) {
  const normalized = normalizeClipVoiceText(text)
  return PHRASES.some((phrase) => phrase === normalized)
}

const cases = [
  ['clip it blur', true],
  ['blur clip it', true],
  ['Clip It Blur!', true],
  ['  blur   clip it  ', true],
  ['clip it', false],
  ['blur clip', false],
  ['clip it blu', false],
  ['hey clip it blur', false],
  ['clip it blur sounds', false],
  ['', false],
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
