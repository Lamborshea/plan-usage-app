import { createHmac, createHash } from 'crypto'
import type { SignRequest, SignedRequest } from './acs3'

export interface VolcSignOptions extends SignRequest {
  region: string
  service: string
}

const sha256hex = (input: string | Buffer): string =>
  createHash('sha256').update(input).digest('hex')

const hmac = (key: string | Buffer, input: string): Buffer =>
  createHmac('sha256', key).update(input).digest()

function canonicalQuery(searchParams: URLSearchParams): string {
  return [...searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

/**
 * Volcengine OpenAPI signature (HMAC-SHA256, AWS SigV4 style).
 * https://www.volcengine.com/docs/6369/67269
 */
export function signVolc(req: VolcSignOptions): SignedRequest {
  const u = new URL(req.url)
  const body = req.body ?? ''
  const hashedPayload = sha256hex(body)

  const now = new Date()
  // 火山引擎要求 X-Date 为 YYYYMMDD'T'HHMMSS'Z'（UTC、精确到秒、带 Z）
  const xDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const shortDate = xDate.slice(0, 8)

  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    host: u.host,
    'x-content-sha256': hashedPayload,
    'x-date': xDate,
    ...req.acsHeaders
  }

  const signedHeaderNames = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
  const canonicalHeaders = signedHeaderNames
    .map((k) => `${k}:${headers[Object.keys(headers).find((o) => o.toLowerCase() === k)!].trim()}\n`)
    .join('')

  const canonicalRequest = [
    req.method,
    u.pathname || '/',
    canonicalQuery(u.searchParams),
    canonicalHeaders,
    signedHeaderNames.join(';'),
    hashedPayload
  ].join('\n')

  const credentialScope = `${shortDate}/${req.region}/${req.service}/request`
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    sha256hex(canonicalRequest)
  ].join('\n')

  const kDate = hmac(req.accessKeySecret, shortDate)
  const kRegion = hmac(kDate, req.region)
  const kService = hmac(kRegion, req.service)
  const kSigning = hmac(kService, 'request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  headers['Authorization'] =
    `HMAC-SHA256 Credential=${req.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`

  return { url: req.url, headers, body: req.body }
}
