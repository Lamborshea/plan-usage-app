import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { join, dirname } from 'path'

export interface StoredProviderConfig {
  enabled: boolean
  /** value -> AES-256-GCM encrypted (base64) with local key file */
  values: Record<string, string>
}

interface StoreShape {
  providers: Record<string, StoredProviderConfig>
}

const ENC_PREFIX = 'enc:v2:'
/** 历史版本使用 OS 钥匙串（safeStorage）加密，会反复弹密码框，已废弃 */
const LEGACY_PREFIX = 'enc:v1:'

let cache: StoreShape | null = null

function storePath(): string {
  return join(app.getPath('userData'), 'provider-config.json')
}

function keyPath(): string {
  return join(app.getPath('userData'), 'secret.key')
}

let keyCache: Buffer | null = null

/** 本地密钥文件（0600），首次使用时随机生成，替代 OS 钥匙串避免授权弹窗 */
function getKey(): Buffer {
  if (keyCache) return keyCache
  if (existsSync(keyPath())) {
    const raw = Buffer.from(readFileSync(keyPath(), 'utf-8').trim(), 'base64')
    if (raw.length === 32) {
      keyCache = raw
      return keyCache
    }
  }
  keyCache = randomBytes(32)
  mkdirSync(dirname(keyPath()), { recursive: true })
  writeFileSync(keyPath(), keyCache.toString('base64'), { mode: 0o600 })
  return keyCache
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
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
  // layout: iv(12) + authTag(16) + ciphertext
  return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}

function decrypt(stored: string): string {
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      const raw = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
      const decipher = createDecipheriv('aes-256-gcm', getKey(), raw.subarray(0, 12))
      decipher.setAuthTag(raw.subarray(12, 28))
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf-8')
    } catch {
      return ''
    }
  }
  // 历史钥匙串密文不再解密（避免触发钥匙串授权弹窗），视为未配置，需在设置中重填一次
  if (stored.startsWith(LEGACY_PREFIX)) return ''
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
