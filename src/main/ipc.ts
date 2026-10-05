import { ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { ProviderState, Result, UsageDetail, UsageSummary } from '../shared/types'
import { allProviders, getProvider } from './providers'
import type { ProviderAdapter, ProviderConfig } from './providers/types'
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

/** 无密钥字段的供应商（如基于本机 CLI 的百炼）视为已配置，可拿到空配置 */
function requireConfig(provider: ProviderAdapter): ProviderConfig {
  const stored = configStore.get(provider.meta.id)
  if (stored) return stored
  if (provider.meta.fields.length === 0) return {}
  throw new Error('尚未配置密钥，请先到设置中填写')
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
      return provider.fetchSummary(requireConfig(provider))
    })
  )

  ipcMain.handle(
    'usage:detail',
    (_e: IpcMainInvokeEvent, id: string, days: number): Promise<Result<UsageDetail>> =>
      guard(async () => {
        const provider = getProvider(id)
        if (!provider) throw new Error(`未知供应商: ${id}`)
        return provider.fetchDetail(requireConfig(provider), days)
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
      // 登录态变化后通知概览面板刷新
      const popover = getPopover()
      if (popover && !popover.isDestroyed()) popover.webContents.send('data:changed')
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
}
