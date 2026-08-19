// Shared contracts for the Record (video capture) and Editor (clip editing) tabs.
// Kept framework-agnostic so both the Electron main process and the React renderer
// can import the same types, channel names, and defaults.

export type VideoResolutionId = 'source' | '720p' | '1080p' | '1440p' | '2160p'

export interface VideoResolutionPreset {
  id: VideoResolutionId
  label: string
  width?: number
  height?: number
}

export const VIDEO_RESOLUTION_PRESETS: VideoResolutionPreset[] = [
  { id: 'source', label: 'Source' },
  { id: '720p', label: '720p', width: 1280, height: 720 },
  { id: '1080p', label: '1080p', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p', width: 2560, height: 1440 },
  { id: '2160p', label: '4K', width: 3840, height: 2160 },
]

export const VIDEO_FPS_OPTIONS = [24, 30, 60] as const
export type VideoFps = (typeof VIDEO_FPS_OPTIONS)[number]

// Hardware-accelerated encode families. On machines without the matching GPU/driver
// the runner transparently falls back to the software x264 encoder.
export type EncoderPreference = 'auto' | 'nvenc' | 'amf' | 'qsv' | 'x264' | 'x265'

export interface EncoderOption {
  id: EncoderPreference
  label: string
  vendor: string
  note: string
}

export const ENCODER_OPTIONS: EncoderOption[] = [
  { id: 'auto', label: 'Auto', vendor: 'Any', note: 'Pick the best available encoder' },
  { id: 'nvenc', label: 'NVENC (H.264)', vendor: 'NVIDIA', note: 'GeForce / RTX hardware encode' },
  { id: 'amf', label: 'AMF (H.264)', vendor: 'AMD', note: 'Radeon hardware encode' },
  { id: 'qsv', label: 'QuickSync (H.264)', vendor: 'Intel', note: 'Intel iGPU hardware encode' },
  { id: 'x264', label: 'x264 (software)', vendor: 'CPU', note: 'Universal software fallback' },
  { id: 'x265', label: 'x265 / HEVC (software)', vendor: 'CPU', note: 'Smaller files, slower encode' },
]

// ClearCast: FFmpeg-based voice isolation (RNNoise + subsonic/high-pass + gate +
// de-ess + speech normalize) that removes fans, hum, desk taps, low rumble, and room
// echo tails so only the speaker's voice remains. Strength 0–100 scales aggressiveness.
export interface ClearCastOptions {
  enabled: boolean
  strength: number
}

export const DEFAULT_CLEARCAST: ClearCastOptions = {
  enabled: false,
  strength: 85,
}

export function clampStrength(value: unknown, fallback: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(100, Math.max(0, Math.round(numeric)))
}

export function normalizeClearCast(raw: unknown): ClearCastOptions {
  const input = raw && typeof raw === 'object' ? (raw as Partial<ClearCastOptions>) : {}
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_CLEARCAST.enabled,
    strength: clampStrength(input.strength, DEFAULT_CLEARCAST.strength),
  }
}

export interface RecordingSettings {
  resolution: VideoResolutionId
  fps: VideoFps
  videoBitrateKbps: number
  audioBitrateKbps: number
  encoder: EncoderPreference
  captureAudio: boolean
  /** Remux/transcode the raw MediaRecorder capture to MP4 through FFmpeg on save. */
  transcodeToMp4: boolean
  /** ClearCast voice isolation applied to the recording's audio on save. */
  clearCast: ClearCastOptions
}

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  resolution: '1080p',
  fps: 60,
  videoBitrateKbps: 12_000,
  audioBitrateKbps: 160,
  encoder: 'auto',
  captureAudio: true,
  transcodeToMp4: true,
  clearCast: { ...DEFAULT_CLEARCAST },
}

export function normalizeRecordingSettings(raw: unknown): RecordingSettings {
  const input = raw && typeof raw === 'object' ? (raw as Partial<RecordingSettings>) : {}
  const resolution = VIDEO_RESOLUTION_PRESETS.some((preset) => preset.id === input.resolution)
    ? (input.resolution as VideoResolutionId)
    : DEFAULT_RECORDING_SETTINGS.resolution
  const fps = (VIDEO_FPS_OPTIONS as readonly number[]).includes(Number(input.fps))
    ? (Number(input.fps) as VideoFps)
    : DEFAULT_RECORDING_SETTINGS.fps
  const encoder = ENCODER_OPTIONS.some((option) => option.id === input.encoder)
    ? (input.encoder as EncoderPreference)
    : DEFAULT_RECORDING_SETTINGS.encoder

  const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
      return fallback
    }
    return Math.min(max, Math.max(min, Math.round(numeric)))
  }

  return {
    resolution,
    fps,
    videoBitrateKbps: clampNumber(
      input.videoBitrateKbps,
      DEFAULT_RECORDING_SETTINGS.videoBitrateKbps,
      1_000,
      100_000,
    ),
    audioBitrateKbps: clampNumber(
      input.audioBitrateKbps,
      DEFAULT_RECORDING_SETTINGS.audioBitrateKbps,
      32,
      512,
    ),
    encoder,
    captureAudio:
      typeof input.captureAudio === 'boolean'
        ? input.captureAudio
        : DEFAULT_RECORDING_SETTINGS.captureAudio,
    transcodeToMp4:
      typeof input.transcodeToMp4 === 'boolean'
        ? input.transcodeToMp4
        : DEFAULT_RECORDING_SETTINGS.transcodeToMp4,
    clearCast: normalizeClearCast(input.clearCast),
  }
}

export interface SaveRecordingPayload {
  data: ArrayBuffer | Uint8Array
  mimeType: string
  sourceName?: string
  settings: RecordingSettings
  durationMs: number
}

export interface SaveRecordingResult {
  path: string
  fileName: string
  folder: string
  transcoded: boolean
  container: string
  encoderUsed: string
}

export interface MediaInfo {
  path: string
  fileName: string
  durationSeconds: number
  width: number
  height: number
  fps: number
  codec: string
  hasAudio: boolean
}

// --- Color grading ------------------------------------------------------------

export interface ColorGrade {
  /** Exposure in stops, -2..2 (0 = neutral). */
  exposure: number
  /** Contrast multiplier around mid-grey, 0..2 (1 = neutral). */
  contrast: number
  /** Saturation multiplier, 0..2 (1 = neutral). */
  saturation: number
  /** Warm (+) / cool (-), -1..1. */
  temperature: number
  /** Green (-) / magenta (+), -1..1. */
  tint: number
  /** Shadow lift, -1..1 (0 = neutral). */
  lift: number
  /** Midtone gamma, 0.2..3 (1 = neutral). */
  gamma: number
  /** Highlight gain, 0..2 (1 = neutral). */
  gain: number
}

export const NEUTRAL_GRADE: ColorGrade = {
  exposure: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  lift: 0,
  gamma: 1,
  gain: 1,
}

export type GradeParam = keyof ColorGrade

// --- Keyframe / animation curve system ---------------------------------------

export type KeyframeInterpolation = 'linear' | 'hold' | 'ease'

export interface Keyframe {
  /** Seconds relative to the clip in-point. */
  time: number
  value: number
  interpolation: KeyframeInterpolation
}

/** Per-parameter keyframe lists. Absent params use the static grade value. */
export type AnimationCurves = Partial<Record<GradeParam, Keyframe[]>>

// --- Timeline / project model -------------------------------------------------

export interface EditorClip {
  id: string
  name: string
  sourcePath: string
  sourceDurationSeconds: number
  /** Trim in/out within the source media (seconds). */
  inPoint: number
  outPoint: number
  /** Start position on the timeline (seconds). */
  timelineStart: number
  grade: ColorGrade
  curves: AnimationCurves
  lutPath?: string
  lutName?: string
  lutIntensity: number
  fps: number
  width: number
  height: number
}

export interface EditorTrack {
  id: string
  kind: 'video' | 'audio'
  name: string
  clips: EditorClip[]
}

export interface EditorProject {
  version: number
  name: string
  fps: number
  width: number
  height: number
  tracks: EditorTrack[]
}

export const EDITOR_PROJECT_VERSION = 1

export function createEmptyProject(): EditorProject {
  return {
    version: EDITOR_PROJECT_VERSION,
    name: 'Untitled project',
    fps: 60,
    width: 1920,
    height: 1080,
    tracks: [
      { id: 'video-1', kind: 'video', name: 'Video 1', clips: [] },
      { id: 'audio-1', kind: 'audio', name: 'Audio 1', clips: [] },
    ],
  }
}

// --- Export -------------------------------------------------------------------

export interface ExportClipRequest {
  sourcePath: string
  inPoint: number
  outPoint: number
  grade: ColorGrade
  lutPath?: string
  lutIntensity: number
  encoder: EncoderPreference
  videoBitrateKbps: number
  audioBitrateKbps: number
  width?: number
  height?: number
  outputName?: string
  clearCast?: ClearCastOptions
}

export interface ExportResult {
  path: string
  fileName: string
  folder: string
  encoderUsed: string
  command: string
}

// --- Smart / analysis features ------------------------------------------------

export interface SilenceRange {
  start: number
  end: number
}

export interface HighlightMarker {
  time: number
  score: number
}

export interface AudioAnalysis {
  silences: SilenceRange[]
  highlights: HighlightMarker[]
  durationSeconds: number
}

export const videoStudioChannels = {
  getRecordingSettings: 'video:getRecordingSettings',
  setRecordingSettings: 'video:setRecordingSettings',
  saveRecording: 'video:saveRecording',
  openRecordingsFolder: 'video:openRecordingsFolder',
  probeMedia: 'video:probeMedia',
  pickMediaFile: 'video:pickMediaFile',
  pickLutFile: 'video:pickLutFile',
  readTextFile: 'video:readTextFile',
  readMediaFile: 'video:readMediaFile',
  exportClip: 'video:exportClip',
  saveProject: 'video:saveProject',
  loadProject: 'video:loadProject',
  detectEncoders: 'video:detectEncoders',
} as const

export interface VideoStudioApi {
  getRecordingSettings: () => Promise<RecordingSettings>
  setRecordingSettings: (patch: Partial<RecordingSettings>) => Promise<RecordingSettings>
  saveRecording: (payload: SaveRecordingPayload) => Promise<SaveRecordingResult>
  openRecordingsFolder: () => Promise<string>
  probeMedia: (path: string) => Promise<MediaInfo>
  pickMediaFile: () => Promise<MediaInfo | undefined>
  pickLutFile: () => Promise<{ path: string; name: string } | undefined>
  /** Read a small UTF-8 text file (e.g. a .cube LUT) from disk. */
  readTextFile: (path: string) => Promise<string>
  /** Read a media file as bytes so the renderer can decode audio / show a preview. */
  readMediaFile: (path: string) => Promise<Uint8Array>
  exportClip: (request: ExportClipRequest) => Promise<ExportResult>
  saveProject: (project: EditorProject) => Promise<{ path: string } | undefined>
  loadProject: () => Promise<{ project: EditorProject; path: string } | undefined>
  /** Encoders actually available in the bundled FFmpeg build on this machine. */
  detectEncoders: () => Promise<EncoderPreference[]>
}
