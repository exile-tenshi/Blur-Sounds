import { BrowserWindow, Notification, screen } from 'electron'

export type ClipOverlayKind = 'heard' | 'clipping' | 'saved' | 'error'

export interface ClipOverlayPayload {
  title: string
  body: string
  kind: ClipOverlayKind
  holdMs?: number
}

let overlayWindow: BrowserWindow | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined

function overlayHtml(payload: ClipOverlayPayload): string {
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function ensureOverlay(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow
  }

  const display = screen.getPrimaryDisplay()
  const width = 420
  const height = 110
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
    focusable: false,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.on('closed', () => {
    overlayWindow = undefined
  })
  return overlayWindow
}

export function showClipOverlay(payload: ClipOverlayPayload): void {
  const holdMs = payload.holdMs ?? (payload.kind === 'clipping' || payload.kind === 'heard' ? 2500 : 4200)
  const window = ensureOverlay()
  const html = overlayHtml(payload)
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => {
    if (!window.isDestroyed()) {
      window.showInactive()
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
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = undefined
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide()
  }
}
