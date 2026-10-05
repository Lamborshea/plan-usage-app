import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'

export const WINDOW_WIDTH = 400

let popover: BrowserWindow | null = null
let pinned = false

export function isPinned(): boolean {
  return pinned
}

export function setPinned(value: boolean): void {
  pinned = value
  popover?.webContents.send('app:pinned', value)
}

export function getPopover(): BrowserWindow | null {
  return popover
}

export function createPopoverWindow(): BrowserWindow {
  popover = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: 560,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  popover.setAlwaysOnTop(true, 'screen-saver')
  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  popover.on('blur', () => {
    if (!pinned) hidePopover()
  })
  popover.on('closed', () => {
    popover = null
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    popover.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    popover.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return popover
}

/** Place the popover under the tray icon (or top-right of the screen). */
export function positionPopover(trayBounds?: Electron.Rectangle): void {
  if (!popover) return
  const winBounds = popover.getBounds()
  let x: number
  let y: number

  if (trayBounds) {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2)
    y = Math.round(trayBounds.y + trayBounds.height + 4)
  } else {
    const workArea = screen.getPrimaryDisplay().workArea
    x = workArea.x + workArea.width - winBounds.width - 16
    y = workArea.y + 8
  }

  // keep inside the display work area
  const display = screen.getDisplayNearestPoint({ x, y })
  const wa = display.workArea
  x = Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - winBounds.width - 4)
  y = Math.min(Math.max(y, wa.y + 4), wa.y + wa.height - winBounds.height - 4)

  popover.setBounds({ x, y, width: winBounds.width, height: winBounds.height })
}

export function showPopover(trayBounds?: Electron.Rectangle): void {
  if (!popover) return
  positionPopover(trayBounds)
  popover.show()
  popover.focus()
}

export function hidePopover(): void {
  if (popover?.isVisible() && !pinned) popover.hide()
}

export function togglePopover(trayBounds?: Electron.Rectangle): void {
  if (!popover) return
  if (popover.isVisible()) {
    setPinned(false)
    hidePopover()
  } else {
    showPopover(trayBounds)
  }
}

export function setPopoverHeight(height: number): void {
  if (!popover) return
  const b = popover.getBounds()
  // anchor to the top edge so the panel grows downward from the menu bar
  popover.setBounds({ x: b.x, y: b.y, width: b.width, height })
  positionPopover(lastTrayBounds ?? undefined)
}

let lastTrayBounds: Electron.Rectangle | null = null
export function rememberTrayBounds(bounds: Electron.Rectangle | null): void {
  lastTrayBounds = bounds
}
