import type { EngineStatus } from './audioTypes.js'

export function createDefaultEngineStatus(): EngineStatus {
  return {
    state: 'stopped',
    helperConnected: false,
    latencyMs: 20,
    underrunCount: 0,
    selectedMicrophoneReady: false,
    selectedInputReady: false,
    hifiOutputActive: undefined,
    hifiListenActive: false,
    outputLevel: 0,
    outputPullLevel: 0,
    mixPullLevel: 0,
    microphoneLevel: 0,
    sessionLevels: [],
  }
}

export function normalizeEngineStatus(
  status: Partial<EngineStatus> | undefined,
): EngineStatus {
  const defaults = createDefaultEngineStatus()

  if (!status) {
    return defaults
  }

  return {
    ...defaults,
    ...status,
    sessionLevels: Array.isArray(status.sessionLevels) ? status.sessionLevels : [],
  }
}
