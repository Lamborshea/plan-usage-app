import { app, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { allProviders, getProvider } from './providers'
import type { ProviderAdapter, ProviderConfig } from './providers/types'
import { configStore } from './store'
import type { UsageDetail, UsageSummary } from '../shared/types'

/**
 * 用量数据缓存：内存 + 磁盘双层。
 * - 冷启动/面板唤出时优先用上次快照秒渲染，再后台刷新（stale-while-revalidate）；
 * - 同 key 并发请求去重；刷新成功后广播 data:changed 给所有窗口；
 * - 详情窗口从 pin 页打开时直接命中概览已填充的缓存与默认区间快照。
 */

export interface Snapshot<T> {
  data: T | null
  /** 上次成功抓取时间（毫秒）；null 表示从未成功过 */
  updatedAt: number | null
  error: string | null
  fetching: boolean
}

const SUMMARY_TTL_MS = 15_000
const DETAIL_DEFAULT_DAYS = 7

type StoredEntry =
  | { kind: 'summary'; data: UsageSummary | null; error: string | null; updatedAt: number | null }
  | { kind: 'detail'; days: number; data: UsageDetail | null; error: string | null; updatedAt: number | null }

type SummaryEntry = Extract<StoredEntry, { kind: 'summary' }>
type DetailEntry = Extract<StoredEntry, { kind: 'detail' }>

const mem = new Map<string, StoredEntry>()
const inFlight = new Map<string, Promise<StoredEntry>>()
let loadedFromDisk = false

function diskPath(): string {
  return join(app.getPath('userData'), 'usage-cache.json')
}

function restoreFromDisk(): void {
  if (loadedFromDisk) return
  loadedFromDisk = true
  try {
    const file = diskPath()
    if (!existsSync(file)) return
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, StoredEntry>
    for (const [key, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== 'object') continue
      // 磁盘快照只作为首屏渲染的种子，updatedAt 保留原值（>TTL 会触发后台刷新）
      mem.set(key, entry)
    }
  } catch {
    /* 缓存损坏则忽略，正常拉取即可 */
  }
}

function persistToDisk(): void {
  try {
    const file = diskPath()
    mkdirSync(dirname(file), { recursive: true })
    const obj: Record<string, StoredEntry> = {}
    for (const [k, v] of mem) obj[k] = v
    writeFileSync(file, JSON.stringify(obj), 'utf-8')
  } catch {
    /* 写盘失败不影响功能 */
  }
}

export function notifyChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('data:changed')
  }
}

function resolveConfig(provider: ProviderAdapter): ProviderConfig | null {
  const stored = configStore.get(provider.meta.id)
  if (stored) return stored
  if (provider.meta.fields.length === 0) return {}
  return null
}

async function fetchSummaryFresh(provider: ProviderAdapter, config: ProviderConfig): Promise<SummaryEntry> {
  try {
    const data = await provider.fetchSummary(config)
    return { kind: 'summary', data, error: null, updatedAt: Date.now() }
  } catch (e) {
    return { kind: 'summary', data: null, error: (e as Error).message, updatedAt: null }
  }
}

async function fetchDetailFresh(provider: ProviderAdapter, config: ProviderConfig, days: number): Promise<DetailEntry> {
  try {
    const data = await provider.fetchDetail(config, days)
    return { kind: 'detail', days, data, error: null, updatedAt: Date.now() }
  } catch (e) {
    return { kind: 'detail', days, data: null, error: (e as Error).message, updatedAt: null }
  }
}

function startRefresh<T extends StoredEntry>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const p = task()
    .then((entry) => {
      // 拉取失败且已有旧快照时保留旧数据，仅记录错误
      const prev = mem.get(key)
      if (entry.data === null && prev && prev.data !== null) {
        mem.set(key, { ...prev, error: entry.error })
      } else {
        mem.set(key, entry)
      }
      persistToDisk()
      notifyChanged()
      return entry
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, p)
  return p
}

function summaryEntry(key: string): SummaryEntry | undefined {
  const entry = mem.get(key)
  return entry && entry.kind === 'summary' ? entry : undefined
}

function detailEntry(key: string): DetailEntry | undefined {
  const entry = mem.get(key)
  return entry && entry.kind === 'detail' ? entry : undefined
}

/* ---------------- 概览摘要 ---------------- */

export function summarySnapshot(providerId: string): Snapshot<UsageSummary> {
  restoreFromDisk()
  const key = `summary:${providerId}`
  const entry = summaryEntry(key)
  if (entry) {
    return { data: entry.data, updatedAt: entry.updatedAt, error: entry.error, fetching: inFlight.has(key) }
  }
  return { data: null, updatedAt: null, error: null, fetching: inFlight.has(key) }
}

/** 返回缓存的摘要；超过 TTL 则后台刷新并广播（不阻塞渲染） */
export async function getSummary(providerId: string, opts: { force?: boolean } = {}): Promise<Snapshot<UsageSummary>> {
  restoreFromDisk()
  const provider = getProvider(providerId)
  if (!provider) throw new Error(`未知供应商: ${providerId}`)
  const config = resolveConfig(provider)
  if (config === null) throw new Error('尚未配置密钥，请先到设置中填写')

  const key = `summary:${providerId}`
  const entry = summaryEntry(key)
  const fresh = !!entry && entry.updatedAt !== null && Date.now() - entry.updatedAt < SUMMARY_TTL_MS

  if (!opts.force && fresh && entry) {
    return { data: entry.data, updatedAt: entry.updatedAt, error: entry.error, fetching: false }
  }
  if (!opts.force && entry && entry.data !== null) {
    // stale-while-revalidate：先回缓存秒渲染，后台刷新
    void startRefresh(key, () => fetchSummaryFresh(provider, config))
    return { data: entry.data, updatedAt: entry.updatedAt, error: entry.error, fetching: true }
  }
  if (inFlight.has(key)) {
    return { data: entry?.data ?? null, updatedAt: entry?.updatedAt ?? null, error: entry?.error ?? null, fetching: true }
  }
  const result = await startRefresh(key, () => fetchSummaryFresh(provider, config))
  return { data: result.data, updatedAt: result.updatedAt, error: result.error, fetching: false }
}

/* ---------------- 详情 ---------------- */

export async function getDetail(providerId: string, days: number): Promise<Snapshot<UsageDetail>> {
  restoreFromDisk()
  const provider = getProvider(providerId)
  if (!provider) throw new Error(`未知供应商: ${providerId}`)
  const config = resolveConfig(provider)
  if (config === null) throw new Error('尚未配置密钥，请先到设置中填写')

  const key = `detail:${providerId}:${days}`
  const entry = detailEntry(key)
  if (entry && entry.data !== null) {
    // 详情命中即用缓存渲染；默认区间同时后台刷新，其余区间保持稳定
    if (days === DETAIL_DEFAULT_DAYS) {
      void startRefresh(key, () => fetchDetailFresh(provider, config, days))
    }
    return { data: entry.data, updatedAt: entry.updatedAt, error: entry.error, fetching: true }
  }
  if (inFlight.has(key)) {
    return { data: null, updatedAt: null, error: null, fetching: true }
  }
  const result = await startRefresh(key, () => fetchDetailFresh(provider, config, days))
  return { data: result.data, updatedAt: result.updatedAt, error: result.error, fetching: false }
}

/** 详情区间标签（供预热用：拉默认区间 + 供应商声明的其余区间） */
async function preheatDetail(provider: ProviderAdapter, config: ProviderConfig): Promise<void> {
  const ranges = [DETAIL_DEFAULT_DAYS]
  try {
    const first = await getDetail(provider.meta.id, DETAIL_DEFAULT_DAYS)
    const data = first.data as UsageDetail | null
    if (data?.ranges) for (const r of data.ranges) if (!ranges.includes(r)) ranges.push(r)
  } catch {
    return
  }
  for (const r of ranges.slice(1)) {
    void startRefresh(`detail:${provider.meta.id}:${r}`, () => fetchDetailFresh(provider, config, r))
  }
}

/* ---------------- 失效与预热 ---------------- */

/** 配置或登录态变化后清空该供应商缓存 */
export function invalidateProvider(providerId: string): void {
  for (const key of [...mem.keys()]) {
    if (key === `summary:${providerId}` || key.startsWith(`detail:${providerId}:`)) mem.delete(key)
  }
  persistToDisk()
}

/** 预热所有可用供应商的摘要 + 详情缓存（启动后与周期调用） */
export async function preheatAll(): Promise<void> {
  restoreFromDisk()
  for (const provider of allProviders()) {
    let available = false
    try {
      const config = resolveConfig(provider) ?? {}
      available = provider.isAvailable ? await provider.isAvailable(config) : provider.meta.fields.length === 0 || configStore.isConfigured(provider.meta.id)
      if (!available) continue
      const entry = await startRefresh(`summary:${provider.meta.id}`, () => fetchSummaryFresh(provider, config))
      if (entry.kind === 'summary' && entry.data) {
        void preheatDetail(provider, config)
      }
    } catch {
      /* 单个供应商失败不影响其他 */
    }
  }
}

/** 距上次成功抓取超过 TTL 的供应商后台刷新 */
export function refreshStaleSummaries(): void {
  restoreFromDisk()
  for (const provider of allProviders()) {
    const key = `summary:${provider.meta.id}`
    if (inFlight.has(key)) continue
    const entry = mem.get(key)
    if (!entry || entry.updatedAt === null || Date.now() - entry.updatedAt >= SUMMARY_TTL_MS) {
      const config = resolveConfig(provider)
      if (config === null) continue
      void startRefresh(key, () => fetchSummaryFresh(provider, config)).catch(() => undefined)
    }
  }
}
