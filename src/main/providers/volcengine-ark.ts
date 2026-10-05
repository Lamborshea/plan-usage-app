import type { DetailChart, UsageDetail, UsageSummary } from '../../shared/types'
import { signVolc } from './signing/volc'
import { ProviderApiError, requestJson, type ProviderAdapter, type ProviderConfig } from './types'

const ENDPOINT = 'https://ark.cn-beijing.volcengineapi.com'
const REGION = 'cn-beijing'
const SERVICE = 'ark'

/**
 * 火山方舟 OpenAPI 响应类型。字段结构以实际接口响应为准，
 * 见 docs/volcengine.md（含 GetAFPUsage / GetUsageDetails 的响应样例）。
 */

/** 所有方舟 OpenAPI 响应的公共元数据；出错时 Error 非空 */
interface ArkResponseMetadata {
  RequestId?: string
  Action?: string
  Version?: string
  Service?: string
  Region?: string
  Error?: { Code?: string; Message?: string }
}

/** 个人版 Agent Plan 套餐档位（GetUsageDetails 数字编码：1=Small 2=Medium 3=Large 4=Max） */
type PlanTier = 'Small' | 'Medium' | 'Large' | 'Max'

/** 计费类型：套餐内 / 套餐外 */
type ArkBillingType = 'WithinPlan' | 'OutsideOfPlan'

/**
 * 单条用量明细。注意：同一模型同一 Time 可能出现多条记录
 * （实际响应验证过），需要调用方自行按 模型+时间 聚合。
 */
interface UsageDetailItem {
  /** Unix 毫秒时间戳，按 QueryInterval 对齐（Day=当天 0 点） */
  Time: number
  /** 模型 / Harness 名称 */
  ObjectName: string
  Usage: number
  /** 单位，如 Tokens、Images */
  Unit: string
  BillingType: ArkBillingType
}

interface UsageDetailsResponse {
  ResponseMetadata?: ArkResponseMetadata
  Result?: { Details: UsageDetailItem[] }
}

/** AFP 滚动窗口配额（GetAFPUsage）。接口实际返回秒级时间戳，经 normalizeWindow 归一化为 epoch 毫秒 */
interface AFPWindow {
  /** 窗口总配额（AFP） */
  Quota: number
  /** 窗口内已用量（AFP） */
  Used: number
  /** 窗口起始时间 */
  SubscribeTime: number
  /** 下次重置时间 */
  ResetTime: number
}

interface AFPUsageResponse {
  ResponseMetadata?: ArkResponseMetadata
  Result?: {
    /** 当前套餐档位 */
    PlanType?: PlanTier
    AFPFiveHour?: AFPWindow
    AFPDaily?: AFPWindow
    AFPWeekly?: AFPWindow
    AFPMonthly?: AFPWindow
  }
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

async function postArk<T extends { ResponseMetadata?: ArkResponseMetadata }>(
  action: string,
  config: ProviderConfig,
  body: string
): Promise<T> {
  const signed = signVolc({
    method: 'POST',
    url: `${ENDPOINT}/?Action=${action}&Version=2024-01-01`,
    acsHeaders: {},
    body,
    region: REGION,
    service: SERVICE,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.secretAccessKey
  })
  const json = await requestJson<T>(signed.url, {
    method: 'POST',
    headers: signed.headers,
    body: signed.body
  })
  const err = json.ResponseMetadata?.Error
  if (err) throw new ProviderApiError(`${err.Code}: ${err.Message}`)
  return json
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
  const json = await postArk<UsageDetailsResponse>('GetUsageDetails', config, body)
  return json.Result?.Details ?? []
}

/** 秒/毫秒时间戳兼容：小于 1e11 视为秒（1973 年前的毫秒值不存在，可安全区分） */
const toMs = (t: number): number => (t < 1e11 ? t * 1000 : t)

const normalizeWindow = (w?: AFPWindow): AFPWindow | undefined =>
  w && { ...w, SubscribeTime: toMs(w.SubscribeTime), ResetTime: toMs(w.ResetTime) }

async function fetchAFPUsage(config: ProviderConfig): Promise<AFPUsageResponse['Result']> {
  const json = await postArk<AFPUsageResponse>('GetAFPUsage', config, '{}')
  const r = json.Result
  if (!r) return undefined
  // 实测接口返回 epoch 秒（与官方文档标注的毫秒不一致），统一归一化为毫秒
  return {
    PlanType: r.PlanType,
    AFPFiveHour: normalizeWindow(r.AFPFiveHour),
    AFPDaily: normalizeWindow(r.AFPDaily),
    AFPWeekly: normalizeWindow(r.AFPWeekly),
    AFPMonthly: normalizeWindow(r.AFPMonthly)
  }
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
    description: 'Agent Plan AFP 额度（5 小时/日/周/月滚动窗口）+ 模型 Tokens 用量明细',
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
        label: '用量明细接口 GetUsageDetails',
        url: 'https://docs.volcengine.com/docs/82379/2479849'
      },
      {
        label: 'AFP 额度接口 GetAFPUsage',
        url: 'https://docs.volcengine.com/docs/82379/2479847'
      },
      {
        label: '火山方舟控制台',
        url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/overview'
      }
    ]
  },

  async fetchSummary(config) {
    const now = Date.now()
    // AFP 配额快照与 Token 明细并行拉取；AFP 失败（如未订阅个人版 Agent Plan）时降级为仅展示 Token 明细
    const [afp, details] = await Promise.all([
      fetchAFPUsage(config).catch(() => undefined),
      fetchUsageDetails(config, now - 30 * DAY, now)
    ])
    const models = groupByModel(details)

    const sumInRange = (fromMs: number): number =>
      details.filter((d) => d.Time >= fromMs).reduce((s, d) => s + d.Usage, 0)

    const last7 = sumInRange(startOfDay(now - 6 * DAY))
    const last30 = sumInRange(startOfDay(now - 29 * DAY))
    const unit = details[0]?.Unit ?? 'Tokens'

    const top = [...models.entries()].sort((a, b) => b[1].total - a[1].total)

    const windows: [string, AFPWindow | undefined][] = [
      ['5 小时', afp?.AFPFiveHour],
      ['今日', afp?.AFPDaily],
      ['本周', afp?.AFPWeekly],
      ['本月', afp?.AFPMonthly]
    ]
    const afpMetrics = windows
      .filter(([, w]) => w)
      .map(([label, w]) => ({
        label: `AFP · ${label}`,
        value: fmt(w!.Used),
        sub: `/ ${fmt(w!.Quota)}`,
        percent: w!.Quota > 0 ? (w!.Used / w!.Quota) * 100 : undefined,
        hint: w!.ResetTime
          ? `重置于 ${new Date(w!.ResetTime).toLocaleString('zh-CN', { hour12: false })}`
          : undefined
      }))

    const fallbackMetrics = [
      { label: '近 7 天用量', value: fmt(last7), sub: unit },
      { label: '近 30 天用量', value: fmt(last30), sub: unit },
      { label: '模型数量', value: `${models.size}`, sub: '有用量记录的模型' }
    ]

    return {
      providerId: 'volcengine-ark',
      status: afp?.PlanType ? `个人版 Agent Plan · ${afp.PlanType}` : undefined,
      metrics: afpMetrics.length > 0 ? afpMetrics : fallbackMetrics,
      breakdowns: [
        { name: '近 7 天 Tokens', used: last7, unit },
        { name: '近 30 天 Tokens', used: last30, unit },
        ...top.map(([name, m]) => ({ name, used: m.total, unit: m.unit }))
      ],
      updatedAt: now
    } satisfies UsageSummary
  },

  async fetchDetail(config, days) {
    const now = Date.now()
    const from = startOfDay(now - (days - 1) * DAY)
    const [afp, details] = await Promise.all([
      fetchAFPUsage(config).catch(() => undefined),
      fetchUsageDetails(config, from, now)
    ])
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

    const charts: DetailChart[] = []

    const afpWindows: [string, AFPWindow | undefined][] = [
      ['5 小时', afp?.AFPFiveHour],
      ['今日', afp?.AFPDaily],
      ['本周', afp?.AFPWeekly],
      ['本月', afp?.AFPMonthly]
    ]
    const presentWindows = afpWindows.filter(([, w]) => w)
    if (presentWindows.length > 0) {
      charts.push({
        id: 'afp-used',
        title: afp?.PlanType ? `AFP 已用量（${afp.PlanType} 套餐）` : 'AFP 已用量',
        kind: 'bar',
        unit: 'AFP',
        categories: presentWindows.map(([label, w]) => ({ name: label, value: w!.Used }))
      })
      charts.push({
        id: 'afp-quota',
        title: 'AFP 配额与剩余',
        kind: 'bar',
        unit: 'AFP',
        categories: presentWindows.flatMap(([label, w]) => [
          { name: `${label} 总配额`, value: w!.Quota },
          { name: `${label} 剩余`, value: Math.max(0, w!.Quota - w!.Used) }
        ])
      })
      charts.push({
        id: 'afp-percent',
        title: 'AFP 使用率',
        kind: 'bar',
        unit: '%',
        categories: presentWindows.map(([label, w]) => ({
          name: label,
          value: w!.Quota > 0 ? Math.round((w!.Used / w!.Quota) * 1000) / 10 : 0
        }))
      })
    }

    charts.push({
      id: 'daily-tokens',
      title: '每日 Tokens 用量（按模型堆叠）',
      kind: 'area',
      unit,
      series
    })

    charts.push({
      id: 'model-total',
      title: `各模型累计用量（近 ${days} 天）`,
      kind: 'bar',
      unit,
      categories: [...models.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([name, m]) => ({ name, value: m.total }))
    })

    const byBilling = new Map<string, number>()
    for (const d of details) {
      const label =
        d.BillingType === 'WithinPlan' ? '套餐内' : d.BillingType === 'OutsideOfPlan' ? '套餐外' : d.BillingType
      byBilling.set(label, (byBilling.get(label) ?? 0) + d.Usage)
    }
    if (byBilling.size > 0) {
      charts.push({
        id: 'billing',
        title: `套餐内外用量占比（近 ${days} 天）`,
        kind: 'pie',
        unit,
        categories: [...byBilling.entries()].map(([name, value]) => ({ name, value }))
      })
    }

    return {
      ranges: [7, 14, 30],
      note: '数据来源：GetAFPUsage（AFP 额度快照，分钟级延迟）+ GetUsageDetails（QueryInterval=Day，小时级延迟）。不同模型 AFP 与 Token 折算系数不同，两类数据不应直接互相核对。',
      charts
    } satisfies UsageDetail
  }
}
