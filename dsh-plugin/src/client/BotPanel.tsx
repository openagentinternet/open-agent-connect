import { useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  IconEditOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotRow, LlmDirectory } from './api.ts'
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
}

/** Round avatar: the Bot's own image when it has one, initials otherwise. */
function BotAvatar({ name, src }: { name: string; src: string | undefined }): ReactNode {
  if (src !== undefined && src.trim() !== '') {
    return <img className="oac-bot-avatar" src={src} alt="" />
  }
  const initials = name.trim().slice(0, 2).toUpperCase() || 'MB'
  return <span className="oac-bot-avatar oac-bot-avatar-fallback" aria-hidden="true">{initials}</span>
}

export function BotPanel({
  list,
  create,
  update,
  remove,
  llmDirectory,
  t,
}: BotPanelInjected & { t: Translate }): ReactNode {
  const [bots, setBots] = useState<BotRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<BotRow | null>(null)
  const [directory, setDirectory] = useState<LlmDirectory | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    void list().then(
      (rows) => { if (current) { setBots(rows); setError(null) } },
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
    return (
      <BotEditor
        bot={editing}
        directory={directory}
        t={t}
        busy={busy}
        error={error}
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
          <Button
            type="button"
            variant="primary"
            icon={<IconPlusOutline16 />}
            onClick={() => { setCreating(true); setError(null) }}
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
                  <div className="oac-bot-info">
                    <span className="oac-bot-name">{bot.name}</span>
                    <code className="oac-bot-id">oac-{bot.slug}</code>
                  </div>
                </div>
                {bot.dshLlmProvider && bot.dshLlmModel ? (
                  <div className="oac-bot-model">{bot.dshLlmProvider}/{bot.dshLlmModel}</div>
                ) : null}
                <div className="oac-bot-foot">
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
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Modal open={creating} onClose={() => setCreating(false)} title={t('createTitle')}>
        <CreateBotForm
          t={t}
          directory={directory}
          busy={busy}
          error={error}
          onCancel={() => setCreating(false)}
          onSubmit={onCreate}
        />
      </Modal>
    </div>
  )
}
