import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotRow } from './api.ts'
import type { ConversationsLocaleKey } from './locale-conversations.ts'
import { asRecordArray, textOf } from './parse.ts'

type Translate = (key: ConversationsLocaleKey, vars?: Record<string, string | number>) => string

export interface ConversationsPanelInjected {
  bots: () => Promise<BotRow[]>
  conversations: (from: string) => Promise<unknown>
  messages: (from: string, conversationId: string) => Promise<unknown>
  send: (from: string, to: string, content: string) => Promise<unknown>
}

export function ConversationsPanel({
  bots,
  conversations,
  messages,
  send,
  t,
}: ConversationsPanelInjected & { t: Translate }): ReactNode {
  const [profiles, setProfiles] = useState<BotRow[]>([])
  const [from, setFrom] = useState('')
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const [thread, setThread] = useState<Record<string, unknown>[]>([])
  const [peer, setPeer] = useState('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    void bots().then((list) => {
      setProfiles(list)
      setFrom((current) => current || list[0]?.slug || '')
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [bots])

  useEffect(() => {
    setSelected(null)
    setThread([])
    setPeer('')
  }, [from])

  useEffect(() => {
    if (!from) return
    let current = true
    setRows(null)
    void conversations(from).then(
      (data) => {
        if (!current) return
        setRows(asRecordArray(data, ['conversations']))
        setError(null)
      },
      (cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => { current = false }
  }, [conversations, from, tick])

  const open = async (row: Record<string, unknown>): Promise<void> => {
    const id = textOf(row, ['conversationId', 'id'])
    if (!id || !from) return
    setSelected(row)
    setPeer(textOf(row, ['peerGlobalMetaId', 'peer']))
    try {
      const data = await messages(from, id)
      setThread(asRecordArray(data, ['messages']))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const onSend = async (): Promise<void> => {
    if (!from || !peer.trim() || !draft.trim()) return
    setBusy(true)
    try {
      await send(from, peer.trim(), draft.trim())
      setDraft('')
      setTick((value) => value + 1)
      const conversationId = selected ? textOf(selected, ['conversationId', 'id']) : ''
      if (conversationId) {
        const data = await messages(from, conversationId)
        setThread(asRecordArray(data, ['messages']))
      }
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
        <Button type="button" onClick={() => setTick((value) => value + 1)}>{t('refresh')}</Button>
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
      <div className="oac-split">
        <div className="oac-card-list">
          {rows === null && from ? <div className="oac-muted">{t('loading')}</div> : null}
          {rows && rows.length === 0 ? <div className="oac-muted">{t('empty')}</div> : null}
          {rows?.map((row) => {
            const id = textOf(row, ['conversationId', 'id'])
            const label = textOf(row, ['peerName', 'peerLabel', 'peerGlobalMetaId', 'peer'], id)
            return (
              <button
                type="button"
                className="oac-card"
                key={id || label}
                data-active={selected === row ? 'true' : 'false'}
                onClick={() => { void open(row) }}
              >
                <strong>{label}</strong>
                <div className="oac-muted">{textOf(row, ['latestText', 'topic'])}</div>
              </button>
            )
          })}
        </div>
        <div className="oac-card">
          <strong>{selected ? textOf(selected, ['peerName', 'peerGlobalMetaId'], t('newChat')) : t('selectConversation')}</strong>
          <div className="oac-messages">
            {thread.length === 0 ? <div className="oac-muted">{t('noMessages')}</div> : null}
            {thread.map((row, index) => (
              <div
                key={textOf(row, ['messageId', 'pinId'], String(index))}
                className={textOf(row, ['direction']) === 'outbound' ? 'oac-msg-out' : 'oac-msg-in'}
              >
                {textOf(row, ['content', 'text'])}
              </div>
            ))}
          </div>
          <label>
            {t('fieldPeer')}
            <Input value={peer} onChange={(event) => setPeer(event.target.value)} placeholder={t('peerPlaceholder')} />
          </label>
          <label>
            {t('fieldMessage')}
            <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('messagePlaceholder')} />
          </label>
          <div className="oac-actions">
            <Button type="button" disabled={busy || !from || !peer.trim() || !draft.trim()} onClick={() => { void onSend() }}>
              {busy ? t('sending') : t('send')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
