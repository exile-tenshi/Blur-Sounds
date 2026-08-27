import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** electron-builder unpacks native binaries beside app.asar — spawn needs the unpacked path. */
function resolveBundledBinary(originalPath: string): string {
  if (!originalPath.includes('app.asar')) {
    return originalPath
  }

  const unpacked = originalPath.replace('app.asar', 'app.asar.unpacked')
  if (existsSync(unpacked)) {
    return unpacked
  }

  return originalPath
}

export function resolveFfmpegPath(): string {
  const raw: string = require('ffmpeg-static')
  return resolveBundledBinary(raw)
}

export function resolveFfprobePath(): string {
  const raw: string = require('ffprobe-static').path
  return resolveBundledBinary(raw)
}
