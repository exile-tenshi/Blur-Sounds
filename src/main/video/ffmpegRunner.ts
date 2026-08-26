import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import type {
  ClearCastOptions,
  ColorGrade,
  EncoderPreference,
  ExportClipRequest,
  MediaInfo,
} from '../../shared/videoStudio.js'
import { buildClearCastFilter } from './clearCast.js'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

// ffmpeg-static exports the binary path as its default export; ffprobe-static exports { path }.
const ffmpegPath: string = require('ffmpeg-static')
const ffprobePath: string = require('ffprobe-static').path

const CODEC_BY_PREFERENCE: Record<Exclude<EncoderPreference, 'auto'>, string> = {
  nvenc: 'h264_nvenc',
  amf: 'h264_amf',
  qsv: 'h264_qsv',
  x264: 'libx264',
  x265: 'libx265',
}

let cachedEncoders: string[] | undefined

async function listFfmpegEncoders(): Promise<string[]> {
  if (cachedEncoders) {
    return cachedEncoders
  }
  try {
    const { stdout } = await execFileAsync(ffmpegPath, ['-hide_banner', '-encoders'], {
      maxBuffer: 1024 * 1024 * 8,
    })
    cachedEncoders = stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[1])
      .filter((name): name is string => Boolean(name))
    return cachedEncoders
  } catch {
    cachedEncoders = ['libx264']
    return cachedEncoders
  }
}

export async function detectAvailableEncoders(): Promise<EncoderPreference[]> {
  const encoders = await listFfmpegEncoders()
  const available: EncoderPreference[] = ['auto']
  const map: Array<[EncoderPreference, string]> = [
    ['nvenc', 'h264_nvenc'],
    ['amf', 'h264_amf'],
    ['qsv', 'h264_qsv'],
    ['x264', 'libx264'],
    ['x265', 'libx265'],
  ]
  for (const [preference, codec] of map) {
    if (encoders.includes(codec)) {
      available.push(preference)
    }
  }
  return available
}

/** Resolve a working video codec, honoring the preference but falling back to libx264. */
async function resolveVideoCodec(preference: EncoderPreference): Promise<string> {
  const encoders = await listFfmpegEncoders()
  if (preference !== 'auto') {
    const codec = CODEC_BY_PREFERENCE[preference]
    if (encoders.includes(codec)) {
      return codec
    }
  } else {
    // Prefer hardware when present, otherwise software.
    for (const codec of ['h264_nvenc', 'h264_qsv', 'h264_amf']) {
      if (encoders.includes(codec)) {
        return codec
      }
    }
  }
  return encoders.includes('libx264') ? 'libx264' : 'mpeg4'
}

export async function probeMedia(path: string, fileName: string): Promise<MediaInfo> {
  const { stdout } = await execFileAsync(
    ffprobePath,
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      path,
    ],
    { maxBuffer: 1024 * 1024 * 8 },
  )

  const parsed = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string
      codec_name?: string
      width?: number
      height?: number
      avg_frame_rate?: string
      r_frame_rate?: string
    }>
    format?: { duration?: string }
  }

  const streams = parsed.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video')
  const hasAudio = streams.some((stream) => stream.codec_type === 'audio')

  const parseFrameRate = (value?: string): number => {
    if (!value) {
      return 30
    }
    const [num, den] = value.split('/').map(Number)
    if (!den || !Number.isFinite(num) || !Number.isFinite(den)) {
      return Number(value) || 30
    }
    return den === 0 ? 30 : num / den
  }

  return {
    path,
    fileName,
    durationSeconds: Number(parsed.format?.duration) || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: Math.round(parseFrameRate(video?.avg_frame_rate || video?.r_frame_rate) * 100) / 100,
    codec: video?.codec_name ?? 'unknown',
    hasAudio,
  }
}

/** Escape a path for use inside an FFmpeg filtergraph option value. */
function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

/** Map the neutral-anchored ColorGrade onto an FFmpeg `eq` filter string. */
function gradeToEqFilter(grade: ColorGrade): string | undefined {
  const parts: string[] = []
  // eq brightness is additive in [-1,1]; approximate exposure stops as brightness.
  const brightness = Math.max(-1, Math.min(1, grade.exposure / 2))
  if (Math.abs(brightness) > 0.001) {
    parts.push(`brightness=${brightness.toFixed(4)}`)
  }
  if (Math.abs(grade.contrast - 1) > 0.001) {
    parts.push(`contrast=${grade.contrast.toFixed(4)}`)
  }
  if (Math.abs(grade.saturation - 1) > 0.001) {
    parts.push(`saturation=${grade.saturation.toFixed(4)}`)
  }
  if (Math.abs(grade.gamma - 1) > 0.001) {
    const gamma = Math.max(0.1, Math.min(10, grade.gamma))
    parts.push(`gamma=${gamma.toFixed(4)}`)
  }
  return parts.length > 0 ? `eq=${parts.join(':')}` : undefined
}

function temperatureFilter(grade: ColorGrade): string | undefined {
  if (Math.abs(grade.temperature) < 0.01) {
    return undefined
  }
  // Warm (+) lowers Kelvin, cool (-) raises it, anchored on 6500K.
  const kelvin = Math.round(6500 - grade.temperature * 3000)
  return `colortemperature=temperature=${Math.max(1000, Math.min(40000, kelvin))}`
}

interface BuiltFilters {
  /** FFmpeg args for the filtergraph (-vf/-af or -filter_complex + -map). */
  filterArgs: string[]
  usedRnnoise: boolean
}

function buildFilterArgs(request: ExportClipRequest): BuiltFilters {
  const videoChain: string[] = []
  if (request.width && request.height) {
    videoChain.push(`scale=${request.width}:${request.height}:flags=lanczos`)
  }
  const eq = gradeToEqFilter(request.grade)
  if (eq) {
    videoChain.push(eq)
  }
  const temp = temperatureFilter(request.grade)
  if (temp) {
    videoChain.push(temp)
  }

  const clear = request.clearCast?.enabled
    ? buildClearCastFilter(request.clearCast.strength, { deEcho: request.clearCast.deEcho })
    : undefined
  const audioChain = clear?.filter

  const fullLut = request.lutPath && request.lutIntensity >= 0.99
  const blendLut = request.lutPath && request.lutIntensity > 0.01 && request.lutIntensity < 0.99

  // Partial-intensity LUT needs a filter_complex blend; when present, audio (ClearCast)
  // must also live in the complex graph since -af cannot be combined with -filter_complex.
  if (blendLut && request.lutPath) {
    const pre = videoChain.length > 0 ? videoChain.join(',') + ',' : ''
    const opacity = request.lutIntensity.toFixed(3)
    let complex =
      `[0:v]${pre}split=2[base][lutin];` +
      `[lutin]lut3d=file='${escapeFilterPath(request.lutPath)}'[lutout];` +
      `[base][lutout]blend=all_mode=normal:all_opacity=${opacity}[vout]`
    const filterArgs = ['-filter_complex', '', '-map', '[vout]']
    if (audioChain) {
      complex += `;[0:a]${audioChain}[aout]`
      filterArgs.push('-map', '[aout]')
    } else {
      filterArgs.push('-map', '0:a?')
    }
    filterArgs[1] = complex
    return { filterArgs, usedRnnoise: clear?.usedRnnoise ?? false }
  }

  if (fullLut && request.lutPath) {
    videoChain.push(`lut3d=file='${escapeFilterPath(request.lutPath)}'`)
  }

  const filterArgs: string[] = []
  if (videoChain.length > 0) {
    filterArgs.push('-vf', videoChain.join(','))
  }
  if (audioChain) {
    filterArgs.push('-af', audioChain)
  }
  return { filterArgs, usedRnnoise: clear?.usedRnnoise ?? false }
}

export interface ExportRunResult {
  encoderUsed: string
  command: string
  clearCastUsedRnnoise?: boolean
}

export async function exportClip(
  request: ExportClipRequest,
  outputPath: string,
): Promise<ExportRunResult> {
  const codec = await resolveVideoCodec(request.encoder)
  const duration = Math.max(0.1, request.outPoint - request.inPoint)
  const { filterArgs, usedRnnoise } = buildFilterArgs(request)

  const args: string[] = [
    '-y',
    '-ss',
    request.inPoint.toFixed(3),
    '-i',
    request.sourcePath,
    '-t',
    duration.toFixed(3),
    ...filterArgs,
    '-c:v',
    codec,
    '-b:v',
    `${request.videoBitrateKbps}k`,
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    `${request.audioBitrateKbps}k`,
    outputPath,
  ]

  const command = `ffmpeg ${args.join(' ')}`

  try {
    await execFileAsync(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 16 })
  } catch (error) {
    // Hardware encoder unavailable at runtime → retry once with software x264.
    if (codec !== 'libx264') {
      const fallbackArgs = args.map((arg) => (arg === codec ? 'libx264' : arg))
      await execFileAsync(ffmpegPath, fallbackArgs, { maxBuffer: 1024 * 1024 * 16 })
      return {
        encoderUsed: 'libx264',
        command: `ffmpeg ${fallbackArgs.join(' ')}`,
        clearCastUsedRnnoise: usedRnnoise,
      }
    }
    throw error
  }

  return { encoderUsed: codec, command, clearCastUsedRnnoise: usedRnnoise }
}

/** Remux/transcode a raw capture blob file to MP4 with the chosen encoder. */
export async function transcodeToMp4(
  inputPath: string,
  outputPath: string,
  options: {
    encoder: EncoderPreference
    videoBitrateKbps: number
    audioBitrateKbps: number
    clearCast?: ClearCastOptions
  },
): Promise<ExportRunResult> {
  const codec = await resolveVideoCodec(options.encoder)
  const clear = options.clearCast?.enabled
    ? buildClearCastFilter(options.clearCast.strength, { deEcho: options.clearCast.deEcho })
    : undefined
  const args = [
    '-y',
    '-i',
    inputPath,
    ...(clear ? ['-af', clear.filter] : []),
    '-c:v',
    codec,
    '-b:v',
    `${options.videoBitrateKbps}k`,
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    `${options.audioBitrateKbps}k`,
    outputPath,
  ]
  const command = `ffmpeg ${args.join(' ')}`
  try {
    await execFileAsync(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 16 })
  } catch (error) {
    if (codec !== 'libx264') {
      const fallbackArgs = args.map((arg) => (arg === codec ? 'libx264' : arg))
      await execFileAsync(ffmpegPath, fallbackArgs, { maxBuffer: 1024 * 1024 * 16 })
      return { encoderUsed: 'libx264', command: `ffmpeg ${fallbackArgs.join(' ')}` }
    }
    throw error
  }
  return { encoderUsed: codec, command }
}
