import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Input, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconCloseOutline16, IconSendOutline14 } from './icons.ts'
import type { CommonKeyOf, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
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
import type { UnreadState } from '../unread-logic.ts'
import type { A2AUnreadView } from './a2a-unread-store.ts'
import type { A2APanelState } from './a2a-panel-store.ts'
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
  /** Open a resource URI (e.g. `metaid://<globalMetaId>`) in the right-Sidebar Bot Browser tab. */
  browserOpen: (uri?: string) => Promise<void>
  hooks: {
    /** The apply-scope A2A unread feed (row dots + Group Tasks badges). */
    unread: SnapshotStore<UnreadState>
    /** The apply-scope overlay state (open + one-shot navigation target). */
    panel: SnapshotStore<A2APanelState>
  }
  clearPrivateUnread: (from: string, peer: string) => void
  clearGroupUnread: (key: string) => void
  /** Feed this panel's live view to the unread controller; cleared on unmount. */
  setView: (view: A2AUnreadView) => void
  /** Acknowledge the applied navigation target (conversation-list tabs). */
  consumeTarget: () => void
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
 * A2A Chat surface (mounted by the `shell.overlay` entry `oac-a2a` inside its
 * center-column cell): a pure reading pane. Every list lives in the left
 * conversation-list tabs (线上对话 / 群任务), so this panel has no header, no
 * mode tabs, and no list columns — what renders is the private thread (with
 * its Steer composer) or the selected group task's detail (GroupTaskView,
 * list hidden), positioned by the one-shot targets the left rows write.
 * With nothing selected the private mode shows an empty state whose composer
 * starts a brand-new conversation. Data comes from the same daemon endpoints
 * the OAC `/ui/conversations` page reads. The panel is root-scoped — it must
 * not assume a Session — and mounts only while the overlay is open, so the
 * effects below run exactly while it is on screen.
 */
export function A2AConversation({
  bots,
  list,
  thread,
  send,
  guidance,
  grouptask,
  browserOpen,
  useUnread,
  usePanel,
  clearPrivateUnread,
  clearGroupUnread,
  setView,
  consumeTarget,
  t,
}: InjectFace<A2AConversationInjected> & { t: Translate }): ReactNode {
  const [mode, setMode] = useState<'private' | 'grouptask'>('private')
  // The left group tab's + button arrives as a grouptask target with an
  // empty taskKey; the create modal rides this counter (GroupTaskView).
  const [gtCreateSignal, setGtCreateSignal] = useState(0)
  // External navigation (conversation-list tabs): the task / collab to land
  // on, re-armed per click (identity, not value, so repeat clicks re-fire).
  const [gtOpen, setGtOpen] = useState<{ key: string; seq: number } | null>(null)
  const [gtCollab, setGtCollab] = useState<{ slug: string; groupId: string; seq: number } | null>(null)
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
  // The group task the user opened last; its live updates stay read while it
  // is on screen.
  const [taskKey, setTaskKey] = useState('')
  const unread = useUnread((state) => state)
  const panelTarget = usePanel((state) => state.target)
  const guidanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const guidanceTokenRef = useRef(0)
  const lastFromRef = useRef('')
  const selectedPeerRef = useRef('')
  // The peer a navigation target wants, riding a ref because a from-switch
  // resets the selection — the list reload applies it once the rows land.
  const pendingPeerRef = useRef('')
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const pinnedToBottomRef = useRef(true)
  const forceScrollRef = useRef(false)

  const reloadList = useCallback((): void => setTick((value) => value + 1), [])

  // One-shot navigation target (conversation-list tabs): land the panel on
  // one private thread, group task, or OpenTeam collab, clear what it
  // lights, acknowledge. The private branch rides pendingPeerRef (see
  // above); the grouptask/collab branches re-arm their signals so repeat
  // clicks on the same row re-fire. A grouptask target with an empty
  // taskKey is the left group tab's + button: open the create-task modal.
  useEffect(() => {
    const target = panelTarget
    if (target === null) return
    if (target.mode === 'private') {
      setMode('private')
      pendingPeerRef.current = target.peer
      setTaskKey('')
      if (target.from !== from) setFrom(target.from)
      else reloadList()
      clearPrivateUnread(target.from, target.peer)
    } else if (target.mode === 'collab') {
      setMode('grouptask')
      setTaskKey('')
      setGtCollab((prev) => ({ slug: target.slug, groupId: target.groupId, seq: (prev?.seq ?? 0) + 1 }))
    } else if (target.taskKey === '') {
      setMode('grouptask')
      setTaskKey('')
      setGtOpen(null)
      setGtCreateSignal((value) => value + 1)
    } else {
      setMode('grouptask')
      setTaskKey(target.taskKey)
      setGtCollab(null)
      setGtOpen((prev) => ({ key: target.taskKey, seq: (prev?.seq ?? 0) + 1 }))
      clearGroupUnread(target.taskKey)
    }
    consumeTarget()
  }, [panelTarget, from, reloadList, clearPrivateUnread, clearGroupUnread, consumeTarget])

  useEffect(() => {
    selectedPeerRef.current = selectedPeer
  }, [selectedPeer])

  // Feed the apply-scope unread controller the live view so the thread/task
  // being read stays read; unmounting (another main panel selected) clears it.
  useEffect(() => {
    setView({ mode, from, selectedPeer, taskKey })
    return () => setView(null)
  }, [mode, from, selectedPeer, taskKey, setView])

  useEffect(() => {
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
  }, [bots])

  // Opening a task clears its badge AND pins it as "being read" so live
  // updates for that task stay read while it is on screen.
  const handleTaskRead = useCallback((key: string): void => {
    setTaskKey(key)
    clearGroupUnread(key)
  }, [clearGroupUnread])

  // The conversation summary list is data, not UI: it feeds the thread
  // header (peer name/avatar, conversation id) and validates targets. It
  // follows the selected local Bot; newest first comes from the api
  // normalization. Switching Bots resets the selection; plain reloads
  // (refresh tick, live conversation events) keep it. Nothing auto-selects —
  // with the lists in the left tabs, selection arrives only by navigation.
  useEffect(() => {
    if (!from) return
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
          const pending = pendingPeerRef.current
          if (pending !== '' && rows.some((row) => row.peerGlobalMetaId === pending)) {
            pendingPeerRef.current = ''
            return pending
          }
          if (peer && rows.some((row) => row.peerGlobalMetaId === peer)) return peer
          return ''
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
  }, [from, list, tick])

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
    if (selectedPeer) void loadThread(selectedPeer)
  }, [selectedPeer, loadThread])

  // Newest messages live at the bottom of the scroll container. Switching
  // conversations forces a pin to the bottom; quiet live reloads only follow
  // when the user is already near the bottom, so reading history is never
  // yanked away.
  useEffect(() => {
    forceScrollRef.current = true
  }, [selectedPeer])

  const onMessagesScroll = useCallback((): void => {
    const el = messagesRef.current
    if (!el) return
    pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  useEffect(() => {
    const el = messagesRef.current
    if (!el || threadStatus !== 'ready' || threadData === null) return
    if (forceScrollRef.current || pinnedToBottomRef.current) {
      el.scrollTop = el.scrollHeight
      pinnedToBottomRef.current = true
    }
    forceScrollRef.current = false
  }, [threadData, threadStatus])

  // Live updates: the host pipes the daemon's per-Bot conversation SSE
  // (stored-row changes + chain-profile warm-up completions) into
  // /oac/api/chat/events. One debounced reload per burst refreshes the list
  // and the open thread, so enriched names/avatars and new messages land
  // without reopening the panel.
  useEffect(() => {
    if (!from) return undefined
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
  }, [from, reloadList, loadThread])

  useEffect(() => {
    return () => {
      if (guidanceTimerRef.current !== null) clearTimeout(guidanceTimerRef.current)
    }
  }, [])

  // Avatar click: open the sender's Bot page in the right-Sidebar Bot
  // Browser tab (the overlay keeps the right Sidebar mounted).
  const openBotPage = useCallback((globalMetaId: string): void => {
    const gmid = globalMetaId.trim()
    if (!gmid) return
    void browserOpen(`metaid://${gmid}`)
  }, [browserOpen])

  // Group-task drawer: open one deliverable/resource URI in the right-Sidebar
  // Bot Browser tab.
  const openResource = useCallback((uri: string): void => {
    const target = uri.trim()
    if (!target) return
    void browserOpen(target)
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
      if (selectedPeer) {
        forceScrollRef.current = true
        void loadThread(selectedPeer)
      }
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
  const peerLabel = (selectedSummary?.displayName?.trim() || selectedSummary?.peerName) ?? selectedPeer
  // Conversation payloads carry peer avatars as small chain references (rendered
  // through the daemon avatar proxy). When the peer is one of the local Bots,
  // its fresh data-URL avatar is already in the Bot list — resolve it here
  // instead of paying a proxy round trip per row.
  const localAvatarByMetaId = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of profiles) {
      if (row.globalMetaId && row.avatarDataUrl) map.set(row.globalMetaId, row.avatarDataUrl)
    }
    return map
  }, [profiles])
  const peerAvatar = selectedSummary
    ? localAvatarByMetaId.get(selectedSummary.peerGlobalMetaId) ?? selectedSummary.peerAvatar ?? undefined
    : undefined

  return (
    <div className="oac-a2a-panel" aria-label={t('title')}>
      {mode === 'grouptask' ? (
        <GroupTaskView
          bots={profiles}
          gt={grouptask}
          t={t}
          createSignal={gtCreateSignal}
          openTaskSignal={gtOpen}
          openCollabSignal={gtCollab}
          hideList
          onOpenBotPage={openBotPage}
          onOpenUri={openResource}
          unreadTaskKeys={new Set(Object.keys(unread.group))}
          onTaskRead={handleTaskRead}
        />
      ) : null}
      {/* The private thread stays mounted (display-none'd) while the panel
          reads a group task, so scroll and guidance state survive the trip. */}
      <div className="oac-a2a-body" style={mode === 'grouptask' ? { display: 'none' } : undefined}>
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
              <span className="oac-note">{listError ?? t('pickOnlineLeft')}</span>
            )}
          </div>
          <div className="oac-a2a-messages" ref={messagesRef} onScroll={onMessagesScroll}>
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
                      icon={<IconSendOutline14 />}
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
                exists solely to start a brand-new conversation, and with the
                lists in the left tabs it doubles as the empty state. */}
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
                    icon={<IconSendOutline14 />}
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
  )
}
