import { globalShortcut, type BrowserWindow } from 'electron'
import { clipChannels } from '../../shared/clipApi.js'
import type { SettingsStore } from '../settings/settingsStore.js'

export class ClipKeybindService {
  private mainWindow?: BrowserWindow
  private registered: string[] = []

  constructor(private readonly settings: SettingsStore) {}

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  refresh(): void {
    this.unregisterAll()
    const keybinds = this.settings.get().clip.keybinds
    for (const accelerator of keybinds) {
      try {
        const ok = globalShortcut.register(accelerator, () => {
          this.emitTrigger()
        })
        if (ok) {
          this.registered.push(accelerator)
        }
      } catch {
        // Invalid accelerator — skip.
      }
    }
  }

  unregisterAll(): void {
    for (const accelerator of this.registered) {
      try {
        globalShortcut.unregister(accelerator)
      } catch {
        // ignore
      }
    }
    this.registered = []
  }

  private emitTrigger(): void {
    const window = this.mainWindow
    if (!window || window.isDestroyed()) {
      return
    }
    window.webContents.send(clipChannels.subscribeTrigger)
  }

  /** Same path as keybinds — used by voice commands. */
  triggerClip(): void {
    this.emitTrigger()
  }
}
