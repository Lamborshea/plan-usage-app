import type { ProviderAdapter } from './types'
import { aliyunBailianAdapter } from './aliyun-bailian'
import { volcengineArkAdapter } from './volcengine-ark'

/**
 * Provider registry — the single extension point of the app.
 * To support a new AI vendor: implement `ProviderAdapter` and add it here.
 */
const adapters: ProviderAdapter[] = [aliyunBailianAdapter, volcengineArkAdapter]

export const providerRegistry: ReadonlyMap<string, ProviderAdapter> = new Map(
  adapters.map((a) => [a.meta.id, a])
)

export const allProviders = (): ProviderAdapter[] => adapters

export function getProvider(id: string): ProviderAdapter | undefined {
  return providerRegistry.get(id)
}
