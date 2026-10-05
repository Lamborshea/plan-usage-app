/**
 * Shared contracts between main / preload / renderer.
 * Adding a new AI provider only requires implementing `ProviderAdapter`
 * (see src/main/providers) — the UI is driven entirely by these types.
 */

/** A single input field rendered in the provider settings form. */
export interface ConfigField {
  key: string
  label: string
  type: 'password' | 'text'
  placeholder?: string
  description?: string
}

/** A documentation / console link shown next to the provider settings. */
export interface GuideLink {
  label: string
  url: string
}

/** Static metadata describing a provider and how to configure it. */
export interface ProviderMeta {
  id: string
  name: string
  description: string
  fields: ConfigField[]
  links: GuideLink[]
}

/** One headline number card (e.g. "remaining credits"). */
export interface Metric {
  label: string
  value: string
  /** Optional secondary text, e.g. "/ 2,000" or a date range. */
  sub?: string
  /** 0-100, renders a progress bar when present. */
  percent?: number
  hint?: string
}

/** used/total pair per category, rendered as progress rows in the overview. */
export interface Breakdown {
  name: string
  used: number
  /** Omit when the provider exposes no quota (value-only row). */
  total?: number
  unit: string
}

export interface UsageSummary {
  providerId: string
  status?: string
  period?: { startMs: number; endMs: number }
  metrics: Metric[]
  breakdowns: Breakdown[]
  updatedAt: number
}

export interface SeriesGroup {
  name: string
  points: { t: number; v: number }[]
}

export interface DetailChart {
  id: string
  title: string
  kind: 'area' | 'bar' | 'pie'
  unit: string
  /** time-series groups (stacked area) */
  series?: SeriesGroup[]
  /** categorical values (bar / pie) */
  categories?: { name: string; value: number }[]
}

export interface UsageDetail {
  charts: DetailChart[]
  /** selectable time ranges in days, e.g. [7, 14, 30] */
  ranges?: number[]
  note?: string
}

/** What the renderer needs to render one provider row in the overview. */
export interface ProviderState {
  meta: ProviderMeta
  configured: boolean
  summary?: UsageSummary
  error?: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/** IPC surface exposed to the renderer via contextBridge. */
export interface UsageApi {
  listProviders(): Promise<ProviderState[]>
  getConfig(providerId: string): Promise<Record<string, string>>
  saveConfig(providerId: string, values: Record<string, string>): Promise<boolean>
  fetchSummary(providerId: string): Promise<Result<UsageSummary>>
  fetchDetail(providerId: string, days: number): Promise<Result<UsageDetail>>
  testConfig(
    providerId: string,
    values: Record<string, string>
  ): Promise<Result<UsageSummary>>
  setHeight(height: number): void
  mouseEnter(): void
  mouseLeave(): void
  togglePin(): Promise<boolean>
  onPinned(cb: (pinned: boolean) => void): void
  /** 配置保存后主进程广播，概览面板据此刷新 */
  onDataChanged(cb: () => void): void
  /** 在独立窗口中打开某供应商的用量详情 */
  openDetail(providerId: string, providerName: string): void
  /** 在独立窗口中打开供应商配置 */
  openSettings(): void
  openExternal(url: string): void
  hideWindow(): void
}
