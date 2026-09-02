import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconCloseOutline16,
  IconNewChatOutline16,
  IconPlusOutline16,
  IconSendOutline16,
  Input,
  MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import {
  timestampLabel,
  txidPreview,
  type BotRow,
  type ConversationMessage,
  type ConversationSummary,
  type ConversationThread,
} from './api.ts'
import { BotAvatar, BotAvatarButton } from './BotAvatar.tsx'
import { CopyIconButton } from './CopyIconButton.tsx'
import { pickDefaultBotSlug } from '../bot-order.ts'
import { relativeTimeLabel } from '../relative-time.ts'
import { GroupTaskView, type GroupTaskInjectedApi } from './GroupTaskView.tsx'
import type { ConversationsLocaleKey } from './locale-conversations.ts'
import { markdownLabels } from './markdown-labels.ts'

type Translate = (key: ConversationsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export interface A2AConversationInjected {
  bots: () => Promise<BotRow[]>
  list: (from: string) => Promise<ConversationSummary[]>
  thread: (from: string, peer: string) => Promise<ConversationThread>
  send: (from: string, to: string, content: string) => Promise<unknown>
  guidance: (from: string, peer: string, guidance: string) => Promise<unknown>
  grouptask: GroupTaskInjectedApi
  /** Open the right-sidebar Bot Browser on a resource URI (e.g. `metaid://<globalMetaId>`). */
  browserOpen: (uri?: string) => Promise<void>
}

const GUIDANCE_POLL_MS = 1500
const GUIDANCE_POLL_MAX = 10

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function isLocalMessage(message: ConversationMessage): boolean {
  const direction = message.direction.toLowerCase()
  return direction === 'outbound' || direction === 'outgoing'
}

/** One message row: avatar, sender, bubble, and txid + time meta. */
function MessageRow({
  message,
  isLocal,
  peerLabel,
  peerAvatar,
  peerGlobalMetaId,
  localLabel,
  localAvatar,
  localGlobalMetaId,
  onOpenBotPage,
  t,
}: {
  message: ConversationMessage
  isLocal: boolean
  peerLabel: string
  peerAvatar: string | undefined
  peerGlobalMetaId: string
  localLabel: string
  localAvatar: string | undefined
  localGlobalMetaId: string
  onOpenBotPage: (globalMetaId: string) => void
  t: Translate
}): ReactNode {
  const senderName = message.sender.name ?? (isLocal ? localLabel : peerLabel)
  const senderAvatar = message.sender.avatar ?? (isLocal ? localAvatar : peerAvatar)
  const senderGlobalMetaId = message.sender.globalMetaId ?? (isLocal ? localGlobalMetaId : peerGlobalMetaId)
  const isImage = (message.contentType ?? '').toLowerCase().startsWith('image/')
  const isMarkdown = message.contentType === 'text/markdown'
  const mdLabels = useMemo(() => markdownLabels(t), [t])
  return (
    <div className={isLocal ? 'oac-a2a-msg oac-a2a-msg-local' : 'oac-a2a-msg oac-a2a-msg-peer'}>
      {senderGlobalMetaId
        ? (
          <BotAvatarButton
            name={senderName}
            src={senderAvatar}
            className="oac-a2a-msg-avatar"
            label={`${t('openBotPage')}: ${senderName}`}
            onClick={() => onOpenBotPage(senderGlobalMetaId)}
          />
        )
        : <BotAvatar name={senderName} src={senderAvatar} className="oac-a2a-msg-avatar" />}
      <div className="oac-a2a-msg-body">
        <div className="oac-a2a-msg-head">
          <span className="oac-a2a-msg-name">{senderName}</span>
          <span className="oac-a2a-msg-meta">
            <span className="oac-a2a-msg-txid">
              {message.txid ? (
                <>
                  <span className="oac-a2a-msg-txid-text">txid: {txidPreview(message.txid)}</span>
                  <CopyIconButton
                    value={message.txid}
                    label={`${t('copyTxid')}: ${message.txid}`}
                    copiedLabel={t('copied')}
                  />
                </>
              ) : (
                <span className="oac-a2a-msg-txid-empty">txid: -</span>
              )}
            </span>
            <span className="oac-a2a-msg-time" title={timestampLabel(message.timestamp)}>
              {relativeTimeLabel(message.timestamp)}
            </span>
          </span>
        </div>
        <div className={isLocal ? 'oac-a2a-bubble oac-a2a-bubble-local' : 'oac-a2a-bubble oac-a2a-bubble-peer'}>
          {isImage
            ? <img className="oac-a2a-msg-image" src={message.content} alt="" />
            : isMarkdown
              ? <MarkdownText text={message.content} labels={mdLabels} />
              : <span className="oac-a2a-msg-text">{message.content}</span>}
        </div>
      </div>
    </div>
  )
}

/**
 * Sidebar-foot A2A conversation entry: a trigger row above Settings (wide and
 * rail variants) that opens a floating two-column panel — peer conversation
 * list on the left, message thread with a composer on the right. Data comes
 * from the same daemon endpoints the OAC `/ui/conversations` page reads.
 */
export function A2AConversation({
  wide,
  bots,
  list,
  thread,
  send,
  guidance,
  grouptask,
  browserOpen,
  t,
}: A2AConversationInjected & { wide: boolean; t: Translate }): ReactNode {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'private' | 'grouptask'>('private')
  const [gtCreateSignal, setGtCreateSignal] = useState(0)
  const [profiles, setProfiles] = useState<BotRow[]>([])
  const [from, setFrom] = useState('')
  const [summaries, setSummaries] = useState<ConversationSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedPeer, setSelectedPeer] = useState('')
  const [threadData, setThreadData] = useState<ConversationThread | null>(null)
  const [threadStatus, setThreadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [threadError, setThreadError] = useState<string | null>(null)
  const [peerDraft, setPeerDraft] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const [guidanceOpen, setGuidanceOpen] = useState(false)
  const [guidanceDraft, setGuidanceDraft] = useState('')
  const [guidanceStatus, setGuidanceStatus] = useState<string | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const guidanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const guidanceTokenRef = useRef(0)
  const lastFromRef = useRef('')
  const selectedPeerRef = useRef('')

  const reloadList = useCallback((): void => setTick((value) => value + 1), [])

  useEffect(() => {
    selectedPeerRef.current = selectedPeer
  }, [selectedPeer])

  useEffect(() => {
    if (!open) return
    let current = true
    setGuidanceStatus(null)
    void bots().then((rows) => {
      if (!current) return
      setProfiles(rows)
      setFrom((currentFrom) => {
        if (currentFrom && rows.some((row) => row.slug === currentFrom)) return currentFrom
        return pickDefaultBotSlug(rows)
      })
    }).catch((cause: unknown) => {
      if (current) setListError(errorText(cause))
    })
    return () => { current = false }
  }, [open, bots])

  // Conversation list follows the selected local Bot; newest first comes from
  // the api normalization. Switching Bots resets the selection; plain reloads
  // (refresh tick, live conversation events) keep it.
  useEffect(() => {
    if (!open || !from) return
    let current = true
    if (lastFromRef.current !== from) {
      lastFromRef.current = from
      setSelectedPeer('')
      setThreadData(null)
    }
    void list(from).then(
      (rows) => {
        if (!current) return
        setSummaries(rows)
        setListError(null)
        setSelectedPeer((peer) => {
          if (peer && rows.some((row) => row.peerGlobalMetaId === peer)) return peer
          return rows[0]?.peerGlobalMetaId ?? ''
        })
      },
      (cause: unknown) => {
        if (!current) return
        setListError(errorText(cause))
        setSummaries([])
        setSelectedPeer('')
        setThreadData(null)
      },
    )
    return () => { current = false }
  }, [open, from, list, tick])

  const loadThread = useCallback(async (peer: string, options?: { quiet?: boolean }): Promise<ConversationThread | null> => {
    if (!from || !peer) return null
    if (options?.quiet !== true) setThreadStatus('loading')
    setThreadError(null)
    try {
      const data = await thread(from, peer)
      setThreadData(data)
      setThreadStatus('ready')
      return data
    } catch (cause) {
      setThreadError(errorText(cause))
      setThreadStatus('error')
      return null
    }
  }, [from, thread])

  useEffect(() => {
    if (open && selectedPeer) void loadThread(selectedPeer)
  }, [open, selectedPeer, loadThread])

  // Live updates: the host pipes the daemon's per-Bot conversation SSE
  // (stored-row changes + chain-profile warm-up completions) into
  // /oac/api/chat/events. One debounced reload per burst refreshes the list
  // and the open thread, so enriched names/avatars and new messages land
  // without reopening the panel.
  useEffect(() => {
    if (!open || !from) return undefined
    let source: EventSource | null = null
    try {
      source = new EventSource(`/oac/api/chat/events?from=${encodeURIComponent(from)}`)
    } catch {
      return undefined
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const onUpdate = (): void => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        reloadList()
        const peer = selectedPeerRef.current
        if (peer) void loadThread(peer, { quiet: true })
      }, 400)
    }
    source.addEventListener('conversation-update', onUpdate)
    return () => {
      if (timer !== null) clearTimeout(timer)
      source?.close()
    }
  }, [open, from, reloadList, loadThread])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    closeButtonRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (guidanceTimerRef.current !== null) clearTimeout(guidanceTimerRef.current)
    }
  }, [open])

  const selectPeer = (peer: string): void => {
    if (peer === selectedPeer) return
    setSelectedPeer(peer)
    setGuidanceStatus(null)
    setGuidanceOpen(false)
  }

  // Avatar click: open the sender's Bot page in the right-sidebar Bot Browser;
  // the modal closes so the Browser is visible (same flow as the Bot cards).
  const openBotPage = useCallback((globalMetaId: string): void => {
    const gmid = globalMetaId.trim()
    if (!gmid) return
    void browserOpen(`metaid://${gmid}`).then(() => setOpen(false))
  }, [browserOpen])

  const onSend = async (): Promise<void> => {
    const peer = selectedPeer || peerDraft.trim()
    const content = draft.trim()
    if (!from || !peer || !content) return
    setBusy(true)
    try {
      await send(from, peer, content)
      setDraft('')
      setPeerDraft('')
      if (selectedPeer) void loadThread(selectedPeer)
      reloadList()
    } catch (cause) {
      setThreadError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  // Guidance: post the instruction, then poll the thread until the local Bot's
  // reply message lands (or the poll budget runs out).
  const submitGuidance = async (): Promise<void> => {
    const text = guidanceDraft.trim()
    if (!selectedPeer || !text || guidanceStatus !== null) return
    const token = ++guidanceTokenRef.current
    const targetPeer = selectedPeer
    const baselineMessageIds = new Set(threadData?.messages.map((row) => row.messageId) ?? [])
    setGuidanceOpen(false)
    setGuidanceStatus(t('guidanceSending'))
    try {
      await guidance(from, targetPeer, text)
      setGuidanceDraft('')
      setGuidanceStatus(t('guidanceAwaiting'))
    } catch (cause) {
      setGuidanceStatus(`${t('guidanceFailed')} ${errorText(cause)}`)
      return
    }
    let polls = 0
    const poll = async (): Promise<void> => {
      if (guidanceTokenRef.current !== token || selectedPeer !== targetPeer) return
      const data = await loadThread(targetPeer)
      const latest = data?.messages[data.messages.length - 1]
      if (latest && isLocalMessage(latest) && !baselineMessageIds.has(latest.messageId)) {
        setGuidanceStatus(t('guidanceSent'))
        return
      }
      polls += 1
      if (polls >= GUIDANCE_POLL_MAX) {
        setGuidanceStatus(t('guidanceAwaiting'))
        return
      }
      guidanceTimerRef.current = setTimeout(() => { void poll() }, GUIDANCE_POLL_MS)
    }
    guidanceTimerRef.current = setTimeout(() => { void poll() }, GUIDANCE_POLL_MS)
  }

  const selectedSummary = selectedPeer
    ? (summaries?.find((row) => row.peerGlobalMetaId === selectedPeer) ?? null)
    : null
  const currentBot = profiles.find((row) => row.slug === from) ?? null
  const localLabel = currentBot?.name ?? t('localBot')
  const localAvatar = currentBot?.avatarDataUrl
  const localGlobalMetaId = selectedSummary?.localGlobalMetaId || currentBot?.globalMetaId || ''
  const peerLabel = selectedSummary?.peerName ?? selectedPeer
  const peerAvatar = selectedSummary?.peerAvatar ?? undefined

  return (
    <>
      <button
        type="button"
        className={wide ? 'oac-a2a-trigger' : 'oac-a2a-trigger oac-a2a-trigger-rail'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <IconNewChatOutline16 />
        {wide ? <span>{t('nav')}</span> : null}
      </button>
      {open ? (
        <div className="oac-a2a-overlay" role="presentation">
          <div className="oac-a2a-mask" aria-hidden="true" onClick={() => setOpen(false)} />
          <div className="oac-a2a-panel" role="dialog" aria-modal="true" aria-label={t('title')}>
            <div className="oac-a2a-header">
              <div className="oac-gt-header-left">
                <h2>{t('title')}</h2>
                <div className="oac-tablist oac-gt-mode-tabs" role="tablist">
                  {(['private', 'grouptask'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      className="oac-tab"
                      data-active={mode === key}
                      onClick={() => setMode(key)}
                    >
                      {t(key === 'private' ? 'tabPrivate' : 'tabGroup')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="oac-gt-header-right">
                {mode === 'grouptask' ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    icon={<IconPlusOutline16 />}
                    onClick={() => setGtCreateSignal((value) => value + 1)}
                  >
                    {t('gtNew')}
                  </Button>
                ) : null}
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="oac-a2a-close"
                  aria-label={t('close')}
                  onClick={() => setOpen(false)}
                >
                  <IconCloseOutline16 size={14} />
                </button>
              </div>
            </div>
            {mode === 'grouptask' ? (
              <GroupTaskView bots={profiles} gt={grouptask} t={t} createSignal={gtCreateSignal} onOpenBotPage={openBotPage} />
            ) : null}
            <div className="oac-a2a-body" style={mode === 'grouptask' ? { display: 'none' } : undefined}>
              <div className="oac-a2a-list">
                <div className="oac-a2a-list-head">
                  <BotAvatar name={localLabel} src={localAvatar} className="oac-a2a-bot-avatar" />
                  <select
                    className="oac-input oac-input-select"
                    value={from}
                    disabled={profiles.length === 0}
                    aria-label={t('fieldBot')}
                    onChange={(event) => setFrom(event.target.value)}
                  >
                    {profiles.map((bot) => (
                      <option key={bot.slug} value={bot.slug}>{bot.name}</option>
                    ))}
                  </select>
                </div>
                {listError ? <p className="oac-note error">{listError}</p> : null}
                <div className="oac-a2a-list-rows">
                  {summaries === null ? <p className="oac-note saving">{t('loading')}</p> : null}
                  {summaries !== null && summaries.length === 0 ? (
                    <p className="oac-note">{t('empty')}</p>
                  ) : null}
                  {summaries?.map((row) => (
                    <button
                      type="button"
                      key={row.conversationId || row.peerGlobalMetaId}
                      className={row.peerGlobalMetaId === selectedPeer ? 'oac-a2a-row active' : 'oac-a2a-row'}
                      onClick={() => selectPeer(row.peerGlobalMetaId)}
                    >
                      <BotAvatar
                        name={row.peerName ?? row.peerGlobalMetaId}
                        src={row.peerAvatar ?? undefined}
                        className="oac-a2a-row-avatar"
                      />
                      <span className="oac-a2a-row-main">
                        <span className="oac-a2a-row-name">{row.peerName ?? row.peerGlobalMetaId}</span>
                        <span className="oac-a2a-row-text">{row.latestText}</span>
                      </span>
                      <span className="oac-a2a-row-time" title={timestampLabel(row.latestAt)}>
                        {relativeTimeLabel(row.latestAt)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="oac-a2a-thread">
                <div className="oac-a2a-thread-head">
                  {selectedSummary ? (
                    <div className="oac-a2a-participants">
                      <div className="oac-a2a-participant">
                        <BotAvatarButton
                          name={peerLabel}
                          src={peerAvatar}
                          className="oac-a2a-thread-avatar"
                          label={`${t('openBotPage')}: ${peerLabel}`}
                          onClick={() => openBotPage(selectedPeer)}
                        />
                        <strong className="oac-a2a-participant-name">{peerLabel}</strong>
                        <span className="oac-a2a-gmid">
                          <code title={selectedPeer}>{txidPreview(selectedPeer)}</code>
                          <CopyIconButton
                            value={selectedPeer}
                            label={`${t('copyGmid')}: ${selectedPeer}`}
                            copiedLabel={t('copied')}
                          />
                        </span>
                      </div>
                      <span className="oac-a2a-id" title={selectedSummary.conversationId}>
                        <code>id: {selectedSummary.conversationId.slice(0, 8)}…</code>
                        <CopyIconButton
                          value={selectedSummary.conversationId}
                          label={`${t('copyConversationId')}: ${selectedSummary.conversationId}`}
                          copiedLabel={t('copied')}
                        />
                      </span>
                      <div className="oac-a2a-participant oac-a2a-participant-local">
                        {localGlobalMetaId
                          ? (
                            <BotAvatarButton
                              name={localLabel}
                              src={localAvatar}
                              className="oac-a2a-thread-avatar"
                              label={`${t('openBotPage')}: ${localLabel}`}
                              onClick={() => openBotPage(localGlobalMetaId)}
                            />
                          )
                          : <BotAvatar name={localLabel} src={localAvatar} className="oac-a2a-thread-avatar" />}
                        <strong className="oac-a2a-participant-name">{localLabel}</strong>
                        {localGlobalMetaId ? (
                          <span className="oac-a2a-gmid">
                            <code title={localGlobalMetaId}>{txidPreview(localGlobalMetaId)}</code>
                            <CopyIconButton
                              value={localGlobalMetaId}
                              label={`${t('copyGmid')}: ${localGlobalMetaId}`}
                              copiedLabel={t('copied')}
                            />
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <span className="oac-note">{t('selectConversation')}</span>
                  )}
                </div>
                <div className="oac-a2a-messages">
                  {threadStatus === 'loading' ? <p className="oac-note saving">{t('loadingMessages')}</p> : null}
                  {threadStatus === 'error' ? <p className="oac-note error">{threadError ?? t('error')}</p> : null}
                  {threadStatus === 'ready' && threadData !== null && threadData.messages.length === 0 ? (
                    <p className="oac-note">{t('noMessages')}</p>
                  ) : null}
                  {threadData?.messages.map((message) => (
                    <MessageRow
                      key={message.messageId || `${message.direction}-${message.timestamp}`}
                      message={message}
                      isLocal={isLocalMessage(message)}
                      peerLabel={peerLabel}
                      peerAvatar={peerAvatar}
                      peerGlobalMetaId={selectedPeer}
                      localLabel={localLabel}
                      localAvatar={localAvatar}
                      localGlobalMetaId={localGlobalMetaId}
                      onOpenBotPage={openBotPage}
                      t={t}
                    />
                  ))}
                </div>
                <div className="oac-a2a-composer">
                  {selectedPeer ? (
                    <div className="oac-a2a-guidance">
                      {guidanceStatus !== null ? (
                        <p className="oac-note">{guidanceStatus}</p>
                      ) : guidanceOpen ? (
                        <div className="oac-a2a-guidance-form">
                          <Input
                            className="oac-a2a-guidance-input"
                            value={guidanceDraft}
                            onChange={(event) => setGuidanceDraft(event.target.value)}
                            placeholder={t('guidancePlaceholder')}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault()
                                void submitGuidance()
                              }
                            }}
                          />
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            icon={<IconSendOutline16 />}
                            disabled={!guidanceDraft.trim()}
                            onClick={() => { void submitGuidance() }}
                          >
                            {t('guidanceSend')}
                          </Button>
                          <button
                            type="button"
                            className="oac-a2a-guidance-close"
                            aria-label={t('guidanceCancel')}
                            title={t('guidanceCancel')}
                            onClick={() => {
                              setGuidanceOpen(false)
                              setGuidanceDraft('')
                            }}
                          >
                            <IconCloseOutline16 size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="oac-a2a-guidance-toggle"
                          onClick={() => setGuidanceOpen(true)}
                        >
                          {t('guidanceToggle')}
                        </button>
                      )}
                    </div>
                  ) : null}
                  {/* OAC /ui/conversations parity: a selected conversation is
                      Steer-only — no free message composer. The plain composer
                      exists solely to start a brand-new conversation. */}
                  {!selectedPeer ? (
                    <>
                      <Input
                        value={peerDraft}
                        onChange={(event) => setPeerDraft(event.target.value)}
                        placeholder={t('peerPlaceholder')}
                      />
                      <div className="oac-a2a-composer-row">
                        <Input
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          placeholder={t('messagePlaceholder')}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault()
                              if (!busy) void onSend()
                            }
                          }}
                        />
                        <Button
                          type="button"
                          variant="primary"
                          icon={<IconSendOutline16 />}
                          disabled={busy || !from || !draft.trim() || !peerDraft.trim()}
                          onClick={() => { void onSend() }}
                        >
                          {busy ? t('sending') : t('send')}
                        </Button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
