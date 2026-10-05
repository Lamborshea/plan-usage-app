import { useEffect, useState } from 'react'
import type { UsageDetail } from '../../../shared/types'
import { api } from '../api'
import { ChartBlock } from '../components/ChartBlock'
import { IconGear } from '../components/Icons'

/** providerId 为该值时展示所有已配置供应商的详情 */
export const ALL_PROVIDERS_ID = 'all'

interface CardProps {
  providerId: string
  providerName: string
}

function ProviderDetailCard({ providerId, providerName }: CardProps): JSX.Element {
  const [detail, setDetail] = useState<UsageDetail | null>(null)
  const [days, setDays] = useState<number>(7)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async (d: number): Promise<void> => {
      setLoading(true)
      setError(null)
      const res = await api.fetchDetail(providerId, d)
      if (!alive) return
      if (res.ok) setDetail(res.data)
      else setError(res.error)
      setLoading(false)
    }
    void load(days)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId])

  const changeRange = (d: number): void => {
    setDays(d)
    setLoading(true)
    void api.fetchDetail(providerId, d).then((res) => {
      if (res.ok) setDetail(res.data)
      else setError(res.error)
      setLoading(false)
    })
  }

  return (
    <section className="card">
      <header className="card-head">
        <span className="card-title">{providerName} · 用量详情</span>
        <span className="spacer" />
        {detail?.ranges && (
          <div className="range-tabs">
            {detail.ranges.map((r) => (
              <button
                key={r}
                className={`range-tab${days === r ? ' active' : ''}`}
                onClick={() => changeRange(r)}
              >
                {r} 天
              </button>
            ))}
          </div>
        )}
        <button className="icon-btn" title="供应商配置" onClick={() => api.openSettings()}>
          <IconGear />
        </button>
      </header>
      <div className="card-body">
        {loading && <div className="muted-row">加载图表中…</div>}
        {!loading && error && <div className="error-row">{error}</div>}
        {!loading && !error && detail && (
          <>
            {detail.note && <div className="note">{detail.note}</div>}
            {detail.charts.map((c) => (
              <ChartBlock key={c.id} chart={c} />
            ))}
            {detail.charts.length === 0 && <div className="muted-row">暂无数据</div>}
          </>
        )}
      </div>
    </section>
  )
}

interface Props {
  providerId: string
  providerName: string
}

export function DetailView({ providerId, providerName }: Props): JSX.Element {
  const isAll = providerId === ALL_PROVIDERS_ID
  const [allList, setAllList] = useState<{ id: string; name: string }[] | null>(null)

  useEffect(() => {
    if (!isAll) return
    let alive = true
    const load = async (): Promise<void> => {
      const list = await api.listProviders()
      if (!alive) return
      setAllList(list.filter((p) => p.configured).map((p) => ({ id: p.meta.id, name: p.meta.name })))
    }
    void load()
    api.onDataChanged(() => void load())
    return () => {
      alive = false
    }
  }, [isAll])

  if (!isAll) {
    return (
      <div className="view">
        <ProviderDetailCard providerId={providerId} providerName={providerName} />
      </div>
    )
  }

  if (allList === null) {
    return (
      <div className="view">
        <div className="muted-row">加载中…</div>
      </div>
    )
  }

  return (
    <div className="view">
      {allList.length === 0 && (
        <section className="card">
          <div className="card-body muted-row">
            尚未配置任何供应商
            <button className="link-btn" onClick={() => api.openSettings()}>
              去配置
            </button>
          </div>
        </section>
      )}
      {allList.map((p) => (
        <ProviderDetailCard key={p.id} providerId={p.id} providerName={p.name} />
      ))}
    </div>
  )
}
