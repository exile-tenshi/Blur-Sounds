/// <reference types="vite/client" />

import type { AudioControlApi } from './shared/audioApi'
import type { ClipControlApi } from './shared/clipApi'

declare global {
  interface Window {
    audioControl?: AudioControlApi
    clipControl?: ClipControlApi
    require?: (moduleName: string) => any
  }
}

export {}
