/// <reference types="vite/client" />

import type { AudioControlApi } from './shared/audioApi'

declare global {
  interface Window {
    audioControl?: AudioControlApi
    require?: (moduleName: string) => any
  }
}

export {}

