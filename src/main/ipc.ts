import { ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { ProviderState, Result, UsageDetail, UsageSummary } from '../shared/types'
import { allProviders, getProvider } from './providers'
import { configStore } from './store'
import { setPopoverHeight, setPinned, isPinned, getPopover } from './windows'
import { openStandalone } from './standalone'
import { cancelScheduledHide, scheduleHide } from './tray'

function guard<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ ok: true as const, data }))
    .catch((e: Error) => ({ ok: false as const, error: e.message }))
}

export function registerIpcHandlers(): void {
  ipcMain.handle('providers:list', (): ProviderState[] =>
    allProviders().map((p) => ({
      meta: p.meta,
      configured: configStore.isConfigured(p.meta.id)
    }))
  )

  ipcMain.handle('providers:get-config', (_e: IpcMainInvokeEvent, id: string) =>
    configStore.getForEdit(id)
  )

  ipcMain.handle(
    'providers:save-config',
    (_e: IpcMainInvokeEvent, id: string, values: Record<string, string>) => {
      if (!getProvider(id)) throw new Error(`未知供应商: ${id}`)
      configStore.set(id, values)
      // 配置变化后通知概览面板刷新
      const popover = getPopover()
      if (popover && !popover.isDestroyed()) popover.webContents.send('data:changed')
      return true
    }
  )

  ipcMain.handle('usage:summary', (_e: IpcMainInvokeEvent, id: string): Promise<Result<UsageSummary>> =>
    guard(async () => {
      const provider = getProvider(id)
      if (!provider) throw new Error(`未知供应商: ${id}`)
      const config = configStore.get(id)
      if (!config) throw new Error('尚未配置密钥，请先到设置中填写')
      return provider.fetchSummary(config)
    })
  )

  ipcMain.handle(
    'usage:detail',
    (_e: IpcMainInvokeEvent, id: string, days: number): Promise<Result<UsageDetail>> =>
      guard(async () => {
        const provider = getProvider(id)
        if (!provider) throw new Error(`未知供应商: ${id}`)
        const config = configStore.get(id)
        if (!config) throw new Error('尚未配置密钥，请先到设置中填写')
        return provider.fetchDetail(config, days)
      })
  )

  ipcMain.handle('providers:test', (_e: IpcMainInvokeEvent, id: string, values: Record<string, string>): Promise<Result<UsageSummary>> =>
    guard(async () => {
      const provider = getProvider(id)
      if (!provider) throw new Error(`未知供应商: ${id}`)
      return provider.fetchSummary(values)
    })
  )

  ipcMain.on('window:set-height', (_e, height: number) => {
    setPopoverHeight(Math.round(height))
  })

  ipcMain.on('window:mouse-leave', () => scheduleHide())
  ipcMain.on('window:mouse-enter', () => cancelScheduledHide())

  ipcMain.on('window:open-detail', (_e, providerId: string, providerName: string) => {
    openStandalone({ view: 'detail', providerId, providerName })
  })

  ipcMain.on('window:open-settings', () => {
    openStandalone({ view: 'settings' })
  })

  ipcMain.handle('window:toggle-pin', () => {
    setPinned(!isPinned())
    return isPinned()
  })

  ipcMain.on('app:open-external', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  ipcMain.on('app:hide-window', () => {
    setPinned(false)
    scheduleHide(0)
  })
}
