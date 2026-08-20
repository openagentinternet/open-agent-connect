import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotRow, UserIdentityPayload } from './api.ts'
import type { UserLocaleKey } from './locale-user.ts'

type Translate = (key: UserLocaleKey, vars?: Record<string, string | number>) => string

export interface UserPanelInjected {
  who: () => Promise<UserIdentityPayload>
  bots: () => Promise<BotRow[]>
  bind: (slug: string) => Promise<unknown>
  unbind: (slug: string) => Promise<unknown>
}

function CopyValue({ value, t }: { value: string; t: Translate }): ReactNode {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="oac-a2a-id"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      <code>{value}</code>
      <span>{copied ? t('copied') : t('copy')}</span>
    </button>
  )
}

export function UserPanel({ who, bots, bind, unbind, t }: UserPanelInjected & { close: () => void; t: Translate }): ReactNode {
  const [identity, setIdentity] = useState<UserIdentityPayload['identity'] | null>(null)
  const [rows, setRows] = useState<BotRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busySlug, setBusySlug] = useState<string | null>(null)
  const [note, setNote] = useState<'saved' | 'failed' | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    void Promise.all([who(), bots()]).then(
      ([whoResult, botRows]) => {
        if (!current) return
        setIdentity(whoResult.identity ?? null)
        setRows(botRows)
        setError(null)
      },
      (cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)) },
    )
    return () => { current = false }
  }, [who, bots, tick])

  const act = async (slug: string, action: 'bind' | 'unbind'): Promise<void> => {
    setBusySlug(slug)
    setNote(null)
    try {
      if (action === 'bind') await bind(slug)
      else await unbind(slug)
      setNote('saved')
      setTick((value) => value + 1)
    } catch {
      setNote('failed')
    } finally {
      setBusySlug(null)
    }
  }

  return (
    <div className="oac-panel">
      <div className="oac-row">
        <h2>{t('title')}</h2>
        <div className="oac-actions">
          <Button type="button" icon={<IconRefreshOutline16 />} onClick={() => setTick((v) => v + 1)}>
            {t('refresh')}
          </Button>
        </div>
      </div>
      {error ? <div className="oac-error">{error}</div> : null}
      <section className="oac-section-card">
        <div className="oac-section-text">
          <span className="oac-section-title">{t('identityTitle')}</span>
          <span className="oac-section-hint">{t('identityHint')}</span>
        </div>
        {identity === null && !error ? <div className="oac-muted">{t('loading')}</div> : null}
        {identity ? (
          <div className="oac-info">
            <div className="oac-info-row">
              <span className="oac-info-label">{t('fieldName')}</span>
              <span className="oac-info-value">{identity.name ?? '-'}</span>
            </div>
            <div className="oac-info-row">
              <span className="oac-info-label">{t('fieldSlug')}</span>
              <span className="oac-info-value">{identity.slug ?? '-'}</span>
            </div>
            {identity.globalMetaId ? (
              <div className="oac-info-row">
                <span className="oac-info-label">{t('fieldGlobalMetaId')}</span>
                <CopyValue value={identity.globalMetaId} t={t} />
              </div>
            ) : null}
            {identity.mvcAddress ? (
              <div className="oac-info-row">
                <span className="oac-info-label">{t('fieldMvcAddress')}</span>
                <CopyValue value={identity.mvcAddress} t={t} />
              </div>
            ) : null}
          </div>
        ) : null}
        {identity === null && error ? <div className="oac-muted">{t('identityEmpty')}</div> : null}
      </section>
      <section className="oac-section-card">
        <div className="oac-section-text">
          <span className="oac-section-title">{t('bindingsTitle')}</span>
          <span className="oac-section-hint">{t('bindingsHint')}</span>
        </div>
        {note === 'saved' ? <span className="oac-note success">{t('bindingSaved')}</span> : null}
        {note === 'failed' ? <span className="oac-note error">{t('bindingFailed')}</span> : null}
        {(rows ?? []).map((bot) => (
          <div className="oac-user-binding-row" key={bot.slug}>
            <span className={`oac-memory-badge${bot.botType === 'twin' ? ' oac-memory-badge-twin' : ''}`}>
              {bot.botType === 'twin' ? t('bindingTwin') : t('bindingWorker')}
            </span>
            <span className="oac-user-binding-name">{bot.name}</span>
            <span className="oac-hint oac-user-binding-owner">
              {bot.ownerGlobalMetaId ?? t('bindingNone')}
            </span>
            {bot.ownerGlobalMetaId ? (
              <Button type="button" disabled={busySlug === bot.slug} onClick={() => void act(bot.slug, 'unbind')}>
                {busySlug === bot.slug ? t('bindingSaving') : t('bindingUnbind')}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={busySlug === bot.slug || !identity?.globalMetaId}
                onClick={() => void act(bot.slug, 'bind')}
              >
                {busySlug === bot.slug ? t('bindingSaving') : t('bindingBind')}
              </Button>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}
