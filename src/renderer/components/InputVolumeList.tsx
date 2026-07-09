import { memo, useCallback, useMemo, useRef } from 'react'
import {
  MAX_INPUT_GAIN,
  formatInputGain,
  readRouteEqualizer,
  type RouteEqualizerSettings,
} from '../../shared/audioConstants'
import type { AudioApplication, MicrophoneSlot, RoutedInput } from '../../shared/audioTypes'
import { GainSlider } from './GainSlider'
import { GraphicalEqualizer } from './GraphicalEqualizer'
import { LevelMeter } from './LevelMeter'

interface MicrophoneSourceControl {
  slotId: string
  name?: string
  level: number
  ready: boolean
  muted: boolean
  volume: number
  onSetMuted: (muted: boolean) => Promise<void>
  onSetVolume: (volume: number) => Promise<void>
}

interface InputVolumeListProps {
  routes: RoutedInput[]
  applications: AudioApplication[]
  microphoneSources: MicrophoneSourceControl[]
  engineActive: boolean
  onSetRouteVolume: (routeId: string, volume: number) => Promise<void>
  onSetRouteEqualizer: (routeId: string, equalizer: RouteEqualizerSettings) => Promise<void>
  onSetRouteMuted: (routeId: string, muted: boolean) => Promise<void>
  onRemoveRoute: (appId: string) => Promise<void>
}

interface GroupedInputRoute {
  appId: string
  appName: string
  routes: RoutedInput[]
  volume: number
  equalizer: RouteEqualizerSettings
  level: number
  muted: boolean
  states: string[]
  errors: string[]
}

function getAppName(applications: AudioApplication[], appId: string): string {
  return applications.find((application) => application.id === appId)?.displayName ?? appId
}

function routeStatePriority(state: RoutedInput['state']): number {
  switch (state) {
    case 'error':
      return 4
    case 'attaching':
      return 3
    case 'live':
      return 2
    case 'detached':
      return 1
    default:
      return 0
  }
}

function finalizeGroupedRoute(group: GroupedInputRoute): GroupedInputRoute {
  const activeRoute = group.routes.reduce((best, route) =>
    routeStatePriority(route.state) >= routeStatePriority(best.state) ? route : best,
  )

  return {
    ...group,
    level: Math.max(...group.routes.map((route) => route.level)),
    states: [activeRoute.state],
    errors:
      activeRoute.state === 'error' && activeRoute.lastError ? [activeRoute.lastError] : [],
  }
}

function groupInputRoutes(
  routes: RoutedInput[],
  applications: AudioApplication[],
): GroupedInputRoute[] {
  const groups = routes
    .filter((route) => route.target === 'hifi-cable')
    .reduce<GroupedInputRoute[]>((accumulator, route) => {
      const existingGroup = accumulator.find((group) => group.appId === route.appId)

      if (existingGroup) {
        existingGroup.routes.push(route)
        existingGroup.volume = route.volume
        existingGroup.equalizer = readRouteEqualizer(route)
        existingGroup.muted = existingGroup.muted || route.muted
        return accumulator
      }

      accumulator.push({
        appId: route.appId,
        appName: getAppName(applications, route.appId),
        routes: [route],
        volume: route.volume,
        equalizer: readRouteEqualizer(route),
        level: route.level,
        muted: route.muted,
        states: [route.state],
        errors: route.lastError ? [route.lastError] : [],
      })

      return accumulator
    }, [])

  return groups.map(finalizeGroupedRoute)
}

const MicrophoneSourceCard = memo(function MicrophoneSourceCard({
  source,
  engineActive,
}: {
  source: MicrophoneSourceControl
  engineActive: boolean
}) {
  if (!source.name) {
    return null
  }

  return (
    <article className={`volume-card${source.muted ? ' is-paused' : ''}`}>
      <div className="volume-copy">
        <div>
          <h3>{source.name}</h3>
          <p className="muted">Microphone input</p>
          <p className="muted">
            {source.muted
              ? 'paused'
              : engineActive
                ? source.ready
                  ? 'live'
                  : 'waiting'
                : 'engine stopped'}
          </p>
        </div>
        <div className="volume-actions">
          <strong>{formatInputGain(source.volume)}</strong>
          <button
            type="button"
            className={`pause-button${source.muted ? ' active' : ''}`}
            onClick={() => void source.onSetMuted(!source.muted)}
          >
            {source.muted ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>
      <GainSlider
        value={source.volume}
        disabled={source.muted}
        onCommit={(volume) => void source.onSetVolume(volume)}
      />
      <p className="muted gain-hint">100% = original level · up to {MAX_INPUT_GAIN * 100}% boost</p>
      <LevelMeter
        level={engineActive && !source.muted ? source.level : 0}
        label={`${source.name} level`}
      />
    </article>
  )
})

const AppRouteVolumeCard = memo(function AppRouteVolumeCard({
  group,
  onSetRouteVolume,
  onSetRouteEqualizer,
  onSetRouteMuted,
  onRemoveRoute,
}: {
  group: GroupedInputRoute
  onSetRouteVolume: (routeId: string, volume: number) => Promise<void>
  onSetRouteEqualizer: (routeId: string, equalizer: RouteEqualizerSettings) => Promise<void>
  onSetRouteMuted: (routeId: string, muted: boolean) => Promise<void>
  onRemoveRoute: (appId: string) => Promise<void>
}) {
  const routesRef = useRef(group.routes)
  routesRef.current = group.routes

  const commitEqualizer = useCallback(
    (next: RouteEqualizerSettings) => {
      void Promise.all(routesRef.current.map((route) => onSetRouteEqualizer(route.routeId, next)))
    },
    [onSetRouteEqualizer],
  )

  const commitVolume = useCallback(
    (volume: number) => {
      void Promise.all(routesRef.current.map((route) => onSetRouteVolume(route.routeId, volume)))
    },
    [onSetRouteVolume],
  )

  return (
    <article className={`volume-card${group.muted ? ' is-paused' : ''}`}>
      <div className="volume-copy">
        <div>
          <h3>{group.appName}</h3>
          <p className="muted">Application</p>
          <p className="muted">
            {group.muted ? 'paused' : group.states[0] ?? 'attaching'}
          </p>
          {group.errors.length > 0 ? (
            <p className="notice error route-warning">{group.errors[0]}</p>
          ) : null}
        </div>
        <div className="volume-actions">
          <strong>{formatInputGain(group.volume)}</strong>
          <button
            type="button"
            className={`pause-button${group.muted ? ' active' : ''}`}
            onClick={() => {
              const nextMuted = !group.muted
              void Promise.all(group.routes.map((route) => onSetRouteMuted(route.routeId, nextMuted)))
            }}
          >
            {group.muted ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            className="remove-button"
            onClick={() => void onRemoveRoute(group.appId)}
          >
            Remove
          </button>
        </div>
      </div>

      <GainSlider value={group.volume} disabled={group.muted} onCommit={commitVolume} />
      <p className="muted gain-hint">100% = original level · up to {MAX_INPUT_GAIN * 100}% boost</p>
      <GraphicalEqualizer
        title="Equalizer"
        value={group.equalizer}
        disabled={group.muted}
        onChange={commitEqualizer}
      />
      <LevelMeter level={group.muted ? 0 : group.level} label={`${group.appName} level`} />
    </article>
  )
})

export function InputVolumeList({
  routes,
  applications,
  microphoneSources,
  engineActive,
  onSetRouteVolume,
  onSetRouteEqualizer,
  onSetRouteMuted,
  onRemoveRoute,
}: InputVolumeListProps) {
  const groupedRoutes = useMemo(
    () => groupInputRoutes(routes, applications),
    [routes, applications],
  )

  const activeMicrophoneSources = microphoneSources.filter((source) => source.name)
  const controlCount = activeMicrophoneSources.length + groupedRoutes.length

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Mix levels</p>
          <h2>Volume and equalizer for each source</h2>
        </div>
        <span className="badge">{controlCount} sources</span>
      </div>

      <div className="volume-list">
        {controlCount === 0 ? (
          <p className="empty-state">
            Select a microphone and add applications to the mix to control them here.
          </p>
        ) : (
          <>
            {activeMicrophoneSources.map((source) => (
              <MicrophoneSourceCard
                key={source.slotId}
                source={source}
                engineActive={engineActive}
              />
            ))}

            {groupedRoutes.map((group) => (
              <AppRouteVolumeCard
                key={group.appId}
                group={group}
                onSetRouteVolume={onSetRouteVolume}
                onSetRouteEqualizer={onSetRouteEqualizer}
                onSetRouteMuted={onSetRouteMuted}
                onRemoveRoute={onRemoveRoute}
              />
            ))}
          </>
        )}
      </div>
    </section>
  )
}
