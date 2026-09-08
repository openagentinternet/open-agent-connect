import { useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  IconBrowseOutline16,
  IconEditOutline16,
  IconLoadingOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconRightUpOutline16,
  IconWarningOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { MetaAppListPayload } from '../apps.ts'
import {
  OacApiError,
  type AutoReplyConfig,
  type BotBackupPayload,
  type BotHomepageUploadPayload,
  type BotRow,
  type BotWalletPayload,
  type ChatSkillsPayload,
  type LlmDirectory
} from './api.ts'
import { sortBotsTwinFirst } from '../bot-order.ts'
import { BotAvatar } from './BotAvatar.tsx'
import { BotEditor } from './BotEditor.tsx'
import { CopyIconButton } from './CopyIconButton.tsx'
import { CreateBotForm, type CreateBotInput } from './CreateBotForm.tsx'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

/** Mirror of the daemon's MAX_LOCAL_BOT_PROFILES (metabotProfileManager.ts). */
const MAX_LOCAL_BOT_PROFILES = 100

/** Create-modal phases: form -> publishing -> success / setup-pending / error. */
type CreatePhase =
  | { kind: 'form' }
  | { kind: 'publishing' }
  | { kind: 'success'; bot: BotRow }
  | { kind: 'setup-pending'; bot: BotRow; resumed: boolean }
  | { kind: 'error'; message: string }

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
  botWallet: (slug: string) => Promise<BotWalletPayload>
  botBackup: (slug: string) => Promise<BotBackupPayload>
  botSetupRetry: (slug: string) => Promise<BotRow>
  botHomepageUpload: (
    slug: string,
    fileName: string,
    contentType: string,
    base64: string,
  ) => Promise<BotHomepageUploadPayload>
  metaappList: (from: string, size?: number, cursor?: string) => Promise<MetaAppListPayload>
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  let text = template
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
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
  botWallet,
  botBackup,
  botSetupRetry,
  botHomepageUpload,
  metaappList,
  close,
  t,
}: BotPanelInjected & { close: () => void; t: Translate }): ReactNode {
  const [bots, setBots] = useState<BotRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createPhase, setCreatePhase] = useState<CreatePhase>({ kind: 'form' })
  const [lastCreateInput, setLastCreateInput] = useState<CreateBotInput | null>(null)
  const [setupRetrying, setSetupRetrying] = useState(false)
  const [setupRetryError, setSetupRetryError] = useState<string | null>(null)
  const [resyncingSlug, setResyncingSlug] = useState<string | null>(null)
  const [editing, setEditing] = useState<BotRow | null>(null)
  const [directory, setDirectory] = useState<LlmDirectory | null>(null)
  const [busy, setBusy] = useState(false)
  const [canCreate, setCanCreate] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    void list().then(
      (rows) => { if (current) { setBots(sortBotsTwinFirst(rows)); setError(null) } },
      (cause: unknown) => { if (current) setError(errorText(cause)) },
    )
    return () => { current = false }
  }, [list, tick])

  useEffect(() => {
    void llmDirectory().then(setDirectory).catch(() => setDirectory({ providers: [], modelsByProvider: {} }))
  }, [llmDirectory])

  const reload = (): void => setTick((value) => value + 1)

  /** setup.state !== 'ready' decides between the success and the amber setup-pending result panel. */
  const createResultPhase = (bot: BotRow): CreatePhase =>
    bot.setup && bot.setup.state !== 'ready'
      ? { kind: 'setup-pending', bot, resumed: false }
      : { kind: 'success', bot }

  const onCreate = async (input: CreateBotInput): Promise<void> => {
    setLastCreateInput(input)
    setBusy(true)
    setError(null)
    setSetupRetryError(null)
    setCreatePhase({ kind: 'publishing' })
    try {
      const created = await create(input)
      reload()
      setCreatePhase(createResultPhase(created))
    } catch (cause) {
      // The CLI timeout can fire while the daemon still completes the create
      // in the background; re-list once and treat a now-existing namesake as
      // the created Bot instead of showing a failure.
      let recovered: BotRow | null = null
      try {
        const rows = await list()
        setBots(sortBotsTwinFirst(rows))
        const needle = input.name.trim().toLowerCase()
        recovered = rows.find((row) => row.name.trim().toLowerCase() === needle) ?? null
      } catch { /* keep the original error */ }
      if (recovered) {
        setCreatePhase(createResultPhase(recovered))
      } else {
        const message = cause instanceof OacApiError && cause.code === 'bot_limit_reached'
          ? interpolate(t('limitReached', { limit: MAX_LOCAL_BOT_PROFILES }), { limit: MAX_LOCAL_BOT_PROFILES })
          : errorText(cause)
        setCreatePhase({ kind: 'error', message })
      }
    } finally {
      setBusy(false)
    }
  }

  const closeCreate = (): void => {
    if (createPhase.kind === 'publishing') return
    setCreating(false)
    setCreatePhase({ kind: 'form' })
    setSetupRetryError(null)
  }

  const continueEditing = (bot: BotRow): void => {
    setCreating(false)
    setCreatePhase({ kind: 'form' })
    setSetupRetryError(null)
    setEditing(bot)
    setError(null)
  }

  const retrySetup = async (bot: BotRow): Promise<void> => {
    if (setupRetrying) return
    setSetupRetrying(true)
    setSetupRetryError(null)
    try {
      const row = await botSetupRetry(bot.slug)
      reload()
      if (row.setup && row.setup.state !== 'ready') {
        setCreatePhase({ kind: 'setup-pending', bot: row, resumed: false })
        setSetupRetryError(row.setup.error)
      } else {
        setCreatePhase({ kind: 'setup-pending', bot: row, resumed: true })
      }
    } catch (cause) {
      setSetupRetryError(errorText(cause))
    } finally {
      setSetupRetrying(false)
    }
  }

  const onCardResync = async (bot: BotRow): Promise<void> => {
    if (resyncingSlug !== null) return
    setResyncingSlug(bot.slug)
    setError(null)
    try {
      await botSetupRetry(bot.slug)
      reload()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setResyncingSlug(null)
    }
  }

  const botLimitReached = bots !== null && bots.length >= MAX_LOCAL_BOT_PROFILES
  const limitText = interpolate(t('limitReached', { limit: MAX_LOCAL_BOT_PROFILES }), { limit: MAX_LOCAL_BOT_PROFILES })

  const createModalTitle = createPhase.kind === 'publishing'
    ? t('createPublishing')
    : createPhase.kind === 'success'
      ? t('createSuccess')
      : createPhase.kind === 'setup-pending'
        ? (createPhase.resumed ? t('setupResumed') : t('setupPendingTitle'))
        : t('createTitle')

  const createModalFooter = (): ReactNode => {
    if (createPhase.kind === 'publishing') {
      return (
        <>
          <Button type="button" variant="outline" disabled>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled>{t('creating')}</Button>
        </>
      )
    }
    if (createPhase.kind === 'success') {
      return (
        <>
          <Button type="button" variant="outline" onClick={closeCreate}>{t('close')}</Button>
          <Button type="button" variant="primary" onClick={() => continueEditing(createPhase.bot)}>
            {t('createContinueEditing')}
          </Button>
        </>
      )
    }
    if (createPhase.kind === 'setup-pending') {
      if (createPhase.resumed) {
        return (
          <>
            <Button type="button" variant="outline" onClick={closeCreate}>{t('close')}</Button>
            <Button type="button" variant="primary" onClick={() => continueEditing(createPhase.bot)}>
              {t('createContinueEditing')}
            </Button>
          </>
        )
      }
      return (
        <>
          <Button type="button" variant="outline" disabled={setupRetrying} onClick={closeCreate}>{t('close')}</Button>
          <Button
            type="button"
            variant="primary"
            disabled={setupRetrying}
            onClick={() => { void retrySetup(createPhase.bot) }}
          >
            {setupRetrying ? t('setupSyncing') : t('setupRetrySubsidy')}
          </Button>
        </>
      )
    }
    if (createPhase.kind === 'error') {
      return (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => { setCreatePhase({ kind: 'form' }) }}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || lastCreateInput === null}
            onClick={() => { if (lastCreateInput) void onCreate(lastCreateInput) }}
          >
            {t('retry')}
          </Button>
        </>
      )
    }
    return (
      <>
        <Button type="button" variant="outline" disabled={busy} onClick={closeCreate}>
          {t('cancel')}
        </Button>
        <Button type="submit" form="oac-create-bot-form" variant="primary" disabled={!canCreate}>
          {busy ? t('creating') : t('create')}
        </Button>
      </>
    )
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
        browserOpen={browserOpen}
        botWallet={botWallet}
        botBackup={botBackup}
        botHomepageUpload={botHomepageUpload}
        metaappList={metaappList}
        onBack={() => { setEditing(null); reload() }}
        onSave={async (patch) => {
          setBusy(true)
          setError(null)
          try {
            const next = await update(editing.slug, patch)
            setEditing(next)
          } catch (cause) {
            setError(errorText(cause))
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
            setError(errorText(cause))
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
            disabled={botLimitReached}
            title={botLimitReached ? limitText : undefined}
            onClick={() => { setCreating(true); setError(null); setCanCreate(false); setCreatePhase({ kind: 'form' }) }}
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
            {bots.map((bot) => {
              const setupPending = bot.setup != null && bot.setup.state !== 'ready'
              const llmUnset = !bot.dshLlmProvider?.trim() || !bot.dshLlmModel?.trim()
              return (
                <li className="oac-bot-card" key={bot.slug}>
                  <div className="oac-bot-main">
                    <BotAvatar name={bot.name} src={bot.avatarDataUrl} />
                    <span className="oac-bot-name">{bot.name}</span>
                    {bot.botType === 'twin' ? <span className="oac-memory-badge oac-memory-badge-twin">Twin</span> : null}
                    {setupPending ? (
                      <span className="oac-memory-badge oac-setup-badge" title={t('cardResyncHint')}>
                        {t('cardSetupPendingBadge')}
                      </span>
                    ) : null}
                  </div>
                  <p className="oac-bot-bio">{bot.bio ?? ''}</p>
                  <div className="oac-bot-model">
                    {llmUnset ? (
                      <span className="oac-memory-badge oac-llm-unset-badge" title={t('cardLlmUnsetHint')}>
                        {t('cardLlmUnsetBadge')}
                      </span>
                    ) : `${bot.dshLlmProvider}/${bot.dshLlmModel}`}
                  </div>
                  <div className="oac-bot-foot">
                    <div className="oac-bot-foot-left">
                      {setupPending ? (
                        <button
                          type="button"
                          className="oac-icon-btn"
                          title={t('cardResyncHint')}
                          aria-label={`${t('cardResyncNow')}: ${bot.name}`}
                          disabled={resyncingSlug === bot.slug}
                          onClick={() => { void onCardResync(bot) }}
                        >
                          {resyncingSlug === bot.slug
                            ? <IconLoadingOutline16 className="oac-spin" />
                            : <IconRefreshOutline16 />}
                        </button>
                      ) : null}
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
              )
            })}
          </ul>
        </>
      ) : null}
      <Modal
        closeLabel={t('close')}
        open={creating}
        onClose={closeCreate}
        title={createModalTitle}
        description={createPhase.kind === 'form' ? t('fieldLlmHint') : undefined}
        className="oac-dialog"
        footer={createModalFooter()}
      >
        {/* The form stays mounted (hidden) through the chain phases so an
            error Cancel returns with the entered values intact. */}
        <div hidden={createPhase.kind !== 'form'}>
          <CreateBotForm
            t={t}
            directory={directory}
            busy={busy}
            error={error}
            formId="oac-create-bot-form"
            existingNames={(bots ?? []).map((bot) => bot.name)}
            onValidityChange={setCanCreate}
            onSubmit={onCreate}
          />
        </div>
        {createPhase.kind === 'publishing' ? (
          <div className="oac-apps-chain-head">
            <span className="oac-apps-chain-badge pending"><IconLoadingOutline16 /></span>
            <div className="oac-apps-chain-copy">
              <strong>{lastCreateInput?.name ?? ''}</strong>
              <p>{t('createPublishingHint')}</p>
            </div>
          </div>
        ) : null}
        {createPhase.kind === 'success' ? (
          <div className="oac-create-result">
            <div className="oac-create-result-icon" aria-hidden="true">🎉</div>
            <strong className="oac-create-result-name">{createPhase.bot.name}</strong>
            <p className="oac-create-result-sub">{t('createSuccessSubtitle')}</p>
          </div>
        ) : null}
        {createPhase.kind === 'setup-pending' ? (
          createPhase.resumed ? (
            <div className="oac-create-result">
              <div className="oac-create-result-icon" aria-hidden="true">🎉</div>
              <strong className="oac-create-result-name">{createPhase.bot.name}</strong>
              <p className="oac-create-result-sub">{t('setupResumed')}</p>
            </div>
          ) : (
            <div className="oac-create-setup">
              <div className="oac-apps-chain-head">
                <span className="oac-apps-chain-badge oac-create-badge-warn"><IconWarningOutline16 /></span>
                <div className="oac-apps-chain-copy">
                  <strong>{createPhase.bot.name}</strong>
                  <p>{t('setupPendingHint')}</p>
                </div>
              </div>
              {createPhase.bot.mvcAddress ? (
                <div className="oac-create-address">
                  <p className="oac-hint">{t('setupSelfFundHint')}</p>
                  <div className="oac-create-address-row">
                    <code>{createPhase.bot.mvcAddress}</code>
                    <CopyIconButton
                      value={createPhase.bot.mvcAddress}
                      label={t('copyAddress')}
                      copiedLabel={t('addressCopied')}
                    />
                  </div>
                </div>
              ) : null}
              {setupRetryError ? <p className="oac-note error">{setupRetryError}</p> : null}
            </div>
          )
        ) : null}
        {createPhase.kind === 'error' ? (
          <div className="oac-error" role="alert">{createPhase.message}</div>
        ) : null}
      </Modal>
    </div>
  )
}
