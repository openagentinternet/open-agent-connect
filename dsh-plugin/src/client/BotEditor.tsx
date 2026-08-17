import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, IconChevronLeftOutline14, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotRow, LlmDirectory } from './api.ts'
import { BotAvatar } from './BotAvatar.tsx'
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

  const tabsId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

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

  // Roving-tabindex tabs in the Plugins settings section's pattern: Arrow
  // keys cycle the focus, Home/End jump, and the selected tab owns tabIndex 0.
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number
    switch (event.key) {
      case 'ArrowRight': nextIndex = (index + 1) % TABS.length; break
      case 'ArrowLeft': nextIndex = (index - 1 + TABS.length) % TABS.length; break
      case 'Home': nextIndex = 0; break
      case 'End': nextIndex = TABS.length - 1; break
      default: return
    }
    event.preventDefault()
    const next = TABS[nextIndex] as { id: TabKey }
    setTab(next.id)
    tabRefs.current[nextIndex]?.focus()
  }

  const tabPanelId = (id: TabKey): string => `${tabsId}-panel-${id}`
  const tabId = (id: TabKey): string => `${tabsId}-tab-${id}`

  return (
    <div className="oac-panel">
      <div className="oac-row">
        <Button type="button" icon={<IconChevronLeftOutline14 />} onClick={onBack}>{t('back')}</Button>
        <div className="oac-editor-title">
          <BotAvatar name={bot.name} src={bot.avatarDataUrl} className="oac-bot-avatar-sm" />
          <h2>{bot.name}</h2>
        </div>
      </div>
      {error ? <div className="oac-error" role="alert">{error}</div> : null}
      <div className="oac-tablist" role="tablist" aria-label={t('title')}>
        {TABS.map((item, index) => {
          const selected = tab === item.id
          return (
            <button
              key={item.id}
              ref={(element) => { tabRefs.current[index] = element }}
              id={tabId(item.id)}
              type="button"
              role="tab"
              className="oac-tab"
              aria-selected={selected}
              aria-controls={tabPanelId(item.id)}
              data-active={selected ? 'true' : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => moveTab(event, index)}
            >
              {t(item.label)}
            </button>
          )
        })}
      </div>
      {tab === 'basic' ? (
        <div id={tabPanelId('basic')} role="tabpanel" aria-labelledby={tabId('basic')} className="oac-tab-panel">
          <div className="oac-form">
            <label className="oac-field">
              <span className="oac-field-label">{t('fieldName')}</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('fieldBio')}</span>
              <textarea className="oac-input" value={bio} onChange={(event) => setBio(event.target.value)} rows={4} />
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('fieldProvider')}</span>
              <select
                className="oac-input oac-input-select"
                value={provider}
                onChange={(event) => { setProvider(event.target.value); setModel('') }}
              >
                <option value=""></option>
                {providers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('fieldModel')}</span>
              <select
                className="oac-input oac-input-select"
                value={model}
                disabled={!provider}
                onChange={(event) => setModel(event.target.value)}
              >
                <option value=""></option>
                {models.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('fieldFallbackProvider')}</span>
              <select
                className="oac-input oac-input-select"
                value={fallbackProvider}
                onChange={(event) => { setFallbackProvider(event.target.value); setFallbackModel('') }}
              >
                <option value=""></option>
                {providers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('fieldFallbackModel')}</span>
              <select
                className="oac-input oac-input-select"
                value={fallbackModel}
                disabled={!fallbackProvider}
                onChange={(event) => setFallbackModel(event.target.value)}
              >
                <option value=""></option>
                {fallbackModels.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <p className="oac-hint">{t('fieldLlmHint')}</p>
            <div className="oac-info-row">
              <span className="oac-info-label">{t('globalMetaId')}</span>
              <code className="oac-info-value">{bot.globalMetaId ?? ''}</code>
            </div>
            <div className="oac-form-actions">
              <Button type="button" variant="primary" disabled={busy} onClick={() => { void saveBasic() }}>
                {busy ? t('saving') : t('save')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {tab === 'behavior' ? (
        <div id={tabPanelId('behavior')} role="tabpanel" aria-labelledby={tabId('behavior')} className="oac-tab-panel">
          <div className="oac-form">
            <label className="oac-field">
              <span className="oac-field-label">{t('fieldRole')}</span>
              <Input value={role} onChange={(event) => setRole(event.target.value)} />
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('fieldSoul')}</span>
              <textarea className="oac-input" value={soul} onChange={(event) => setSoul(event.target.value)} rows={4} />
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('fieldGoal')}</span>
              <textarea className="oac-input" value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} />
            </label>
            <div className="oac-form-actions">
              <Button type="button" variant="primary" disabled={busy} onClick={() => { void saveBehavior() }}>
                {busy ? t('saving') : t('save')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {tab === 'chat' ? (
        <div id={tabPanelId('chat')} role="tabpanel" aria-labelledby={tabId('chat')} className="oac-tab-panel">
          <div className="oac-form">
            <label className="oac-field">
              <span className="oac-field-label">{t('fieldChatSkills')}</span>
              <textarea className="oac-input" value={chatSkills} onChange={(event) => setChatSkills(event.target.value)} rows={8} />
            </label>
            <div className="oac-form-actions">
              <Button type="button" variant="primary" disabled={busy} onClick={() => { void saveChat() }}>
                {busy ? t('saving') : t('save')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {tab === 'advanced' ? (
        <div id={tabPanelId('advanced')} role="tabpanel" aria-labelledby={tabId('advanced')} className="oac-tab-panel">
          <div className="oac-form">
            <p className="oac-hint">{t('advancedHint')}</p>
            <div className="oac-info">
              <div className="oac-info-row">
                <span className="oac-info-label">{t('slug')}</span>
                <code className="oac-info-value">{bot.slug}</code>
              </div>
              <div className="oac-info-row">
                <span className="oac-info-label">{t('preset')}</span>
                <code className="oac-info-value">oac-{bot.slug}</code>
              </div>
              <div className="oac-info-row">
                <span className="oac-info-label">{t('mvcAddress')}</span>
                <code className="oac-info-value">{bot.mvcAddress ?? ''}</code>
              </div>
            </div>
            <div className="oac-form-actions">
              <Button type="button" variant="outline" className="oac-danger-outline" onClick={() => setConfirmDelete(true)}>
                {t('remove')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('removeTitle')}
        className="oac-dialog-delete"
        footer={(
          <>
            <Button type="button" variant="outline" autoFocus disabled={busy} onClick={() => setConfirmDelete(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="oac-danger-outline"
              disabled={busy}
              onClick={() => { void onDelete() }}
            >
              {busy ? t('removing') : t('confirmRemove')}
            </Button>
          </>
        )}
      >
        <p className="oac-dialog-body">
          {interpolate(t('removeConfirm', { name: bot.name, slug: bot.slug }), { name: bot.name, slug: bot.slug })}
        </p>
      </Modal>
    </div>
  )
}
