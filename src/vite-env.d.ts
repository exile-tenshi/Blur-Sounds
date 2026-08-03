/// <reference types="vite/client" />

import type { AudioControlApi } from './shared/audioApi'
import type { ClipControlApi } from './shared/clipApi'
import type { SettingsControlApi } from './shared/settingsApi'

declare global {
  interface Window {
    audioControl?: AudioControlApi
    clipControl?: ClipControlApi
    settingsControl?: SettingsControlApi
    require?: (moduleName: string) => any
  }
}

export {}
