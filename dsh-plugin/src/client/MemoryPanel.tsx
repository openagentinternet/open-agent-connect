import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Button,
  IconChevronDownSmallOutline16,
  IconChevronRightOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  BotRow,
  DreamRunRow,
  DreamSummaryRow,
  ImpressionObservationRow,
  ImpressionSnapshotRow,
  KnowledgeRow,
  MemoryEntryRow,
  MemoryPolicyPayload,
} from './api.ts'
import type { MemoryLocaleKey } from './locale-memory.ts'

type Translate = (key: MemoryLocaleKey, vars?: Record<string, string | number>) => string

export interface MemoryPanelInjected {
  bots: () => Promise<BotRow[]>
  twinCurrent: () => Promise<{ twinSlug?: string | null }>
  memoryList: (from: string, options?: Record<string, unknown>) => Promise<{ entries?: MemoryEntryRow[] }>
  memoryAdd: (from: string, entry: Record<string, unknown>) => Promise<unknown>
  memoryUpdate: (from: string, entry: Record<string, unknown>) => Promise<unknown>
  memoryDelete: (from: string, id: string) => Promise<unknown>
  memoryStats: (from: string) => Promise<{ stats?: { total: number; created: number; stale: number } }>
  memoryPolicyGet: (from: string) => Promise<MemoryPolicyPayload>
  memoryPolicySet: (from: string, patch: Record<string, unknown>) => Promise<unknown>
  memoryPolicyDelete: (from: string) => Promise<unknown>
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
  dreamStatus: (from: string) => Promise<{ runs?: DreamRunRow[] }>
  dreamSelfIdentity: (from: string) => Promise<{ text?: string }>
  dreamRun: (from: string, date: string) => Promise<unknown>
}

type TabKey = 'knowledge' | 'contacts' | 'facts' | 'dream'

const USAGE_CLASSES = [
  'profile_fact',
  'preference',
  'operational_preference',
  'work_review',
  'value_boundary',
] as const

function yesterdayLocal(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
              <DreamTab key={`d-${slug}-${tick}`} from={slug} t={t} injected={injected} onDone={reload} />
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
          {open ? <IconChevronDownSmallOutline16 /> : <IconChevronRightOutline16 />}
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
          <span className="oac-mono">{snapshot.subjectGlobalMetaId}</span>
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
  const [editing, setEditing] = useState<MemoryEntryRow | null>(null)
  const [editText, setEditText] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    void Promise.all([
      injected.memoryList(from, { limit: 100, ...(query.trim() ? { query: query.trim() } : {}) }),
      injected.memoryStats(from).catch(() => null),
    ]).then(([list, statsResult]) => {
      if (!current) return
      setEntries(list.entries ?? [])
      setStats(statsResult?.stats ?? null)
    })
    return () => { current = false }
  }, [from, query, tick, injected])

  return (
    <div className="oac-card-list">
      <div className="oac-row">
        <input
          className="oac-input"
          placeholder={t('factsSearch')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="button" variant="primary" icon={<IconPlusOutline16 />} onClick={() => setAdding(true)}>
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
      {(entries ?? []).map((entry) => (
        <div className="oac-card" key={entry.id} data-active={entry.status === 'created'}>
          <p className="oac-note">{entry.text}</p>
          <div className="oac-row">
            <span className="oac-memory-badge">
              {entry.usageClass} · {entry.origin}{entry.status !== 'created' ? ` · ${entry.status}` : ''}
            </span>
            {entry.usageClass !== 'self_identity' ? (
              <div className="oac-actions">
                <Button type="button" onClick={() => { setEditing(entry); setEditText(entry.text) }}>
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
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title={t('factsAdd')}
        className="oac-dialog"
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>{t('factsCancel')}</Button>
            <Button type="button" variant="primary" disabled={!addText.trim()} onClick={() => {
              void injected.memoryAdd(from, { text: addText.trim(), isExplicit: true }).then(() => {
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
        </div>
      </Modal>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t('factsEdit')}
        className="oac-dialog"
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t('factsCancel')}</Button>
            <Button type="button" variant="primary" disabled={!editText.trim()} onClick={() => {
              if (!editing) return
              void injected.memoryUpdate(from, { id: editing.id, text: editText.trim() }).then(() => {
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
        </div>
      </Modal>
    </div>
  )
}

function DreamTab({ from, t, injected, onDone }: {
  from: string
  t: Translate
  injected: MemoryPanelInjected
  onDone: () => void
}): ReactNode {
  const [summaries, setSummaries] = useState<DreamSummaryRow[] | null>(null)
  const [runs, setRuns] = useState<DreamRunRow[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [runDate, setRunDate] = useState(yesterdayLocal())
  const [running, setRunning] = useState(false)
  const [runNote, setRunNote] = useState<'done' | 'failed' | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    void Promise.all([
      injected.dreamSummaries(from, 30),
      injected.dreamStatus(from).catch(() => ({ runs: [] })),
    ]).then(([summariesResult, statusResult]) => {
      if (!current) return
      setSummaries(summariesResult.summaries ?? [])
      setRuns(statusResult.runs ?? [])
    })
    return () => { current = false }
  }, [from, tick, injected])

  const failedRuns = useMemo(() => runs.filter((run) => run.status === 'failed'), [runs])

  return (
    <div className="oac-card-list">
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
      {failedRuns.length > 0 ? (
        <div className="oac-card">
          <span className="oac-section-title">{t('dreamRuns')}</span>
          {failedRuns.slice(0, 5).map((run) => (
            <p className="oac-note error" key={run.dreamDate}>
              {run.dreamDate} · {t('dreamRunStatus')}: {run.status}{run.error ? ` · ${run.error}` : ''}
            </p>
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
