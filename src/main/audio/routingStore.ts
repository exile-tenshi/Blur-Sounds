import type {
  AudioSnapshot,
  AudioDevice,
  DeviceSelection,
  EngineRouteTelemetry,
  EngineStatus,
  RoutedInput,
  SetDeviceSelectionPayload,
  SetMicrophoneMutedPayload,
  SetMicrophoneNoiseSuppressionPayload,
  SetMicrophoneVolumePayload,
  SetRouteAssignmentPayload,
  SetRouteMutedPayload,
  SetRouteEqualizerPayload,
  SetRouteVolumePayload,
} from '../../shared/audioTypes.js'
import {
  clampInputGain,
  DEFAULT_ROUTE_EQUALIZER,
  DEFAULT_INPUT_GAIN,
  equalizerSettingsToPayload,
  readRouteEqualizer,
  type RouteEqualizerSettings,
} from '../../shared/audioConstants.js'
import {
  addMicrophoneSlot,
  createDefaultMicrophoneSlots,
  hasActiveMicrophoneSlot,
  normalizeMicrophoneSlots,
  updateMicrophoneSlot,
} from '../../shared/microphoneSlots.js'
import {
  findMatchingRecordingDevice,
  isRecordingEndpointDevice,
  isSelectableMicrophoneDevice,
} from '../../shared/audioLabels.js'
import { remapStaleApplicationRoutes } from '../../shared/appRouteRemap.js'
import { createDefaultEngineStatus, normalizeEngineStatus } from '../../shared/engineStatus.js'
import {
  detectHifiCableDependency,
  describeHifiFormatStartBlocker,
  findHifiCablePlaybackDevice,
  findHifiCableRecordingDevice,
  formatHifiCableRecordingUnavailableMessage,
  formatHifiCableUnavailableMessage,
  getHifiCableSelectionDefaults,
  isHifiCablePlaybackDevice,
  mergeHifiCableFormatStatus,
} from '../../shared/hifiCable.js'
import type { HifiCableFormatResult } from '../../shared/audioApi.js'
import { NativeEngineBridge } from './engineBridge.js'
import { listActiveApplications, listAudioDevices } from './windowsAudioService.js'

type SnapshotListener = (snapshot: AudioSnapshot) => void

function mergeAudioDevices(primary: AudioDevice[], secondary: AudioDevice[]): AudioDevice[] {
  const merged = new Map<string, AudioDevice>()

  for (const device of secondary) {
    const key = `${device.kind}::${device.name.trim().toLowerCase()}`
    merged.set(key, device)
  }

  for (const device of primary) {
    const key = `${device.kind}::${device.name.trim().toLowerCase()}`
    merged.set(key, device)
  }

  return [...merged.values()]
}

function listRecordingEndpointDevices(devices: AudioSnapshot['devices']): AudioSnapshot['devices'] {
  return devices.filter(
    (device) => device.kind === 'input' && device.isAvailable && isRecordingEndpointDevice(device.name),
  )
}

function resolveRecordingDeviceId(
  inputDevice: AudioSnapshot['devices'][number] | undefined,
  recordingDevices: AudioSnapshot['devices'],
  currentRecordingDeviceId?: string,
): string | undefined {
  if (
    currentRecordingDeviceId &&
    recordingDevices.some((device) => device.id === currentRecordingDeviceId)
  ) {
    return currentRecordingDeviceId
  }

  if (inputDevice) {
    const paired = findHifiCableRecordingDevice(recordingDevices, inputDevice)
    if (paired) {
      return paired.id
    }

    return findMatchingRecordingDevice(inputDevice.name, recordingDevices)?.id ?? recordingDevices[0]?.id
  }

  const preferred = findHifiCableRecordingDevice(recordingDevices)
  return preferred?.id ?? recordingDevices.find((device) => device.isDefault)?.id ?? recordingDevices[0]?.id
}

function clampVolume(volume: number): number {
  return clampInputGain(volume)
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0
  }

  return Math.max(0, Math.min(1, level))
}

function applyEqualizerToRoute(route: RoutedInput, equalizer: RouteEqualizerSettings): void {
  const eq = equalizerSettingsToPayload(equalizer)
  route.eqEnabled = eq.enabled
  route.band60Db = eq.band60Db
  route.band150Db = eq.band150Db
  route.band400Db = eq.band400Db
  route.band1000Db = eq.band1000Db
  route.band2400Db = eq.band2400Db
  route.band15000Db = eq.band15000Db
}

function readStoredEqualizer(route: RoutedInput | undefined): RouteEqualizerSettings {
  return route ? readRouteEqualizer(route) : { ...DEFAULT_ROUTE_EQUALIZER }
}

function buildRouteId(appId: string, target: RoutedInput['target']): string {
  return `${target}:${appId}`
}

function matchDeviceId(
  selectedId: string | undefined,
  devices: AudioSnapshot['devices'],
): string | undefined {
  if (!selectedId) {
    return undefined
  }

  if (devices.some((device) => device.id === selectedId)) {
    return selectedId
  }

  const legacyName = selectedId.includes('::') ? selectedId.split('::').slice(1).join('::') : selectedId
  const byName = devices.find((device) => device.name === legacyName)
  if (byName) {
    return byName.id
  }

  const byPartialName = devices.find(
    (device) =>
      device.name.toLowerCase().includes(legacyName.toLowerCase()) ||
      legacyName.toLowerCase().includes(device.name.toLowerCase()),
  )
  return byPartialName?.id
}

function resolveInputDeviceId(
  currentId: string | undefined,
  outputDevices: AudioSnapshot['devices'],
  preferredInput: AudioSnapshot['devices'][number] | undefined,
): string | undefined {
  const matchedId = matchDeviceId(currentId, outputDevices)
  if (
    matchedId &&
    outputDevices.some(
      (device) => device.id === matchedId && isHifiCablePlaybackDevice(device.name),
    )
  ) {
    return matchedId
  }

  return (
    preferredInput?.id ??
    outputDevices.find((device) => isHifiCablePlaybackDevice(device.name))?.id
  )
}

function createInitialEngineStatus(): EngineStatus {
  return createDefaultEngineStatus()
}

export class RoutingStore {
  private selection: DeviceSelection = {
    microphones: createDefaultMicrophoneSlots(),
  }
  private routedInputs = new Map<string, RoutedInput>()
  private listeners = new Set<SnapshotListener>()
  private devices: AudioSnapshot['devices'] = []
  private applications: AudioSnapshot['applications'] = []
  private engine = new NativeEngineBridge()
  private engineStatus: EngineStatus = createInitialEngineStatus()
  private telemetryByAppId = new Map<string, EngineRouteTelemetry>()
  private telemetryEmitTimer?: ReturnType<typeof setTimeout>
  private lastTelemetryEmitAt = 0
  /** Keep level meters near real-time; remap/list work stays on slower timers. */
  private readonly telemetryEmitIntervalMs = 100
  private lastRouteRemapAt = 0
  private readonly routeRemapIntervalMs = 2000
  private hifiCableFormatStatus?: HifiCableFormatResult
  private pendingMixSync = false
  private mixSyncInFlight?: Promise<void>

  constructor() {
    this.engine.subscribe((status, routeTelemetry) => {
      this.engineStatus = normalizeEngineStatus(status)
      this.telemetryByAppId = new Map(routeTelemetry.map((route) => [route.appId, route]))
      this.applyTelemetryToRoutes()
      this.maybeRemapApplicationRoutes()
      this.scheduleTelemetryEmit()
    })
  }

  /** Coalesce rapid volume/EQ/NS updates so the UI never waits on a backlog of engine IPC. */
  private scheduleMixSync(): void {
    if (!this.canSyncMixLevels()) {
      return
    }

    this.pendingMixSync = true
    if (this.mixSyncInFlight) {
      return
    }

    this.mixSyncInFlight = (async () => {
      while (this.pendingMixSync) {
        this.pendingMixSync = false
        if (!this.canSyncMixLevels()) {
          break
        }

        try {
          await this.engine.updateMix(this.selection, this.getSortedRoutes())
        } catch (error) {
          this.setEngineError(
            error instanceof Error ? error.message : 'Unable to update mix levels.',
          )
          break
        }
      }
    })().finally(() => {
      this.mixSyncInFlight = undefined
      if (this.pendingMixSync) {
        this.scheduleMixSync()
      }
    })
  }

  private maybeRemapApplicationRoutes(): void {
    if (!this.isEngineActive() || this.applications.length === 0 || this.routedInputs.size === 0) {
      return
    }

    const now = Date.now()
    if (now - this.lastRouteRemapAt < this.routeRemapIntervalMs) {
      return
    }

    const knownAppIds = new Set(this.applications.map((application) => application.id))
    const needsAttention = [...this.routedInputs.values()].some((route) => !knownAppIds.has(route.appId))
    if (!needsAttention) {
      return
    }

    const remapped = remapStaleApplicationRoutes(
      this.routedInputs,
      this.applications,
      this.engineStatus.sessionLevels,
    )

    if (!remapped) {
      return
    }

    this.lastRouteRemapAt = now
    void this.syncEngineRoutes().catch((error) => {
      this.setEngineError(error instanceof Error ? error.message : 'Unable to remap application routes.')
    })
  }

  private scheduleTelemetryEmit(): void {
    const elapsed = Date.now() - this.lastTelemetryEmitAt

    if (elapsed >= this.telemetryEmitIntervalMs) {
      if (this.telemetryEmitTimer) {
        clearTimeout(this.telemetryEmitTimer)
        this.telemetryEmitTimer = undefined
      }

      this.lastTelemetryEmitAt = Date.now()
      this.emit(this.buildSnapshot())
      return
    }

    if (this.telemetryEmitTimer) {
      return
    }

    this.telemetryEmitTimer = setTimeout(() => {
      this.telemetryEmitTimer = undefined
      this.lastTelemetryEmitAt = Date.now()
      this.emit(this.buildSnapshot())
    }, this.telemetryEmitIntervalMs - elapsed)
  }

  buildSnapshot(): AudioSnapshot {
    return {
      devices: this.devices,
      applications: this.applications,
      routedInputs: this.getSortedRoutes(),
      selection: this.selection,
      backendMode: 'native-engine',
      engine: this.engineStatus,
      hifiCable: mergeHifiCableFormatStatus(
        detectHifiCableDependency(this.devices),
        this.hifiCableFormatStatus,
      ),
      lastUpdatedAt: new Date().toISOString(),
    }
  }

  private emitCachedSnapshot(): AudioSnapshot {
    const snapshot = this.buildSnapshot()
    this.emit(snapshot)
    return snapshot
  }

  private isEngineActive(): boolean {
    return (
      this.engineStatus.helperConnected &&
      (this.engineStatus.state === 'running' || this.engineStatus.state === 'starting')
    )
  }

  private canSyncMixLevels(): boolean {
    return this.isEngineActive()
  }

  private hasStreamableMix(): boolean {
    return (
      hasActiveMicrophoneSlot(normalizeMicrophoneSlots(this.selection)) ||
      this.getSortedRoutes().length > 0
    )
  }

  private setEngineError(message: string): void {
    this.engineStatus = {
      ...this.engineStatus,
      state: 'error',
      message,
    }
    this.telemetryByAppId.clear()
    this.applyTelemetryToRoutes()
  }

  private normalizeRouteState(state: RoutedInput['state']): RoutedInput['state'] {
    if (!this.isEngineActive()) {
      return 'detached'
    }

    return state
  }

  async getSnapshot(): Promise<AudioSnapshot> {
    if (this.devices.length === 0) {
      return this.refreshDevices()
    }

    return this.buildSnapshot()
  }

  async refreshDevices(): Promise<AudioSnapshot> {
    const [engineDevices, fallbackDevices, applications] = await Promise.all([
      this.engine.listDevices().catch(() => [] as AudioDevice[]),
      listAudioDevices().catch(() => [] as AudioDevice[]),
      listActiveApplications(),
    ])
    const devices = mergeAudioDevices(engineDevices, fallbackDevices)
    this.devices = devices
    this.applications = applications
    this.ensureValidSelection(devices)
    const routesRemapped = remapStaleApplicationRoutes(
      this.routedInputs,
      applications,
      this.engineStatus.sessionLevels,
    )

    // Do not auto-apply Hi-Fi Cable PolicyConfig on every refresh — that COM/registry
    // work can freeze the UI for seconds. Users apply via Setup / Start stream.

    if (this.isEngineActive()) {
      try {
        if (routesRemapped) {
          await this.syncEngineRoutes()
        } else {
          await this.ensureEngineRunning()
        }
      } catch (error) {
        this.setEngineError(
          error instanceof Error ? error.message : 'Unable to refresh the audio engine.',
        )
      }
    }

    const snapshot = this.buildSnapshot()
    this.emit(snapshot)
    return snapshot
  }

  async refresh(): Promise<AudioSnapshot> {
    return this.refreshDevices()
  }

  async setDeviceSelection(payload: SetDeviceSelectionPayload): Promise<AudioSnapshot> {
    const outputDevices = this.devices.filter((device) => device.kind === 'output' && device.isAvailable)
    const recordingDevices = listRecordingEndpointDevices(this.devices)
    const inputChanged =
      payload.inputDeviceId !== undefined && payload.inputDeviceId !== this.selection.inputDeviceId
    let nextInputId = payload.inputDeviceId ?? this.selection.inputDeviceId

    let nextRecordingId = payload.recordingDeviceId ?? this.selection.recordingDeviceId
    if (payload.recordingDeviceId !== undefined) {
      nextRecordingId = payload.recordingDeviceId
    } else if (inputChanged && nextInputId) {
      const inputDevice = outputDevices.find((device) => device.id === nextInputId)
      nextRecordingId = resolveRecordingDeviceId(inputDevice, recordingDevices)
    }

    // Preserve noise-suppression fields — stripping them made Noise look like the mic
    // was never picked up after Track mic / device changes.
    let nextMicrophones = payload.microphones
      ? normalizeMicrophoneSlots({ microphones: payload.microphones })
      : normalizeMicrophoneSlots(this.selection)

    if (payload.microphoneId !== undefined) {
      const firstSlot = nextMicrophones[0] ?? createDefaultMicrophoneSlots()[0]
      nextMicrophones = [
        {
          ...firstSlot,
          deviceId: payload.microphoneId || undefined,
          noiseSuppression: firstSlot.noiseSuppression,
          noiseSuppressionSettings: firstSlot.noiseSuppressionSettings,
        },
        ...nextMicrophones.slice(1),
      ]
    }

    this.selection = {
      microphones: nextMicrophones.length > 0 ? nextMicrophones : createDefaultMicrophoneSlots(),
      inputDeviceId: nextInputId,
      recordingDeviceId: nextRecordingId,
    }

    if (this.devices.length > 0) {
      this.ensureValidSelection(this.devices)
    }

    const engineSelectionChanged =
      payload.inputDeviceId !== undefined ||
      payload.recordingDeviceId !== undefined ||
      payload.microphoneId !== undefined ||
      payload.microphones !== undefined

    if (this.isEngineActive() && engineSelectionChanged) {
      try {
        await this.ensureEngineRunning()
      } catch (error) {
        this.setEngineError(
          error instanceof Error ? error.message : 'Unable to update the audio engine.',
        )
      }
    }

    return this.emitCachedSnapshot()
  }

  async setMicrophoneMuted(payload: SetMicrophoneMutedPayload): Promise<AudioSnapshot> {
    const slots = normalizeMicrophoneSlots(this.selection)
    const slotId = payload.slotId ?? slots.find((slot) => slot.deviceId)?.id ?? slots[0]?.id

    if (!slotId) {
      return this.emitCachedSnapshot()
    }

    this.selection = {
      ...this.selection,
      microphones: updateMicrophoneSlot(slots, slotId, { muted: payload.muted }),
    }

    this.scheduleMixSync()
    return this.emitCachedSnapshot()
  }

  async setMicrophoneVolume(payload: SetMicrophoneVolumePayload): Promise<AudioSnapshot> {
    const slots = normalizeMicrophoneSlots(this.selection)
    const slotId = payload.slotId ?? slots.find((slot) => slot.deviceId)?.id ?? slots[0]?.id

    if (!slotId) {
      return this.emitCachedSnapshot()
    }

    this.selection = {
      ...this.selection,
      microphones: updateMicrophoneSlot(slots, slotId, { volume: clampVolume(payload.volume) }),
    }

    this.scheduleMixSync()
    return this.emitCachedSnapshot()
  }

  async setMicrophoneNoiseSuppression(
    payload: SetMicrophoneNoiseSuppressionPayload,
  ): Promise<AudioSnapshot> {
    const slots = normalizeMicrophoneSlots(this.selection)
    const slotId = payload.slotId ?? slots.find((slot) => slot.deviceId)?.id ?? slots[0]?.id

    if (!slotId) {
      return this.emitCachedSnapshot()
    }

    const current = slots.find((slot) => slot.id === slotId)
    const nextSettings = {
      ...(current?.noiseSuppressionSettings ?? {}),
      ...(payload.settings ?? {}),
      enabled:
        payload.settings?.enabled ??
        payload.noiseSuppression ??
        current?.noiseSuppressionSettings?.enabled ??
        current?.noiseSuppression ??
        false,
    }

    this.selection = {
      ...this.selection,
      microphones: updateMicrophoneSlot(slots, slotId, {
        noiseSuppression: nextSettings.enabled,
        noiseSuppressionSettings: nextSettings,
      }),
    }

    // Re-bind mics when the engine is live so NS applies to a real capture source,
    // not only volume state on an unbound slot.
    if (this.isEngineActive()) {
      try {
        await this.ensureEngineRunning()
      } catch (error) {
        this.setEngineError(
          error instanceof Error ? error.message : 'Unable to apply noise suppression.',
        )
      }
    } else {
      this.scheduleMixSync()
    }

    return this.emitCachedSnapshot()
  }

  async setRouteAssignment(payload: SetRouteAssignmentPayload): Promise<AudioSnapshot> {
    const routeId = buildRouteId(payload.appId, 'hifi-cable')

    if (payload.enabled) {
      const existing = this.routedInputs.get(routeId)
      const equalizer = readStoredEqualizer(existing)
      const application = this.applications.find((entry) => entry.id === payload.appId)
      this.routedInputs.set(routeId, {
        routeId,
        appId: payload.appId,
        processName: application?.processName ?? existing?.processName,
        target: 'hifi-cable',
        volume: existing?.volume ?? DEFAULT_INPUT_GAIN,
        eqEnabled: equalizer.enabled,
        band60Db: equalizer.band60Db,
        band150Db: equalizer.band150Db,
        band400Db: equalizer.band400Db,
        band1000Db: equalizer.band1000Db,
        band2400Db: equalizer.band2400Db,
        band15000Db: equalizer.band15000Db,
        level: existing?.level ?? 0,
        muted: existing?.muted ?? false,
        state: existing?.state ?? 'attaching',
        lastError: existing?.lastError,
      })
    } else {
      this.routedInputs.delete(routeId)
    }

    try {
      await this.syncEngineRoutes()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update route.'
      const route = this.routedInputs.get(routeId)
      if (route) {
        route.state = 'error'
        route.lastError = message
        this.routedInputs.set(routeId, route)
      }
      this.setEngineError(message)
    }

    return this.emitCachedSnapshot()
  }

  async setRouteVolume(payload: SetRouteVolumePayload): Promise<AudioSnapshot> {
    const route = this.routedInputs.get(payload.routeId)

    if (route) {
      route.volume = clampVolume(payload.volume)
      this.routedInputs.set(payload.routeId, route)
    }

    this.scheduleMixSync()
    return this.emitCachedSnapshot()
  }

  async setRouteEqualizer(payload: SetRouteEqualizerPayload): Promise<AudioSnapshot> {
    const route = this.routedInputs.get(payload.routeId)

    if (route) {
      applyEqualizerToRoute(route, payload.equalizer)
      this.routedInputs.set(payload.routeId, route)
    }

    this.scheduleMixSync()
    return this.emitCachedSnapshot()
  }

  async setRouteMuted(payload: SetRouteMutedPayload): Promise<AudioSnapshot> {
    const route = this.routedInputs.get(payload.routeId)

    if (route) {
      route.muted = payload.muted
      this.routedInputs.set(payload.routeId, route)
    }

    this.scheduleMixSync()
    return this.emitCachedSnapshot()
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async applyHifiCableStudioSettings(): Promise<AudioSnapshot> {
    try {
      const result = await this.engine.configureHifiCable()
      this.hifiCableFormatStatus = result
      if (!result.playbackConfigured && !result.recordingConfigured) {
        this.setEngineError(result.message)
      } else {
        this.engineStatus = {
          ...this.engineStatus,
          message: result.message,
        }
      }
    } catch (error) {
      this.setEngineError(
        error instanceof Error ? error.message : 'Unable to apply Hi-Fi Cable studio settings.',
      )
    }

    return this.emitCachedSnapshot()
  }

  /** Plays a test tone into Hi-Fi Cable Input and reports whether Output hears it. */
  async probeHifiCable(): Promise<string> {
    try {
      if (this.isEngineActive()) {
        await this.engine.stop()
      }

      const report = await this.engine.probeHifiCable()
      const passed =
        /meterPeak=(?!0\.000)\d+\.\d+/.test(report) ||
        /capturePeak=(?!0\.000)\d+\.\d+/.test(report)
      this.engineStatus = {
        ...createDefaultEngineStatus(),
        helperConnected: this.engineStatus.helperConnected,
        state: 'stopped',
        message: passed
          ? `Hi-Fi Cable test passed — Output heard the tone. Start stream, then point Discord at Hi-Fi Cable Output.\n${report}`
          : `Hi-Fi Cable test failed — tone did not reach Output. Check Playback → Hi-Fi Cable Input Advanced is 48 kHz · 24-bit (same as Output), exclusive mode off on both.\n${report}`,
      }
      this.emitCachedSnapshot()
      return report
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to test Hi-Fi Cable.'
      this.setEngineError(message)
      this.emitCachedSnapshot()
      return message
    }
  }

  async startEngine(): Promise<AudioSnapshot> {
    if (this.devices.length === 0) {
      await this.refreshDevices()
    } else {
      this.ensureValidSelection(this.devices)
    }

    const hifiCable = detectHifiCableDependency(this.devices)
    if (!hifiCable.playbackReady) {
      this.setEngineError(formatHifiCableUnavailableMessage(hifiCable))
      return this.emitCachedSnapshot()
    }

    if (!hifiCable.recordingReady) {
      this.setEngineError(formatHifiCableRecordingUnavailableMessage())
      return this.emitCachedSnapshot()
    }

    // Hi-Fi Cable is bit-perfect — refuse Start when Input/Output MixFormats diverge
    // or are not clean 48 kHz. Soft-continuing here was the main "no audio through Hi-Fi" bug.
    try {
      const result = await this.engine.configureHifiCable()
      this.hifiCableFormatStatus = result
      const formatBlocker = describeHifiFormatStartBlocker(result)
      if (formatBlocker) {
        this.setEngineError(formatBlocker)
        return this.emitCachedSnapshot()
      }
    } catch (error) {
      this.setEngineError(
        error instanceof Error
          ? error.message
          : 'Unable to apply Hi-Fi Cable clean audio settings. Set both endpoints to 48 kHz · 24-bit in Windows Sound.',
      )
      return this.emitCachedSnapshot()
    }

    if (!this.selection.inputDeviceId) {
      this.setEngineError('Select an Input device before starting the stream.')
      return this.emitCachedSnapshot()
    }

    if (!this.hasStreamableMix()) {
      this.setEngineError('Select a microphone or add an application to the mix before starting.')
      return this.emitCachedSnapshot()
    }

    try {
      await this.ensureEngineRunning()
    } catch (error) {
      this.setEngineError(
        error instanceof Error ? error.message : 'Unable to start the audio engine.',
      )
      return this.emitCachedSnapshot()
    }

    // Soft warning only — hard-stopping the engine here left users with a dead cable
    // even when Input render was already pumping (Pass-Through / Discord open on Output).
    if (this.engineStatus.hifiOutputActive === false) {
      const keepAliveWarning =
        this.engineStatus.hifiOutputError ||
        'Hi-Fi Cable Output keep-alive did not start. Enable Recording → Hi-Fi Cable Output and leave ASIO Bridge on Pass-Through if Discord/OBS stay silent.'
      if (!this.engineStatus.message?.includes('Listen to this device')) {
        this.engineStatus = {
          ...this.engineStatus,
          message: keepAliveWarning,
          hifiOutputError: keepAliveWarning,
        }
      }
    }

    return this.emitCachedSnapshot()
  }

  async stopEngine(): Promise<AudioSnapshot> {
    await this.engine.stop()
    this.telemetryByAppId.clear()
    this.applyTelemetryToRoutes()
    return this.emitCachedSnapshot()
  }

  dispose(): void {
    void this.engine.stop()
    this.engine.dispose()
  }

  private ensureValidSelection(snapshotDevices: AudioSnapshot['devices']): DeviceSelection {
    const inputDevices = snapshotDevices.filter((device) => device.kind === 'input')
    const selectableMicrophones = inputDevices.filter((device) =>
      isSelectableMicrophoneDevice(device.name),
    )
    const outputDevices = snapshotDevices.filter((device) => device.kind === 'output' && device.isAvailable)
    const recordingDevices = listRecordingEndpointDevices(snapshotDevices)
    const cableDefaults = getHifiCableSelectionDefaults(snapshotDevices)

    const preferredInput = findHifiCablePlaybackDevice(snapshotDevices)
    const preferredRecording = findHifiCableRecordingDevice(snapshotDevices, preferredInput)

    let microphones = normalizeMicrophoneSlots(this.selection)
    if (!this.selection.microphones?.length && !this.selection.microphoneId) {
      microphones = createDefaultMicrophoneSlots()
    }

    microphones = microphones.map((slot) => {
      if (!slot.deviceId) {
        return slot
      }

      const resolvedId = matchDeviceId(slot.deviceId, selectableMicrophones)
      const stillListed = inputDevices.some((device) => device.id === slot.deviceId)

      return {
        ...slot,
        deviceId: resolvedId ?? (stillListed ? slot.deviceId : undefined),
      }
    })

    const resolvedInputId = resolveInputDeviceId(
      this.selection.inputDeviceId ?? cableDefaults.inputDeviceId,
      outputDevices,
      preferredInput,
    )
    const inputDeviceId = resolvedInputId

    const selectedInputDevice = outputDevices.find((device) => device.id === inputDeviceId)
    const recordingDeviceId =
      resolveRecordingDeviceId(
        selectedInputDevice,
        recordingDevices,
        matchDeviceId(this.selection.recordingDeviceId, recordingDevices) ?? cableDefaults.recordingDeviceId,
      ) ?? preferredRecording?.id

    this.selection = {
      microphones,
      inputDeviceId,
      recordingDeviceId,
    }

    return this.selection
  }

  private getSortedRoutes(): RoutedInput[] {
    return [...this.routedInputs.values()]
      .filter((route) => route.target === 'hifi-cable')
      .sort((left, right) => left.routeId.localeCompare(right.routeId))
  }

  private emit(snapshot: AudioSnapshot): void {
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private applyTelemetryToRoutes(): void {
    for (const route of this.routedInputs.values()) {
      const telemetry = this.telemetryByAppId.get(route.appId)
      if (!telemetry) {
        route.level = 0
        route.state = this.normalizeRouteState('attaching')
        route.lastError = undefined
        continue
      }

      route.level = this.isEngineActive() && !route.muted ? clampLevel(telemetry.level) : 0
      route.state = this.normalizeRouteState(telemetry.state as RoutedInput['state'])
      route.lastError =
        this.isEngineActive() && telemetry.state === 'error' ? telemetry.lastError : undefined
    }
  }

  private async syncEngineRoutes(): Promise<void> {
    if (this.devices.length > 0) {
      this.ensureValidSelection(this.devices)
    }

    remapStaleApplicationRoutes(
      this.routedInputs,
      this.applications,
      this.engineStatus.sessionLevels,
    )

    const payload = {
      selection: this.selection,
      routes: this.getSortedRoutes(),
    }

    if (!this.hasStreamableMix()) {
      if (this.isEngineActive()) {
        await this.engine.syncRoutes(payload)
      }
      return
    }

    if (!this.selection.inputDeviceId) {
      throw new Error('Select an Input device before streaming audio.')
    }

    const hifiCable = detectHifiCableDependency(this.devices)
    if (!hifiCable.playbackReady) {
      throw new Error(formatHifiCableUnavailableMessage(hifiCable))
    }

    if (this.isEngineActive()) {
      await this.engine.sync(payload)
      return
    }

    await this.engine.start(this.selection, payload.routes)
  }

  private async ensureEngineRunning(): Promise<void> {
    if (this.devices.length > 0) {
      this.ensureValidSelection(this.devices)
    }

    if (!this.selection.inputDeviceId) {
      throw new Error('Select Hi-Fi Cable Input before streaming audio.')
    }

    if (this.isEngineActive()) {
      await this.engine.sync({
        selection: this.selection,
        routes: this.getSortedRoutes(),
      })
      return
    }

    await this.engine.start(this.selection, this.getSortedRoutes())
  }
}
