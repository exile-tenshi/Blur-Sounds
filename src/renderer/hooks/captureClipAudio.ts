import { isHifiCableRecordingDevice } from '../../shared/hifiCable.js'

export interface ClipAudioCapture {
  stream: MediaStream
  cleanup: () => void
}

async function ensureAudioPermission(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This system cannot capture clip audio.')
  }
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    probe.getTracks().forEach((track) => track.stop())
  } catch {
    // enumerateDevices may still work if permission was granted earlier.
  }
}

async function findHifiCableOutputDeviceId(): Promise<string | undefined> {
  await ensureAudioPermission()
  const devices = await navigator.mediaDevices.enumerateDevices()
  const match = devices.find(
    (device) => device.kind === 'audioinput' && isHifiCableRecordingDevice(device.label || ''),
  )
  return match?.deviceId
}

async function openMicStream(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  })
}

/**
 * Build the audio bus for Clip it:
 * - Selected applications → Hi-Fi Cable Output (Blur mix — keep those apps routed + stream on)
 * - Selected microphones → direct device capture
 */
export async function captureClipAudioStream(options: {
  includeAppMix: boolean
  microphoneIds: string[]
}): Promise<ClipAudioCapture | undefined> {
  const sources: MediaStream[] = []

  if (options.includeAppMix) {
    const cableId = await findHifiCableOutputDeviceId()
    if (!cableId) {
      throw new Error(
        'App audio needs Hi-Fi Cable Output. Enable it under Windows Sound → Recording, then Refresh in Setup.',
      )
    }
    sources.push(
      await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: cableId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      }),
    )
  }

  for (const microphoneId of options.microphoneIds) {
    try {
      sources.push(await openMicStream(microphoneId))
    } catch {
      // Skip unavailable devices; keep other sources.
    }
  }

  if (sources.length === 0) {
    return undefined
  }

  if (sources.length === 1) {
    const stream = sources[0]
    return {
      stream,
      cleanup: () => {
        stream.getTracks().forEach((track) => track.stop())
      },
    }
  }

  const context = new AudioContext()
  const destination = context.createMediaStreamDestination()
  for (const source of sources) {
    context.createMediaStreamSource(source).connect(destination)
  }

  return {
    stream: destination.stream,
    cleanup: () => {
      for (const source of sources) {
        source.getTracks().forEach((track) => track.stop())
      }
      void context.close()
    },
  }
}
