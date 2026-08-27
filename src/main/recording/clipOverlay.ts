import { BrowserWindow, Notification, screen, shell, ipcMain } from 'electron'
import { dirname } from 'node:path'

export type ClipOverlayKind = 'heard' | 'clipping' | 'saved' | 'error'

export interface ClipOverlayPayload {
  title: string
  body: string
  kind: ClipOverlayKind
  holdMs?: number
  clipPath?: string
  thumbnailDataUrl?: string
}

const OVERLAY_CHANNEL_WATCH = 'clip-overlay:watch'
const OVERLAY_CHANNEL_EDIT = 'clip-overlay:edit'
const OVERLAY_CHANNEL_FOLDER = 'clip-overlay:folder'
const OVERLAY_CHANNEL_DISMISS = 'clip-overlay:dismiss'

let overlayWindow: BrowserWindow | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined
let ipcRegistered = false

function registerOverlayIpc(): void {
  if (ipcRegistered) {
    return
  }
  ipcRegistered = true

  ipcMain.on(OVERLAY_CHANNEL_WATCH, (_event, filePath: string) => {
    if (filePath) {
      void shell.openPath(filePath)
    }
    hideClipOverlay()
  })

  ipcMain.on(OVERLAY_CHANNEL_EDIT, (_event, filePath: string) => {
    if (filePath) {
      void shell.openPath(filePath)
    }
    hideClipOverlay()
  })

  ipcMain.on(OVERLAY_CHANNEL_FOLDER, (_event, filePath: string) => {
    if (filePath) {
      shell.showItemInFolder(filePath)
    }
    hideClipOverlay()
  })

  ipcMain.on(OVERLAY_CHANNEL_DISMISS, () => {
    hideClipOverlay()
  })
}

function buildTransientOverlayHtml(payload: ClipOverlayPayload): string {
  const accent =
    payload.kind === 'error' ? '#fb7185' : payload.kind === 'saved' ? '#34d399' : '#22d3ee'
  const title = escapeHtml(payload.title)
  const body = escapeHtml(payload.body)
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        background: transparent;
        overflow: hidden;
        font-family: Segoe UI, system-ui, sans-serif;
      }
      .card {
        margin: 8px;
        padding: 14px 18px;
        border-radius: 16px;
        background: rgba(8, 15, 30, 0.92);
        border: 1px solid ${accent}66;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45), 0 0 0 1px ${accent}22;
        color: #f8fafc;
      }
      .kicker {
        color: ${accent};
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .title { font-size: 18px; font-weight: 700; }
      .body { margin-top: 4px; color: #cbd5e1; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="kicker">Blur Sounds</div>
      <div class="title">${title}</div>
      <div class="body">${body}</div>
    </div>
  </body>
</html>`
}

function buildSavedOverlayHtml(payload: ClipOverlayPayload): string {
  const accent = '#34d399'
  const title = escapeHtml(payload.title)
  const body = escapeHtml(payload.body)
  const clipPath = escapeHtml(payload.clipPath ?? '')
  const thumb = payload.thumbnailDataUrl
    ? `<img src="${payload.thumbnailDataUrl}" class="thumb" />`
    : '<div class="thumb thumb-placeholder">▶</div>'

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        background: transparent;
        overflow: hidden;
        font-family: Segoe UI, system-ui, sans-serif;
        -webkit-app-region: no-drag;
      }
      .card {
        margin: 8px;
        padding: 14px 18px;
        border-radius: 16px;
        background: rgba(8, 15, 30, 0.95);
        border: 1px solid ${accent}66;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px ${accent}22;
        color: #f8fafc;
        display: flex;
        gap: 14px;
        align-items: flex-start;
      }
      .thumb {
        width: 128px;
        height: 72px;
        border-radius: 8px;
        object-fit: cover;
        background: rgba(255,255,255,0.05);
        flex-shrink: 0;
      }
      .thumb-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        color: ${accent};
      }
      .info { flex: 1; min-width: 0; }
      .kicker {
        color: ${accent};
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 3px;
      }
      .title { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
      .body {
        color: #94a3b8;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
      .actions {
        display: flex;
        gap: 6px;
        margin-top: 10px;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 12px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 8px;
        background: rgba(255,255,255,0.06);
        color: #f1f5f9;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
        font-family: inherit;
      }
      .btn:hover {
        background: rgba(255,255,255,0.12);
        border-color: rgba(255,255,255,0.2);
      }
      .btn-primary {
        background: ${accent}22;
        border-color: ${accent}55;
        color: ${accent};
      }
      .btn-primary:hover {
        background: ${accent}33;
        border-color: ${accent}88;
      }
      .dismiss {
        position: absolute;
        top: 12px;
        right: 16px;
        background: none;
        border: none;
        color: #64748b;
        font-size: 16px;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .dismiss:hover { color: #94a3b8; background: rgba(255,255,255,0.06); }
    </style>
  </head>
  <body>
    <div class="card" style="position: relative;">
      <button class="dismiss" onclick="dismiss()" title="Close">✕</button>
      ${thumb}
      <div class="info">
        <div class="kicker">Blur Sounds</div>
        <div class="title">${title}</div>
        <div class="body">${body}</div>
        <div class="actions">
          <button class="btn btn-primary" onclick="watch()">▶ Watch</button>
          <button class="btn" onclick="edit()">✏ Edit</button>
          <button class="btn" onclick="folder()">📂 Show file</button>
        </div>
      </div>
    </div>
    <script>
      const { ipcRenderer } = require('electron');
      const clipPath = ${JSON.stringify(clipPath)};
      function watch()   { ipcRenderer.send('${OVERLAY_CHANNEL_WATCH}', clipPath); }
      function edit()    { ipcRenderer.send('${OVERLAY_CHANNEL_EDIT}', clipPath); }
      function folder()  { ipcRenderer.send('${OVERLAY_CHANNEL_FOLDER}', clipPath); }
      function dismiss() { ipcRenderer.send('${OVERLAY_CHANNEL_DISMISS}'); }
    </script>
  </body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function destroyOverlayWindow(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = undefined
  }
  const existing = overlayWindow
  overlayWindow = undefined
  if (!existing || existing.isDestroyed()) {
    return
  }
  try {
    existing.removeAllListeners('closed')
    // destroy() is synchronous — close() left the old “Clipping…” window on screen.
    existing.destroy()
  } catch {
    // Ignore destroy races.
  }
}

function ensureOverlay(interactive: boolean): BrowserWindow {
  destroyOverlayWindow()

  const display = screen.getPrimaryDisplay()
  const width = interactive ? 460 : 420
  const height = interactive ? 140 : 110
  const work = display.workArea
  overlayWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(work.x + work.width - width - 16),
    y: Math.round(work.y + 16),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: interactive,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: interactive,
      contextIsolation: !interactive,
      sandbox: !interactive,
    },
  })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  overlayWindow.setIgnoreMouseEvents(!interactive, { forward: !interactive })
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.on('closed', () => {
    overlayWindow = undefined
  })
  return overlayWindow
}

export function showClipOverlay(payload: ClipOverlayPayload): void {
  registerOverlayIpc()

  const isSaved = payload.kind === 'saved' && Boolean(payload.clipPath)
  // Clipping can last for the full forward roll + encode — keep it until saved/error
  // replaces it (safety timeout only). Short holds left a stale “Clipping…” card up.
  const holdMs =
    payload.kind === 'clipping'
      ? (payload.holdMs ?? 45_000)
      : isSaved
        ? (payload.holdMs ?? 12_000)
        : (payload.holdMs ?? (payload.kind === 'heard' ? 2500 : 4200))
  const interactive = Boolean(isSaved)

  const window = ensureOverlay(interactive)
  if (interactive) {
    window.setSize(460, 140)
  } else {
    window.setSize(420, 110)
  }

  const display = screen.getPrimaryDisplay()
  const work = display.workArea
  const [w] = window.getSize()
  window.setPosition(
    Math.round(work.x + work.width - w - 16),
    Math.round(work.y + 16),
  )

  const html = isSaved
    ? buildSavedOverlayHtml(payload)
    : buildTransientOverlayHtml(payload)

  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => {
    if (!window.isDestroyed()) {
      if (interactive) {
        window.show()
      } else {
        window.showInactive()
      }
    }
  })

  try {
    new Notification({
      title: payload.title,
      body: payload.body,
      silent: payload.kind === 'heard' || payload.kind === 'clipping',
    }).show()
  } catch {
    // Notifications are best-effort (game fullscreen may hide them).
  }

  if (hideTimer) {
    clearTimeout(hideTimer)
  }
  hideTimer = setTimeout(() => {
    hideClipOverlay()
  }, holdMs)
}

export function hideClipOverlay(): void {
  destroyOverlayWindow()
}
