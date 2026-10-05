import type { UsageApi } from '../../shared/types'

declare global {
  interface Window {
    usageApi: UsageApi
  }
}

export const api: UsageApi = window.usageApi
