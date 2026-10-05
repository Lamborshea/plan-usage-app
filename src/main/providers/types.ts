import type { ProviderMeta, UsageDetail, UsageSummary } from '../../shared/types'

export type ProviderConfig = Record<string, string>

/**
 * Contract every AI provider integration must implement.
 * Register new adapters in `src/main/providers/index.ts`.
 */
export interface ProviderAdapter {
  meta: ProviderMeta
  fetchSummary(config: ProviderConfig): Promise<UsageSummary>
  fetchDetail(config: ProviderConfig, days: number): Promise<UsageDetail>
}

export class ProviderApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ProviderApiError'
  }
}

export async function requestJson<T>(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (e) {
    throw new ProviderApiError(`网络请求失败: ${(e as Error).message}`)
  }
  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new ProviderApiError(`响应解析失败 (HTTP ${res.status})`)
  }
  if (!res.ok) {
    throw new ProviderApiError(
      `HTTP ${res.status}: ${truncate(text)}`,
      res.status
    )
  }
  return json as T
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}
