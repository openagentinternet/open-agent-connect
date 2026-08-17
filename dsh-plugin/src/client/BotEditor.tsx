import { useState, type ReactNode } from 'react'
import { Button, IconChevronLeftOutline14, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotRow, LlmDirectory } from './api.ts'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey, vars?: Record<string, string | number>) => string
type TabKey = 'basic' | 'behavior' | 'chat' | 'advanced'

const TABS: Array<{ id: TabKey; label: BotsLocaleKey }> = [
  { id: 'basic', label: 'tabBasic' },
  { id: 'behavior', label: 'tabBehavior' },
  { id: 'chat', label: 'tabChat' },
  { id: 'advanced', label: 'tabAdvanced' },
]

function interpolate(template: string, vars: Record<string, string | number>): string {
  let text = template
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

export function BotEditor({
  bot,
  directory,
  t,
  busy,
  error,
  onBack,
  onSave,
  onDelete,
}: {
  bot: BotRow
  directory: LlmDirectory | null
  t: Translate
  busy: boolean
  error: string | null
  onBack: () => void
  onSave: (patch: Record<string, unknown>) => Promise<void>
  onDelete: () => Promise<void>
}): ReactNode {
  const [tab, setTab] = useState<TabKey>('basic')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [name, setName] = useState(bot.name)
  const [bio, setBio] = useState(bot.bio ?? '')
  const [provider, setProvider] = useState(bot.dshLlmProvider ?? '')
  const [model, setModel] = useState(bot.dshLlmModel ?? '')
  const [fallbackProvider, setFallbackProvider] = useState(bot.dshLlmFallbackProvider ?? '')
  const [fallbackModel, setFallbackModel] = useState(bot.dshLlmFallbackModel ?? '')
  const [role, setRole] = useState(bot.role ?? '')
  const [soul, setSoul] = useState(bot.soul ?? '')
  const [goal, setGoal] = useState(bot.goal ?? '')
  const [chatSkills, setChatSkills] = useState((bot.allowChatSkills ?? []).join('\n'))
  const providers = directory?.providers ?? []
  const models = directory?.modelsByProvider[provider] ?? []
  const fallbackModels = fallbackProvider ? directory?.modelsByProvider[fallbackProvider] ?? [] : []

  const saveBasic = (): Promise<void> => onSave({
    name,
    bio,
    dshLlmProvider: provider || null,
    dshLlmModel: model || null,
    dshLlmFallbackProvider: fallbackProvider || null,
    dshLlmFallbackModel: fallbackModel || null,
  })
  const saveBehavior = (): Promise<void> => onSave({ role, soul, goal })
  const saveChat = (): Promise<void> => onSave({
    allowChatSkills: chatSkills.split('\n').map((line) => line.trim()).filter(Boolean),
  })

  return (
    <div className="oac-panel">
      <div className="oac-row">
        <Button type="button" icon={<IconChevronLeftOutline14 />} onClick={onBack}>{t('back')}</Button>
        <strong>{bot.name}</strong>
      </div>
      {error ? <div className="oac-error">{error}</div> : null}
      <div className="oac-tabs">
        {TABS.map((item) => (
          <Button
            key={item.id}
            type="button"
            data-active={tab === item.id ? 'true' : 'false'}
            onClick={() => setTab(item.id)}
          >
            {t(item.label)}
          </Button>
        ))}
      </div>
      {tab === 'basic' ? (
        <div className="oac-form">
          <label>{t('fieldName')}<Input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>{t('fieldBio')}<textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={4} /></label>
          <label>
            {t('fieldProvider')}
            <select value={provider} onChange={(event) => { setProvider(event.target.value); setModel('') }}>
              {providers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label>
            {t('fieldModel')}
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {models.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label>
            {t('fieldFallbackProvider')}
            <select value={fallbackProvider} onChange={(event) => { setFallbackProvider(event.target.value); setFallbackModel('') }}>
              <option value=""></option>
              {providers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label>
            {t('fieldFallbackModel')}
            <select value={fallbackModel} onChange={(event) => setFallbackModel(event.target.value)}>
              <option value=""></option>
              {fallbackModels.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <p className="oac-muted">{t('fieldLlmHint')}</p>
          <div className="oac-mono">{t('globalMetaId')}: {bot.globalMetaId ?? ''}</div>
          <Button type="button" disabled={busy} onClick={() => { void saveBasic() }}>{busy ? t('saving') : t('save')}</Button>
        </div>
      ) : null}
      {tab === 'behavior' ? (
        <div className="oac-form">
          <label>{t('fieldRole')}<Input value={role} onChange={(event) => setRole(event.target.value)} /></label>
          <label>{t('fieldSoul')}<textarea value={soul} onChange={(event) => setSoul(event.target.value)} rows={4} /></label>
          <label>{t('fieldGoal')}<textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} /></label>
          <Button type="button" disabled={busy} onClick={() => { void saveBehavior() }}>{busy ? t('saving') : t('save')}</Button>
        </div>
      ) : null}
      {tab === 'chat' ? (
        <div className="oac-form">
          <label>
            {t('fieldChatSkills')}
            <textarea value={chatSkills} onChange={(event) => setChatSkills(event.target.value)} rows={8} />
          </label>
          <Button type="button" disabled={busy} onClick={() => { void saveChat() }}>{busy ? t('saving') : t('save')}</Button>
        </div>
      ) : null}
      {tab === 'advanced' ? (
        <div className="oac-form">
          <p className="oac-muted">{t('advancedHint')}</p>
          <div className="oac-mono">{t('slug')}: {bot.slug}</div>
          <div className="oac-mono">{t('preset')}: oac-{bot.slug}</div>
          <div className="oac-mono">{t('mvcAddress')}: {bot.mvcAddress ?? ''}</div>
          <Button type="button" onClick={() => setConfirmDelete(true)}>{t('remove')}</Button>
        </div>
      ) : null}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('removeTitle')}>
        <p>{interpolate(t('removeConfirm', { name: bot.name, slug: bot.slug }), { name: bot.name, slug: bot.slug })}</p>
        <div className="oac-actions">
          <Button type="button" onClick={() => setConfirmDelete(false)}>{t('cancel')}</Button>
          <Button type="button" disabled={busy} onClick={() => { void onDelete() }}>{busy ? t('removing') : t('confirmRemove')}</Button>
        </div>
      </Modal>
    </div>
  )
}
