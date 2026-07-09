import { buildSessionLevelMap } from './appGroups.js'
import type { AudioApplication, EngineSessionLevel, RoutedInput } from './audioTypes.js'

export function buildRouteId(appId: string, target: RoutedInput['target']): string {
  return `${target}:${appId}`
}

/**
 * Rebind routes when an app restarts (new PID) or when a sibling instance is actually playing audio.
 */
export function remapStaleApplicationRoutes(
  routes: Map<string, RoutedInput>,
  applications: AudioApplication[],
  sessionLevels: EngineSessionLevel[],
): boolean {
  if (routes.size === 0 || applications.length === 0) {
    return false
  }

  const appById = new Map(applications.map((application) => [application.id, application]))
  const appsByProcessName = new Map<string, AudioApplication[]>()

  for (const application of applications) {
    const key = application.processName.toLowerCase()
    const existing = appsByProcessName.get(key) ?? []
    existing.push(application)
    appsByProcessName.set(key, existing)
  }

  const sessionMap = buildSessionLevelMap(sessionLevels)
  let changed = false

  for (const [routeId, route] of [...routes.entries()]) {
    const processName =
      route.processName?.toLowerCase() ?? appById.get(route.appId)?.processName.toLowerCase()

    if (!processName) {
      continue
    }

    const candidates = appsByProcessName.get(processName) ?? []
    if (candidates.length === 0) {
      continue
    }

    const bestCandidate = candidates.reduce((best, application) => {
      const peak = sessionMap.get(application.processId) ?? 0
      const bestPeak = sessionMap.get(best.processId) ?? 0
      return peak > bestPeak ? application : best
    }, candidates[0]!)

    const routedPeak = sessionMap.get(Number(route.appId)) ?? 0
    const bestPeak = sessionMap.get(bestCandidate.processId) ?? 0
    const processMissing = !appById.has(route.appId)
    const betterInstanceAvailable =
      bestCandidate.id !== route.appId &&
      bestPeak > 0.01 &&
      (routedPeak < 0.01 || bestPeak > routedPeak * 1.5)

    if (!processMissing && !betterInstanceAvailable) {
      if (!route.processName && appById.has(route.appId)) {
        route.processName = appById.get(route.appId)!.processName
      }
      continue
    }

    routes.delete(routeId)
    const newRouteId = buildRouteId(bestCandidate.id, route.target)
    const existing = routes.get(newRouteId)

    routes.set(newRouteId, {
      ...(existing ?? route),
      routeId: newRouteId,
      appId: bestCandidate.id,
      processName: bestCandidate.processName,
      state: existing?.state ?? 'attaching',
      lastError: undefined,
    })

    changed = true
  }

  return changed
}
