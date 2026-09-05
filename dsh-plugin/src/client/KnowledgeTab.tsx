/**
 * Bot editor Knowledge tab — DSH port of IDBots' KnowledgeBasePanel +
 * MetawebStudyJobsPanel (same card structure, same copy). Electron-only bits
 * are adapted to the web host: the source-directory picker and "open
 * directory" run through the plugin's own host routes (osascript/zenity on
 * the host machine, the same mechanism as the DSH native directory picker),
 * and file import uses a browser file input over the raw kb/import route.
 *
 * Manages this Bot's document corpora as cards: create (name + description +
 * optional external source directory), inline edit, auto-learn toggle,
 * manual/incremental learn with the learn summary, from-scratch relearn under
 * an Advanced disclosure, file import, delete (never the default KB). No
 * manual document typing — agents and file import feed the corpus. The
 * read-only study-jobs panel sits below (topics are assigned in chat).
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import {
  kbBrowseDir,
  kbCreate,
  kbImport,
  kbLearn,
  kbList,
  kbOpenDir,
  kbRemove,
  kbUpdate,
  studyList,
  type KbLearnSummary,
  type KbRecord,
  type StudyJob,
} from './api.ts'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

/** Keep in sync with SUPPORTED_KB_EXTENSIONS in the OAC core text pipeline. */
const KB_IMPORT_FILE_EXTENSIONS = [
  '.md', '.markdown', '.txt', '.json', '.csv', '.tsv', '.yaml', '.yml',
  '.xml', '.log', '.rst', '.pdf', '.docx', '.pptx', '.xlsx', '.xls',
  '.html', '.htm', '.epub',
]
const NOTICE_AUTO_CLEAR_MS = 10_000

type Notice = { kind: 'success' | 'error'; text: string }

const STUDY_STATUS_KEYS: Record<string, BotsLocaleKey> = {
  pending: 'kbStatusPending',
  running: 'kbStatusRunning',
  done: 'kbStatusDone',
  failed: 'kbStatusFailed',
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  let text = template
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

function formatLastLearnedAt(t: Translate, value: number | null): string {
  if (!value) return t('kbNeverLearned')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('kbNeverLearned')
  return interpolate(t('kbLastLearned'), { time: date.toLocaleString() })
}

function formatRunAt(t: Translate, value: number | null): string {
  if (!value) return t('kbStudyNever')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('kbStudyNever')
  return interpolate(t('kbStudyLastRun'), { time: date.toLocaleString() })
}

export function KnowledgeTab({ bot, t }: { bot: { slug: string }; t: Translate }): ReactNode {
  const [kbs, setKbs] = useState<KbRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [panelError, setPanelError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createRawDir, setCreateRawDir] = useState('')
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState('')
  const [learningIds, setLearningIds] = useState<ReadonlySet<string>>(new Set())
  const [importingIds, setImportingIds] = useState<ReadonlySet<string>>(new Set())
  const [autoLearnSavingIds, setAutoLearnSavingIds] = useState<ReadonlySet<string>>(new Set())
  const [browsing, setBrowsing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editError, setEditError] = useState('')
  const [notices, setNotices] = useState<Record<string, Notice>>({})
  const [jobs, setJobs] = useState<StudyJob[]>([])
  const [jobsLoaded, setJobsLoaded] = useState(false)
  const [jobsError, setJobsError] = useState('')
  const noticeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const importTargetRef = useRef<string | null>(null)

  const showNotice = useCallback((kbId: string, notice: Notice) => {
    setNotices((prev) => ({ ...prev, [kbId]: notice }))
    const timers = noticeTimersRef.current
    const existing = timers.get(kbId)
    if (existing) clearTimeout(existing)
    timers.set(kbId, setTimeout(() => {
      timers.delete(kbId)
      setNotices((prev) => {
        const next = { ...prev }
        delete next[kbId]
        return next
      })
    }, NOTICE_AUTO_CLEAR_MS))
  }, [])

  const loadKbs = useCallback((slug: string) => {
    void kbList(slug).then((rows) => {
      setKbs(rows)
      setPanelError('')
      setLoaded(true)
    }).catch((cause) => {
      setPanelError(errorText(cause) || t('kbLoadFailed'))
      setLoaded(true)
    })
  }, [t])

  const loadJobs = useCallback((slug: string) => {
    void studyList(slug).then((rows) => {
      setJobs(rows)
      setJobsError('')
      setJobsLoaded(true)
    }).catch((cause) => {
      setJobsError(errorText(cause) || t('kbStudyLoadFailed'))
      setJobsLoaded(true)
    })
  }, [t])

  useEffect(() => {
    setKbs([])
    setLoaded(false)
    setPanelError('')
    setCreateOpen(false)
    setCreateError('')
    setEditingId(null)
    setNotices({})
    loadKbs(bot.slug)
    setJobs([])
    setJobsLoaded(false)
    loadJobs(bot.slug)
  }, [bot.slug, loadKbs, loadJobs, t])

  useEffect(() => {
    const timers = noticeTimersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const handleBrowseSourceDir = async (): Promise<void> => {
    if (browsing) return
    setBrowsing(true)
    try {
      const picked = await kbBrowseDir()
      if (picked !== null) setCreateRawDir(picked)
    } catch (cause) {
      setCreateError(errorText(cause))
    } finally {
      setBrowsing(false)
    }
  }

  const handleCreate = async (): Promise<void> => {
    const name = createName.trim()
    const description = createDescription.trim()
    if (!name) {
      setCreateError(t('kbNameRequired'))
      return
    }
    if (!description) {
      setCreateError(t('kbDescriptionRequired'))
      return
    }
    setCreateSaving(true)
    setCreateError('')
    try {
      await kbCreate(bot.slug, name, description, createRawDir.trim() || undefined)
      setCreateOpen(false)
      setCreateName('')
      setCreateDescription('')
      setCreateRawDir('')
      loadKbs(bot.slug)
    } catch (cause) {
      setCreateError(errorText(cause) || t('kbCreateFailed'))
    } finally {
      setCreateSaving(false)
    }
  }

  const handleToggleAutoLearn = (kb: KbRecord): void => {
    if (autoLearnSavingIds.has(kb.id)) return
    setAutoLearnSavingIds((prev) => new Set(prev).add(kb.id))
    void kbUpdate(bot.slug, kb.id, { autoLearn: !kb.autoLearn })
      .then(() => loadKbs(bot.slug))
      .catch((cause) => showNotice(kb.id, { kind: 'error', text: errorText(cause) || t('kbUpdateFailed') }))
      .finally(() => {
        setAutoLearnSavingIds((prev) => {
          const next = new Set(prev)
          next.delete(kb.id)
          return next
        })
      })
  }

  const handleLearn = (kb: KbRecord, full: boolean): void => {
    if (learningIds.has(kb.id)) return
    if (full && !window.confirm(interpolate(t('kbRelearnFullConfirm'), { name: kb.name }))) return
    setLearningIds((prev) => new Set(prev).add(kb.id))
    void kbLearn(bot.slug, kb.id, full)
      .then((summary) => {
        loadKbs(bot.slug)
        showNotice(kb.id, {
          kind: 'success',
          text: summary
            ? interpolate(t('kbLearnSummary'), summary)
            : t('kbLearnNow'),
        })
      })
      .catch((cause) => showNotice(kb.id, { kind: 'error', text: errorText(cause) || t('kbLearnFailed') }))
      .finally(() => {
        setLearningIds((prev) => {
          const next = new Set(prev)
          next.delete(kb.id)
          return next
        })
      })
  }

  const handleOpenDir = (kb: KbRecord): void => {
    void kbOpenDir(bot.slug, kb.id)
      .catch((cause) => showNotice(kb.id, { kind: 'error', text: errorText(cause) || t('kbOpenDirFailed') }))
  }

  const handleImportPicked = (kb: KbRecord, event: ChangeEvent<HTMLInputElement>): void => {
    const picked = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!picked.length || importingIds.has(kb.id)) return
    setImportingIds((prev) => new Set(prev).add(kb.id))
    void (async () => {
      let imported = 0
      let firstError = ''
      for (const file of picked) {
        try {
          imported += await kbImport(bot.slug, kb.id, file)
        } catch (cause) {
          if (!firstError) firstError = errorText(cause)
        }
      }
      const skipped = picked.length - imported
      showNotice(kb.id, {
        kind: imported > 0 ? 'success' : 'error',
        text: imported > 0
          ? interpolate(t('kbImportResult'), { imported, skipped })
          : firstError || t('kbImportFailed'),
      })
      loadKbs(bot.slug)
    })().finally(() => {
      setImportingIds((prev) => {
        const next = new Set(prev)
        next.delete(kb.id)
        return next
      })
    })
  }

  const handleSaveEdit = (kb: KbRecord): void => {
    const name = editName.trim()
    const description = editDescription.trim()
    if (!name) {
      setEditError(t('kbNameRequired'))
      return
    }
    if (!description) {
      setEditError(t('kbDescriptionRequired'))
      return
    }
    void kbUpdate(bot.slug, kb.id, { name, description })
      .then(() => {
        setEditingId(null)
        loadKbs(bot.slug)
      })
      .catch((cause) => setEditError(errorText(cause) || t('kbUpdateFailed')))
  }

  const handleRemove = (kb: KbRecord): void => {
    if (kb.isDefault) return
    if (!window.confirm(interpolate(t('kbDeleteConfirm'), { name: kb.name }))) return
    void kbRemove(bot.slug, kb.id)
      .then(() => loadKbs(bot.slug))
      .catch((cause) => showNotice(kb.id, { kind: 'error', text: errorText(cause) || t('kbDeleteFailed') }))
  }

  const renderCard = (kb: KbRecord): ReactNode => {
    const learning = learningIds.has(kb.id)
    const importing = importingIds.has(kb.id)
    const autoLearnSaving = autoLearnSavingIds.has(kb.id)
    const editing = editingId === kb.id
    const notice = notices[kb.id]
    return (
      <div key={kb.id} className="oac-kb-card" data-slot={`knowledge-base-card-${kb.id}`}>
        <div className="oac-kb-row-head">
          <div className="oac-kb-name-row">
            <span className="oac-kb-name" title={kb.name}>{kb.name}</span>
            {kb.isDefault ? <span className="oac-kb-badge">{t('kbDefaultBadge')}</span> : null}
          </div>
          <div className="oac-kb-row" style={{ flexWrap: 'nowrap' }}>
            <span className="oac-kb-hint">{t('kbAutoLearn')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={kb.autoLearn}
              aria-label={t('kbAutoLearn')}
              title={t('kbAutoLearnHint')}
              data-slot={`knowledge-base-auto-learn-${kb.id}`}
              className="oac-kb-toggle"
              data-on={kb.autoLearn ? 'true' : 'false'}
              disabled={autoLearnSaving}
              onClick={() => handleToggleAutoLearn(kb)}
            >
              <span className="oac-kb-toggle-knob" />
            </button>
          </div>
        </div>
        {!editing && kb.description ? <p className="oac-kb-desc">{kb.description}</p> : null}
        <p className="oac-kb-path" title={kb.rawDir}>{kb.rawDir}</p>
        <p className="oac-kb-stats">
          {`${interpolate(t('kbStatsDocs'), { count: kb.docCount })} · ${interpolate(t('kbStatsChunks'), { count: kb.chunkCount })} · ${formatLastLearnedAt(t, kb.lastLearnedAt)}`}
        </p>

        {notice ? <div className="oac-kb-notice" data-kind={notice.kind}>{notice.text}</div> : null}

        {editing ? (
          <div className="oac-kb-card" style={{ padding: 0, border: 'none', gap: 8 }} data-slot={`knowledge-base-edit-form-${kb.id}`}>
            <Input
              value={editName}
              placeholder={t('kbNamePlaceholder')}
              onChange={(event) => setEditName(event.target.value)}
            />
            <textarea
              className="oac-input"
              rows={2}
              value={editDescription}
              placeholder={t('kbDescriptionPlaceholder')}
              onChange={(event) => setEditDescription(event.target.value)}
            />
            {editError ? <div className="oac-kb-error">{editError}</div> : null}
            <div className="oac-kb-row" style={{ justifyContent: 'flex-end' }}>
              <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
                {t('cancel')}
              </Button>
              <Button type="button" variant="primary" onClick={() => handleSaveEdit(kb)}>
                {t('save')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="oac-kb-row">
            <Button
              type="button"
              variant="outline"
              disabled={learning}
              onClick={() => handleLearn(kb, false)}
            >
              {learning ? t('kbLearning') : t('kbLearnNow')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={learning}
              onClick={() => handleOpenDir(kb)}
            >
              {t('kbOpenDir')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={importing || learning}
              onClick={() => {
                importTargetRef.current = kb.id
                importInputRef.current?.click()
              }}
            >
              {importing ? t('kbImporting') : t('kbImportFiles')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={learning}
              onClick={() => {
                setEditingId(kb.id)
                setEditName(kb.name)
                setEditDescription(kb.description)
                setEditError('')
              }}
            >
              {t('kbEdit')}
            </Button>
            {!kb.isDefault ? (
              <Button
                type="button"
                variant="outline"
                className="oac-kb-danger-btn"
                disabled={learning}
                onClick={() => handleRemove(kb)}
              >
                {t('kbDelete')}
              </Button>
            ) : null}
          </div>
        )}

        <details className="oac-kb-advanced" data-slot={`knowledge-base-advanced-${kb.id}`}>
          <summary>{t('kbAdvancedToggle')}</summary>
          <div className="oac-kb-adv-row">
            <p className="oac-kb-hint">{t('kbRelearnFullHint')}</p>
            <Button
              type="button"
              variant="outline"
              className="oac-kb-danger-btn"
              disabled={learning}
              onClick={() => handleLearn(kb, true)}
            >
              {learning ? t('kbLearning') : t('kbRelearnFull')}
            </Button>
          </div>
        </details>
      </div>
    )
  }

  return (
    <div id="oac-editor-panel-knowledge" role="tabpanel" className="oac-tab-panel">
      <div className="oac-form">
        <div className="oac-kb-row" style={{ justifyContent: 'space-between' }}>
          <p className="oac-kb-hint">{t('kbPanelHint')}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setCreateOpen((prev) => !prev)
              setCreateError('')
            }}
          >
            {createOpen ? t('cancel') : t('kbCreate')}
          </Button>
        </div>
        <p className="oac-kb-hint">{interpolate(t('kbFormatsHint'), { formats: KB_IMPORT_FILE_EXTENSIONS.join(' ') })}</p>

        {panelError ? <div className="oac-kb-error">{panelError}</div> : null}

        {createOpen ? (
          <div className="oac-kb-card" data-slot="knowledge-base-create-form">
            <label className="oac-field">
              <span className="oac-field-label">{t('kbNameLabel')}</span>
              <Input
                value={createName}
                placeholder={t('kbNamePlaceholder')}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('kbDescriptionLabel')}</span>
              <textarea
                className="oac-input"
                rows={2}
                value={createDescription}
                placeholder={t('kbDescriptionPlaceholder')}
                onChange={(event) => setCreateDescription(event.target.value)}
              />
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('kbRawDirLabel')}</span>
              <div className="oac-kb-row" style={{ flexWrap: 'nowrap' }}>
                <Input
                  value={createRawDir}
                  readOnly
                  placeholder={t('kbRawDirPlaceholder')}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={browsing}
                  onClick={() => void handleBrowseSourceDir()}
                >
                  {browsing ? t('kbLearning') : t('kbBrowse')}
                </Button>
                {createRawDir ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="oac-kb-danger-btn"
                    onClick={() => setCreateRawDir('')}
                  >
                    {t('kbClear')}
                  </Button>
                ) : null}
              </div>
              <span className="oac-field-label" style={{ fontWeight: 400 }}>{t('kbRawDirHint')}</span>
            </label>
            {createError ? <div className="oac-kb-error">{createError}</div> : null}
            <div className="oac-kb-row" style={{ justifyContent: 'flex-end' }}>
              <Button
                type="button"
                variant="outline"
                disabled={createSaving}
                onClick={() => {
                  setCreateOpen(false)
                  setCreateError('')
                }}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={createSaving}
                onClick={() => void handleCreate()}
              >
                {createSaving ? t('saving') : t('kbCreate')}
              </Button>
            </div>
          </div>
        ) : null}

        {loaded && !panelError && kbs.length === 0 ? (
          <p className="oac-kb-hint">{t('kbEmpty')}</p>
        ) : (
          kbs.map(renderCard)
        )}

        {/* Hidden multi-file picker driving the raw kb/import upload. */}
        <input
          ref={importInputRef}
          type="file"
          multiple
          accept={KB_IMPORT_FILE_EXTENSIONS.join(',')}
          style={{ display: 'none' }}
          onChange={(event) => {
            const kbId = importTargetRef.current
            const kb = kbs.find((entry) => entry.id === kbId)
            if (kb) handleImportPicked(kb, event)
            else event.target.value = ''
          }}
        />

        <hr className="oac-kb-sep" />
        <div className="oac-kb-row-head">
          <span className="oac-kb-name">{t('kbStudyTitle')}</span>
          <Button type="button" variant="outline" onClick={() => loadJobs(bot.slug)}>
            {t('refresh')}
          </Button>
        </div>
        <p className="oac-kb-hint">{t('kbStudyPanelHint')}</p>
        {jobsError ? <div className="oac-kb-error">{jobsError}</div> : null}
        {jobsLoaded && !jobsError && jobs.length === 0 ? (
          <p className="oac-kb-hint">{t('kbStudyEmpty')}</p>
        ) : null}
        {jobs.map((job) => (
          <div key={job.id} className="oac-kb-card" data-slot={`knowledge-base-study-job-${job.id}`}>
            <div className="oac-kb-row-head">
              <span className="oac-kb-name" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{job.topic}</span>
              <span className="oac-kb-study-badge" data-status={job.status}>
                {t(STUDY_STATUS_KEYS[job.status] ?? 'kbStatusPending')}
              </span>
            </div>
            <p className="oac-kb-stats">
              {`${interpolate(t('kbStudyStats'), { runs: job.runCount, pins: job.pinsProcessed, budget: job.budgetPins })} · ${formatRunAt(t, job.lastRunAt)}`}
            </p>
            {job.summary ? <p className="oac-kb-desc">{job.summary}</p> : null}
            {job.error ? <p className="oac-kb-error" style={{ background: 'none', padding: 0 }}>{job.error}</p> : null}
          </div>
        ))}
      </div>
    </div>
  )
}
