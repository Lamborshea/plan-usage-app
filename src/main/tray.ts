import { Tray, Menu, nativeImage, app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  createPopoverWindow,
  getPopover,
  hidePopover,
  setPinned,
  showPopover,
  togglePopover,
  rememberTrayBounds,
  isPinned
} from './windows'

let tray: Tray | null = null
let hideTimer: NodeJS.Timeout | null = null

function trayIcon(): Electron.NativeImage {
  const base = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
  // 36px bitmap declared as @2x => renders at the standard 18pt menu-bar size
  const img = nativeImage.createFromBuffer(readFileSync(join(base, 'tray@2x.png')), {
    scaleFactor: 2
  })
  img.setTemplateImage(true)
  return img
}

function cancelHide(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

/** Hide shortly after the mouse leaves both tray and popover. */
export function scheduleHide(delayMs = 500): void {
  cancelHide()
  hideTimer = setTimeout(() => {
    hideTimer = null
    if (!isPinned()) hidePopover()
  }, delayMs)
}

export function cancelScheduledHide(): void {
  cancelHide()
}

export function createTray(): Tray {
  tray = new Tray(trayIcon())
  tray.setToolTip('Plan Usage · AI 用量监控')

  const bounds = (): Electron.Rectangle | undefined => tray?.getBounds()

  // hover on the menu bar icon -> show the usage panel
  tray.on('mouse-move', () => {
    rememberTrayBounds(bounds() ?? null)
    cancelHide()
    const win = getPopover()
    if (!win) return
    if (!win.isVisible()) {
      showPopover(bounds())
    }
  })
  tray.on('mouse-leave', () => scheduleHide())
  tray.on('mouse-enter', () => cancelHide())

  // click -> pin / unpin the panel
  tray.on('click', () => {
    rememberTrayBounds(bounds() ?? null)
    cancelHide()
    togglePopover(bounds())
  })

  // NOTE: on macOS, setContextMenu swallows the left 'click' event,
  // so the menu is popped manually on right-click instead.
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开面板',
      click: () => {
        setPinned(true)
        showPopover(bounds())
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.on('right-click', () => {
    tray?.popUpContextMenu(contextMenu)
  })

  return tray
}

export function initTrayAndWindow(): void {
  createPopoverWindow()
  createTray()

  const win = getPopover()
  win?.webContents.on('did-finish-load', () => {
    win.webContents.send('app:pinned', isPinned())
  })
}
