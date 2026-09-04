/**
 * Bot editor Knowledge tab: per-bot document knowledge bases (list, create,
 * edit, delete, add-document, query, learn) plus the nightly study-jobs
 * status panel — the DSH port of IDBots' KnowledgeBasePanel +
 * MetawebStudyJobsPanel, mounted inside the same editor chrome.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import {
  OacApiError,
  kbAddDocument,
  kbCreate,
  kbLearn,
  kbList,
  kbQuery,
  kbRemove,
  kbUpdate,
  studyList,
  type KbQueryResult,
  type KbRecord,
  type StudyJob,
} from './api.ts'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

const STUDY_STATUS_KEYS: Record<string, BotsLocaleKey> = {
  pending: 'kbStatusPending',
  running: 'kbStatusRunning',
  done: 'kbStatusDone',
  failed: 'kbStatusFailed',
}

function errorText(cause: unknown): string {
  if (cause instanceof OacApiError) return cause.message
  return cause instanceof Error ? cause.message : String(cause)
}

export function KnowledgeTab({ bot, t }: { bot: { slug: string }; t: Translate }): ReactNode {
  const [kbs, setKbs] = useState<KbRecord[] | null>(null)
  const [jobs, setJobs] = useState<StudyJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [docKbId, setDocKbId] = useState('')
  const [docTitle, setDocTitle] = useState('')
  const [docContent, setDocContent] = useState('')
  const [queryText, setQueryText] = useState('')
  const [queryResults, setQueryResults] = useState<KbQueryResult[] | null>(null)

  const guard = async (key: string, work: () => Promise<void>): Promise<void> => {
    if (busy !== null) return
    setBusy(key)
    setError(null)
    setNote(null)
    try {
      await work()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(null)
    }
  }

  const reload = useCallback((slug: string) => {
    void kbList(slug).then((rows) => {
      setKbs(rows)
      setDocKbId((current) => (rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ''))
    }).catch((cause) => setError(errorText(cause)))
    void studyList(slug).then(setJobs).catch(() => setJobs(null))
  }, [])

  useEffect(() => {
    reload(bot.slug)
  }, [bot.slug, reload])

  const flash = (key: BotsLocaleKey): void => setNote(t(key))

  const learn = (kb: KbRecord, full: boolean): void => {
    void guard(full ? `rebuild:${kb.id}` : `learn:${kb.id}`, async () => {
      await kbLearn(bot.slug, kb.id, full)
      reload(bot.slug)
      flash('kbLearnDone')
    })
  }

  return (
    <div id="oac-editor-panel-knowledge" role="tabpanel" className="oac-tab-panel">
      <div className="oac-form">
        <p className="oac-hint">{t('kbHint')}</p>
        {error ? <div className="oac-error">{error}</div> : null}
        {note ? <div className="oac-hint">{note}</div> : null}

        <div className="oac-form-actions">
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => reload(bot.slug)}
          >
            {t('refresh')}
          </Button>
        </div>

        {kbs !== null && kbs.length === 0 ? <p className="oac-hint">{t('kbEmpty')}</p> : null}
        {(kbs ?? []).map((kb) => (
          <div key={kb.id} className="oac-info">
            <div className="oac-info-row">
              <span className="oac-info-label">
                {kb.name}
                {kb.isDefault ? <span className="oac-hint"> · {t('kbDefault')}</span> : null}
              </span>
              <code className="oac-info-value">
                {t('kbDocsChunks', { docs: kb.docCount, chunks: kb.chunkCount })}
              </code>
            </div>
            {editId === kb.id ? (
              <div className="oac-form">
                <Input
                  value={editName}
                  placeholder={t('kbNamePlaceholder')}
                  onChange={(event) => setEditName(event.target.value)}
                />
                <Input
                  value={editDescription}
                  placeholder={t('kbDescriptionPlaceholder')}
                  onChange={(event) => setEditDescription(event.target.value)}
                />
                <div className="oac-form-actions">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={busy !== null}
                    onClick={() => void guard(`edit:${kb.id}`, async () => {
                      await kbUpdate(bot.slug, kb.id, {
                        ...(editName.trim() ? { name: editName.trim() } : {}),
                        description: editDescription.trim(),
                      })
                      setEditId(null)
                      reload(bot.slug)
                      flash('kbSaved')
                    })}
                  >
                    {t('saving')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setEditId(null)}>
                    {t('cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {kb.description ? <div className="oac-info-row"><span className="oac-hint">{kb.description}</span></div> : null}
                <div className="oac-form-actions">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => learn(kb, false)}
                  >
                    {t('kbLearn')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => learn(kb, true)}
                  >
                    {t('kbRebuild')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void guard(`autolearn:${kb.id}`, async () => {
                      await kbUpdate(bot.slug, kb.id, { autoLearn: !kb.autoLearn })
                      reload(bot.slug)
                    })}
                  >
                    {kb.autoLearn ? t('kbAutoLearnOn') : t('kbAutoLearnOff')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => {
                      setEditId(kb.id)
                      setEditName(kb.name)
                      setEditDescription(kb.description)
                    }}
                  >
                    {t('kbEdit')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => {
                      if (removingId !== kb.id) {
                        setRemovingId(kb.id)
                        return
                      }
                      void guard(`remove:${kb.id}`, async () => {
                        await kbRemove(bot.slug, kb.id)
                        setRemovingId(null)
                        reload(bot.slug)
                      })
                    }}
                  >
                    {removingId === kb.id ? t('kbRemoveConfirm') : t('kbRemove')}
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}

        <div className="oac-form">
          <p className="oac-hint">{t('kbCreate')}</p>
          <Input
            value={createName}
            placeholder={t('kbNamePlaceholder')}
            onChange={(event) => setCreateName(event.target.value)}
          />
          <Input
            value={createDescription}
            placeholder={t('kbDescriptionPlaceholder')}
            onChange={(event) => setCreateDescription(event.target.value)}
          />
          <div className="oac-form-actions">
            <Button
              type="button"
              variant="primary"
              disabled={busy !== null || !createName.trim()}
              onClick={() => void guard('create', async () => {
                await kbCreate(bot.slug, createName.trim(), createDescription.trim() || undefined)
                setCreateName('')
                setCreateDescription('')
                reload(bot.slug)
                flash('kbSaved')
              })}
            >
              {t('kbCreate')}
            </Button>
          </div>
        </div>

        <p className="oac-hint">{t('kbAddDocTitle')}</p>
        <div className="oac-form">
          <select
            className="oac-input"
            value={docKbId}
            onChange={(event) => setDocKbId(event.target.value)}
          >
            {(kbs ?? []).map((kb) => (
              <option key={kb.id} value={kb.id}>{kb.name}</option>
            ))}
          </select>
          <Input
            value={docTitle}
            placeholder={t('kbDocTitlePlaceholder')}
            onChange={(event) => setDocTitle(event.target.value)}
          />
          <textarea
            className="oac-input"
            rows={5}
            value={docContent}
            placeholder={t('kbDocContentPlaceholder')}
            onChange={(event) => setDocContent(event.target.value)}
          />
          <div className="oac-form-actions">
            <Button
              type="button"
              variant="primary"
              disabled={busy !== null || !docTitle.trim() || !docContent.trim() || !docKbId}
              onClick={() => void guard('addDoc', async () => {
                await kbAddDocument(bot.slug, { id: docKbId, title: docTitle.trim(), content: docContent })
                setDocTitle('')
                setDocContent('')
                await kbLearn(bot.slug, docKbId)
                reload(bot.slug)
                flash('kbLearnDone')
              })}
            >
              {t('kbDocAdd')}
            </Button>
          </div>
        </div>

        <p className="oac-hint">{t('kbQueryTitle')}</p>
        <div className="oac-form">
          <Input
            value={queryText}
            placeholder={t('kbQueryPlaceholder')}
            onChange={(event) => setQueryText(event.target.value)}
          />
          <div className="oac-form-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null || !queryText.trim()}
              onClick={() => void guard('query', async () => {
                const results = await kbQuery(bot.slug, queryText.trim())
                setQueryResults(results)
              })}
            >
              {t('kbQueryButton')}
            </Button>
          </div>
          {queryResults !== null ? (
            queryResults.length === 0 ? <p className="oac-hint">{t('kbQueryEmpty')}</p> : (
              queryResults.map((result) => (
                <div key={result.knowledgeBaseId}>
                  <p className="oac-hint">
                    {t('kbQueryHits', { name: result.knowledgeBaseName, count: result.hits.length })}
                  </p>
                  {result.hits.map((hit) => (
                    <div key={`${hit.docRelPath}#${hit.ord}`} className="oac-info">
                      <div className="oac-info-row">
                        <span className="oac-info-label">{hit.title}</span>
                        <code className="oac-info-value">{hit.score.toFixed(3)}</code>
                      </div>
                      <span className="oac-hint">{hit.snippet}</span>
                    </div>
                  ))}
                </div>
              ))
            )
          ) : null}
        </div>

        <p className="oac-hint">{t('kbStudyHint')}</p>
        {jobs !== null && jobs.length === 0 ? <p className="oac-hint">{t('kbStudyEmpty')}</p> : null}
        {(jobs ?? []).map((job) => (
          <div key={job.id} className="oac-info">
            <div className="oac-info-row">
              <span className="oac-info-label">{job.topic}</span>
              <code className="oac-info-value">{t(STUDY_STATUS_KEYS[job.status] ?? 'kbStatusPending')}</code>
            </div>
            <span className="oac-hint">
              {t('kbStudyStats', {
                runs: job.runCount,
                pins: job.pinsProcessed,
                budget: job.budgetPins,
              })}
              {job.consecutiveFailures > 0 ? ` · ${t('kbStudyFailures', { count: job.consecutiveFailures })}` : ''}
            </span>
            {job.summary ? <span className="oac-hint">{job.summary}</span> : null}
            {job.error ? <span className="oac-error">{job.error}</span> : null}
          </div>
        ))}
      </div>
    </div>
  )
}
