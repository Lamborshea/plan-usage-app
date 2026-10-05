import type { Breakdown, DetailChart, Metric, UsageDetail, UsageSummary } from '../../shared/types'
import { signAcs3 } from './signing/acs3'
import { ProviderApiError, requestJson, type ProviderAdapter, type ProviderConfig } from './types'

const HOST = 'https://modelstudio.cn-beijing.aliyuncs.com'
const API_VERSION = '2026-02-10'
/** TokenPlan 产品固定的命名空间 */
const NAMESPACE_ID = 'namespace-1'

const SEAT_TYPE_LABELS: Record<string, string> = {
  standard: '标准席位',
  pro: '高级席位',
  max: '尊享席位'
}

const ROLE_LABELS: Record<string, string> = {
  ORG_OWNER: '组织拥有者',
  ORG_ADMIN: '组织管理员',
  WS_ADMIN: '空间管理员',
  MEMBER: '成员'
}

/* ------------------------------------------------------------------ *
 * 通用请求层
 * ------------------------------------------------------------------ */

type QueryValue = string | number | boolean | undefined | string[]

interface AcsRequest {
  action: string
  path: string
  query?: Record<string, QueryValue>
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const u = new URL(HOST + path)
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined) continue
    if (Array.isArray(v)) v.forEach((item, i) => u.searchParams.append(`${k}.${i + 1}`, item))
    else u.searchParams.append(k, String(v))
  }
  return u.toString()
}

async function callAcs<T>(config: ProviderConfig, req: AcsRequest): Promise<T> {
  const signed = signAcs3({
    method: 'GET',
    url: buildUrl(req.path, req.query),
    acsHeaders: { 'x-acs-action': req.action, 'x-acs-version': API_VERSION },
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret
  })
  return requestJson<T>(signed.url, { method: 'GET', headers: signed.headers })
}

/* ------------------------------------------------------------------ *
 * 响应结构
 * TokenPlan 系列接口用 PascalCase（Success/Data），账单系列用 camelCase。
 * ------------------------------------------------------------------ */

interface SubscriptionStatsResponse {
  Success: boolean
  Code?: string
  Message?: string
  Data?: {
    SubscriptionStartTime: number
    SubscriptionEndTime: number
    Items?: {
      SeatType: string
      SeatRefreshTime: number
      TotalSeats: number
      AssignedSeats: number
      SeatCredits: number
      SeatRemainingCredits: number
    }[]
  }
}

interface SeatDetailsResponse {
  Success: boolean
  Data?: {
    Total?: number
    Items?: {
      SeatId?: string
      SpecType?: string
      AssignedStatus?: string
      Status?: string
      StartTime?: number
      EndTime?: number
      EquityList?: {
        EquityType?: string
        CycleStartTime?: number
        CycleEndTime?: number
        CycleTotalValue?: number
        CycleSurplusValue?: number
      }[]
    }[]
  }
}

interface AccountResponse {
  Success: boolean
  Data?: {
    AccountId?: string
    Name?: string
    OrgMemberships?: { OrgId?: string; RoleCode?: string; MemberStatus?: string }[]
  }
}

interface MemberSeatResponse {
  Success?: boolean
  OrgId?: string
  TotalMemberCount?: number
  SeatedMemberCount?: number
  UnseatedMemberCount?: number
}

interface Money {
  amount?: string
  pretaxAmount?: string
  totalAmount?: string
  currency?: string
}
interface DimValue extends Money {
  name?: string
  key?: string
}

interface BillingOverviewResponse {
  success: boolean
  data?: Money & { groups?: DimValue[] }
}

interface BillingTrendResponse {
  success: boolean
  data?: {
    resultByTime?: { period?: string; total?: Money; periodDetails?: DimValue[] }[]
  }
}

/* ------------------------------------------------------------------ *
 * 工具函数
 * ------------------------------------------------------------------ */

const num = (v: string | number | undefined): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

const seatLabel = (t?: string): string => (t ? (SEAT_TYPE_LABELS[t] ?? t) : '未分类')

const fmtDate = (ms: number): string => new Date(ms).toLocaleString('zh-CN', { hour12: false })

const fmtMoney = (v: number, currency = 'CNY'): string =>
  `${currency === 'CNY' ? '¥' : ''}${v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** '20261003' -> 当天 00:00 的时间戳 */
const parsePeriod = (p: string): number => {
  const y = Number(p.slice(0, 4))
  const m = Number(p.slice(4, 6)) - 1
  const day = Number(p.slice(6, 8)) || 1
  return new Date(y, m, day).getTime()
}

/** 账单接口要求时间区间不能跨月，按自然月切段 */
function monthSegments(startMs: number, endMs: number): { start: string; end: string }[] {
  const segs: { start: string; end: string }[] = []
  const end = new Date(endMs)
  const cur = new Date(startMs)
  cur.setHours(0, 0, 0, 0)
  while (cur <= end) {
    const monthLast = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
    const segEnd = monthLast < end ? monthLast : end
    segs.push({ start: ymd(cur), end: ymd(segEnd) })
    cur.setMonth(cur.getMonth() + 1, 1)
  }
  return segs
}

const monthsIn = (startMs: number, endMs: number): string[] => {
  const out: string[] = []
  const cur = new Date(startMs)
  const end = new Date(endMs)
  while (cur <= end && out.length < 12) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`)
    cur.setMonth(cur.getMonth() + 1, 1)
  }
  return out
}

const thisMonthKey = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const lastMonthKey = (): string => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ *
 * 数据采集：团队版席位 + 个人版账单，能取到多少算多少
 * ------------------------------------------------------------------ */

interface Snapshot {
  stats?: SubscriptionStatsResponse['Data']
  seats?: SeatDetailsResponse['Data']
  account?: AccountResponse['Data']
  member?: MemberSeatResponse
  curMonth?: BillingOverviewResponse['data']
  prevMonth?: BillingOverviewResponse['data']
  /** 全部接口都失败时才有的错误 */
  failures: string[]
}

async function collect(config: ProviderConfig): Promise<Snapshot> {
  const failures: string[] = []
  const pick = <T>(r: PromiseSettledResult<T>, label: string): T | undefined => {
    if (r.status === 'fulfilled') return r.value
    failures.push(`${label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    return undefined
  }

  const [statsR, seatsR, accountR, memberR, curR, prevR] = await Promise.allSettled([
    callAcs<SubscriptionStatsResponse>(config, { action: 'GetSubscriptionStats', path: '/tokenplan/subscription/stats' }),
    callAcs<SeatDetailsResponse>(config, {
      action: 'GetSubscriptionSeatDetails',
      path: '/tokenplan/subscription/seat-detail',
      query: { NamespaceId: NAMESPACE_ID, PageNo: 1, PageSize: 100, StatusList: ['NORMAL'] }
    }),
    callAcs<AccountResponse>(config, { action: 'GetTokenPlanAccountDetail', path: '/tokenplan/account' }),
    callAcs<MemberSeatResponse>(config, { action: 'GetOrganizationMemberSeatStats', path: '/tokenplan/organization/member-seat-stats' }),
    callAcs<BillingOverviewResponse>(config, {
      action: 'GetBillingOverview',
      path: '/modelstudio/billing/overview',
      query: { billMonth: thisMonthKey(), groupBy: JSON.stringify([{ code: 'BASE_MODEL' }]), topNum: 20, zeroFilter: false, locale: 'zh-CN' }
    }),
    callAcs<BillingOverviewResponse>(config, {
      action: 'GetBillingOverview',
      path: '/modelstudio/billing/overview',
      query: { billMonth: lastMonthKey(), groupBy: JSON.stringify([{ code: 'BASE_MODEL' }]), topNum: 20, zeroFilter: false, locale: 'zh-CN' }
    })
  ])

  const stats = pick(statsR, 'GetSubscriptionStats')?.Data
  const seats = pick(seatsR, 'GetSubscriptionSeatDetails')?.Data
  const account = pick(accountR, 'GetTokenPlanAccountDetail')?.Data
  const member = pick(memberR, 'GetOrganizationMemberSeatStats')
  const curMonth = pick(curR, 'GetBillingOverview(本月)')?.data
  const prevMonth = pick(prevR, 'GetBillingOverview(上月)')?.data

  if (failures.length >= 6) throw new ProviderApiError(failures[0] ?? '所有接口调用失败')

  return { stats, seats, account, member, curMonth, prevMonth, failures }
}

/** 团队版 Credits：优先用聚合接口，缺失时按席位明细汇总 */
function teamCredits(s: Snapshot) {
  const items = s.stats?.Items ?? []
  if (items.length) {
    const totalCredits = items.reduce((a, i) => a + num(i.SeatCredits), 0)
    const remainingCredits = items.reduce((a, i) => a + num(i.SeatRemainingCredits), 0)
    return {
      from: 'stats' as const,
      totalCredits,
      remainingCredits,
      usedCredits: totalCredits - remainingCredits,
      totalSeats: items.reduce((a, i) => a + num(i.TotalSeats), 0),
      assignedSeats: items.reduce((a, i) => a + num(i.AssignedSeats), 0),
      breakdowns: items.map<Breakdown>((i) => ({
        name: seatLabel(i.SeatType),
        used: num(i.SeatCredits) - num(i.SeatRemainingCredits),
        total: num(i.SeatCredits),
        unit: 'Credits'
      }))
    }
  }

  const seats = s.seats?.Items ?? []
  if (!seats.length) return undefined
  const creditSeats = seats.filter((x) => (x.EquityList ?? []).length)
  let totalCredits = 0
  let remainingCredits = 0
  const byType = new Map<string, { used: number; total: number }>()
  for (const seat of creditSeats) {
    for (const e of seat.EquityList ?? []) {
      const total = num(e.CycleTotalValue)
      const surplus = num(e.CycleSurplusValue)
      totalCredits += total
      remainingCredits += surplus
      const key = seatLabel(seat.SpecType)
      const acc = byType.get(key) ?? { used: 0, total: 0 }
      acc.used += total - surplus
      acc.total += total
      byType.set(key, acc)
    }
  }
  return {
    from: 'seats' as const,
    totalCredits,
    remainingCredits,
    usedCredits: totalCredits - remainingCredits,
    totalSeats: seats.length,
    assignedSeats: seats.filter((x) => x.AssignedStatus === 'ASSIGNED' || x.AssignedStatus === 'true').length,
    breakdowns: [...byType.entries()].map<Breakdown>(([name, v]) => ({ name, used: v.used, total: v.total, unit: 'Credits' }))
  }
}

const currencyOf = (s: Snapshot): string => s.curMonth?.currency ?? s.prevMonth?.currency ?? 'CNY'

function throwIfNoData(s: Snapshot): void {
  if (s.stats?.Items?.length || s.seats?.Items?.length || s.member?.OrgId || s.curMonth || s.prevMonth) return
  throw new ProviderApiError(
    '接口调用成功，但该账号名下没有 Token Plan 用量数据。' +
      '个人版（Solo）订阅的 Credits 额度未开放 OpenAPI，' +
      '请在控制台「我的订阅」查看；若为团队版，请确认已订阅席位，并给该 AccessKey 授予 AliyunTokenPlanReadOnlyAccess、AliyunBSSReadOnlyAccess。'
  )
}

/* ------------------------------------------------------------------ *
 * 适配器
 * ------------------------------------------------------------------ */

export const aliyunBailianAdapter: ProviderAdapter = {
  meta: {
    id: 'aliyun-bailian',
    name: '阿里云百炼',
    description: 'Token Plan 团队版席位 Credits + 模型账单消费统计',
    fields: [
      {
        key: 'accessKeyId',
        label: 'AccessKey ID',
        type: 'text',
        placeholder: 'LTAI5t…',
        description: '需具备 AliyunTokenPlanReadOnlyAccess 与 AliyunBSSReadOnlyAccess 权限'
      },
      {
        key: 'accessKeySecret',
        label: 'AccessKey Secret',
        type: 'password',
        placeholder: '••••••••'
      }
    ],
    links: [
      { label: '获取 AccessKey（RAM 控制台）', url: 'https://ram.console.aliyun.com/manage/ak' },
      { label: 'Token Plan 我的订阅（控制台）', url: 'https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan' },
      { label: '订阅席位接口 GetSubscriptionStats', url: 'https://api.aliyun.com/api/ModelStudio/2026-02-10/GetSubscriptionStats' },
      { label: '账单概览接口 GetBillingOverview', url: 'https://api.aliyun.com/api/ModelStudio/2026-02-10/GetBillingOverview' }
    ]
  },

  async fetchSummary(config) {
    const s = await collect(config)
    const team = teamCredits(s)
    if (!team) throwIfNoData(s)

    const currency = currencyOf(s)
    const cur = num(s.curMonth?.totalAmount ?? s.curMonth?.amount)
    const prev = num(s.prevMonth?.totalAmount ?? s.prevMonth?.amount)
    const metrics: Metric[] = []

    if (team) {
      metrics.push(
        {
          label: 'Credits 额度',
          value: team.usedCredits.toLocaleString(),
          sub: `/ ${team.totalCredits.toLocaleString()}`,
          percent: team.totalCredits ? (team.usedCredits / team.totalCredits) * 100 : 0,
          hint: `剩余 ${team.remainingCredits.toLocaleString()} Credits`
        },
        {
          label: '席位分配',
          value: `${team.assignedSeats}`,
          sub: `/ ${team.totalSeats}`,
          percent: team.totalSeats ? (team.assignedSeats / team.totalSeats) * 100 : 0
        }
      )
      if (s.stats) {
        const remainDays = Math.max(0, Math.ceil((s.stats.SubscriptionEndTime - Date.now()) / 86_400_000))
        metrics.push({ label: '订阅剩余', value: `${remainDays} 天`, sub: fmtDate(s.stats.SubscriptionEndTime) })
      }
    }

    metrics.push({
      label: '本月消费',
      value: fmtMoney(cur, currency),
      sub: `上月 ${fmtMoney(prev, currency)}`,
      percent: prev > 0 ? Math.min(100, (cur / prev) * 100) : undefined
    })

    const role = s.account?.OrgMemberships?.[0]?.RoleCode
    if (role) metrics.push({ label: '组织角色', value: ROLE_LABELS[role] ?? role })

    const breakdowns: Breakdown[] = team?.breakdowns ?? []
    const groups = (s.curMonth?.groups ?? []).filter((g) => num(g.amount) > 0)
    if (groups.length) {
      breakdowns.push(
        ...groups.map<Breakdown>((g) => ({
          name: g.name && g.name !== '-' ? g.name : '套餐/未分类',
          used: num(g.amount),
          total: cur || undefined,
          unit: currency
        }))
      )
    }
    if (!breakdowns.length && s.member?.OrgId) {
      breakdowns.push({ name: '已分配席位成员', used: num(s.member.SeatedMemberCount), total: num(s.member.TotalMemberCount), unit: '人' })
    }
    if (!metrics.length) throwIfNoData(s)

    const status = s.account?.OrgMemberships?.[0]?.MemberStatus
    return {
      providerId: 'aliyun-bailian',
      status: status === 'ACTIVE' ? '生效中' : status ?? (team ? '生效中' : undefined),
      period: s.stats ? { startMs: s.stats.SubscriptionStartTime, endMs: s.stats.SubscriptionEndTime } : undefined,
      metrics,
      breakdowns,
      updatedAt: Date.now()
    } satisfies UsageSummary
  },

  async fetchDetail(config, days) {
    const s = await collect(config)
    const team = teamCredits(s)
    if (!team) throwIfNoData(s)

    const charts: DetailChart[] = []
    const currency = currencyOf(s)

    if (team) {
      charts.push(
        {
          id: 'credits-used',
          title: '各席位类型 Credits 使用',
          kind: 'bar',
          unit: 'Credits',
          categories: team.breakdowns.map((b) => ({ name: b.name, value: b.used }))
        },
        {
          id: 'credits-remaining',
          title: '各席位类型剩余 Credits',
          kind: 'pie',
          unit: 'Credits',
          categories:
            team.from === 'seats'
              ? (s.seats?.Items ?? []).map((seat) => ({
                  name: seatLabel(seat.SpecType),
                  value: (seat.EquityList ?? []).reduce((a, e) => a + num(e.CycleSurplusValue), 0)
                }))
              : (s.stats?.Items ?? []).map((i) => ({ name: seatLabel(i.SeatType), value: num(i.SeatRemainingCredits) }))
        }
      )
    }

    // 按天消费趋势（账单接口不能跨月，按月分段后合并）
    const endMs = Date.now()
    const startMs = endMs - (Math.max(1, days) - 1) * 86_400_000
    const segs = monthSegments(startMs, endMs)
    const trends = await Promise.allSettled(
      segs.map((seg) =>
        callAcs<BillingTrendResponse>(config, {
          action: 'GetBillingTrend',
          path: '/modelstudio/billing/trend',
          query: {
            granularity: 'DAY',
            timePeriod: JSON.stringify({ start: seg.start, end: seg.end }),
            groupBy: JSON.stringify([{ code: 'BASE_MODEL' }]),
            topNum: 20,
            zeroFilter: false,
            locale: 'zh-CN'
          }
        })
      )
    )

    const daily: { t: number; v: number }[] = []
    const byModel = new Map<string, number>()
    for (const r of trends) {
      if (r.status !== 'fulfilled') continue
      for (const row of r.value.data?.resultByTime ?? []) {
        if (!row.period) continue
        const t = parsePeriod(row.period)
        daily.push({ t, v: num(row.total?.amount) })
        for (const d of row.periodDetails ?? []) {
          const name = d.name && d.name !== '-' ? d.name : '套餐/未分类'
          byModel.set(name, (byModel.get(name) ?? 0) + num(d.amount))
        }
      }
    }
    daily.sort((a, b) => a.t - b.t)

    if (daily.length) {
      charts.push({ id: 'billing-daily', title: '按天消费趋势', kind: 'area', unit: currency, series: [{ name: '消费', points: daily }] })
    }
    if (byModel.size) {
      charts.push({
        id: 'billing-model',
        title: '模型/计费项消费占比',
        kind: 'pie',
        unit: currency,
        categories: [...byModel.entries()].map(([name, value]) => ({ name, value }))
      })
    }

    const monthKeys = monthsIn(startMs, endMs)
    const overviews = await Promise.allSettled(
      monthKeys.map((billMonth) =>
        callAcs<BillingOverviewResponse>(config, {
          action: 'GetBillingOverview',
          path: '/modelstudio/billing/overview',
          query: { billMonth, groupBy: JSON.stringify([{ code: 'BASE_MODEL' }]), topNum: 20, zeroFilter: false, locale: 'zh-CN' }
        })
      )
    )
    const monthly = monthKeys
      .map((m, i) => {
        const r = overviews[i]
        const amount = r.status === 'fulfilled' ? num(r.value.data?.totalAmount ?? r.value.data?.amount) : 0
        return { name: m, value: amount }
      })
      .filter((x) => x.value > 0)
    if (monthly.length) charts.push({ id: 'billing-monthly', title: '月度消费对比', kind: 'bar', unit: currency, categories: monthly })

    if (!charts.length) throwIfNoData(s)

    const notes: string[] = []
    if (s.stats) notes.push(`订阅周期：${fmtDate(s.stats.SubscriptionStartTime)} → ${fmtDate(s.stats.SubscriptionEndTime)}；Credits 按席位周期刷新。`)
    else if (team) notes.push('Credits 按席位周期统计（来自席位明细接口）。')
    if (!team) notes.push('个人版 Credits 未开放 OpenAPI，以下金额为账单接口返回的实际消费。')

    return { ranges: [7, 30, 90], note: notes.join(' '), charts } satisfies UsageDetail
  }
}
