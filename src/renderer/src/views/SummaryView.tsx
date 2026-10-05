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

  const refresh = useCallback(async (id: string) => {
    setSlots((s) => ({ ...s, [id]: { ...s[id], loading: true, error: undefined } }))
    const res = await api.fetchSummary(id)
    setSlots((s) => ({
      ...s,
      [id]: { loading: false, summary: res.ok ? res.data : s[id]?.summary, error: res.ok ? undefined : res.error }
    }))
  }, [])

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const list = await api.listProviders()
      if (!alive) return
      setProviders(list)
      for (const p of list) {
        if (p.configured) void refresh(p.meta.id)
        else setSlots((s) => ({ ...s, [p.meta.id]: { loading: false } }))
      }
    }
    void load()
    // 配置保存后主进程广播 data:changed，重新拉取
    api.onDataChanged(() => void load())
    return () => {
      alive = false
    }
  }, [refresh])

  return (
    <div className="view">
      {providers.length === 0 && <div className="empty">暂无供应商</div>}
      {providers.map((p) => {
        const slot = slots[p.meta.id]
        return (
          <section className="card" key={p.meta.id}>
            <header className="card-head">
              <span className="card-title">{p.meta.name}</span>
              {p.configured ? (
                <span className="badge badge-ok">已配置</span>
              ) : (
                <span className="badge badge-warn">未配置</span>
              )}
              <span className="spacer" />
              {p.configured && (
                <button
                  className="icon-btn"
                  title="刷新"
                  onClick={(e) => {
                    e.stopPropagation()
                    void refresh(p.meta.id)
                  }}
                >
                  <span className={slot?.loading ? 'spin' : ''}>
                    <IconRefresh />
                  </span>
                </button>
              )}
              <button className="icon-btn" title="在新窗口查看用量详情" onClick={() => onOpenDetail(p.meta.id, p.meta.name)}>
                <IconExpand />
              </button>
            </header>

            {!p.configured && (
              <div className="card-body muted-row">
                尚未配置密钥
                <button className="link-btn" onClick={onOpenSettings}>
                  去配置
                </button>
              </div>
            )}

            {p.configured && slot?.loading && !slot.summary && <div className="card-body muted-row">加载中…</div>}
            {p.configured && slot?.error && !slot.summary && <div className="card-body error-row">{slot.error}</div>}

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
