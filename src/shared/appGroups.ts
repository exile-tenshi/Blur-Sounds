import type { AudioApplication } from './audioTypes.js'

export interface ApplicationGroup {
  processName: string
  label: string
  instances: AudioApplication[]
}

export function groupApplicationsByProcess(applications: AudioApplication[]): ApplicationGroup[] {
  const groups = new Map<string, AudioApplication[]>()

  for (const application of applications) {
    const key = application.processName.toLowerCase()
    const existing = groups.get(key)

    if (existing) {
      existing.push(application)
      continue
    }

    groups.set(key, [application])
  }

  return [...groups.entries()]
    .map(([, instances]) => {
      const sortedInstances = [...instances].sort((left, right) => {
        if (left.hasVisibleWindow !== right.hasVisibleWindow) {
          return left.hasVisibleWindow ? -1 : 1
        }

        return left.displayName.localeCompare(right.displayName)
      })

      const processName = sortedInstances[0]?.processName ?? 'Unknown'

      return {
        processName,
        label: sortedInstances.length > 1 ? `${processName} (${sortedInstances.length})` : processName,
        instances: sortedInstances,
      }
    })
    .sort((left, right) => left.processName.localeCompare(right.processName))
}

export function buildSessionLevelMap(
  sessionLevels: Array<{ processId: number; peak: number }> | undefined,
): Map<number, number> {
  if (!sessionLevels || sessionLevels.length === 0) {
    return new Map()
  }

  return new Map(sessionLevels.map((session) => [session.processId, session.peak]))
}
