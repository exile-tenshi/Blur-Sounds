import { globalShortcut, type BrowserWindow } from 'electron'
import { clipChannels } from '../../shared/clipApi.js'
import type { SettingsStore } from '../settings/settingsStore.js'
import { showClipOverlay } from './clipOverlay.js'

export type ClipTriggerGate = () => { ok: true } | { ok: false; reason: string }

export class ClipKeybindService {
  private mainWindow?: BrowserWindow
  private registered: string[] = []
  private clipGate?: ClipTriggerGate

  constructor(private readonly settings: SettingsStore) {}

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /** Optional guard — e.g. buffer must be running before Clip it fires. */
  setClipGate(gate: ClipTriggerGate | undefined): void {
    this.clipGate = gate
  }

  refresh(): void {
    this.unregisterAll()
    const keybinds = this.settings.get().clip.keybinds
    for (const accelerator of keybinds) {
      try {
        const ok = globalShortcut.register(accelerator, () => {
          this.triggerClip('keybind')
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

  /** Same path for keybinds and voice commands. */
  triggerClip(source: 'keybind' | 'voice' | 'ui' = 'keybind'): void {
    const gate = this.clipGate?.()
    if (gate && !gate.ok) {
      showClipOverlay({
        title: source === 'voice' ? 'Heard “clip it blur”' : 'Clip it',
        body: gate.reason,
        kind: 'error',
        holdMs: 3200,
      })
      return
    }

    const heard = source === 'voice' ? 'Heard “clip it blur”' : 'Clip it'
    showClipOverlay({
      title: heard,
      body: 'Saving your lookback buffer…',
      kind: 'heard',
      holdMs: 2200,
    })
    const window = this.mainWindow
    if (!window || window.isDestroyed()) {
      return
    }
    if (!window.isFocused()) {
      window.flashFrame(true)
    }
    window.webContents.send(clipChannels.subscribeTrigger)
  }
}
