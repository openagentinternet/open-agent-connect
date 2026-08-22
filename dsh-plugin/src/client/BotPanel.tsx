import { useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  IconBrowseOutline16,
  IconEditOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconRightUpOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotRow, LlmDirectory, AutoReplyConfig, ChatSkillsPayload } from './api.ts'
import { BotAvatar } from './BotAvatar.tsx'
import { BotEditor } from './BotEditor.tsx'
import { CreateBotForm, type CreateBotInput } from './CreateBotForm.tsx'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey, vars?: Record<string, string | number>) => string

export interface BotPanelInjected {
  list: () => Promise<BotRow[]>
  create: (input: CreateBotInput) => Promise<BotRow>
  update: (slug: string, patch: Record<string, unknown>) => Promise<BotRow>
  remove: (slug: string) => Promise<void>
  llmDirectory: () => Promise<LlmDirectory>
  chatSkills: (from: string) => Promise<ChatSkillsPayload>
  loadAutoReplyStatus: (from: string) => Promise<AutoReplyConfig>
  autoReplyConfig: (
    from: string,
    patch: { enabled?: boolean; maxTurns?: number; cooldownMs?: number },
  ) => Promise<AutoReplyConfig>
  /** Open the right-sidebar Bot Browser; no URI opens its home. Resolves once the sidebar has visibly reacted; never rejects. */
  browserOpen: (uri?: string) => Promise<void>
}

/** Newest first, by profile creation time. */
function sortNewestFirst(rows: BotRow[]): BotRow[] {
  return [...rows].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
}

export function BotPanel({
  list,
  create,
  update,
  remove,
  llmDirectory,
  chatSkills,
  loadAutoReplyStatus,
  autoReplyConfig,
  browserOpen,
  close,
  t,
}: BotPanelInjected & { close: () => void; t: Translate }): ReactNode {
  const [bots, setBots] = useState<BotRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<BotRow | null>(null)
  const [directory, setDirectory] = useState<LlmDirectory | null>(null)
  const [busy, setBusy] = useState(false)
  const [canCreate, setCanCreate] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    void list().then(
      (rows) => { if (current) { setBots(sortNewestFirst(rows)); setError(null) } },
      (cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)) },
    )
    return () => { current = false }
  }, [list, tick])

  useEffect(() => {
    void llmDirectory().then(setDirectory).catch(() => setDirectory({ providers: [], modelsByProvider: {} }))
  }, [llmDirectory])

  const reload = (): void => setTick((value) => value + 1)

  const onCreate = async (input: CreateBotInput): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const created = await create(input)
      setCreating(false)
      setEditing(created)
      reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    const otherTwin = (bots ?? []).find((row) => row.botType === 'twin' && row.slug !== editing.slug)
    return (
      <BotEditor
        bot={editing}
        hasOtherTwin={Boolean(otherTwin)}
        otherTwinName={otherTwin?.name ?? ''}
        directory={directory}
        t={t}
        busy={busy}
        error={error}
        chatSkills={chatSkills}
        loadAutoReplyStatus={loadAutoReplyStatus}
        autoReplyConfig={autoReplyConfig}
        onBack={() => { setEditing(null); reload() }}
        onSave={async (patch) => {
          setBusy(true)
          setError(null)
          try {
            const next = await update(editing.slug, patch)
            setEditing(next)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            setBusy(false)
          }
        }}
        onDelete={async () => {
          setBusy(true)
          try {
            await remove(editing.slug)
            setEditing(null)
            reload()
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          } finally {
            setBusy(false)
          }
        }}
      />
    )
  }

  return (
    <div className="oac-panel">
      <div className="oac-row">
        <h2>{t('title')}</h2>
        <div className="oac-actions">
          <Button type="button" icon={<IconRefreshOutline16 />} onClick={reload}>{t('refresh')}</Button>
          <Button type="button" icon={<IconBrowseOutline16 />} onClick={() => { void browserOpen().then(close) }}>
            {t('browserOpen')}
          </Button>
          <Button
            type="button"
            variant="primary"
            icon={<IconPlusOutline16 />}
            onClick={() => { setCreating(true); setError(null); setCanCreate(false) }}
          >
            {t('createNew')}
          </Button>
        </div>
      </div>
      {error && !creating ? <div className="oac-error">{error}</div> : null}
      {bots === null && !error ? <div className="oac-muted">{t('loading')}</div> : null}
      {bots && bots.length === 0 ? <div className="oac-bot-intro">{t('empty')}</div> : null}
      {bots && bots.length > 0 ? (
        <>
          <p className="oac-bot-intro">{t('count', { count: bots.length }).replace('{count}', String(bots.length))}</p>
          <ul className="oac-bot-grid">
            {bots.map((bot) => (
              <li className="oac-bot-card" key={bot.slug}>
                <div className="oac-bot-main">
                  <BotAvatar name={bot.name} src={bot.avatarDataUrl} />
                  <span className="oac-bot-name">{bot.name}</span>
                  {bot.botType === 'twin' ? <span className="oac-memory-badge oac-memory-badge-twin">Twin</span> : null}
                </div>
                {bot.bio ? <p className="oac-bot-bio">{bot.bio}</p> : null}
                {bot.dshLlmProvider && bot.dshLlmModel ? (
                  <div className="oac-bot-model">{bot.dshLlmProvider}/{bot.dshLlmModel}</div>
                ) : null}
                <div className="oac-bot-foot">
                  <div className="oac-bot-foot-left">
                    {bot.globalMetaId ? (
                      <button
                        type="button"
                        className="oac-icon-btn"
                        data-tip={t('botPage')}
                        aria-label={`${t('botPage')}: ${bot.name}`}
                        onClick={() => {
                          void browserOpen(`metaid://${bot.globalMetaId}`).then(close)
                        }}
                      >
                        <IconRightUpOutline16 />
                      </button>
                    ) : null}
                  </div>
                  <div className="oac-bot-foot-right">
                    <button
                      type="button"
                      className="oac-icon-btn"
                      data-tip={t('edit')}
                      aria-label={`${t('edit')}: ${bot.name}`}
                      onClick={() => { setEditing(bot); setError(null) }}
                    >
                      <IconEditOutline16 />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t('createTitle')}
        description={t('fieldLlmHint')}
        className="oac-dialog"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setCreating(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="oac-create-bot-form" variant="primary" disabled={!canCreate}>
              {busy ? t('creating') : t('create')}
            </Button>
          </>
        )}
      >
        <CreateBotForm
          t={t}
          directory={directory}
          busy={busy}
          error={error}
          formId="oac-create-bot-form"
          onValidityChange={setCanCreate}
          onSubmit={onCreate}
        />
      </Modal>
    </div>
  )
}
