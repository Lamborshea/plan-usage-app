import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { SummaryView } from './views/SummaryView'
import { DetailView } from './views/DetailView'
import { SettingsView } from './views/SettingsView'
import { IconClose, IconExpand, IconGear, IconPin, IconQuit } from './components/Icons'

/** 窗口路由：由 URL query 决定该窗口渲染概览面板、详情还是配置。 */
type Route =
  | { mode: 'popover' }
  | { mode: 'detail'; providerId: string; providerName: string }
  | { mode: 'settings' }

function readRoute(): Route {
  const p = new URLSearchParams(window.location.search)
  const view = p.get('view')
  const providerId = p.get('providerId')
  if (view === 'detail' && providerId) {
    return { mode: 'detail', providerId, providerName: p.get('providerName') ?? providerId }
  }
  if (view === 'settings') return { mode: 'settings' }
  return { mode: 'popover' }
}

const MIN_HEIGHT = 220
/** 面板绝对上限，防止在大屏上出现过长面板；小屏按可用高度再收敛 */
const MAX_HEIGHT = 900

/** 面板顶边锚定在菜单栏下方：按屏幕可用高度留出托盘偏移与底部余量（约 48px） */
function maxHeightForScreen(): number {
  const avail = window.screen.availHeight
  if (!avail) return MAX_HEIGHT
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, avail - 48))
}

export default function App(): JSX.Element {
  const route = useMemo(readRoute, [])
  const standalone = route.mode !== 'popover'
  const [pinned, setPinned] = useState(false)
  const bodyRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!standalone) api.onPinned(setPinned)
  }, [standalone])

  // 独立窗口用原生标题栏，标题跟随路由
  useEffect(() => {
    if (route.mode === 'detail') document.title = `${route.providerName} · 用量详情`
    else if (route.mode === 'settings') document.title = '供应商配置'
  }, [route])

  // 仅概览面板需要自适应高度；独立窗口由用户缩放。
  // 注意不能测 .panel 本身：它 max-height:100% 会被当前窗口高度钳制，形成循环依赖，
  // 导致面板永远停在初始高度。这里改测滚动容器内部内容的自然高度。
  useLayoutEffect(() => {
    if (standalone) return
    const body = bodyRef.current
    const inner = body?.firstElementChild as HTMLElement | null
    if (!body || !inner) return
    const update = (): void => {
      // body.offsetTop = 面板上边框 + 头部高度；inner 高度不受窗口钳制
      const natural = body.offsetTop + inner.offsetHeight + 2
      const h = Math.min(maxHeightForScreen(), Math.max(MIN_HEIGHT, natural))
      api.setHeight(h)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [standalone, route])

  if (route.mode === 'detail' || route.mode === 'settings') {
    return (
      <div className="standalone">
        <main className="standalone-body">
          {route.mode === 'detail' ? (
            <DetailView providerId={route.providerId} providerName={route.providerName} />
          ) : (
            <SettingsView onSaved={() => undefined} />
          )}
        </main>
      </div>
    )
  }

  return (
    <div
      className="shell"
      onMouseEnter={() => api.mouseEnter()}
      onMouseLeave={() => api.mouseLeave()}
    >
      <div className="panel">
        <header className="panel-head">
          <span className="logo-dot" />
          <span className="panel-title">Plan Usage</span>
          <span className="spacer" />
          <button
            className="icon-btn"
            title="查看全部用量详情"
            onClick={() => api.openDetail('all', '全部供应商')}
          >
            <IconExpand />
          </button>
          <button
            className={`icon-btn${pinned ? ' active' : ''}`}
            title={pinned ? '取消固定' : '固定面板'}
            onClick={() => void api.togglePin().then(setPinned)}
          >
            <IconPin pinned={pinned} />
          </button>
          <button className="icon-btn" title="设置" onClick={() => api.openSettings()}>
            <IconGear />
          </button>
          <button
            className="icon-btn"
            title="退出应用"
            onClick={() => {
              if (window.confirm('确定退出 Plan Usage 吗？退出后需重新启动才会出现在菜单栏。')) api.quit()
            }}
          >
            <IconQuit />
          </button>
          <button className="icon-btn" title="隐藏" onClick={() => api.hideWindow()}>
            <IconClose />
          </button>
        </header>

        <main className="panel-body" ref={bodyRef}>
          <SummaryView
            onOpenDetail={(id, name) => api.openDetail(id, name)}
            onOpenSettings={() => api.openSettings()}
          />
        </main>
      </div>
    </div>
  )
}
