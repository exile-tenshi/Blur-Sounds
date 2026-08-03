import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, nativeImage } from 'electron'
import type { RoutingStore } from './audio/routingStore.js'
import { registerAudioIpc } from './ipc/audioIpc.js'
import { registerClipIpc } from './ipc/clipIpc.js'
import { registerSettingsIpc } from './ipc/settingsIpc.js'
import { ClipKeybindService } from './recording/clipKeybinds.js'
import { SettingsStore } from './settings/settingsStore.js'

const devServerUrl = process.env.VITE_DEV_SERVER_URL
const currentDir = dirname(fileURLToPath(import.meta.url))
const appDataRoot = join(app.getPath('appData'), 'BlurSounds')
const sessionDataRoot = join(appDataRoot, 'SessionData')
const appIconPath = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(currentDir, '..', 'public', 'icon.png')

let audioStore: RoutingStore | undefined
let clipKeybinds: ClipKeybindService | undefined

mkdirSync(appDataRoot, { recursive: true })
mkdirSync(sessionDataRoot, { recursive: true })

app.setPath('userData', appDataRoot)
app.setPath('sessionData', sessionDataRoot)
app.setName('Blur Sounds')

function shutdownAudioStore(): void {
  clipKeybinds?.unregisterAll()
  clipKeybinds = undefined

  if (!audioStore) {
    return
  }

  const store = audioStore
  audioStore = undefined
  void store.stopEngine().finally(() => {
    store.dispose()
  })
}

async function createMainWindow(): Promise<void> {
  const icon = nativeImage.createFromPath(appIconPath)

  const mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0b1220',
    title: 'Blur Sounds',
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      preload: join(currentDir, 'index.mjs'),
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  })

  const settings = new SettingsStore()
  clipKeybinds = new ClipKeybindService(settings)
  registerSettingsIpc(mainWindow, settings)
  audioStore = registerAudioIpc(mainWindow)
  registerClipIpc(mainWindow, settings, clipKeybinds)

  mainWindow.on('closed', () => {
    shutdownAudioStore()
  })

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await mainWindow.loadFile(join(app.getAppPath(), 'dist/index.html'))
  }
}

app.whenReady().then(async () => {
  await createMainWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    shutdownAudioStore()
    app.quit()
  }
})

app.on('before-quit', () => {
  shutdownAudioStore()
})

app.on('will-quit', () => {
  clipKeybinds?.unregisterAll()
})
