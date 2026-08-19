import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotRow, CommandEnvelope } from './api.ts'
import type { AppsLocaleKey } from './locale-apps.ts'
import { asRecordArray, interpolate, textOf } from './parse.ts'

type Translate = (key: AppsLocaleKey, vars?: Record<string, string | number>) => string

export interface AppsPanelInjected {
  bots: () => Promise<BotRow[]>
  list: (from: string) => Promise<unknown>
  publish: (from: string, payload: Record<string, unknown>) => Promise<CommandEnvelope>
  remove: (from: string, targetPinId: string) => Promise<CommandEnvelope>
}

export function AppsPanel({
  bots,
  list,
  publish,
  remove,
  t,
}: AppsPanelInjected & { t: Translate }): ReactNode {
  const [profiles, setProfiles] = useState<BotRow[]>([])
  const [from, setFrom] = useState('')
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const [publishing, setPublishing] = useState(false)
  const [deleting, setDeleting] = useState<Record<string, unknown> | null>(null)
  const [title, setTitle] = useState('')
  const [appName, setAppName] = useState('')
  const [intro, setIntro] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    void bots().then((listBots) => {
      setProfiles(listBots)
      setFrom((current) => current || listBots[0]?.slug || '')
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [bots])

  useEffect(() => {
    if (!from) return
    let current = true
    setRows(null)
    void list(from).then(
      (data) => {
        if (!current) return
        setRows(asRecordArray(data, ['records', 'items', 'apps', 'metaapps']))
        setError(null)
      },
      (cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => { current = false }
  }, [from, list, tick])

  const onPublish = async (): Promise<void> => {
    if (!from) return
    setBusy(true)
    try {
      await publish(from, { title, appName, intro, content })
      setPublishing(false)
      setTick((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (): Promise<void> => {
    if (!from || !deleting) return
    const id = textOf(deleting, ['pinId', 'targetPinId', 'id'])
    if (!id) return
    setBusy(true)
    try {
      await remove(from, id)
      setDeleting(null)
      setTick((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="oac-panel">
      <div className="oac-row">
        <h2>{t('title')}</h2>
        <div className="oac-actions">
          <Button type="button" onClick={() => setTick((value) => value + 1)}>{t('refresh')}</Button>
          <Button type="button" onClick={() => { setPublishing(true); setError(null) }}>{t('publish')}</Button>
        </div>
      </div>
      {error ? <div className="oac-error">{error}</div> : null}
      <label className="oac-form">
        {t('fieldBot')}
        <select value={from} onChange={(event) => setFrom(event.target.value)}>
          <option value="">{t('pickBot')}</option>
          {profiles.map((bot) => (
            <option key={bot.slug} value={bot.slug}>{bot.name} ({bot.slug})</option>
          ))}
        </select>
      </label>
      {rows === null && from ? <div className="oac-muted">{t('loading')}</div> : null}
      {rows && rows.length === 0 ? <div className="oac-muted">{t('empty')}</div> : null}
      <div className="oac-card-list">
        {rows?.map((row) => {
          const id = textOf(row, ['pinId', 'id'])
          const name = textOf(row, ['title', 'appName'], id)
          return (
            <div className="oac-card" key={id || name}>
              <strong>{name}</strong>
              <div className="oac-muted">{t('pinId')}: <span className="oac-mono">{id}</span></div>
              {textOf(row, ['runUrl', 'metawebUrl']) ? (
                <div className="oac-muted">{t('runUrl')}: {textOf(row, ['runUrl', 'metawebUrl'])}</div>
              ) : null}
              <Button type="button" onClick={() => setDeleting(row)}>{t('remove')}</Button>
            </div>
          )
        })}
      </div>
      <Modal open={publishing} onClose={() => setPublishing(false)} title={t('publishTitle')}>
        <form className="oac-form" onSubmit={(event) => { event.preventDefault(); void onPublish() }}>
          <p>{interpolate(t('publishConfirm'), { from })}</p>
          <label>{t('fieldTitle')}<Input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>{t('fieldAppName')}<Input value={appName} onChange={(event) => setAppName(event.target.value)} /></label>
          <label>{t('fieldIntro')}<Input value={intro} onChange={(event) => setIntro(event.target.value)} /></label>
          <label>{t('fieldContent')}<Input value={content} onChange={(event) => setContent(event.target.value)} /></label>
          <div className="oac-actions">
            <Button type="button" onClick={() => setPublishing(false)}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy || !from || !appName.trim() || !content.trim()}>
              {busy ? t('publishing') : t('confirmPublish')}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={t('removeTitle')}>
        <p>{interpolate(t('removeConfirm'), {
          name: deleting ? textOf(deleting, ['title', 'appName'], 'MetaApp') : '',
          id: deleting ? textOf(deleting, ['pinId', 'id']) : '',
        })}</p>
        <div className="oac-actions">
          <Button type="button" onClick={() => setDeleting(null)}>{t('cancel')}</Button>
          <Button type="button" disabled={busy} onClick={() => { void onDelete() }}>{busy ? t('removing') : t('confirmRemove')}</Button>
        </div>
      </Modal>
    </div>
  )
}
