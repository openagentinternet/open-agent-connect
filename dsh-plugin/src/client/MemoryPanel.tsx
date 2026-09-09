import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconPlusOutline16,
  IconRefreshOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BotRow,
  DreamStatusPayload,
  DreamSummaryRow,
  HygieneStatusPayload,
  ImpressionObservationRow,
  ImpressionSnapshotRow,
  KnowledgeRow,
  MemoryEntryRow,
  MemoryPolicyPayload,
} from './api.ts'
import type { MemoryLocaleKey } from './locale-memory.ts'

type Translate = (key: MemoryLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export interface MemoryPanelInjected {
  bots: () => Promise<BotRow[]>
  twinCurrent: () => Promise<{ twinSlug?: string | null }>
  memoryList: (from: string, options?: Record<string, unknown>) => Promise<{ entries?: MemoryEntryRow[] }>
  memoryAdd: (from: string, entry: Record<string, unknown>) => Promise<unknown>
  memoryUpdate: (from: string, entry: Record<string, unknown>) => Promise<unknown>
  memoryDelete: (from: string, id: string) => Promise<unknown>
  memoryUnarchive: (from: string, id: string) => Promise<unknown>
  memoryStats: (from: string) => Promise<{ stats?: { total: number; created: number; stale: number } }>
  memoryPolicyGet: (from: string) => Promise<MemoryPolicyPayload>
  memoryPolicySet: (from: string, patch: Record<string, unknown>) => Promise<unknown>
  memoryPolicyDelete: (from: string) => Promise<unknown>
  hygieneStatus: (from: string) => Promise<HygieneStatusPayload>
  hygieneRun: (from: string, noDeep?: boolean) => Promise<unknown>
  hygieneConfigSet: (from: string, config: Record<string, unknown>) => Promise<unknown>
  knowledgeList: (from: string, options?: Record<string, unknown>) => Promise<{ entries?: KnowledgeRow[] }>
  knowledgeUpdate: (from: string, entry: Record<string, unknown>) => Promise<unknown>
  knowledgeArchive: (from: string, id: string) => Promise<unknown>
  knowledgeDelete: (from: string, id: string) => Promise<unknown>
  impressionsList: (from: string) => Promise<{ snapshots?: ImpressionSnapshotRow[] }>
  impressionsShow: (
    from: string,
    subject: string,
  ) => Promise<{ snapshot?: ImpressionSnapshotRow | null; observations?: ImpressionObservationRow[] }>
  dreamSummaries: (from: string, limit?: number) => Promise<{ summaries?: DreamSummaryRow[] }>
  dreamStatus: (from: string) => Promise<DreamStatusPayload>
  dreamSelfIdentity: (from: string) => Promise<{ text?: string }>
  dreamRun: (from: string, date: string) => Promise<unknown>
}

type TabKey = 'knowledge' | 'contacts' | 'facts' | 'dream'

/** Shorten a GlobalMetaID for compact display (IDBots parity): full id stays in the title tooltip. */
function abbreviateGlobalMetaId(id: string): string {
  const trimmed = id.trim()
  if (trimmed.length <= 16) return trimmed
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-6)}`
}

const USAGE_CLASSES = [
  'profile_fact',
  'preference',
  'operational_preference',
  'work_review',
  'value_boundary',
] as const

const USAGE_CLASS_LABEL_KEY: Record<string, MemoryLocaleKey> = {
  profile_fact: 'usageProfileFact',
  preference: 'usagePreference',
  operational_preference: 'usageOperationalPreference',
  work_review: 'usageWorkReview',
  value_boundary: 'usageValueBoundary',
}

function usageClassLabel(t: Translate, usageClass: string): string {
  const key = USAGE_CLASS_LABEL_KEY[usageClass]
  return key ? t(key) : usageClass
}

const DREAM_RUN_STATUS_LABEL_KEY: Record<string, MemoryLocaleKey> = {
  completed: 'dreamRunStatusCompleted',
  failed: 'dreamRunStatusFailed',
  running: 'dreamRunStatusRunning',
}

function dreamRunStatusLabel(t: Translate, status: string): string {
  const key = DREAM_RUN_STATUS_LABEL_KEY[status]
  return key ? t(key) : status
}

function yesterdayLocal(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Compact countdown to a future epoch ms (dream retry rows): ≤1m / Nm / Nh / Nd. */
function untilLabel(target: number, now = Date.now()): string {
  const diff = target - now
  if (diff <= 60_000) return '≤1m'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function MemoryPanel(injected: MemoryPanelInjected & { close: () => void; t: Translate }): ReactNode {
  const { t } = injected
  const [bots, setBots] = useState<BotRow[] | null>(null)
  const [slug, setSlug] = useState('')
  const [tab, setTab] = useState<TabKey>('facts')
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    void Promise.all([injected.bots(), injected.twinCurrent().catch(() => ({ twinSlug: null }))]).then(
      ([rows, twin]) => {
        if (!current) return
        setBots(rows)
        if (!slug) {
          const twinRow = rows.find((row) => row.slug === twin.twinSlug)
          setSlug((twinRow ?? rows[0])?.slug ?? '')
        }
      },
      (cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)) },
    )
    return () => { current = false }
  }, [injected, slug])

  const reload = (): void => setTick((value) => value + 1)

  return (
    <div className="oac-panel">
      <div className="oac-row">
        <h2>{t('title')}</h2>
        <div className="oac-actions">
          <select
            className="oac-input oac-input-select oac-memory-bot-select"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            aria-label={t('botSelector')}
          >
            {(bots ?? []).map((bot) => (
              <option key={bot.slug} value={bot.slug}>
                {bot.name}{bot.botType === 'twin' ? ' · Twin' : ''}
              </option>
            ))}
          </select>
          <Button type="button" icon={<IconRefreshOutline16 />} onClick={reload}>{t('refresh')}</Button>
        </div>
      </div>
      {error ? <div className="oac-error">{error}</div> : null}
      {!slug ? <div className="oac-muted">{t('loading')}</div> : (
        <>
          <IdentityCard key={`identity-${tick}`} from={slug} t={t} dreamSelfIdentity={injected.dreamSelfIdentity} />
          <PolicyCard
            key={`policy-${tick}`}
            from={slug}
            t={t}
            memoryPolicyGet={injected.memoryPolicyGet}
            memoryPolicySet={injected.memoryPolicySet}
            memoryPolicyDelete={injected.memoryPolicyDelete}
          />
          <HygieneCard
            key={`hygiene-${tick}`}
            from={slug}
            t={t}
            hygieneStatus={injected.hygieneStatus}
            hygieneRun={injected.hygieneRun}
            hygieneConfigSet={injected.hygieneConfigSet}
          />
          <div className="oac-tablist" role="tablist">
            {(['knowledge', 'contacts', 'facts', 'dream'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                className="oac-tab"
                data-active={tab === key}
                onClick={() => setTab(key)}
              >
                {t(key === 'knowledge' ? 'tabKnowledge' : key === 'contacts' ? 'tabContacts' : key === 'facts' ? 'tabFacts' : 'tabDream')}
              </button>
            ))}
          </div>
          <div className="oac-tab-panel">
            {tab === 'knowledge' ? (
              <KnowledgeTab key={`k-${slug}-${tick}`} from={slug} t={t} injected={injected} />
            ) : null}
            {tab === 'contacts' ? (
              <ContactsTab key={`c-${slug}-${tick}`} from={slug} t={t} injected={injected} />
            ) : null}
            {tab === 'facts' ? (
              <FactsTab key={`f-${slug}-${tick}`} from={slug} t={t} injected={injected} />
            ) : null}
            {tab === 'dream' ? (
              <DreamTab
                key={`d-${slug}-${tick}`}
                from={slug}
                t={t}
                injected={injected}
                onDone={reload}
                bot={(bots ?? []).find((bot) => bot.slug === slug)}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function IdentityCard({ from, t, dreamSelfIdentity }: {
  from: string
  t: Translate
  dreamSelfIdentity: MemoryPanelInjected['dreamSelfIdentity']
}): ReactNode {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    void dreamSelfIdentity(from).then(
      (result) => { if (current) setText(result.text ?? '') },
      () => { if (current) setText('') },
    )
    return () => { current = false }
  }, [from, dreamSelfIdentity])
  return (
    <section className="oac-section-card">
      <div className="oac-section-head">
        <div className="oac-section-text">
          <span className="oac-section-title">{t('identityTitle')}</span>
          <span className="oac-section-hint">{t('identityHint')}</span>
        </div>
      </div>
      {text === null ? <div className="oac-muted">{t('loading')}</div> : null}
      {text === '' ? <div className="oac-muted">{t('identityEmpty')}</div> : null}
      {text ? <p className="oac-memory-identity">{text}</p> : null}
    </section>
  )
}

function PolicyCard({ from, t, memoryPolicyGet, memoryPolicySet, memoryPolicyDelete }: {
  from: string
  t: Translate
  memoryPolicyGet: MemoryPanelInjected['memoryPolicyGet']
  memoryPolicySet: MemoryPanelInjected['memoryPolicySet']
  memoryPolicyDelete: MemoryPanelInjected['memoryPolicyDelete']
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [policy, setPolicy] = useState<MemoryPolicyPayload | null>(null)
  const [override, setOverride] = useState(false)
  const [form, setForm] = useState<Record<string, unknown>>({})
  const [note, setNote] = useState<'saving' | 'saved' | 'error' | null>(null)

  useEffect(() => {
    if (!open) return
    let current = true
    void memoryPolicyGet(from).then((result) => {
      if (!current) return
      setPolicy(result)
      const hasOverride = Object.keys(result.override ?? {}).length > 0
      setOverride(hasOverride)
      setForm({
        memoryEnabled: result.effective.memoryEnabled,
        memoryImplicitUpdateEnabled: result.effective.memoryImplicitUpdateEnabled,
        memoryLlmJudgeEnabled: result.effective.memoryLlmJudgeEnabled,
        memoryGuardLevel: result.effective.memoryGuardLevel,
        memoryUserMemoriesMaxItems: result.effective.memoryUserMemoriesMaxItems,
        memoryPromptMaxChars: result.effective.memoryPromptMaxChars,
        dreamEnabled: result.effective.dreamEnabled,
      })
    }).catch(() => { if (current) setPolicy(null) })
    return () => { current = false }
  }, [from, open, memoryPolicyGet])

  const save = async (): Promise<void> => {
    setNote('saving')
    try {
      if (override) {
        await memoryPolicySet(from, form)
      } else {
        await memoryPolicyDelete(from)
      }
      setNote('saved')
    } catch {
      setNote('error')
    }
  }

  return (
    <section className="oac-section-card">
      <div className="oac-section-head">
        <div className="oac-section-text">
          <span className="oac-section-title">{t('policyTitle')}</span>
        </div>
        <button type="button" className="oac-icon-btn" onClick={() => setOpen((value) => !value)}
          aria-label={open ? t('policyHide') : t('policyShow')}>
          {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
        </button>
      </div>
      {open && policy ? (
        <>
          <label className="oac-switch" data-on={override}>
            <span className={`oac-switch-track${override ? ' on' : ''}`}>
              <span className="oac-switch-thumb" />
            </span>
            <input type="checkbox" hidden checked={override} onChange={(event) => setOverride(event.target.checked)} />
            <span className="oac-switch-text">{t('policyOverride')}</span>
          </label>
          <p className="oac-hint">{t('policyOverrideHint')}</p>
          {override ? (
            <>
              {([
                ['memoryEnabled', t('policyEnabled'), t('policyEnabledHint')],
                ['memoryImplicitUpdateEnabled', t('policyImplicit'), t('policyImplicitHint')],
                ['memoryLlmJudgeEnabled', t('policyJudge'), t('policyJudgeHint')],
                ['dreamEnabled', t('policyDream'), t('policyDreamHint')],
              ] as const).map(([key, label, hint]) => (
                <label className="oac-switch" key={key}>
                  <span className={`oac-switch-track${form[key] === true ? ' on' : ''}`}>
                    <span className="oac-switch-thumb" />
                  </span>
                  <input
                    type="checkbox"
                    hidden
                    checked={form[key] === true}
                    onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.checked }))}
                  />
                  <span className="oac-switch-text">{label}</span>
                  <span className="oac-hint">{hint}</span>
                </label>
              ))}
              <div className="oac-param-grid">
                <label className="oac-field">
                  <span className="oac-field-label">{t('policyGuard')}</span>
                  <select
                    className="oac-input oac-input-select"
                    value={String(form.memoryGuardLevel ?? 'strict')}
                    onChange={(event) => setForm((prev) => ({ ...prev, memoryGuardLevel: event.target.value }))}
                  >
                    <option value="strict">{t('policyGuardStrict')}</option>
                    <option value="standard">{t('policyGuardStandard')}</option>
                    <option value="relaxed">{t('policyGuardRelaxed')}</option>
                  </select>
                </label>
                <label className="oac-field">
                  <span className="oac-field-label">{t('policyMaxItems')}</span>
                  <input
                    className="oac-input"
                    type="number"
                    min={1}
                    max={60}
                    value={Number(form.memoryUserMemoriesMaxItems ?? 20)}
                    onChange={(event) => setForm((prev) => ({
                      ...prev,
                      memoryUserMemoriesMaxItems: Number(event.target.value),
                    }))}
                  />
                </label>
                <label className="oac-field">
                  <span className="oac-field-label">{t('policyMaxChars')}</span>
                  <input
                    className="oac-input"
                    type="number"
                    min={2000}
                    max={65536}
                    value={Number(form.memoryPromptMaxChars ?? 12000)}
                    onChange={(event) => setForm((prev) => ({
                      ...prev,
                      memoryPromptMaxChars: Number(event.target.value),
                    }))}
                  />
                </label>
              </div>
            </>
          ) : null}
          <div className="oac-form-actions">
            {note === 'saved' ? <span className="oac-note success">{t('policySaved')}</span> : null}
            {note === 'error' ? <span className="oac-note error">{t('policySaveFailed')}</span> : null}
            <Button type="button" variant="primary" onClick={() => void save()} disabled={note === 'saving'}>
              {note === 'saving' ? t('policySaving') : t('policySave')}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  )
}

/** Nightly memory-hygiene card (IDBots parity): last-run per-step counters,
 * editable retention config, and a manual run button. */
function HygieneCard({ from, t, hygieneStatus, hygieneRun, hygieneConfigSet }: {
  from: string
  t: Translate
  hygieneStatus: MemoryPanelInjected['hygieneStatus']
  hygieneRun: MemoryPanelInjected['hygieneRun']
  hygieneConfigSet: MemoryPanelInjected['hygieneConfigSet']
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<HygieneStatusPayload | null>(null)
  const [form, setForm] = useState<Record<string, unknown>>({})
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState<'done' | 'failed' | 'saved' | null>(null)

  useEffect(() => {
    let current = true
    void hygieneStatus(from).then(
      (result) => {
        if (!current) return
        setStatus(result)
        setForm(result.config ?? {})
      },
      () => { if (current) setStatus({}) },
    )
    return () => { current = false }
  }, [from, hygieneStatus])

  const lastRun = status?.lastRun ?? null
  const config = status?.config ?? {}

  const saveConfig = (): void => {
    setNote(null)
    void hygieneConfigSet(from, form).then(
      () => setNote('saved'),
      () => setNote('failed'),
    )
  }

  const runNow = (): void => {
    setRunning(true)
    setNote(null)
    void hygieneRun(from).then(
      () => setNote('done'),
      () => setNote('failed'),
    ).finally(() => {
      setRunning(false)
      void hygieneStatus(from).then((result) => setStatus(result))
    })
  }

  return (
    <section className="oac-section-card">
      <button type="button" className="oac-section-head oac-section-toggle" onClick={() => setOpen(!open)}>
        <div className="oac-section-text">
          <span className="oac-section-title">{t('hygieneTitle')}</span>
          <span className="oac-section-hint">
            {lastRun?.dateKey
              ? t('hygieneLastRun', { date: lastRun.dateKey }).replace('{date}', String(lastRun.dateKey))
                + (lastRun.trigger === 'manual' ? ` · ${t('hygieneTriggerManual')}` : '')
              : t('hygieneNever')}
          </span>
        </div>
        {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
      </button>
      {open ? (
        <>
          {lastRun ? (
            <div className="oac-hint">
              {Object.entries(lastRun.counts ?? {}).map(([step, count]) => `${step}: ${count}`).join(' · ')}
              {(lastRun.errors ?? []).length > 0 ? (
                <p className="oac-note error">{(lastRun.errors ?? []).join('; ')}</p>
              ) : null}
            </div>
          ) : null}
          <div className="oac-form">
            <label className="oac-field">
              <span className="oac-field-label">{t('hygieneConfigDecayDays')}</span>
              <input
                className="oac-input"
                type="number"
                min={14}
                max={3650}
                value={Number(form.memoryDecayDays ?? config.memoryDecayDays ?? 180)}
                onChange={(event) => setForm((prev) => ({ ...prev, memoryDecayDays: Number(event.target.value) }))}
              />
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('hygieneConfigRevisionKeep')}</span>
              <input
                className="oac-input"
                type="number"
                min={1}
                max={50}
                value={Number(form.knowledgeRevisionKeep ?? config.knowledgeRevisionKeep ?? 5)}
                onChange={(event) => setForm((prev) => ({ ...prev, knowledgeRevisionKeep: Number(event.target.value) }))}
              />
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('hygieneConfigRunRetention')}</span>
              <input
                className="oac-input"
                type="number"
                min={30}
                max={3650}
                value={Number(form.dreamRunRetentionDays ?? config.dreamRunRetentionDays ?? 90)}
                onChange={(event) => setForm((prev) => ({ ...prev, dreamRunRetentionDays: Number(event.target.value) }))}
              />
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('hygieneConfigDeep')}</span>
              <select
                className="oac-input oac-input-select"
                value={String(form.deepConsolidationEnabled ?? config.deepConsolidationEnabled ?? true)}
                onChange={(event) => setForm((prev) => ({
                  ...prev,
                  deepConsolidationEnabled: event.target.value === 'true',
                }))}
              >
                <option value="true">{t('hygieneDeepOn')}</option>
                <option value="false">{t('hygieneDeepOff')}</option>
              </select>
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('hygieneConfigInterval')}</span>
              <input
                className="oac-input"
                type="number"
                min={7}
                max={365}
                value={Number(form.deepConsolidationIntervalDays ?? config.deepConsolidationIntervalDays ?? 7)}
                onChange={(event) => setForm((prev) => ({
                  ...prev,
                  deepConsolidationIntervalDays: Number(event.target.value),
                }))}
              />
            </label>
          </div>
          <div className="oac-form-actions">
            {note === 'done' ? <span className="oac-note success">{t('hygieneRunDone')}</span> : null}
            {note === 'saved' ? <span className="oac-note success">{t('hygieneSaved')}</span> : null}
            {note === 'failed' ? <span className="oac-note error">{t('hygieneRunFailed')}</span> : null}
            <Button type="button" onClick={() => void saveConfig()}>{t('hygieneSave')}</Button>
            <Button type="button" variant="primary" disabled={running} onClick={runNow}>
              {running ? t('hygieneRunning') : t('hygieneRunNow')}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  )
}

function KnowledgeTab({ from, t, injected }: {
  from: string
  t: Translate
  injected: MemoryPanelInjected
}): ReactNode {
  const [entries, setEntries] = useState<KnowledgeRow[] | null>(null)
  const [kind, setKind] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<KnowledgeRow | null>(null)
  const [editForm, setEditForm] = useState({ topic: '', summary: '', kind: 'know_how' })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    void injected.knowledgeList(from, {
      status: 'all',
      ...(kind ? { kind } : {}),
      ...(query.trim() ? { query: query.trim() } : {}),
      limit: 100,
    }).then(
      (result) => { if (current) setEntries(result.entries ?? []) },
      () => { if (current) setEntries([]) },
    )
    return () => { current = false }
  }, [from, kind, query, tick, injected])

  return (
    <div className="oac-card-list">
      <div className="oac-row">
        <input
          className="oac-input"
          placeholder={t('knowledgeSearch')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="oac-input oac-input-select oac-memory-kind-select"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="">{t('knowledgeKindAll')}</option>
          <option value="know_how">{t('knowledgeKindKnowHow')}</option>
          <option value="pitfall">{t('knowledgeKindPitfall')}</option>
          <option value="principle">{t('knowledgeKindPrinciple')}</option>
        </select>
      </div>
      {entries === null ? <div className="oac-muted">{t('loading')}</div> : null}
      {entries?.length === 0 ? <div className="oac-muted">{t('knowledgeEmpty')}</div> : null}
      {(entries ?? []).map((entry) => (
        <div className="oac-card" key={entry.id} data-active={entry.status === 'active'}>
          <div className="oac-row">
            <strong>{entry.topic}</strong>
            <span className="oac-memory-badge">{entry.kind}{entry.version > 1 ? ` v${entry.version}` : ''}</span>
          </div>
          <p className="oac-note">{entry.summary}</p>
          <div className="oac-actions">
            <Button type="button" onClick={() => {
              setEditing(entry)
              setEditForm({ topic: entry.topic, summary: entry.summary, kind: entry.kind })
            }}>{t('knowledgeEdit')}</Button>
            {entry.status === 'active' ? (
              <Button type="button" onClick={() => {
                void injected.knowledgeArchive(from, entry.id).then(() => setTick((v) => v + 1))
              }}>{t('knowledgeArchive')}</Button>
            ) : null}
            <Button type="button" onClick={() => {
              if (window.confirm(t('knowledgeDeleteConfirm'))) {
                void injected.knowledgeDelete(from, entry.id).then(() => setTick((v) => v + 1))
              }
            }}>{t('knowledgeDelete')}</Button>
          </div>
        </div>
      ))}
      <Modal
        closeLabel={t('close')}
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t('knowledgeEdit')}
        className="oac-dialog"
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t('knowledgeCancel')}</Button>
            <Button type="button" variant="primary" onClick={() => {
              if (!editing) return
              void injected.knowledgeUpdate(from, { id: editing.id, ...editForm }).then(() => {
                setEditing(null)
                setTick((v) => v + 1)
              })
            }}>{t('knowledgeSave')}</Button>
          </>
        )}
      >
        <div className="oac-form">
          <label className="oac-field">
            <span className="oac-field-label">{t('knowledgeFieldTopic')}</span>
            <input className="oac-input" value={editForm.topic}
              onChange={(event) => setEditForm((prev) => ({ ...prev, topic: event.target.value }))} />
          </label>
          <label className="oac-field">
            <span className="oac-field-label">{t('knowledgeFieldSummary')}</span>
            <textarea className="oac-input" value={editForm.summary}
              onChange={(event) => setEditForm((prev) => ({ ...prev, summary: event.target.value }))} />
          </label>
          <label className="oac-field">
            <span className="oac-field-label">{t('knowledgeFieldKind')}</span>
            <select className="oac-input oac-input-select" value={editForm.kind}
              onChange={(event) => setEditForm((prev) => ({ ...prev, kind: event.target.value }))}>
              <option value="know_how">{t('knowledgeKindKnowHow')}</option>
              <option value="pitfall">{t('knowledgeKindPitfall')}</option>
              <option value="principle">{t('knowledgeKindPrinciple')}</option>
            </select>
          </label>
        </div>
      </Modal>
    </div>
  )
}

function ContactsTab({ from, t, injected }: {
  from: string
  t: Translate
  injected: MemoryPanelInjected
}): ReactNode {
  const [snapshots, setSnapshots] = useState<ImpressionSnapshotRow[] | null>(null)
  const [detail, setDetail] = useState<{
    snapshot: ImpressionSnapshotRow | null
    observations: ImpressionObservationRow[]
  } | null>(null)

  useEffect(() => {
    let current = true
    void injected.impressionsList(from).then(
      (result) => { if (current) setSnapshots(result.snapshots ?? []) },
      () => { if (current) setSnapshots([]) },
    )
    return () => { current = false }
  }, [from, injected])

  if (detail) {
    const snapshot = detail.snapshot
    return (
      <div className="oac-card-list">
        <div className="oac-row">
          <Button type="button" onClick={() => setDetail(null)}>{t('contactsBack')}</Button>
        </div>
        {snapshot ? (
          <div className="oac-card">
            <span className="oac-contact-name">{snapshot.subjectName?.trim() || abbreviateGlobalMetaId(snapshot.subjectGlobalMetaId)}</span>
            <span className="oac-contact-id" title={snapshot.subjectGlobalMetaId}>
              {abbreviateGlobalMetaId(snapshot.subjectGlobalMetaId)}
            </span>
            <span className="oac-section-title">{t('contactsSnapshot')}</span>
            <p className="oac-note">{snapshot.summaryText}</p>
            {snapshot.styleDescriptors.length > 0 ? (
              <p className="oac-hint">{t('contactsStyle')}: {snapshot.styleDescriptors.join(', ')}</p>
            ) : null}
            {snapshot.relationshipTemperature ? (
              <p className="oac-hint">{t('contactsTemperature')}: {snapshot.relationshipTemperature}</p>
            ) : null}
            {snapshot.communicationGuidance ? (
              <p className="oac-hint">{t('contactsGuidance')}: {snapshot.communicationGuidance}</p>
            ) : null}
            {snapshot.uncertaintyText ? (
              <p className="oac-hint">{t('contactsUncertainty')}: {snapshot.uncertaintyText}</p>
            ) : null}
          </div>
        ) : null}
        <span className="oac-section-title">{t('contactsObservations')}</span>
        {detail.observations.map((observation) => (
          <div className="oac-card" key={observation.id} data-active={observation.status === 'active'}>
            <p className="oac-note">{observation.observationText}</p>
            <p className="oac-hint">{observation.interpretationText}</p>
            <span className="oac-memory-badge">{observation.dreamDate} · {observation.status}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="oac-card-list">
      {snapshots === null ? <div className="oac-muted">{t('loading')}</div> : null}
      {snapshots?.length === 0 ? <div className="oac-muted">{t('contactsEmpty')}</div> : null}
      {(snapshots ?? []).map((snapshot) => (
        <button
          type="button"
          className="oac-card oac-memory-contact"
          key={snapshot.subjectGlobalMetaId}
          onClick={() => {
            void injected.impressionsShow(from, snapshot.subjectGlobalMetaId).then((result) => {
              setDetail({
                snapshot: result.snapshot ?? null,
                observations: result.observations ?? [],
              })
            })
          }}
        >
          <span className="oac-contact-name">{snapshot.subjectName?.trim() || abbreviateGlobalMetaId(snapshot.subjectGlobalMetaId)}</span>
          {snapshot.subjectName?.trim() ? (
            <span className="oac-contact-id" title={snapshot.subjectGlobalMetaId}>
              {abbreviateGlobalMetaId(snapshot.subjectGlobalMetaId)}
            </span>
          ) : null}
          <span className="oac-hint">
            {snapshot.interactionCount} {t('contactsInteractions')}
          </span>
          <p className="oac-note">{snapshot.summaryText}</p>
        </button>
      ))}
    </div>
  )
}

function FactsTab({ from, t, injected }: {
  from: string
  t: Translate
  injected: MemoryPanelInjected
}): ReactNode {
  const [entries, setEntries] = useState<MemoryEntryRow[] | null>(null)
  const [stats, setStats] = useState<{ total: number; created: number; stale: number } | null>(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [addText, setAddText] = useState('')
  const [addUsageClass, setAddUsageClass] = useState<string>('profile_fact')
  const [editing, setEditing] = useState<MemoryEntryRow | null>(null)
  const [editText, setEditText] = useState('')
  const [editUsageClass, setEditUsageClass] = useState<string>('profile_fact')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    void Promise.all([
      // includeArchived pulls the hygiene-soft-archived rows too; they render
      // in a separate restorable section below (IDBots Facts-tab parity).
      injected.memoryList(from, { limit: 100, includeArchived: true, ...(query.trim() ? { query: query.trim() } : {}) }),
      injected.memoryStats(from).catch(() => null),
    ]).then(([list, statsResult]) => {
      if (!current) return
      setEntries(list.entries ?? [])
      setStats(statsResult?.stats ?? null)
    })
    return () => { current = false }
  }, [from, query, tick, injected])

  const activeEntries = useMemo(
    () => (entries ?? []).filter((entry) => !entry.archivedAt),
    [entries],
  )
  const archivedEntries = useMemo(
    () => (entries ?? []).filter((entry) => Boolean(entry.archivedAt)),
    [entries],
  )

  return (
    <div className="oac-card-list">
      <div className="oac-row">
        <input
          className="oac-input"
          placeholder={t('factsSearch')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="button" variant="primary" className="oac-memory-add-btn" icon={<IconPlusOutline16 />} onClick={() => setAdding(true)}>
          {t('factsAdd')}
        </Button>
      </div>
      {stats ? (
        <p className="oac-hint">
          {t('factsStats', { total: stats.total, created: stats.created, stale: stats.stale })
            .replace('{total}', String(stats.total))
            .replace('{created}', String(stats.created))
            .replace('{stale}', String(stats.stale))}
        </p>
      ) : null}
      {entries === null ? <div className="oac-muted">{t('loading')}</div> : null}
      {entries?.length === 0 ? <div className="oac-muted">{t('factsEmpty')}</div> : null}
      {activeEntries.map((entry) => (
        <div className="oac-card" key={entry.id} data-active={entry.status === 'created'}>
          <p className="oac-note">{entry.text}</p>
          <div className="oac-row">
            <span className="oac-memory-badge">
              {usageClassLabel(t, entry.usageClass)} · {entry.origin}{entry.status !== 'created' ? ` · ${entry.status}` : ''}
            </span>
            {entry.usageClass !== 'self_identity' ? (
              <div className="oac-actions">
                <Button type="button" onClick={() => {
                  setEditing(entry)
                  setEditText(entry.text)
                  setEditUsageClass(USAGE_CLASS_LABEL_KEY[entry.usageClass] ? entry.usageClass : 'profile_fact')
                }}>
                  {t('factsEdit')}
                </Button>
                <Button type="button" onClick={() => {
                  if (window.confirm(t('factsDeleteConfirm'))) {
                    void injected.memoryDelete(from, entry.id).then(() => setTick((v) => v + 1))
                  }
                }}>{t('factsDelete')}</Button>
              </div>
            ) : (
              <span className="oac-hint">{t('factsProtected')}</span>
            )}
          </div>
        </div>
      ))}
      {archivedEntries.length > 0 ? (
        <div className="oac-card">
          <span className="oac-section-title">{t('factsArchived')}</span>
          <span className="oac-hint">{t('factsArchivedHint')}</span>
          {archivedEntries.map((entry) => (
            <div className="oac-note oac-memory-run-row" key={entry.id}>
              <span>{entry.text}</span>
              <Button type="button" onClick={() => {
                void injected.memoryUnarchive(from, entry.id).then(() => setTick((v) => v + 1))
              }}>{t('factsRestore')}</Button>
            </div>
          ))}
        </div>
      ) : null}
      <Modal
        closeLabel={t('close')}
        open={adding}
        onClose={() => setAdding(false)}
        title={t('factsAdd')}
        className="oac-dialog"
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>{t('factsCancel')}</Button>
            <Button type="button" variant="primary" disabled={!addText.trim()} onClick={() => {
              void injected.memoryAdd(from, { text: addText.trim(), isExplicit: true, usageClass: addUsageClass }).then(() => {
                setAdding(false)
                setAddText('')
                setTick((v) => v + 1)
              })
            }}>{t('factsSave')}</Button>
          </>
        )}
      >
        <div className="oac-form">
          <label className="oac-field">
            <span className="oac-field-label">{t('factsFieldText')}</span>
            <textarea className="oac-input" value={addText}
              onChange={(event) => setAddText(event.target.value)} />
          </label>
          <label className="oac-field">
            <span className="oac-field-label">{t('factsFieldClass')}</span>
            <select className="oac-input oac-input-select" value={addUsageClass}
              onChange={(event) => setAddUsageClass(event.target.value)}>
              {USAGE_CLASSES.map((value) => (
                <option key={value} value={value}>{usageClassLabel(t, value)}</option>
              ))}
            </select>
          </label>
        </div>
      </Modal>
      <Modal
        closeLabel={t('close')}
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t('factsEdit')}
        className="oac-dialog"
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t('factsCancel')}</Button>
            <Button type="button" variant="primary" disabled={!editText.trim()} onClick={() => {
              if (!editing) return
              void injected.memoryUpdate(from, { id: editing.id, text: editText.trim(), usageClass: editUsageClass }).then(() => {
                setEditing(null)
                setTick((v) => v + 1)
              })
            }}>{t('factsSave')}</Button>
          </>
        )}
      >
        <div className="oac-form">
          <label className="oac-field">
            <span className="oac-field-label">{t('factsFieldText')}</span>
            <textarea className="oac-input" value={editText}
              onChange={(event) => setEditText(event.target.value)} />
          </label>
          <label className="oac-field">
            <span className="oac-field-label">{t('factsFieldClass')}</span>
            <select className="oac-input oac-input-select" value={editUsageClass}
              onChange={(event) => setEditUsageClass(event.target.value)}>
              {USAGE_CLASSES.map((value) => (
                <option key={value} value={value}>{usageClassLabel(t, value)}</option>
              ))}
            </select>
          </label>
        </div>
      </Modal>
    </div>
  )
}

function DreamTab({ from, t, injected, onDone, bot }: {
  from: string
  t: Translate
  injected: MemoryPanelInjected
  onDone: () => void
  bot?: BotRow
}): ReactNode {
  const [summaries, setSummaries] = useState<DreamSummaryRow[] | null>(null)
  const [status, setStatus] = useState<DreamStatusPayload | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [runDate, setRunDate] = useState(yesterdayLocal())
  const [running, setRunning] = useState(false)
  const [rowRunning, setRowRunning] = useState<string | null>(null)
  const [runNote, setRunNote] = useState<'done' | 'failed' | null>(null)
  const [tick, setTick] = useState(0)

  /** Per-row 立即重试 for a failed date (IDBots parity): manual runs bypass
   * the retry backoff, so a wedged date can be forced right now. */
  const retryDate = (date: string): void => {
    setRowRunning(date)
    setRunNote(null)
    void injected.dreamRun(from, date).then(
      () => setRunNote('done'),
      () => setRunNote('failed'),
    ).finally(() => {
      setRowRunning(null)
      setTick((v) => v + 1)
      onDone()
    })
  }

  useEffect(() => {
    let current = true
    void Promise.all([
      injected.dreamSummaries(from, 30),
      injected.dreamStatus(from).catch(() => ({ runs: [] })),
    ]).then(([summariesResult, statusResult]) => {
      if (!current) return
      setSummaries(summariesResult.summaries ?? [])
      setStatus(statusResult)
    })
    return () => { current = false }
  }, [from, tick, injected])

  const runs = useMemo(() => status?.runs ?? [], [status])
  const summaryDates = useMemo(
    () => new Set((summaries ?? []).map((summary) => summary.summaryDate)),
    [summaries],
  )
  const statusLine = useMemo(() => {
    if (!status) return ''
    const summaryCount = status.summaryCount ?? 0
    return [
      t('dreamStatusSummary', { count: summaryCount }).replace('{count}', String(summaryCount)),
      status.latestSummaryDate
        ? t('dreamStatusLatest', { date: status.latestSummaryDate }).replace('{date}', status.latestSummaryDate)
        : null,
      status.hasSelfIdentity ? t('dreamStatusIdentity') : t('dreamStatusNoIdentity'),
    ].filter((part): part is string => Boolean(part)).join(' · ')
  }, [status, t])

  return (
    <div className="oac-card-list">
      {bot && !(bot.dshLlmProvider && bot.dshLlmModel) ? (
        <p className="oac-note warn">{t('dreamNoLlmHint')}</p>
      ) : null}
      <div className="oac-row">
        <label className="oac-field oac-memory-dream-date">
          <span className="oac-field-label">{t('dreamRunDate')}</span>
          <input
            className="oac-input"
            type="date"
            value={runDate}
            onChange={(event) => setRunDate(event.target.value)}
          />
        </label>
        <Button
          type="button"
          variant="primary"
          disabled={running || !runDate}
          onClick={() => {
            setRunning(true)
            setRunNote(null)
            void injected.dreamRun(from, runDate).then(
              () => setRunNote('done'),
              () => setRunNote('failed'),
            ).finally(() => {
              setRunning(false)
              setTick((v) => v + 1)
              onDone()
            })
          }}
        >
          {running ? t('dreamRunning') : t('dreamRunNow')}
        </Button>
      </div>
      {runNote === 'done' ? <span className="oac-note success">{t('dreamRunDone')}</span> : null}
      {runNote === 'failed' ? <span className="oac-note error">{t('dreamRunFailed')}</span> : null}
      {statusLine ? <p className="oac-hint">{statusLine}</p> : null}
      {runs.length > 0 ? (
        <div className="oac-card">
          <span className="oac-section-title">{t('dreamRuns')}</span>
          {runs.slice(0, 10).map((run) => (
            <div className={`oac-note oac-memory-run-row${run.status === 'failed' ? ' error' : ''}`} key={run.dreamDate}>
              <span>
                {run.dreamDate} · {dreamRunStatusLabel(t, run.status)}
                {` · ${t('dreamRunAttempts', { count: run.attemptCount }).replace('{count}', String(run.attemptCount))}`}
                {run.status === 'completed' && !summaryDates.has(run.dreamDate) ? ` · ${t('dreamQuietDay')}` : ''}
                {run.status === 'failed' && run.error ? ` · ${run.error}` : ''}
                {run.status === 'failed' && typeof run.nextRetryAt === 'number' && run.nextRetryAt > Date.now()
                  ? ` · ${t('dreamNextRetry', { time: untilLabel(run.nextRetryAt) }).replace('{time}', untilLabel(run.nextRetryAt))}`
                  : ''}
              </span>
              {run.status === 'failed' ? (
                <Button
                  type="button"
                  disabled={running || rowRunning !== null}
                  onClick={() => retryDate(run.dreamDate)}
                >
                  {rowRunning === run.dreamDate ? t('dreamRunning') : t('dreamRetryNow')}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {summaries === null ? <div className="oac-muted">{t('loading')}</div> : null}
      {summaries?.length === 0 ? <div className="oac-muted">{t('dreamEmpty')}</div> : null}
      {(summaries ?? []).map((summary) => (
        <div className="oac-card" key={summary.summaryDate}>
          <button
            type="button"
            className="oac-memory-diary-head"
            onClick={() => setExpanded((current) => current === summary.summaryDate ? null : summary.summaryDate)}
          >
            <strong>{summary.summaryDate}</strong>
            <span className="oac-hint">
              {t('dreamStats', {
                sessions: summary.stats.sessionCount ?? 0,
                messages: summary.stats.messageCount ?? 0,
              })
                .replace('{sessions}', String(summary.stats.sessionCount ?? 0))
                .replace('{messages}', String(summary.stats.messageCount ?? 0))}
            </span>
          </button>
          {expanded === summary.summaryDate ? (
            <>
              <p className="oac-memory-diary-text">{summary.summaryText}</p>
              {Object.keys(summary.sections).length > 0 ? (
                <div className="oac-memory-diary-sections">
                  <span className="oac-section-title">{t('dreamSections')}</span>
                  {Object.entries(summary.sections).map(([key, value]) => (
                    <p className="oac-note" key={key}><strong>{key}</strong>: {value}</p>
                  ))}
                </div>
              ) : null}
              {summary.sessionRefs.length > 0 ? (
                <p className="oac-hint">
                  {t('dreamSessions')}: {summary.sessionRefs.map((ref) => ref.sessionId).join(', ')}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}
