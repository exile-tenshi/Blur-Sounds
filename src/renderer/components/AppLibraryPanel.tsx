import { useMemo, useRef, useState } from 'react'
import { groupApplicationsByProcess, buildSessionLevelMap } from '../../shared/appGroups'
import type { AudioApplication, EngineSessionLevel, RoutedInput } from '../../shared/audioTypes'
import { LevelMeter } from './LevelMeter'

interface AppLibraryPanelProps {
  applications: AudioApplication[]
  routedInputs: RoutedInput[]
  sessionLevels: EngineSessionLevel[]
  engineActive: boolean
  onToggleRoute: (appId: string, enabled: boolean) => Promise<void>
  onToggleRouteMuted: (routeId: string, muted: boolean) => Promise<void>
}

function getRouteForApp(routes: RoutedInput[], appId: string): RoutedInput | undefined {
  return routes.find((route) => route.appId === appId && route.target === 'hifi-cable')
}

function getDetectedLevel(
  application: AudioApplication,
  route: RoutedInput | undefined,
  sessionLevels: Map<number, number>,
  engineActive: boolean,
): number {
  const sessionLevel = sessionLevels.get(application.processId) ?? 0
  const routedLevel =
    route && engineActive && !route.muted ? route.level : 0

  return Math.max(sessionLevel, routedLevel)
}

function formatInstanceLabel(application: AudioApplication): string {
  if (application.hasVisibleWindow && application.displayName !== application.processName) {
    return `${application.displayName} · PID ${application.processId}`
  }

  return `PID ${application.processId}`
}

function useStableAudioLive(level: number): boolean {
  const liveRef = useRef(level > 0.02)

  if (level > 0.03) {
    liveRef.current = true
  } else if (level < 0.01) {
    liveRef.current = false
  }

  return liveRef.current
}

interface AppInstanceRowProps {
  application: AudioApplication
  route?: RoutedInput
  level: number
  engineActive: boolean
  nested?: boolean
  onToggleRoute: (appId: string, enabled: boolean) => Promise<void>
  onToggleRouteMuted: (routeId: string, muted: boolean) => Promise<void>
}

function AppInstanceRow({
  application,
  route,
  level,
  engineActive,
  nested = false,
  onToggleRoute,
  onToggleRouteMuted,
}: AppInstanceRowProps) {
  const isRouted = Boolean(route)
  const isDetectingAudio = useStableAudioLive(level)

  return (
    <article className={`app-card${route?.muted ? ' is-paused' : ''}${nested ? ' app-card-nested' : ''}`}>
      <div className="app-card-main">
        <div className="app-card-copy">
          <h3>{nested ? formatInstanceLabel(application) : application.displayName}</h3>
          <p className="muted app-card-meta">
            <span>
              {nested ? application.processName : `${application.processName} · PID ${application.processId}`}
            </span>
            <span
              className={`app-audio-dot${isDetectingAudio ? ' is-live' : ''}`}
              title={isDetectingAudio ? 'Playing audio' : 'Silent'}
              aria-hidden="true"
            />
          </p>
        </div>

        <div className="app-card-actions">
          <div className="app-card-meter-slot">
            <LevelMeter
              compact
              level={isDetectingAudio ? level : 0}
              label={`${application.displayName} audio level`}
            />
          </div>

          <div className="toggle-row">
            <label className="route-toggle">
              <input
                type="checkbox"
                checked={isRouted}
                onChange={(event) => void onToggleRoute(application.id, event.target.checked)}
              />
              <span>Add to mix</span>
            </label>
            {isRouted && route ? (
              <button
                type="button"
                className={`pause-button${route.muted ? ' active' : ''}`}
                onClick={() => void onToggleRouteMuted(route.routeId, !route.muted)}
              >
                {route.muted ? 'Resume' : 'Pause'}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {isRouted && route && !nested ? (
        <LevelMeter
          level={engineActive && !route.muted ? route.level : 0}
          label={`${application.displayName} mix level`}
        />
      ) : null}
    </article>
  )
}

export function AppLibraryPanel({
  applications,
  routedInputs,
  sessionLevels,
  engineActive,
  onToggleRoute,
  onToggleRouteMuted,
}: AppLibraryPanelProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const groups = useMemo(() => groupApplicationsByProcess(applications), [applications])
  const sessionLevelMap = useMemo(() => buildSessionLevelMap(sessionLevels), [sessionLevels])

  const toggleGroup = (processName: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current)

      if (next.has(processName)) {
        next.delete(processName)
      } else {
        next.add(processName)
      }

      return next
    })
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Applications</p>
          <h2>Capture app audio into the mix</h2>
          <p className="muted section-help">
            Keep apps like Spotify on your normal speakers or headphones — not your virtual cable input.
            Blur Sounds captures that audio and sends it to your chosen cable input, where volume and EQ work.
            If Spotify stops coming through after an update, click Refresh or remove and re-add it to the mix.
          </p>
        </div>
        <span className="badge">{groups.length} apps</span>
      </div>

      <div className="app-library">
        {groups.length === 0 ? (
          <p className="empty-state">No applications found. Click refresh or open an app with a window.</p>
        ) : (
          groups.map((group) => {
            const isExpandable = group.instances.length > 1
            const isExpanded = expandedGroups.has(group.processName)
            const groupLevel = Math.max(
              ...group.instances.map((application) =>
                getDetectedLevel(
                  application,
                  getRouteForApp(routedInputs, application.id),
                  sessionLevelMap,
                  engineActive,
                ),
              ),
              0,
            )
            const routedCount = group.instances.filter((application) =>
              getRouteForApp(routedInputs, application.id),
            ).length

            if (!isExpandable) {
              const application = group.instances[0]

              return (
                <AppInstanceRow
                  key={application.id}
                  application={application}
                  route={getRouteForApp(routedInputs, application.id)}
                  level={getDetectedLevel(
                    application,
                    getRouteForApp(routedInputs, application.id),
                    sessionLevelMap,
                    engineActive,
                  )}
                  engineActive={engineActive}
                  onToggleRoute={onToggleRoute}
                  onToggleRouteMuted={onToggleRouteMuted}
                />
              )
            }

            return (
              <section className="app-group" key={group.processName}>
                <button
                  type="button"
                  className={`app-group-header${isExpanded ? ' expanded' : ''}`}
                  onClick={() => toggleGroup(group.processName)}
                >
                  <span className="app-group-chevron" aria-hidden="true">
                    {isExpanded ? '▾' : '▸'}
                  </span>
                  <span className="app-group-title">{group.label}</span>
                  <div className="app-group-meter-slot">
                    <LevelMeter compact level={groupLevel} label={`${group.processName} audio level`} />
                  </div>
                  {routedCount > 0 ? <span className="app-group-meta">{routedCount} in mix</span> : null}
                </button>

                {isExpanded ? (
                  <div className="app-group-children">
                    {group.instances.map((application) => (
                      <AppInstanceRow
                        key={application.id}
                        application={application}
                        route={getRouteForApp(routedInputs, application.id)}
                        level={getDetectedLevel(
                          application,
                          getRouteForApp(routedInputs, application.id),
                          sessionLevelMap,
                          engineActive,
                        )}
                        engineActive={engineActive}
                        nested
                        onToggleRoute={onToggleRoute}
                        onToggleRouteMuted={onToggleRouteMuted}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            )
          })
        )}
      </div>
    </section>
  )
}
