import { app } from 'electron'
import { registerIpcHandlers } from './ipc'
import { initTrayAndWindow } from './tray'
import { preheatAll, refreshStaleSummaries } from './cache'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

/** 后台预热/刷新周期：概览 15s TTL，5 分钟兜底刷一次 */
const PREHEAT_DELAY_MS = 1_500
const REFRESH_INTERVAL_MS = 5 * 60_000

app.whenReady().then(() => {
  // menu-bar utility app: no dock icon on macOS
  if (process.platform === 'darwin' && app.dock) app.dock.hide()

  registerIpcHandlers()
  initTrayAndWindow()

  // 启动后预热缓存（面板首开即可用快照渲染），之后周期性后台刷新
  setTimeout(() => void preheatAll(), PREHEAT_DELAY_MS)
  setInterval(() => refreshStaleSummaries(), REFRESH_INTERVAL_MS)
})

app.on('window-all-closed', () => {
  // keep running in the menu bar
})
