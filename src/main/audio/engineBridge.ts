import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { accessSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import type {
  AudioDevice,
  DeviceSelection,
  EngineCommandPayload,
  EngineRouteTelemetry,
  EngineStatus,
  MicrophoneSlot,
  RoutedInput,
} from '../../shared/audioTypes.js'
import { readRouteEqualizer } from '../../shared/audioConstants.js'
import { normalizeMicrophoneSlots } from '../../shared/microphoneSlots.js'

interface EngineTelemetryEvent {
  type: 'telemetry'
  payload: EngineStatus & { routes: EngineRouteTelemetry[] }
}

interface EngineDevicePayload {
  name: string
  kind: 'input' | 'output'
  endpointId: string
  isAvailable: boolean
  isDefault: boolean
}

interface EngineDevicesEvent {
  type: 'devices'
  payload: {
    devices: EngineDevicePayload[]
  }
}

interface EngineHifiCableFormatEvent {
  type: 'hifiCableFormat'
  payload: {
    playbackConfigured: boolean
    recordingConfigured: boolean
    playbackDeviceName?: string
    recordingDeviceName?: string
    playbackStatus?: {
      deviceName: string
      sampleRate: number
      bitsPerSample: number
      exclusiveModeEnabled: boolean
      atStudioQuality: boolean
      formatLabel: string
    }
    recordingStatus?: {
      deviceName: string
      sampleRate: number
      bitsPerSample: number
      exclusiveModeEnabled: boolean
      atStudioQuality: boolean
      formatLabel: string
    }
    message: string
  }
}

interface EngineProbeEvent {
  type: 'probe'
  payload: {
    report: string
  }
}

type EngineEvent =
  | EngineTelemetryEvent
  | EngineDevicesEvent
  | EngineHifiCableFormatEvent
  | EngineProbeEvent

type TelemetryListener = (status: EngineStatus, routes: EngineRouteTelemetry[]) => void

import { createDefaultEngineStatus, normalizeEngineStatus } from '../../shared/engineStatus.js'

function createDisconnectedStatus(message?: string): EngineStatus {
  return normalizeEngineStatus({
    ...createDefaultEngineStatus(),
    message,
  })
}

export class NativeEngineBridge {
  private readonly engineDirectory: string
  private readonly runtimePath: string
  private readonly useDotnetHost: boolean
  private helper?: ChildProcessWithoutNullStreams
  private status: EngineStatus = createDisconnectedStatus()
  private routeTelemetry = new Map<string, EngineRouteTelemetry>()
  private listeners = new Set<TelemetryListener>()
  private stdoutBuffer = ''
  private helperReadyPromise?: Promise<void>
  private resolveHelperReady?: () => void
  private rejectHelperReady?: (error: Error) => void
  private operationQueue: Promise<void> = Promise.resolve()
  private pendingDevicesResolvers: Array<(devices: AudioDevice[]) => void> = []
  private pendingDevicesRejectors: Array<(error: Error) => void> = []
  private pendingHifiFormatResolvers: Array<(result: EngineHifiCableFormatEvent['payload']) => void> = []
  private pendingHifiFormatRejectors: Array<(error: Error) => void> = []
  private pendingProbeResolvers: Array<(report: string) => void> = []
  private pendingProbeRejectors: Array<(error: Error) => void> = []

  constructor() {
    const runtime = resolveEngineRuntime()
    this.engineDirectory = runtime.engineDirectory
    this.runtimePath = runtime.runtimePath
    this.useDotnetHost = runtime.useDotnetHost
  }

  subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener)
    listener(this.status, [...this.routeTelemetry.values()])
    return () => {
      this.listeners.delete(listener)
    }
  }

  getStatus(): EngineStatus {
    return this.status
  }

  getRouteTelemetry(): EngineRouteTelemetry[] {
    return [...this.routeTelemetry.values()]
  }

  async sync(payload: EngineCommandPayload): Promise<void> {
    return this.enqueueEngineOperation(async () => {
      await this.ensureHelper()
      this.sendCommand('sync', toEngineCommandPayload(payload.selection, payload.routes))
      await this.waitForCommandRoundTrip()
    })
  }

  async syncRoutes(payload: EngineCommandPayload): Promise<void> {
    return this.enqueueEngineOperation(async () => {
      await this.ensureHelper()
      this.sendCommand('syncRoutes', toEngineCommandPayload(payload.selection, payload.routes))
      await this.waitForCommandRoundTrip()
    })
  }

  async updateMix(selection: DeviceSelection, routes: RoutedInput[]): Promise<void> {
    return this.enqueueEngineOperation(async () => {
      await this.ensureHelper()
      // Volume/EQ/NS updates are fire-and-forget — waiting 80ms per change freezes the UI
      // when sliders or rapid toggles queue many commands.
      this.sendCommand('updateVolumes', toEngineVolumePayload(selection, routes))
    })
  }

  async start(selection: DeviceSelection, routes: RoutedInput[]): Promise<void> {
    return this.enqueueEngineOperation(async () => {
      await this.ensureHelper()
      const payload = toEngineCommandPayload(selection, routes)
      const canSyncInPlace =
        this.status.state === 'running' && this.status.selectedInputReady === true

      if (canSyncInPlace) {
        this.sendCommand('sync', payload)
        await this.waitForCommandRoundTrip()
        return
      }

      this.sendCommand('start', payload)
      await this.waitForEngineState('running', 12000)
    })
  }

  async stop(): Promise<void> {
    if (!this.helper) {
      this.status = createDisconnectedStatus()
      this.emit()
      return
    }

    return this.enqueueEngineOperation(async () => {
      this.sendCommand('stop', { selection: {}, routes: [] })
      await this.waitForCommandRoundTrip()
    })
  }

  async listDevices(): Promise<AudioDevice[]> {
    return this.enqueueEngineOperation(async () => {
      await this.ensureHelper()

      const devicesPromise = new Promise<AudioDevice[]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingDevicesResolvers = []
          this.pendingDevicesRejectors = []
          reject(new Error('Timed out while listing audio devices.'))
        }, 8000)

        this.pendingDevicesResolvers.push((devices) => {
          clearTimeout(timeout)
          resolve(devices)
        })
        this.pendingDevicesRejectors.push((error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      this.sendCommand('listDevices', { selection: {}, routes: [] })
      return devicesPromise
    })
  }

  async configureHifiCable(): Promise<EngineHifiCableFormatEvent['payload']> {
    return this.enqueueEngineOperation(async () => {
      await this.ensureHelper()

      const resultPromise = new Promise<EngineHifiCableFormatEvent['payload']>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingHifiFormatResolvers = []
          this.pendingHifiFormatRejectors = []
          reject(new Error('Timed out while applying Hi-Fi Cable studio settings.'))
        }, 12000)

        this.pendingHifiFormatResolvers.push((result) => {
          clearTimeout(timeout)
          resolve(result)
        })
        this.pendingHifiFormatRejectors.push((error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      this.sendCommand('configureHifiCable', { selection: {}, routes: [] })
      return resultPromise
    })
  }

  async probeHifiCable(): Promise<string> {
    return this.enqueueEngineOperation(async () => {
      await this.ensureHelper()

      const resultPromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingProbeResolvers = []
          this.pendingProbeRejectors = []
          reject(new Error('Timed out while testing Hi-Fi Cable.'))
        }, 15000)

        this.pendingProbeResolvers.push((report) => {
          clearTimeout(timeout)
          resolve(report)
        })
        this.pendingProbeRejectors.push((error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      this.sendCommand('probeHifiOutput', { selection: {}, routes: [] })
      return resultPromise
    })
  }

  dispose(): void {
    if (this.helper && !this.helper.killed) {
      this.helper.kill()
    }
  }

  private async ensureHelper(): Promise<void> {
    if (this.helper && !this.helper.killed) {
      return
    }

    await this.resolveRuntimePath()
    this.helperReadyPromise = new Promise<void>((resolve, reject) => {
      this.resolveHelperReady = resolve
      this.rejectHelperReady = reject
    })

    const readyTimeout = setTimeout(() => {
      this.rejectHelperReady?.(new Error('Engine helper timed out while starting.'))
      this.rejectHelperReady = undefined
      this.resolveHelperReady = undefined
    }, 10000)

    this.helperReadyPromise.finally(() => {
      clearTimeout(readyTimeout)
    })

    this.helper = this.useDotnetHost
      ? spawn('dotnet', [this.runtimePath], {
          cwd: this.engineDirectory,
          stdio: 'pipe',
          windowsHide: true,
        })
      : spawn(this.runtimePath, [], {
          cwd: this.engineDirectory,
          stdio: 'pipe',
          windowsHide: true,
        })

    this.status = {
      ...this.status,
      state: 'starting',
      helperConnected: true,
      message: 'Starting native audio engine...',
    }
    this.emit()

    this.helper.stdout.on('data', (chunk) => {
      this.stdoutBuffer += chunk.toString()
      this.flushStdoutBuffer()
    })

    this.helper.stderr.on('data', (chunk) => {
      this.status = {
        ...this.status,
        state: 'error',
        helperConnected: true,
        message: chunk.toString().trim(),
      }
      this.emit()
    })

    this.helper.on('exit', () => {
      this.helper = undefined
      this.routeTelemetry.clear()
      this.rejectHelperReady?.(new Error('Native audio engine exited before it was ready.'))
      this.rejectHelperReady = undefined
      this.resolveHelperReady = undefined
      this.status = createDisconnectedStatus()
      this.emit()
    })

    await this.helperReadyPromise
  }

  private waitForEngineState(targetState: EngineStatus['state'], timeoutMs: number): Promise<void> {
    if (this.status.state === targetState) {
      return Promise.resolve()
    }

    if (this.status.state === 'error') {
      return Promise.reject(new Error(this.status.message ?? 'Audio engine failed to start.'))
    }

    return new Promise((resolve, reject) => {
      let unsubscribe = () => {}

      const timeout = setTimeout(() => {
        unsubscribe()
        reject(new Error(this.status.message ?? `Audio engine did not reach ${targetState} state.`))
      }, timeoutMs)

      unsubscribe = this.subscribe((status) => {
        if (status.state === targetState) {
          clearTimeout(timeout)
          unsubscribe()
          resolve()
          return
        }

        if (status.state === 'error' && targetState === 'running') {
          clearTimeout(timeout)
          unsubscribe()
          reject(new Error(status.message ?? 'Audio engine failed to start.'))
        }
      })
    })
  }

  private enqueueEngineOperation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation)
    this.operationQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private waitForCommandRoundTrip(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 80)
    })
  }

  private markHelperReady(): void {
    if (!this.resolveHelperReady) {
      return
    }

    this.resolveHelperReady()
    this.resolveHelperReady = undefined
    this.rejectHelperReady = undefined
  }

  private async resolveRuntimePath(): Promise<string> {
    try {
      accessSync(this.runtimePath)
    } catch {
      throw new Error(
        this.useDotnetHost
          ? 'VoiceMeeterEngine is not built. Run: npm run build:engine'
          : 'VoiceMeeterEngine runtime is missing from the installed application.',
      )
    }

    return this.runtimePath
  }

  private flushStdoutBuffer(): void {
    const lines = this.stdoutBuffer.split(/\r?\n/)
    this.stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) {
        continue
      }

      try {
        const event = JSON.parse(line) as EngineEvent
        if (event.type === 'telemetry') {
          const routes = event.payload.routes ?? []
          const { routes: _routes, ...rawStatus } = event.payload
          this.status = normalizeEngineStatus(rawStatus)
          this.routeTelemetry = new Map(routes.map((route) => [route.appId, route]))
          this.markHelperReady()
          this.emit()
          continue
        }

        if (event.type === 'devices') {
          const devices = mapEngineDevices(event.payload.devices)
          for (const resolve of this.pendingDevicesResolvers) {
            resolve(devices)
          }
          this.pendingDevicesResolvers = []
          this.pendingDevicesRejectors = []
          this.markHelperReady()
          continue
        }

        if (event.type === 'hifiCableFormat') {
          for (const resolve of this.pendingHifiFormatResolvers) {
            resolve(event.payload)
          }
          this.pendingHifiFormatResolvers = []
          this.pendingHifiFormatRejectors = []
          this.markHelperReady()
          continue
        }

        if (event.type === 'probe') {
          for (const resolve of this.pendingProbeResolvers) {
            resolve(event.payload.report)
          }
          this.pendingProbeResolvers = []
          this.pendingProbeRejectors = []
          this.markHelperReady()
        }
      } catch (error) {
        this.status = {
          ...this.status,
          state: 'error',
          message: error instanceof Error ? error.message : 'Unable to parse engine telemetry.',
        }
        this.emit()
      }
    }
  }

  private sendCommand(type: string, payload: EngineCommandPayload): void {
    this.helper?.stdin.write(`${JSON.stringify({ type, payload })}\n`)
  }

  private emit(): void {
    const routes = [...this.routeTelemetry.values()]
    for (const listener of this.listeners) {
      listener(this.status, routes)
    }
  }
}

interface EngineRuntimePaths {
  engineDirectory: string
  runtimePath: string
  useDotnetHost: boolean
}

function resolveEngineRuntime(): EngineRuntimePaths {
  if (app.isPackaged) {
    const engineDirectory = join(process.resourcesPath, 'engine')
    return {
      engineDirectory,
      runtimePath: join(engineDirectory, 'VoiceMeeterEngine.exe'),
      useDotnetHost: false,
    }
  }

  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const bundledDirectory = join(projectRoot, 'resources', 'engine')
  const debugDirectory = join(
    projectRoot,
    'engine',
    'VoiceMeeterEngine',
    'bin',
    'Debug',
    'net8.0-windows10.0.19041.0',
  )

  // Always prefer the published Release engine when available — Debug builds are easy to leave stale.
  if (existsSync(join(bundledDirectory, 'VoiceMeeterEngine.exe'))) {
    return {
      engineDirectory: bundledDirectory,
      runtimePath: join(bundledDirectory, 'VoiceMeeterEngine.exe'),
      useDotnetHost: false,
    }
  }

  if (!app.isPackaged && existsSync(join(debugDirectory, 'VoiceMeeterEngine.dll'))) {
    return {
      engineDirectory: debugDirectory,
      runtimePath: join(debugDirectory, 'VoiceMeeterEngine.dll'),
      useDotnetHost: true,
    }
  }

  return {
    engineDirectory: debugDirectory,
    runtimePath: join(debugDirectory, 'VoiceMeeterEngine.dll'),
    useDotnetHost: true,
  }
}

function mapEngineDevices(devices: EngineDevicePayload[]): AudioDevice[] {
  return devices.map((device) => ({
    id: device.endpointId || `${device.kind}::${device.name}`,
    name: device.name,
    kind: device.kind,
    isAvailable: device.isAvailable,
    isDefault: device.isDefault,
  }))
}

function toEngineMicrophones(slots: MicrophoneSlot[]): MicrophoneSlot[] {
  return slots.map((slot) => ({
    id: slot.id,
    deviceId: slot.deviceId,
    muted: slot.muted ?? false,
    volume: slot.volume ?? 1,
    noiseSuppression: slot.noiseSuppressionSettings?.enabled ?? slot.noiseSuppression ?? false,
    noiseSuppressionSettings: slot.noiseSuppressionSettings,
  }))
}

function toEngineSelection(selection: DeviceSelection): DeviceSelection {
  if (!selection.inputDeviceId) {
    throw new Error('Select Hi-Fi Cable Input before starting the stream.')
  }

  return {
    microphones: toEngineMicrophones(normalizeMicrophoneSlots(selection)),
    inputDeviceId: selection.inputDeviceId,
  }
}

function toEngineRoutes(routes: RoutedInput[]): RoutedInput[] {
  return routes.map((route) => {
    const equalizer = readRouteEqualizer(route)
    return {
      routeId: route.routeId,
      appId: route.appId,
      processName: route.processName,
      target: route.target,
      volume: route.volume,
      muted: route.muted,
      eqEnabled: equalizer.enabled,
      band60Db: equalizer.band60Db,
      band150Db: equalizer.band150Db,
      band400Db: equalizer.band400Db,
      band1000Db: equalizer.band1000Db,
      band2400Db: equalizer.band2400Db,
      band15000Db: equalizer.band15000Db,
      level: 0,
      state: 'detached' as const,
    }
  })
}

function toEngineCommandPayload(
  selection: DeviceSelection,
  routes: RoutedInput[],
): EngineCommandPayload {
  return {
    selection: toEngineSelection(selection),
    routes: toEngineRoutes(routes),
  }
}

function toEngineVolumePayload(
  selection: DeviceSelection,
  routes: RoutedInput[],
): EngineCommandPayload {
  return {
    selection: {
      microphones: toEngineMicrophones(normalizeMicrophoneSlots(selection)),
      inputDeviceId: selection.inputDeviceId,
    },
    routes: toEngineRoutes(routes),
  }
}

