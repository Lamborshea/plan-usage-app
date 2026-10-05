import { app, ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { ProviderState, Result, UsageDetail, UsageSummary } from '../shared/types'
import { allProviders, getProvider } from './providers'
import { configStore } from './store'
import { getDetail, getSummary, invalidateProvider, notifyChanged } from './cache'
import { setPopoverHeight, setPinned, isPinned } from './windows'
import { openStandalone } from './standalone'
import { cancelScheduledHide, scheduleHide } from './tray'

function guard<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ ok: true as const, data }))
    .catch((e: Error) => ({ ok: false as const, error: e.message }))
}

export function registerIpcHandlers(): void {
  ipcMain.handle('providers:list', async (): Promise<ProviderState[]> => {
    const states = await Promise.all(
      allProviders().map(async (p) => ({
        meta: p.meta,
        // 凭证在外部体系的供应商（如百炼 CLI 登录态）用 isAvailable 判断，
        // 其余按配置字段是否齐全判断；未配置/未登录的供应商不进入概览面板
        configured: p.isAvailable
          ? await p.isAvailable(configStore.get(p.meta.id) ?? {})
          : p.meta.fields.length === 0 || configStore.isConfigured(p.meta.id),
        canLogin: typeof p.login === 'function'
      }))
    )
    return states
  })

  ipcMain.handle('providers:get-config', (_e: IpcMainInvokeEvent, id: string) =>
    configStore.getForEdit(id)
  )

  ipcMain.handle(
    'providers:save-config',
    (_e: IpcMainInvokeEvent, id: string, values: Record<string, string>) => {
      if (!getProvider(id)) throw new Error(`未知供应商: ${id}`)
      configStore.set(id, values)
      // 配置变化后失效缓存并通知所有窗口刷新
      invalidateProvider(id)
      notifyChanged()
      return true
    }
  )

  ipcMain.handle(
    'usage:summary',
    (_e: IpcMainInvokeEvent, id: string, force?: boolean): Promise<Result<UsageSummary>> =>
      guard(async () => {
        // 缓存优先：TTL 内直接回快照；过期回旧数据 + 后台刷新（刷新完广播）
        const snap = await getSummary(id, { force })
        if (snap.data === null) throw new Error(snap.error ?? '暂无数据')
        return snap.data
      })
  )

  ipcMain.handle(
    'usage:detail',
    (_e: IpcMainInvokeEvent, id: string, days: number): Promise<Result<UsageDetail>> =>
      guard(async () => {
        const snap = await getDetail(id, days)
        if (snap.data === null) throw new Error(snap.error ?? '暂无数据')
        return snap.data
      })
  )

  ipcMain.handle('providers:test', (_e: IpcMainInvokeEvent, id: string, values: Record<string, string>): Promise<Result<UsageSummary>> =>
    guard(async () => {
      const provider = getProvider(id)
      if (!provider) throw new Error(`未知供应商: ${id}`)
      return provider.fetchSummary(values)
    })
  )

  ipcMain.handle('providers:login', (_e: IpcMainInvokeEvent, id: string): Promise<Result<string>> =>
    guard(async () => {
      const provider = getProvider(id)
      if (!provider) throw new Error(`未知供应商: ${id}`)
      if (!provider.login) throw new Error('该供应商不支持应用内登录')
      const message = await provider.login()
      // 登录态变化后失效缓存并通知所有窗口刷新
      invalidateProvider(id)
      notifyChanged()
      return message
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

  ipcMain.on('app:quit', () => {
    app.quit()
  })
}
