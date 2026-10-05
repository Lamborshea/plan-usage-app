import { useCallback, useEffect, useState } from 'react'
import type { ProviderState, UsageSummary } from '../../../shared/types'
import { api } from '../api'
import { IconExpand, IconRefresh } from '../components/Icons'

interface SummarySlot {
  loading: boolean
  summary?: UsageSummary
  error?: string
}

interface Props {
  onOpenDetail: (providerId: string, providerName: string) => void
  onOpenSettings: () => void
}

export function SummaryView({ onOpenDetail, onOpenSettings }: Props): JSX.Element {
  const [providers, setProviders] = useState<ProviderState[]>([])
  const [slots, setSlots] = useState<Record<string, SummarySlot>>({})
  const [loggingIn, setLoggingIn] = useState<Record<string, boolean>>({})

  const refresh = useCallback(async (id: string, force = false) => {
    // 已有数据时不整屏切加载态（仅按钮转圈）；主进程缓存优先，响应几乎即时
    setSlots((s) => {
      const prev = s[id]
      return { ...s, [id]: { ...prev, loading: !prev?.summary || force, error: undefined } }
    })
    const res = await api.fetchSummary(id, force)
    setSlots((s) => ({
      ...s,
      [id]: { loading: false, summary: res.ok ? res.data : s[id]?.summary, error: res.ok ? undefined : res.error }
    }))
  }, [])

  const login = useCallback(
    async (id: string) => {
      setLoggingIn((s) => ({ ...s, [id]: true }))
      const res = await api.loginProvider(id)
      setLoggingIn((s) => ({ ...s, [id]: false }))
      if (res.ok) void refresh(id)
      else
        setSlots((s) => ({
          ...s,
          [id]: { ...s[id], loading: false, summary: s[id]?.summary, error: res.error }
        }))
    },
    [refresh]
  )

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const list = await api.listProviders()
      if (!alive) return
      // 仅展示已成功配置密钥的供应商
      const configured = list.filter((p) => p.configured)
      setProviders(configured)
      for (const p of configured) void refresh(p.meta.id)
    }
    void load()
    // 主进程缓存后台刷新成功/配置变化后广播 data:changed，静默回填最新快照
    api.onDataChanged(() => void load())
    return () => {
      alive = false
    }
  }, [refresh])

  return (
    <div className="view">
      {providers.length === 0 && (
        <section className="card">
          <div className="card-body muted-row">
            尚未配置任何供应商
            <button className="link-btn" onClick={onOpenSettings}>
              去配置
            </button>
          </div>
        </section>
      )}
      {providers.map((p) => {
        const slot = slots[p.meta.id]
        return (
          <section className="card" key={p.meta.id}>
            <header className="card-head">
              <span className="card-title">{p.meta.name}</span>
              <span className="spacer" />
              <button
                className="icon-btn"
                title="刷新"
                onClick={(e) => {
                  e.stopPropagation()
                  void refresh(p.meta.id, true)
                }}
              >
                <span className={slot?.loading ? 'spin' : ''}>
                  <IconRefresh />
                </span>
              </button>
              <button className="icon-btn" title="在新窗口查看用量详情" onClick={() => onOpenDetail(p.meta.id, p.meta.name)}>
                <IconExpand />
              </button>
            </header>

            {slot?.loading && !slot.summary && <div className="card-body muted-row">加载中…</div>}
            {slot?.error && !slot.summary && (
              <div className="card-body error-row">
                <div>{slot.error}</div>
                {p.canLogin && (
                  <button
                    className="link-btn"
                    disabled={loggingIn[p.meta.id]}
                    onClick={() => void login(p.meta.id)}
                  >
                    {loggingIn[p.meta.id] ? '等待浏览器授权…' : `登录${p.meta.name}`}
                  </button>
                )}
              </div>
            )}

            {slot?.summary && (
              <div className="card-body">
                {slot.summary.metrics.map((m) => (
                  <div className="metric" key={m.label}>
                    <div className="metric-line">
                      <span className="metric-label">{m.label}</span>
                      <span className="metric-value">
                        {m.value}
                        {m.sub && <span className="metric-sub"> {m.sub}</span>}
                      </span>
                    </div>
                    {m.percent !== undefined && (
                      <div className="bar">
                        <div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, m.percent))}%` }} />
                      </div>
                    )}
                    {m.hint && <div className="metric-hint">{m.hint}</div>}
                  </div>
                ))}

                {slot.summary.breakdowns.length > 0 && (
                  <div className="breakdowns">
                    {slot.summary.breakdowns.map((b) => (
                      <div className="breakdown" key={b.name}>
                        <div className="metric-line">
                          <span className="metric-label">{b.name}</span>
                          <span className="metric-value small">
                            {b.used.toLocaleString()}
                            {b.total !== undefined && <span className="metric-sub"> / {b.total.toLocaleString()}</span>}
                            <span className="metric-sub"> {b.unit}</span>
                          </span>
                        </div>
                        {b.total !== undefined && b.total > 0 && (
                          <div className="bar thin">
                            <div className="bar-fill" style={{ width: `${Math.min(100, (b.used / b.total) * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="card-foot">
                  {slot.summary.status && <span>{slot.summary.status}</span>}
                  {slot.summary.period && (
                    <span>
                      {new Date(slot.summary.period.startMs).toLocaleDateString('zh-CN')} ~{' '}
                      {new Date(slot.summary.period.endMs).toLocaleDateString('zh-CN')}
                    </span>
                  )}
                  <span className="spacer" />
                  <span>更新于 {new Date(slot.summary.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                </div>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
