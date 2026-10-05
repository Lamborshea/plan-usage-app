import { useEffect, useState } from 'react'
import type { ProviderMeta } from '../../../shared/types'
import { api } from '../api'

interface Props {
  onSaved: () => void
}

interface FormState {
  values: Record<string, string>
  saving: boolean
  testing: boolean
  message?: { kind: 'ok' | 'err'; text: string }
}

function ProviderForm({ meta, onSaved }: { meta: ProviderMeta; onSaved: () => void }): JSX.Element {
  const [form, setForm] = useState<FormState>({ values: {}, saving: false, testing: false })

  useEffect(() => {
    let alive = true
    api.getConfig(meta.id).then((values) => {
      if (alive) setForm((f) => ({ ...f, values }))
    })
    return () => {
      alive = false
    }
  }, [meta.id])

  const setField = (key: string, value: string): void =>
    setForm((f) => ({ ...f, values: { ...f.values, [key]: value }, message: undefined }))

  const save = async (): Promise<void> => {
    setForm((f) => ({ ...f, saving: true, message: undefined }))
    // 先用填入的密钥做一次接口测试，通过才落盘并跳转详情
    const test = await api.testConfig(meta.id, form.values)
    if (!test.ok) {
      setForm((f) => ({ ...f, saving: false, message: { kind: 'err', text: `测试失败：${test.error}` } }))
      return
    }
    try {
      await api.saveConfig(meta.id, form.values)
      setForm((f) => ({ ...f, saving: false, message: { kind: 'ok', text: '已保存，正在打开用量详情…' } }))
      onSaved()
      api.openDetail(meta.id, meta.name)
    } catch (e) {
      setForm((f) => ({ ...f, saving: false, message: { kind: 'err', text: (e as Error).message } }))
    }
  }

  const test = async (): Promise<void> => {
    setForm((f) => ({ ...f, testing: true, message: undefined }))
    const res = await api.testConfig(meta.id, form.values)
    setForm((f) => ({
      ...f,
      testing: false,
      message: res.ok
        ? { kind: 'ok', text: '连接成功，接口返回正常' }
        : { kind: 'err', text: res.error }
    }))
  }

  return (
    <div className="settings-form">
      <p className="settings-desc">{meta.description}</p>
      <div className="links">
        {meta.links.map((l) => (
          <button key={l.url} className="link-btn" onClick={() => api.openExternal(l.url)}>
            {l.label} ↗
          </button>
        ))}
      </div>
      {meta.fields.map((field) => (
        <label className="field" key={field.key}>
          <span className="field-label">{field.label}</span>
          <input
            type={field.type}
            value={form.values[field.key] ?? ''}
            placeholder={field.placeholder}
            onChange={(e) => setField(field.key, e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
      ))}
      {form.message && (
        <div className={form.message.kind === 'ok' ? 'msg-ok' : 'msg-err'}>{form.message.text}</div>
      )}
      {meta.fields.length > 0 ? (
        <div className="settings-actions">
          <button className="btn primary" onClick={() => void save()} disabled={form.saving}>
            {form.saving ? '保存中…' : '保存'}
          </button>
          <button className="btn" onClick={() => void test()} disabled={form.testing}>
            {form.testing ? '测试中…' : '测试连接'}
          </button>
        </div>
      ) : (
        <p className="muted-text">无需填写密钥。请在菜单栏用量面板点击「登录{meta.name}」完成浏览器授权。</p>
      )}
    </div>
  )
}

export function SettingsView({ onSaved }: Props): JSX.Element {
  const [metas, setMetas] = useState<ProviderMeta[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    api.listProviders().then((list) => {
      setMetas(list.map((p) => p.meta))
      setExpanded((cur) => cur ?? list[0]?.meta.id ?? null)
    })
  }, [])

  return (
    <div className="view">
      {metas.map((meta) => (
        <section className="card" key={meta.id}>
          <header
            className="card-head clickable"
            onClick={() => setExpanded((cur) => (cur === meta.id ? null : meta.id))}
          >
            <span className="card-title">{meta.name}</span>
            <span className="spacer" />
            <span className="muted-text">{expanded === meta.id ? '收起' : '展开'}</span>
          </header>
          {expanded === meta.id && <ProviderForm meta={meta} onSaved={onSaved} />}
        </section>
      ))}
      <p className="footnote">密钥仅保存在本机，使用本地密钥文件（AES-256-GCM）加密。</p>
    </div>
  )
}
