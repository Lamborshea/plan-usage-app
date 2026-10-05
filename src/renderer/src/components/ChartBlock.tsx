import type { CSSProperties } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts'
import type { DetailChart } from '../../../shared/types'

export const CHART_COLORS = ['#5B5BD6', '#10a37f', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7', '#64748b', '#ec4899']

const fmtNum = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)

const fmtDate = (t: number): string => {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function AreaBlock({ chart }: { chart: DetailChart }): JSX.Element {
  const groups = chart.series ?? []
  const dayCount = groups[0]?.points.length ?? 0
  const rows = Array.from({ length: dayCount }, (_, i) => {
    const row: Record<string, number> = { t: groups[0]?.points[i].t ?? 0 }
    for (const g of groups) row[g.name] = g.points[i]?.v ?? 0
    return row
  })
  return (
    <ResponsiveContainer width="100%" height={170}>
      <AreaChart data={rows} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
        <defs>
          {groups.map((g, i) => (
            <linearGradient key={g.name} id={`grad-${chart.id}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="#f0f0f4" vertical={false} />
        <XAxis dataKey="t" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: '#9a9aa5' }} axisLine={false} tickLine={false} minTickGap={28} />
        <YAxis tickFormatter={fmtNum} tick={{ fontSize: 10, fill: '#9a9aa5' }} axisLine={false} tickLine={false} />
        <Tooltip
          labelFormatter={(t) => fmtDate(Number(t))}
          formatter={(v, name) => [`${Number(v).toLocaleString()} ${chart.unit}`, name]}
          contentStyle={tooltipStyle}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
        {groups.map((g, i) => (
          <Area
            key={g.name}
            type="monotone"
            dataKey={g.name}
            stackId="1"
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth={1.5}
            fill={`url(#grad-${chart.id}-${i})`}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

function BarBlock({ chart }: { chart: DetailChart }): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, (chart.categories?.length ?? 1) * 34 + 40)}>
      <BarChart data={chart.categories} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="#f0f0f4" horizontal={false} />
        <XAxis type="number" tickFormatter={fmtNum} tick={{ fontSize: 10, fill: '#9a9aa5' }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: '#55555e' }} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(v) => [`${Number(v).toLocaleString()} ${chart.unit}`, '']}
          contentStyle={tooltipStyle}
          cursor={{ fill: '#f6f6f9' }}
        />
        <Bar dataKey="value" radius={[3, 3, 3, 3]} barSize={14}>
          {(chart.categories ?? []).map((_c, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function PieBlock({ chart }: { chart: DetailChart }): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie data={chart.categories} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2} stroke="none">
          {(chart.categories ?? []).map((_c, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v, name) => [`${Number(v).toLocaleString()} ${chart.unit}`, name]} contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
      </PieChart>
    </ResponsiveContainer>
  )
}

const tooltipStyle: CSSProperties = {
  fontSize: 11,
  borderRadius: 8,
  border: '1px solid #ececf1',
  boxShadow: '0 4px 16px rgba(20,20,40,0.08)',
  padding: '6px 10px'
}

export function ChartBlock({ chart }: { chart: DetailChart }): JSX.Element {
  return (
    <div className="chart-block">
      <div className="chart-title">
        {chart.title}
        <span className="chart-unit">{chart.unit}</span>
      </div>
      {chart.kind === 'area' && <AreaBlock chart={chart} />}
      {chart.kind === 'bar' && <BarBlock chart={chart} />}
      {chart.kind === 'pie' && <PieBlock chart={chart} />}
    </div>
  )
}
