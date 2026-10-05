import { app, BrowserWindow } from 'electron'
import { join } from 'path'

/**
 * Standalone windows for "detail" and "settings" views.
 * Unlike the transparent tray popover, these are regular resizable windows
 * with a native title bar. The target view is selected via a URL query so the
 * same renderer bundle can serve every window kind.
 */

export type StandaloneView = 'detail' | 'settings'

interface OpenOptions {
  view: StandaloneView
  providerId?: string
  providerName?: string
}

const windows = new Map<string, BrowserWindow>()

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function windowKey(opts: OpenOptions): string {
  return opts.view === 'settings' ? 'settings' : `detail:${opts.providerId ?? ''}`
}

function buildSearch(opts: OpenOptions): string {
  const p = new URLSearchParams()
  p.set('view', opts.view)
  if (opts.providerId) p.set('providerId', opts.providerId)
  if (opts.providerName) p.set('providerName', opts.providerName)
  return p.toString()
}

function loadView(win: BrowserWindow, opts: OpenOptions): void {
  const search = buildSearch(opts)
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    win.loadURL(`${devUrl}?${search}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
}

function titleFor(opts: OpenOptions): string {
  if (opts.view === 'settings') return '供应商配置'
  return opts.providerName ? `${opts.providerName} · 用量详情` : '用量详情'
}

/** Open (or focus an existing) standalone window for the given view. */
export function openStandalone(opts: OpenOptions): void {
  const key = windowKey(opts)
  const existing = windows.get(key)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }

  const isDetail = opts.view === 'detail'
  const win = new BrowserWindow({
    width: isDetail ? 920 : 560,
    height: isDetail ? 680 : 640,
    minWidth: isDetail ? 640 : 440,
    minHeight: isDetail ? 420 : 420,
    title: titleFor(opts),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f5f8',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  windows.set(key, win)
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    windows.delete(key)
  })

  loadView(win, opts)
}
