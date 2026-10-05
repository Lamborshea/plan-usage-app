import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

export interface StoredProviderConfig {
  enabled: boolean
  /** value -> encrypted (base64) when safeStorage is available, else plaintext marker */
  values: Record<string, string>
}

interface StoreShape {
  providers: Record<string, StoredProviderConfig>
}

const ENC_PREFIX = 'enc:v1:'

let cache: StoreShape | null = null

function storePath(): string {
  return join(app.getPath('userData'), 'provider-config.json')
}

function load(): StoreShape {
  if (cache) return cache
  try {
    if (existsSync(storePath())) {
      cache = JSON.parse(readFileSync(storePath(), 'utf-8')) as StoreShape
      return cache
    }
  } catch {
    // corrupted store -> start fresh
  }
  cache = { providers: {} }
  return cache
}

function persist(): void {
  const p = storePath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(cache, null, 2), 'utf-8')
}

function encrypt(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
  }
  return plain
}

function decrypt(stored: string): string {
  if (stored.startsWith(ENC_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) return ''
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
  }
  return stored
}

export const configStore = {
  isConfigured(providerId: string): boolean {
    const entry = load().providers[providerId]
    return !!entry && Object.values(entry.values).every((v) => v.length > 0)
  },

  /** plaintext values for the main process (API calls) */
  get(providerId: string): Record<string, string> | null {
    const entry = load().providers[providerId]
    if (!entry) return null
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(entry.values)) out[k] = decrypt(v)
    return out
  },

  /** plaintext values for the settings form */
  getForEdit(providerId: string): Record<string, string> {
    return this.get(providerId) ?? {}
  },

  set(providerId: string, values: Record<string, string>): void {
    const encrypted: Record<string, string> = {}
    for (const [k, v] of Object.entries(values)) encrypted[k] = encrypt(v)
    load().providers[providerId] = { enabled: true, values: encrypted }
    persist()
  },

  clear(providerId: string): void {
    delete load().providers[providerId]
    persist()
  }
}
