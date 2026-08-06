import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { AppSettings, ClipSettings } from '../../shared/appSettings.js'
import { settingsChannels } from '../../shared/settingsApi.js'
import type { SettingsStore } from '../settings/settingsStore.js'

export function registerSettingsIpc(
  mainWindow: BrowserWindow,
  store: SettingsStore,
): void {
  const publish = (settings: AppSettings): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(settingsChannels.subscribe, settings)
    }
  }

  store.subscribe(publish)

  ipcMain.handle(settingsChannels.get, () => store.get())
  ipcMain.handle(
    settingsChannels.set,
    (_event, patch: Partial<AppSettings> & { clip?: Partial<ClipSettings> }) => store.set(patch),
  )
}
