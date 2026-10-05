import { contextBridge, ipcRenderer } from 'electron'
import type { UsageApi } from '../shared/types'

const api: UsageApi = {
  listProviders: () => ipcRenderer.invoke('providers:list'),
  getConfig: (id) => ipcRenderer.invoke('providers:get-config', id),
  saveConfig: (id, values) => ipcRenderer.invoke('providers:save-config', id, values),
  fetchSummary: (id, force) => ipcRenderer.invoke('usage:summary', id, force),
  fetchDetail: (id, days) => ipcRenderer.invoke('usage:detail', id, days),
  testConfig: (id, values) => ipcRenderer.invoke('providers:test', id, values),
  loginProvider: (id) => ipcRenderer.invoke('providers:login', id),
  setHeight: (height) => ipcRenderer.send('window:set-height', height),
  mouseEnter: () => ipcRenderer.send('window:mouse-enter'),
  mouseLeave: () => ipcRenderer.send('window:mouse-leave'),
  togglePin: () => ipcRenderer.invoke('window:toggle-pin'),
  onPinned: (cb) => {
    ipcRenderer.on('app:pinned', (_e, pinned: boolean) => cb(pinned))
  },
  onDataChanged: (cb) => {
    ipcRenderer.on('data:changed', () => cb())
  },
  openDetail: (providerId, providerName) =>
    ipcRenderer.send('window:open-detail', providerId, providerName),
  openSettings: () => ipcRenderer.send('window:open-settings'),
  openExternal: (url) => ipcRenderer.send('app:open-external', url),
  hideWindow: () => ipcRenderer.send('app:hide-window'),
  quit: () => ipcRenderer.send('app:quit')
}

contextBridge.exposeInMainWorld('usageApi', api)
