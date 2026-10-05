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
    // 面板是 screen-saver 级置顶，会盖住右键菜单（含"退出"入口）：
    // 弹菜单前先隐藏面板，菜单关闭后若仍处于固定状态再恢复
    const win = getPopover()
    const wasVisible = !!win && win.isVisible()
    if (wasVisible) win?.hide()
    const restore = (): void => {
      if (wasVisible && isPinned()) showPopover(bounds())
    }
    if (wasVisible) {
      contextMenu.once('menu-will-close', restore)
      // 兜底：事件异常未触发时最迟 15s 后恢复，避免面板永久消失
      setTimeout(restore, 15_000)
    }
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
