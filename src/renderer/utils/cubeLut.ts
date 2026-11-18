// Minimal Adobe/IRIDAS .cube 3D LUT parser. Produces an 8-bit RGB volume laid
// out with the red axis varying fastest (matching both the .cube spec and the
// order expected by WebGL texImage3D), ready to upload as a sampler3D.

export interface CubeLut {
  size: number
  /** size^3 * 3 bytes, red-fastest ordering. */
  data: Uint8Array
}

export function parseCubeLut(text: string): CubeLut {
  const lines = text.split(/\r?\n/)
  let size = 0
  let domainMin = [0, 0, 0]
  let domainMax = [1, 1, 1]
  const values: number[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const upper = line.toUpperCase()
    if (upper.startsWith('TITLE')) {
      continue
    }
    if (upper.startsWith('LUT_3D_SIZE')) {
      size = Number(line.split(/\s+/)[1])
      continue
    }
    if (upper.startsWith('LUT_1D_SIZE')) {
      throw new Error('1D LUTs are not supported. Use a 3D .cube LUT.')
    }
    if (upper.startsWith('DOMAIN_MIN')) {
      domainMin = line.split(/\s+/).slice(1).map(Number)
      continue
    }
    if (upper.startsWith('DOMAIN_MAX')) {
      domainMax = line.split(/\s+/).slice(1).map(Number)
      continue
    }
    const parts = line.split(/\s+/).map(Number)
    if (parts.length >= 3 && parts.every((value) => Number.isFinite(value))) {
      values.push(parts[0], parts[1], parts[2])
    }
  }

  if (!size || values.length !== size * size * size * 3) {
    throw new Error('Invalid or unsupported .cube LUT (size/entry mismatch).')
  }

  const spanR = (domainMax[0] ?? 1) - (domainMin[0] ?? 0) || 1
  const spanG = (domainMax[1] ?? 1) - (domainMin[1] ?? 0) || 1
  const spanB = (domainMax[2] ?? 1) - (domainMin[2] ?? 0) || 1

  const data = new Uint8Array(values.length)
  for (let index = 0; index < values.length; index += 3) {
    const r = (values[index] - (domainMin[0] ?? 0)) / spanR
    const g = (values[index + 1] - (domainMin[1] ?? 0)) / spanG
    const b = (values[index + 2] - (domainMin[2] ?? 0)) / spanB
    data[index] = Math.max(0, Math.min(255, Math.round(r * 255)))
    data[index + 1] = Math.max(0, Math.min(255, Math.round(g * 255)))
    data[index + 2] = Math.max(0, Math.min(255, Math.round(b * 255)))
  }

  return { size, data }
}
