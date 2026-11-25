import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_APP_SETTINGS,
  type AppSectionId,
  type AppSettings,
  type ClipSettings,
} from '../../shared/appSettings'
import { settingsChannels, type SettingsControlApi } from '../../shared/settingsApi'

function resolveSettingsControl(): SettingsControlApi | undefined {
  if (window.settingsControl) {
    return window.settingsControl
  }

  if (!window.require) {
    return undefined
  }

  const { ipcRenderer } = window.require('electron') as typeof import('electron')
  return {
    get: () => ipcRenderer.invoke(settingsChannels.get),
    set: (patch) => ipcRenderer.invoke(settingsChannels.set, patch),
    subscribe: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, settings: AppSettings) => {
        listener(settings)
      }
      ipcRenderer.on(settingsChannels.subscribe, wrapped)
      return () => {
        ipcRenderer.removeListener(settingsChannels.subscribe, wrapped)
      }
    },
  }
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)

  useEffect(() => {
    const control = resolveSettingsControl()
    if (!control) {
      return
    }

    void control.get().then(setSettings)
    return control.subscribe(setSettings)
  }, [])

  const setActiveSection = useCallback(async (activeSection: AppSectionId) => {
    const control = resolveSettingsControl()
    if (!control) {
      setSettings((current) => ({ ...current, activeSection }))
      return
    }
    setSettings(await control.set({ activeSection }))
  }, [])

  const patchClipSettings = useCallback(async (clip: Partial<ClipSettings>) => {
    const control = resolveSettingsControl()
    if (!control) {
      setSettings((current) => ({ ...current, clip: { ...current.clip, ...clip } }))
      return
    }
    setSettings(await control.set({ clip }))
  }, [])

  return {
    settings,
    activeSection: settings.activeSection,
    setActiveSection,
    patchClipSettings,
  }
}
