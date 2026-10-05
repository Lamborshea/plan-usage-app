import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { Breakdown, DetailChart, Metric, UsageDetail, UsageSummary } from '../../shared/types'
import { ProviderApiError, type ProviderAdapter, type ProviderConfig } from './types'

const execFileAsync = promisify(execFile)

/* ------------------------------------------------------------------ *
 * 百炼 Agent 套餐用量：通过官方 CLI（bl）的 Console 鉴权通道查询
 *   - bl usage token-plan  → Token Plan 个人版（并发 Agent 套餐）5 小时 / 1 周额度
 *   - bl usage coding-plan → Coding Plan 5 小时 / 周 / 账期额度
 * 两者均为实时快照，返回 0-1 的小数百分比与重置时间戳（毫秒）。
 * ------------------------------------------------------------------ */

/**
 * `bl usage token-plan --output json` 输出。
 * 网关 API：zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage（请求体 {}）。
 * CLI 仅保留有限数字类型的这 4 个字段；未订阅个人版时输出 {}。
 * 详见 docs/bailian.md《usage token-plan》。
 */
interface TokenPlanUsage {
  /** 5 小时窗口额度使用比例，0–1 小数（如 0.32 = 32%） */
  per5HourPercentage?: number
  /** 5 小时窗口重置时间，毫秒时间戳 */
  per5HourResetTime?: number
  /** 1 周窗口额度使用比例，0–1 小数 */
  per1WeekPercentage?: number
  /** 1 周窗口重置时间，毫秒时间戳 */
  per1WeekResetTime?: number
}

/**
 * Coding Plan 单个额度窗口。
 * 由原始字段 {前缀}UsedQuota / TotalQuota / QuotaNextRefreshTime 映射而来，
 * 原始字段缺失则对应键省略。
 */
interface PlanWindow {
  /** 本窗口已用额度（次数） */
  usedQuota?: number
  /** 本窗口总额度（次数） */
  totalQuota?: number
  /** 窗口重置时间，毫秒时间戳（原始 *QuotaNextRefreshTime） */
  resetTime?: number
  /** CLI 计算的 usedQuota/totalQuota，仅当两者存在且 totalQuota>0 时输出 */
  percentage?: number
}

/**
 * `bl usage coding-plan --output json` 输出。
 * 网关 API：zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2，
 * 取 codingPlanInstanceInfos 中首个 status==='VALID' 实例的 codingPlanQuotaInfo；
 * 无有效订阅时输出 {}。详见 docs/bailian.md《usage coding-plan》。
 */
interface CodingPlanUsage {
  per5Hour?: PlanWindow
  perWeek?: PlanWindow
  perBillMonth?: PlanWindow
  /** 实例规格（如 pro / max），仅当 CLI 返回非空字符串时存在 */
  instanceType?: string
}

/**
 * bl 失败时的错误对象。code 枚举（bailian-cli-core）：0 SUCCESS / 1 GENERAL /
 * 2 USAGE / 3 AUTH（未登录或 Console 会话过期）/ 4 QUOTA / 5 TIMEOUT / 6 NETWORK。
 */
interface BlCliError {
  code?: number
  message?: string
  hint?: string
}

/* ------------------------------------------------------------------ *
 * bl 执行器定位：优先使用随 app 分发的内置 bailian-cli（用 Electron
 * 自带的 Node 运行时直接跑它的 ESM 入口，用户无需安装 Node 或 CLI），
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

/** 执行 bl 子命令并解析 JSON 输出 */
async function runBl(args: string[]): Promise<Record<string, unknown>> {
  const launcher = await resolveLauncher()
  let stdout = ''
  let stderr = ''
  try {
    const r = await execFileAsync(launcher.cmd, [...launcher.prefix, ...args], {
      timeout: 60_000,
      env: launcher.env
    })
    stdout = r.stdout
    stderr = r.stderr
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    stdout = err.stdout ?? ''
    stderr = err.stderr ?? ''
  }
  const text = (stdout || stderr).trim()
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new ProviderApiError(`百炼 CLI 输出解析失败: ${text || '（无输出）'}`)
  }
  const cliErr = json.error as BlCliError | undefined
  if (cliErr) {
    if (cliErr.code === 3 || /console access token|not authenticated/i.test(cliErr.message ?? '')) {
      throw new ProviderApiError('百炼未登录控制台，请点击下方「登录百炼」完成授权')
    }
    const hint = cliErr.hint ? `（${cliErr.hint}）` : ''
    throw new ProviderApiError(`百炼 CLI: ${cliErr.message ?? '未知错误'}${hint}`)
  }
  return json
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

const isBlank = (o: Record<string, unknown>): boolean => Object.keys(o).length === 0

function hasWindow(c: CodingPlanUsage): boolean {
  return Boolean(c.per5Hour || c.perWeek || c.perBillMonth)
}

async function collect(_config: ProviderConfig): Promise<PlanUsage> {
  const [tp, cp] = await Promise.allSettled([
    runBl(['usage', 'token-plan', '--output', 'json']),
    runBl(['usage', 'coding-plan', '--output', 'json'])
  ])
  // 鉴权/环境问题两边一致，任一失败即透出，避免静默吞掉真实错误
  const fatal = (r: PromiseRejectedResult): never => {
    throw r.reason instanceof ProviderApiError
      ? r.reason
      : new ProviderApiError(`百炼用量查询失败: ${(r.reason as Error).message}`)
  }
  let token: TokenPlanUsage | null = null
  let coding: CodingPlanUsage | null = null
  const tpErr = tp.status === 'rejected' ? tp : null
  const cpErr = cp.status === 'rejected' ? cp : null
  if (tpErr && cpErr) fatal(tpErr)
  if (tp.status === 'fulfilled' && !isBlank(tp.value)) token = tp.value as TokenPlanUsage
  if (cp.status === 'fulfilled' && !isBlank(cp.value) && hasWindow(cp.value as CodingPlanUsage)) {
    coding = cp.value as CodingPlanUsage
  }
  if (!token && !coding) {
    // 只剩一个接口成功时，透出另一个的真实错误
    if (tpErr) fatal(tpErr)
    if (cpErr) fatal(cpErr)
    throw new ProviderApiError('当前账号未查询到 Token Plan / Coding Plan 套餐用量')
  }
  return { token, coding }
}

/* ------------------------------------------------------------------ *
 * 展示辅助
 * ------------------------------------------------------------------ */

const pct = (fraction: number | undefined): number | undefined =>
  fraction === undefined ? undefined : Math.round(fraction * 1000) / 10

const hasQuota = (u: TokenPlanUsage | null): boolean =>
  Boolean(u && (u.per5HourPercentage !== undefined || u.per1WeekPercentage !== undefined))

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

  /** 百炼凭证由 CLI 管理（~/.bailian），以控制台登录态判断可用性 */
  async isAvailable() {
    try {
      const status = await runBl(['auth', 'status', '--output', 'json'])
      const consoleAuth = status.console as { source?: string } | undefined
      return Boolean(consoleAuth?.source)
    } catch {
      return false
    }
  },

  async fetchSummary(config: ProviderConfig): Promise<UsageSummary> {
    const usage = await collect(config)
    const metrics: Metric[] = []
    const breakdowns: Breakdown[] = []

    if (hasQuota(usage.token)) {
      const t = usage.token as TokenPlanUsage
      metrics.push(
        {
          label: 'Token Plan · 5 小时用量',
          value: pct(t.per5HourPercentage) !== undefined ? `${pct(t.per5HourPercentage)}%` : '—',
          percent: pct(t.per5HourPercentage),
          sub: fmtReset(t.per5HourResetTime)
        },
        {
          label: 'Token Plan · 1 周用量',
          value: pct(t.per1WeekPercentage) !== undefined ? `${pct(t.per1WeekPercentage)}%` : '—',
          percent: pct(t.per1WeekPercentage),
          sub: fmtReset(t.per1WeekResetTime)
        }
      )
      if (t.per5HourPercentage !== undefined) {
        breakdowns.push({ name: 'Token Plan 5 小时窗口', used: pct(t.per5HourPercentage) as number, total: 100, unit: '%' })
      }
      if (t.per1WeekPercentage !== undefined) {
        breakdowns.push({ name: 'Token Plan 1 周窗口', used: pct(t.per1WeekPercentage) as number, total: 100, unit: '%' })
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
      if (t.per5HourPercentage !== undefined) rateCats.push({ name: 'TP 5小时', value: pct(t.per5HourPercentage) as number })
      if (t.per1WeekPercentage !== undefined) rateCats.push({ name: 'TP 每周', value: pct(t.per1WeekPercentage) as number })
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
      note: '百炼 CLI 提供当前套餐周期的实时额度快照，额度按窗口自动重置，暂无历史趋势数据。'
    }
  }
}
