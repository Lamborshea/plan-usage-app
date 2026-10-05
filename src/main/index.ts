import { app } from 'electron'
import { registerIpcHandlers } from './ipc'
import { initTrayAndWindow } from './tray'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.whenReady().then(() => {
  // menu-bar utility app: no dock icon on macOS
  if (process.platform === 'darwin' && app.dock) app.dock.hide()

  registerIpcHandlers()
  initTrayAndWindow()
})

app.on('window-all-closed', () => {
  // keep running in the menu bar
})
