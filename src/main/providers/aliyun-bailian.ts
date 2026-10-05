import { execFile, spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { Breakdown, DetailChart, Metric, UsageDetail, UsageSummary } from '../../shared/types'
import { ProviderApiError, type ProviderAdapter, type ProviderConfig } from './types'

const execFileAsync = promisify(execFile)

/* ------------------------------------------------------------------ *
 * 百炼 Agent 套餐用量（Token Plan 个人版 / Coding Plan）
 *
 * 实测网关（bl 同款通道）返回的真实字段为月度窗口 per1MonthPercentage 等，
 * 而 bailian-cli 2.1.0 的 `usage token-plan` 输出映射只挑 per5Hour/per1Week
 * 四个键，会把 per1Month 数据丢弃成 {}。因此本供应商不走 CLI 查询，
 * 直接读取 CLI 登录态（~/.bailian/config.json）的 console access token，
 * 复刻 bl 的控制台网关调用获取原始用量数据；登录授权仍复用内置 bl CLI。
 * 接口与真实返回结构详见 docs/bailian.md。
 * ------------------------------------------------------------------ */

interface TokenPlanUsage {
  /** 5 小时窗口使用比例，0–1 小数 */
  per5HourPercentage?: number
  /** 5 小时窗口重置时间，毫秒时间戳 */
  per5HourResetTime?: number
  /** 1 周窗口使用比例，0–1 小数 */
  per1WeekPercentage?: number
  /** 1 周窗口重置时间，毫秒时间戳 */
  per1WeekResetTime?: number
  /** 1 月窗口使用比例，0–1 小数（当前个人版套餐实际返回的窗口） */
  per1MonthPercentage?: number
  /** 1 月窗口重置时间，毫秒时间戳 */
  per1MonthResetTime?: number
}

/** Coding Plan 单个额度窗口（原始字段 {前缀}UsedQuota/TotalQuota/QuotaNextRefreshTime 映射而来） */
interface PlanWindow {
  /** 本窗口已用额度（次数） */
  usedQuota?: number
  /** 本窗口总额度（次数） */
  totalQuota?: number
  /** 窗口重置时间，毫秒时间戳 */
  resetTime?: number
  /** usedQuota/totalQuota，仅当两者存在且 totalQuota>0 时可计算 */
  percentage?: number
}

interface CodingPlanUsage {
  per5Hour?: PlanWindow
  perWeek?: PlanWindow
  perBillMonth?: PlanWindow
  /** 实例规格（如 pro / max） */
  instanceType?: string
}

/* ------------------------------------------------------------------ *
 * Console 凭证：bl 登录后写入 ~/.bailian/config.json 的 access_token
 * ------------------------------------------------------------------ */

interface ConsoleSession {
  token: string
  region: string
  site: string
  switchAgent?: number
}

function loadConsoleSession(): ConsoleSession | null {
  const envHome = process.env.BAILIAN_CONFIG_DIR || path.join(os.homedir(), '.bailian')
  const file = path.join(envHome, 'config.json')
  if (!existsSync(file)) return null
  let cfg: Record<string, unknown>
  try {
    cfg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
  const token = typeof cfg.access_token === 'string' ? cfg.access_token.trim() : ''
  if (!token) return null
  return {
    token,
    region: typeof cfg.console_region === 'string' && cfg.console_region ? cfg.console_region : 'cn-beijing',
    site: cfg.console_site === 'international' ? 'international' : 'domestic',
    switchAgent: typeof cfg.console_switch_agent === 'number' ? cfg.console_switch_agent : undefined
  }
}

/* ------------------------------------------------------------------ *
 * 控制台网关调用（复刻 bl 的 BroadScopeAspnGateway 通道）
 * ------------------------------------------------------------------ */

const GATEWAYS: Record<string, Record<string, { host: string; action: string }>> = {
  'cn-beijing': {
    domestic: { host: 'bailian-cs.console.aliyun.com', action: 'BroadScopeAspnGateway' },
    international: { host: 'bailian-cs.console.alibabacloud.com', action: 'BroadScopeAspnGateway' }
  },
  'ap-southeast-1': {
    domestic: { host: 'modelstudio-cs.console.aliyun.com', action: 'IntlBroadScopeAspnGateway' },
    international: { host: 'bailian-singapore-cs.console.alibabacloud.com', action: 'IntlBroadScopeAspnGateway' }
  }
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/** 与 bl 的 unwrapResponse 一致：剥离网关信封 data → DataV2.data(.data) */
function unwrap(raw: Record<string, unknown>): Record<string, unknown> {
  const d = raw.data as Record<string, unknown> | undefined
  if (!d) return raw
  const v2 = d.DataV2 as Record<string, unknown> | undefined
  if (v2) {
    const inner = v2.data as Record<string, unknown> | undefined
    if (inner && typeof inner.data === 'object' && inner.data !== null) {
      return inner.data as Record<string, unknown>
    }
    return inner ?? v2
  }
  return typeof d.data === 'object' && d.data !== null ? (d.data as Record<string, unknown>) : d
}

async function consoleCall(
  session: ConsoleSession,
  api: string,
  data: Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const payload = {
    Api: api,
    V: '1.0',
    Data: {
      ...data,
      cornerstoneParam: {
        protocol: 'V2',
        console: 'ONE_CONSOLE',
        productCode: 'p_efm',
        switchUserType: 3,
        consoleSite: 'BAILIAN_ALIYUN',
        ...(session.switchAgent == null ? {} : { switchAgent: session.switchAgent })
      }
    }
  }
  const gw = GATEWAYS[session.region]?.[session.site] ?? GATEWAYS['cn-beijing'].domestic
  const url = `https://${gw.host}/cli/api.json?action=${gw.action}&product=sfm_bailian&api=${encodeURIComponent(api)}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${session.token}`
      },
      body: new URLSearchParams({ params: JSON.stringify(payload), region: session.region }).toString(),
      signal: AbortSignal.timeout(30_000)
    })
  } catch (e) {
    throw new ProviderApiError(`百炼网关请求失败: ${(e as Error).message}`)
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new ProviderApiError(`百炼网关 HTTP ${res.status}: ${text.slice(0, 200)}`)
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new ProviderApiError(`百炼网关响应解析失败: ${text.slice(0, 200) || '（无输出）'}`)
  }
  const inner = (raw.data ?? {}) as Record<string, unknown>
  const errorCode = String(inner.errorCode ?? '')
  if (inner.success === false || (errorCode && errorCode !== 'SUCCESS')) {
    if (errorCode.includes('NotLogined')) {
      throw new ProviderApiError('百炼登录态已过期，请点击下方「登录百炼」重新授权')
    }
    throw new ProviderApiError(`百炼网关错误: ${errorCode || String(inner.errorMsg ?? '未知错误')}`)
  }
  return unwrap(raw)
}

/* ------------------------------------------------------------------ *
 * 真实返回字段 → 供应商数据模型
 * ------------------------------------------------------------------ */

/** tokenplan/personal/api/v2/usage：只保留有限数字字段（与 bl 的过滤规则一致） */
function toTokenPlan(usage: Record<string, unknown>): TokenPlanUsage | null {
  const out: TokenPlanUsage = {}
  for (const key of [
    'per5HourPercentage',
    'per5HourResetTime',
    'per1WeekPercentage',
    'per1WeekResetTime',
    'per1MonthPercentage',
    'per1MonthResetTime'
  ] as const) {
    const v = num(usage[key])
    if (v !== undefined) out[key] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

function toWindow(raw: Record<string, unknown> | undefined, prefix: string): PlanWindow | undefined {
  if (!raw) return undefined
  const used = num(raw[`${prefix}UsedQuota`])
  const total = num(raw[`${prefix}TotalQuota`])
  const reset = num(raw[`${prefix}QuotaNextRefreshTime`])
  const w: PlanWindow = {}
  if (used !== undefined) w.usedQuota = used
  if (total !== undefined) w.totalQuota = total
  if (reset !== undefined) w.resetTime = reset
  if (used !== undefined && total !== undefined && total > 0) w.percentage = used / total
  return Object.keys(w).length > 0 ? w : undefined
}

/** queryCodingPlanInstanceInfoV2：取首个 VALID 实例的额度信息 */
function toCodingPlan(resp: Record<string, unknown>): CodingPlanUsage | null {
  const list = Array.isArray(resp.codingPlanInstanceInfos)
    ? (resp.codingPlanInstanceInfos as Record<string, unknown>[])
    : []
  const inst = list.find((e) => e.status === 'VALID')
  if (!inst) return null
  const quota = (inst.codingPlanQuotaInfo ?? {}) as Record<string, unknown>
  const out: CodingPlanUsage = {}
  const w5 = toWindow(quota, 'per5Hour')
  const ww = toWindow(quota, 'perWeek')
  const wm = toWindow(quota, 'perBillMonth')
  if (w5) out.per5Hour = w5
  if (ww) out.perWeek = ww
  if (wm) out.perBillMonth = wm
  if (typeof inst.instanceType === 'string' && inst.instanceType) out.instanceType = inst.instanceType
  return Object.keys(out).length > 0 ? out : null
}

const TOKEN_PLAN_API = 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage'
const CODING_PLAN_API = 'zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2'
const CODING_PLAN_COMMODITY: Record<string, string> = {
  domestic: 'sfm_codingplan_public_cn',
  international: 'sfm_codingplan_public_intl'
}

/* ------------------------------------------------------------------ *
 * bl 执行器定位：登录授权需要拉起内置 CLI（用 Electron 自带的 Node
 * 运行时直接跑它的 ESM 入口，用户无需安装 Node 或 CLI），
 * 找不到内置脚本时再回退系统安装的 bl（GUI 启动时 PATH 通常不含
 * npm 全局目录，需要常见路径 + 登录 shell 兜底）。
 * ------------------------------------------------------------------ */

interface BlLauncher {
  cmd: string
  /** 传给 cmd 的前置参数（内置模式下为脚本路径） */
  prefix: string[]
  env: NodeJS.ProcessEnv
}

const BL_CANDIDATES = ['bl', 'bailian', '/usr/local/bin/bl', '/opt/homebrew/bin/bl']

let launcherCache: BlLauncher | null = null

function blEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, NO_COLOR: '1', ...extra }
}

/** 内置 bailian-cli 入口脚本的候选路径（按可靠性排序） */
function bundledScriptCandidates(): string[] {
  const rel = path.join('node_modules', 'bailian-cli', 'dist', 'bailian.mjs')
  const list: string[] = []
  const res = process.resourcesPath
  if (res) {
    // asarUnpack 后的解包目录（ESM 无法从 asar 内加载，必须走 unpacked）
    list.push(path.join(res, 'app.asar.unpacked', rel))
    // 关闭 asar 打包时的常规目录
    list.push(path.join(res, 'app', rel))
  }
  try {
    // 开发模式：appPath 即项目根目录
    list.push(path.join(app.getAppPath(), rel))
  } catch {
    /* app 未 ready 时 getAppPath 也可用，这里只是防御 */
  }
  return list
}

async function canRun(launcher: BlLauncher): Promise<boolean> {
  try {
    await execFileAsync(launcher.cmd, [...launcher.prefix, '--version'], {
      timeout: 10_000,
      env: launcher.env
    })
    return true
  } catch {
    return false
  }
}

async function resolveLauncher(): Promise<BlLauncher> {
  if (launcherCache) return launcherCache
  // 1) 内置 CLI：用 Electron 自带的 Node 运行时执行打包进来的 mjs
  const script = bundledScriptCandidates().find((p) => existsSync(p))
  if (script) {
    const launcher: BlLauncher = {
      cmd: process.execPath,
      prefix: [script],
      env: blEnv({ ELECTRON_RUN_AS_NODE: '1' })
    }
    if (await canRun(launcher)) {
      launcherCache = launcher
      return launcher
    }
  }
  // 2) 系统安装的 bl
  for (const c of BL_CANDIDATES) {
    const launcher: BlLauncher = { cmd: c, prefix: [], env: blEnv() }
    if (await canRun(launcher)) {
      launcherCache = launcher
      return launcher
    }
  }
  // 3) 回退：借登录 shell 解析用户 PATH（nvm 等版本管理器在此生效）
  try {
    const { stdout } = await execFileAsync(
      '/bin/zsh',
      ['-lc', 'command -v bl || command -v bailian'],
      { timeout: 10_000 }
    )
    const p = stdout.trim().split('\n').pop() ?? ''
    if (p) {
      const launcher: BlLauncher = { cmd: p, prefix: [], env: blEnv() }
      if (await canRun(launcher)) {
        launcherCache = launcher
        return launcher
      }
    }
  } catch {
    /* 忽略，走统一报错 */
  }
  throw new ProviderApiError(
    '百炼 CLI 不可用：安装包中未找到内置 CLI，系统也未安装。请重新安装应用，或在终端执行: npm install -g bailian-cli'
  )
}

/**
 * 拉起控制台 OAuth 登录（浏览器授权，本地端口回调）。
 * bl 为非交互命令：打开浏览器后等待回调，exit 0 即登录成功。
 */
async function loginConsole(): Promise<string> {
  const launcher = await resolveLauncher()
  return new Promise<string>((resolve, reject) => {
    const child = spawn(launcher.cmd, [...launcher.prefix, 'auth', 'login', '--console'], {
      env: launcher.env
    })
    let output = ''
    child.stdout?.on('data', (d) => (output += String(d)))
    child.stderr?.on('data', (d) => (output += String(d)))
    const timer = setTimeout(() => {
      child.kill()
      reject(new ProviderApiError('百炼登录超时（5 分钟），请在浏览器完成授权后重试'))
    }, 300_000)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new ProviderApiError(`无法启动百炼登录: ${e.message}`))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve('登录成功')
      } else {
        const detail = output.trim()
        reject(
          new ProviderApiError(
            `百炼登录失败（退出码 ${code}）${detail ? `: ${detail.slice(0, 200)}` : ''}`
          )
        )
      }
    })
  })
}

/* ------------------------------------------------------------------ *
 * 采集两类套餐用量；某个套餐不存在时静默跳过，全部为空才报错
 * ------------------------------------------------------------------ */

interface PlanUsage {
  token: TokenPlanUsage | null
  coding: CodingPlanUsage | null
}

async function collect(_config: ProviderConfig): Promise<PlanUsage> {
  const session = loadConsoleSession()
  if (!session) {
    throw new ProviderApiError('百炼未登录控制台，请点击下方「登录百炼」完成授权')
  }
  const [tp, cp] = await Promise.allSettled([
    consoleCall(session, TOKEN_PLAN_API, {}).then(toTokenPlan),
    consoleCall(session, CODING_PLAN_API, {
      queryCodingPlanInstanceInfoRequest: {
        commodityCode: CODING_PLAN_COMMODITY[session.site],
        onlyLatestOne: true
      }
    }).then(toCodingPlan)
  ])
  const fail = (r: PromiseRejectedResult): never => {
    throw r.reason instanceof ProviderApiError
      ? r.reason
      : new ProviderApiError(`百炼用量查询失败: ${(r.reason as Error).message}`)
  }
  const tpErr = tp.status === 'rejected' ? tp : null
  const cpErr = cp.status === 'rejected' ? cp : null
  if (tpErr && cpErr) fail(tpErr)
  const token = tp.status === 'fulfilled' ? tp.value : null
  const coding = cp.status === 'fulfilled' ? cp.value : null
  if (!token && !coding) {
    // 只剩一个接口成功时，透出另一个的真实错误
    if (tpErr) fail(tpErr)
    if (cpErr) fail(cpErr)
    throw new ProviderApiError('登录成功，但当前账号未查询到 Token Plan / Coding Plan 套餐')
  }
  return { token, coding }
}

/* ------------------------------------------------------------------ *
 * 展示辅助
 * ------------------------------------------------------------------ */

const pct = (fraction: number | undefined): number | undefined =>
  fraction === undefined ? undefined : Math.round(fraction * 1000) / 10

const hasQuota = (u: TokenPlanUsage | null): boolean =>
  Boolean(
    u &&
      (u.per5HourPercentage !== undefined ||
        u.per1WeekPercentage !== undefined ||
        u.per1MonthPercentage !== undefined)
  )

function fmtReset(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined
  return `重置于 ${new Date(ms).toLocaleString('zh-CN', { hour12: false })}`
}

const V = (n: number): string => n.toLocaleString('zh-CN')

function windowMetric(label: string, w: PlanWindow): Metric {
  const used = w.usedQuota
  const total = w.totalQuota
  const m: Metric = {
    label,
    value:
      used !== undefined && total !== undefined
        ? `${V(used)} / ${V(total)}`
        : pct(w.percentage) !== undefined
          ? `${pct(w.percentage)}%`
          : '—',
    percent: pct(w.percentage),
    sub: fmtReset(w.resetTime)
  }
  return m
}

function planLabels(u: PlanUsage): string {
  const parts: string[] = []
  if (hasQuota(u.token)) parts.push('Token Plan')
  if (u.coding) parts.push(`Coding Plan${u.coding.instanceType ? ` (${u.coding.instanceType})` : ''}`)
  return parts.join(' · ')
}

/* ------------------------------------------------------------------ *
 * Provider 适配器
 * ------------------------------------------------------------------ */

export const aliyunBailianAdapter: ProviderAdapter = {
  meta: {
    id: 'aliyun-bailian',
    name: '阿里云百炼',
    description:
      '查询百炼 Agent 套餐（Token Plan 个人版 / Coding Plan）的实时额度用量。已内置官方百炼 CLI，无需单独安装；首次使用点击「登录百炼」完成控制台授权即可。',
    fields: [],
    links: [
      { label: '百炼 CLI 安装文档', url: 'https://bailian.aliyun.com/cli/install.md' },
      { label: '百炼控制台', url: 'https://bailian.console.aliyun.com/' }
    ]
  },

  login: loginConsole,

  /** 百炼凭证由 CLI 管理（~/.bailian/config.json 的 access_token），以登录态判断可用性 */
  async isAvailable() {
    return loadConsoleSession() !== null
  },

  async fetchSummary(config: ProviderConfig): Promise<UsageSummary> {
    const usage = await collect(config)
    const metrics: Metric[] = []
    const breakdowns: Breakdown[] = []

    if (hasQuota(usage.token)) {
      const t = usage.token as TokenPlanUsage
      const windows: [string, number | undefined, number | undefined][] = [
        ['5 小时', t.per5HourPercentage, t.per5HourResetTime],
        ['1 周', t.per1WeekPercentage, t.per1WeekResetTime],
        ['1 个月', t.per1MonthPercentage, t.per1MonthResetTime]
      ]
      for (const [name, p, reset] of windows) {
        if (p === undefined) continue
        metrics.push({
          label: `Token Plan · ${name}用量`,
          value: `${pct(p)}%`,
          percent: pct(p),
          sub: fmtReset(reset)
        })
        breakdowns.push({ name: `Token Plan ${name}窗口`, used: pct(p) as number, total: 100, unit: '%' })
      }
    }

    if (usage.coding) {
      const c = usage.coding
      const windows: [string, PlanWindow | undefined][] = [
        ['Coding Plan · 5 小时', c.per5Hour],
        ['Coding Plan · 每周', c.perWeek],
        ['Coding Plan · 本账期', c.perBillMonth]
      ]
      for (const [label, w] of windows) {
        if (!w) continue
        metrics.push(windowMetric(label, w))
        if (w.usedQuota !== undefined && w.totalQuota !== undefined) {
          breakdowns.push({ name: label, used: w.usedQuota, total: w.totalQuota, unit: '次' })
        }
      }
    }

    return {
      providerId: 'aliyun-bailian',
      status: planLabels(usage),
      metrics,
      breakdowns,
      updatedAt: Date.now()
    }
  },

  async fetchDetail(config: ProviderConfig, _days: number): Promise<UsageDetail> {
    const usage = await collect(config)
    const charts: DetailChart[] = []

    const rateCats: { name: string; value: number }[] = []
    if (hasQuota(usage.token)) {
      const t = usage.token as TokenPlanUsage
      const entries: [string, number | undefined][] = [
        ['TP 5小时', t.per5HourPercentage],
        ['TP 每周', t.per1WeekPercentage],
        ['TP 每月', t.per1MonthPercentage]
      ]
      for (const [name, p] of entries) {
        if (p !== undefined) rateCats.push({ name, value: pct(p) as number })
      }
    }
    if (usage.coding) {
      const c = usage.coding
      const entries: [string, PlanWindow | undefined][] = [
        ['CP 5小时', c.per5Hour],
        ['CP 每周', c.perWeek],
        ['CP 账期', c.perBillMonth]
      ]
      for (const [name, w] of entries) {
        if (w && pct(w.percentage) !== undefined) rateCats.push({ name, value: pct(w.percentage) as number })
      }
    }
    if (rateCats.length > 0) {
      charts.push({ id: 'plan-window-usage-rate', title: '套餐额度使用率（当前周期）', kind: 'bar', unit: '%', categories: rateCats })
    }

    if (usage.coding) {
      const quotaCats: { name: string; value: number }[] = []
      const entries: [string, PlanWindow | undefined][] = [
        ['5 小时', usage.coding.per5Hour],
        ['每周', usage.coding.perWeek],
        ['本账期', usage.coding.perBillMonth]
      ]
      for (const [name, w] of entries) {
        if (w?.usedQuota !== undefined) quotaCats.push({ name, value: w.usedQuota as number })
      }
      if (quotaCats.length > 0) {
        charts.push({ id: 'coding-plan-used-quota', title: 'Coding Plan 已用额度', kind: 'bar', unit: '次', categories: quotaCats })
      }
    }

    return {
      charts,
      note: '百炼套餐额度为当前周期实时快照，按窗口自动重置，暂无历史趋势数据。'
    }
  }
}
