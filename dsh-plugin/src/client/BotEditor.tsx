import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Button,
  IconChevronLeftOutline14,
  IconCloseOutline16,
  IconPlusOutline16,
  Input,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  AUTO_REPLY_COOLDOWN_MS_OPTIONS,
  AUTO_REPLY_MAX_TURNS_OPTIONS,
  DEFAULT_AUTO_REPLY_COOLDOWN_MS,
  DEFAULT_AUTO_REPLY_MAX_TURNS,
  type AutoReplyConfig,
  type BotRow,
  type ChatSkillsPayload,
  type LlmDirectory,
} from './api.ts'
import { BotAvatar } from './BotAvatar.tsx'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey, vars?: Record<string, string | number>) => string
type TabKey = 'basic' | 'behavior' | 'chat' | 'advanced'
type NoteTone = 'saving' | 'success' | 'warn' | 'error'

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

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function sameList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

export function BotEditor({
  bot,
  directory,
  t,
  busy,
  error,
  chatSkills,
  loadAutoReplyStatus,
  autoReplyConfig,
  onBack,
  onSave,
  onDelete,
}: {
  bot: BotRow
  directory: LlmDirectory | null
  t: Translate
  busy: boolean
  error: string | null
  chatSkills: (from: string) => Promise<ChatSkillsPayload>
  loadAutoReplyStatus: (from: string) => Promise<AutoReplyConfig>
  autoReplyConfig: (
    from: string,
    patch: { enabled?: boolean; maxTurns?: number; cooldownMs?: number },
  ) => Promise<AutoReplyConfig>
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
  const providers = directory?.providers ?? []
  const models = directory?.modelsByProvider[provider] ?? []
  const fallbackModels = fallbackProvider ? directory?.modelsByProvider[fallbackProvider] ?? [] : []

  // Chat settings: the auto-reply state lives server-side and is written on
  // every toggle/param change; the allowed-skill list is a local draft that
  // one Save action persists through the normal profile update.
  const [skills, setSkills] = useState<Array<{ skillName: string; title: string; description: string }>>([])
  const [skillsStatus, setSkillsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [skillsError, setSkillsError] = useState('')
  const [skipped, setSkipped] = useState<string[]>([])
  const [picked, setPicked] = useState('')
  const [allowed, setAllowed] = useState<string[]>(bot.allowChatSkills ?? [])
  const [chatNote, setChatNote] = useState<{ tone: NoteTone; text: string } | null>(null)
  const [autoReply, setAutoReply] = useState<AutoReplyConfig | null>(null)
  const [autoReplyStatus, setAutoReplyStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [autoReplyError, setAutoReplyError] = useState('')
  const [autoReplyNote, setAutoReplyNote] = useState<{ tone: NoteTone; text: string } | null>(null)

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

  // Refresh the skill catalog and the auto-reply state on every chat-tab
  // entry, like the OAC page does: skills installed later or a runtime switch
  // must show up without a page reload, and a load error retries on re-entry.
  useEffect(() => {
    if (tab !== 'chat') return
    let current = true
    setSkillsStatus('loading')
    setAutoReplyStatus('loading')
    setAutoReplyNote(null)
    void chatSkills(bot.slug).then(
      (payload) => {
        if (!current) return
        setSkills(payload.skills)
        setSkipped(payload.skipped)
        setSkillsStatus('ready')
      },
      (cause: unknown) => {
        if (!current) return
        setSkillsError(errorText(cause))
        setSkillsStatus('error')
      },
    )
    void loadAutoReplyStatus(bot.slug).then(
      (config) => {
        if (!current) return
        setAutoReply(config)
        setAutoReplyStatus('ready')
      },
      (cause: unknown) => {
        if (!current) return
        setAutoReplyError(errorText(cause))
        setAutoReplyStatus('error')
      },
    )
    return () => { current = false }
  }, [tab, bot.slug, chatSkills, loadAutoReplyStatus])

  const toggleAutoReply = (): void => {
    if (autoReply === null || autoReplyStatus !== 'ready') return
    const next = !autoReply.enabled
    setAutoReply({ ...autoReply, enabled: next })
    setAutoReplyNote({ tone: 'saving', text: t('autoReplySaving') })
    void autoReplyConfig(bot.slug, { enabled: next }).then(
      (config) => {
        setAutoReply(config)
        setAutoReplyNote({ tone: 'success', text: t('autoReplySaved') })
      },
      (cause: unknown) => {
        setAutoReply((previous) => (previous === null ? null : { ...previous, enabled: !next }))
        setAutoReplyNote({ tone: 'error', text: errorText(cause) })
      },
    )
  }

  const saveAutoReplyParam = (key: 'maxTurns' | 'cooldownMs', value: number): void => {
    if (autoReply === null) return
    const previousValue = autoReply[key]
    setAutoReply({ ...autoReply, [key]: value })
    setAutoReplyNote({ tone: 'saving', text: t('autoReplySaving') })
    void autoReplyConfig(bot.slug, { [key]: value }).then(
      (config) => {
        setAutoReply(config)
        setAutoReplyNote({ tone: 'success', text: t('autoReplySaved') })
      },
      (cause: unknown) => {
        setAutoReply((current) => (current === null ? null : { ...current, [key]: previousValue }))
        setAutoReplyNote({ tone: 'error', text: errorText(cause) })
      },
    )
  }

  const addSkill = (): void => {
    const skill = picked.trim()
    setPicked('')
    if (!skill || allowed.includes(skill)) return
    setAllowed([...allowed, skill])
  }

  const removeSkill = (skill: string): void => {
    setAllowed(allowed.filter((item) => item !== skill))
  }

  const saveSkills = async (): Promise<void> => {
    setChatNote({ tone: 'saving', text: t('savingChatSkills') })
    try {
      await onSave({ allowChatSkills: allowed })
      setChatNote({ tone: 'success', text: t('savedChatSkills') })
    } catch (cause) {
      setChatNote({ tone: 'error', text: errorText(cause) })
    }
  }

  const availableSkills = skills.filter((skill) => !allowed.includes(skill.skillName))
  const skillsDirty = !sameList(allowed, bot.allowChatSkills ?? [])
  const autoReplyReady = autoReplyStatus === 'ready' && autoReply !== null

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
            <div className="oac-section-card">
              <div className="oac-section-head">
                <div className="oac-section-text">
                  <span className="oac-section-title">{t('autoReplyToggle')}</span>
                  <span className="oac-section-hint">{t('autoReplyHint')}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoReply?.enabled === true}
                  className={autoReply?.enabled === true ? 'oac-switch on' : 'oac-switch'}
                  disabled={!autoReplyReady}
                  onClick={toggleAutoReply}
                >
                  <span className="oac-switch-track"><span className="oac-switch-thumb" /></span>
                  <span className="oac-switch-text">
                    {autoReply?.enabled === true ? t('autoReplyOn') : t('autoReplyOff')}
                  </span>
                </button>
              </div>
              <div className="oac-param-grid">
                <label className="oac-field">
                  <span className="oac-field-label">{t('autoReplyMaxTurns')}</span>
                  <select
                    className="oac-input oac-input-select"
                    value={autoReply?.maxTurns ?? DEFAULT_AUTO_REPLY_MAX_TURNS}
                    disabled={!autoReplyReady}
                    onChange={(event) => saveAutoReplyParam('maxTurns', Number(event.target.value))}
                  >
                    {AUTO_REPLY_MAX_TURNS_OPTIONS.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                  <span className="oac-hint">{t('autoReplyMaxTurnsHint')}</span>
                </label>
                <label className="oac-field">
                  <span className="oac-field-label">{t('autoReplyCooldown')}</span>
                  <select
                    className="oac-input oac-input-select"
                    value={autoReply?.cooldownMs ?? DEFAULT_AUTO_REPLY_COOLDOWN_MS}
                    disabled={!autoReplyReady}
                    onChange={(event) => saveAutoReplyParam('cooldownMs', Number(event.target.value))}
                  >
                    {AUTO_REPLY_COOLDOWN_MS_OPTIONS.map((value) => (
                      <option key={value} value={value}>{value / 60_000} {t('autoReplyCooldownMinutes')}</option>
                    ))}
                  </select>
                  <span className="oac-hint">{t('autoReplyCooldownHint')}</span>
                </label>
              </div>
              {autoReplyStatus === 'loading'
                ? <p className="oac-note saving">{t('loadingAutoReply')}</p>
                : autoReplyStatus === 'error'
                  ? <p className="oac-note error">{autoReplyError || t('autoReplyLoadFailed')}</p>
                  : autoReplyNote === null
                    ? null
                    : <p className={`oac-note ${autoReplyNote.tone}`}>{autoReplyNote.text}</p>}
            </div>
            <div className="oac-section-card">
              <div className="oac-section-text">
                <span className="oac-section-title">{t('chatAllowedSkills')}</span>
              </div>
              {allowed.length === 0 ? (
                <p className="oac-hint">{t('noChatSkillsAllowed')}</p>
              ) : (
                <ul className="oac-chip-list">
                  {allowed.map((skill) => (
                    <li className="oac-chip" key={skill}>
                      <code>{skill}</code>
                      <button
                        type="button"
                        className="oac-chip-remove"
                        aria-label={`${t('removeSkill')}: ${skill}`}
                        onClick={() => removeSkill(skill)}
                      >
                        <IconCloseOutline16 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="oac-skill-picker">
                <select
                  className="oac-input oac-input-select"
                  value={picked}
                  disabled={skillsStatus !== 'ready' || availableSkills.length === 0}
                  onChange={(event) => setPicked(event.target.value)}
                >
                  <option value="">{t('selectSkill')}</option>
                  {availableSkills.map((skill) => (
                    <option key={skill.skillName} value={skill.skillName}>
                      {skill.title && skill.title !== skill.skillName
                        ? `${skill.title} (${skill.skillName})`
                        : skill.skillName}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  icon={<IconPlusOutline16 />}
                  disabled={!picked || skillsStatus !== 'ready'}
                  onClick={addSkill}
                >
                  {t('addSkill')}
                </Button>
              </div>
              {skillsStatus === 'loading'
                ? <p className="oac-note saving">{t('loadingChatSkills')}</p>
                : skillsStatus === 'error'
                  ? <p className="oac-note error">{skillsError || t('chatSkillsLoadFailed')}</p>
                  : null}
              {skipped.length > 0 ? (
                <p className="oac-note warn">
                  {interpolate(
                    t('chatSkillsUnavailable', { count: skipped.length, names: skipped.join(', ') }),
                    { count: skipped.length, names: skipped.join(', ') },
                  )}
                </p>
              ) : null}
              <div className="oac-form-actions">
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy || !skillsDirty}
                  onClick={() => { void saveSkills() }}
                >
                  {busy ? t('savingChatSkills') : t('saveChatSkills')}
                </Button>
                {chatNote === null ? null : <p className={`oac-note ${chatNote.tone}`}>{chatNote.text}</p>}
              </div>
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
