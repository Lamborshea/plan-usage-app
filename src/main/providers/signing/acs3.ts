import { createHmac, createHash, randomUUID } from 'crypto'

export interface SignRequest {
  method: 'GET' | 'POST'
  url: string
  /** extra headers included in the signature (x-acs-action, x-acs-version, ...) */
  acsHeaders: Record<string, string>
  body?: string
  accessKeyId: string
  accessKeySecret: string
}

export interface SignedRequest {
  url: string
  headers: Record<string, string>
  body?: string
}

const sha256hex = (input: string | Buffer): string =>
  createHash('sha256').update(input).digest('hex')

const hmacHex = (key: string | Buffer, input: string): string =>
  createHmac('sha256', key).update(input).digest('hex')

function canonicalQuery(searchParams: URLSearchParams): string {
  return [...searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

/**
 * Alibaba Cloud OpenAPI signature, algorithm ACS3-HMAC-SHA256 (signature v3).
 * https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
 */
export function signAcs3(req: SignRequest): SignedRequest {
  const u = new URL(req.url)
  const body = req.body ?? ''
  const hashedPayload = sha256hex(body)

  const headers: Record<string, string> = {
    host: u.host,
    'x-acs-action': req.acsHeaders['x-acs-action'],
    'x-acs-version': req.acsHeaders['x-acs-version'],
    'x-acs-date': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    'x-acs-signature-nonce': randomUUID(),
    'x-acs-content-sha256': hashedPayload,
    ...req.acsHeaders
  }
  if (body) headers['content-type'] = 'application/json; charset=utf-8'

  const signedHeaderNames = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
  const canonicalHeaders = signedHeaderNames
    .map((k) => `${k}:${headers[Object.keys(headers).find((o) => o.toLowerCase() === k)!].trim()}\n`)
    .join('')

  const canonicalRequest = [
    req.method,
    u.pathname,
    canonicalQuery(u.searchParams),
    canonicalHeaders,
    signedHeaderNames.join(';'),
    hashedPayload
  ].join('\n')

  const stringToSign = `ACS3-HMAC-SHA256\n${sha256hex(canonicalRequest)}`
  const signature = hmacHex(req.accessKeySecret, stringToSign)

  headers['Authorization'] =
    `ACS3-HMAC-SHA256 Credential=${req.accessKeyId},` +
    `SignedHeaders=${signedHeaderNames.join(';')},Signature=${signature}`

  return { url: req.url, headers, body: req.body }
}
