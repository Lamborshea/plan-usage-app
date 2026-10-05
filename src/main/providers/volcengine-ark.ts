import type { UsageDetail, UsageSummary } from '../../shared/types'
import { signVolc } from './signing/volc'
import { ProviderApiError, requestJson, type ProviderAdapter, type ProviderConfig } from './types'

const ENDPOINT = 'https://ark.cn-beijing.volcengineapi.com/?Action=GetUsageDetails&Version=2024-01-01'
const REGION = 'cn-beijing'
const SERVICE = 'ark'

interface UsageDetailItem {
  Time: number
  ObjectName: string
  Usage: number
  Unit: string
  BillingType: string
}

interface UsageDetailsResponse {
  ResponseMetadata?: { RequestId?: string; Error?: { Code?: string; Message?: string } }
  Result?: { Details: UsageDetailItem[] }
}

const DAY = 86_400_000

const toDateStr = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const startOfDay = (ms: number): number => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

async function fetchUsageDetails(
  config: ProviderConfig,
  startMs: number,
  endMs: number
): Promise<UsageDetailItem[]> {
  const body = JSON.stringify({
    QueryInterval: 'Day',
    Filter: { StartTime: toDateStr(startMs), EndTime: toDateStr(endMs) }
  })
  const signed = signVolc({
    method: 'POST',
    url: ENDPOINT,
    acsHeaders: {},
    body,
    region: REGION,
    service: SERVICE,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.secretAccessKey
  })
  const json = await requestJson<UsageDetailsResponse>(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body: signed.body
  })
  const err = json.ResponseMetadata?.Error
  if (err) throw new ProviderApiError(`${err.Code}: ${err.Message}`)
  return json.Result?.Details ?? []
}

function groupByModel(
  details: UsageDetailItem[]
): Map<string, { total: number; unit: string; byDay: Map<number, number> }> {
  const models = new Map<string, { total: number; unit: string; byDay: Map<number, number> }>()
  for (const d of details) {
    let entry = models.get(d.ObjectName)
    if (!entry) {
      entry = { total: 0, unit: d.Unit, byDay: new Map() }
      models.set(d.ObjectName, entry)
    }
    entry.total += d.Usage
    const day = startOfDay(d.Time)
    entry.byDay.set(day, (entry.byDay.get(day) ?? 0) + d.Usage)
  }
  return models
}

const fmt = (n: number): string => n.toLocaleString('zh-CN')

export const volcengineArkAdapter: ProviderAdapter = {
  meta: {
    id: 'volcengine-ark',
    name: '火山方舟',
    description: '套餐用量详情（GetUsageDetails，按天统计 Tokens）',
    fields: [
      {
        key: 'accessKeyId',
        label: 'AccessKey ID',
        type: 'text',
        placeholder: 'AKLT…'
      },
      {
        key: 'secretAccessKey',
        label: 'SecretAccessKey',
        type: 'password',
        placeholder: '••••••••'
      }
    ],
    links: [
      {
        label: '获取 AccessKey（IAM 控制台）',
        url: 'https://console.volcengine.com/iam/keymanage/'
      },
      {
        label: '火山方舟控制台',
        url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/overview'
      }
    ]
  },

  async fetchSummary(config) {
    const now = Date.now()
    const details = await fetchUsageDetails(config, now - 30 * DAY, now)
    const models = groupByModel(details)

    const sumInRange = (fromMs: number): number =>
      details.filter((d) => d.Time >= fromMs).reduce((s, d) => s + d.Usage, 0)

    const last7 = sumInRange(startOfDay(now - 6 * DAY))
    const last30 = sumInRange(startOfDay(now - 29 * DAY))
    const unit = details[0]?.Unit ?? 'Tokens'

    const top = [...models.entries()].sort((a, b) => b[1].total - a[1].total)

    return {
      providerId: 'volcengine-ark',
      metrics: [
        { label: '近 7 天用量', value: fmt(last7), sub: unit },
        { label: '近 30 天用量', value: fmt(last30), sub: unit },
        { label: '模型数量', value: `${models.size}`, sub: '有用量记录的模型' }
      ],
      breakdowns: top.map(([name, m]) => ({ name, used: m.total, unit: m.unit })),
      updatedAt: now
    } satisfies UsageSummary
  },

  async fetchDetail(config, days) {
    const now = Date.now()
    const from = startOfDay(now - (days - 1) * DAY)
    const details = await fetchUsageDetails(config, from, now)
    const models = groupByModel(details)

    const daysList: number[] = []
    for (let t = from; t <= now; t += DAY) daysList.push(t)

    const series = [...models.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8)
      .map(([name, m]) => ({
        name,
        points: daysList.map((t) => ({ t, v: m.byDay.get(t) ?? 0 }))
      }))

    const unit = details[0]?.Unit ?? 'Tokens'

    return {
      ranges: [7, 14, 30],
      note: '数据来源：火山方舟 GetUsageDetails（QueryInterval=Day），含套餐内与超额用量。',
      charts: [
        {
          id: 'daily-tokens',
          title: '每日 Tokens 用量（按模型堆叠）',
          kind: 'area',
          unit,
          series
        },
        {
          id: 'model-total',
          title: '各模型累计用量',
          kind: 'bar',
          unit,
          categories: [...models.entries()]
            .sort((a, b) => b[1].total - a[1].total)
            .map(([name, m]) => ({ name, value: m.total }))
        }
      ]
    } satisfies UsageDetail
  }
}
