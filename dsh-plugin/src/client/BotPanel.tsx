import { useEffect, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
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
          <Button type="button" onClick={reload}>{t('refresh')}</Button>
          <Button type="button" onClick={() => { setCreating(true); setError(null) }}>{t('createNew')}</Button>
        </div>
      </div>
      {error && !creating ? <div className="oac-error">{error}</div> : null}
      {bots === null && !error ? <div className="oac-muted">{t('loading')}</div> : null}
      {bots && bots.length === 0 ? <div className="oac-muted">{t('empty')}</div> : null}
      {bots && bots.length > 0 ? (
        <>
          <div className="oac-muted">{t('count', { count: bots.length }).replace('{count}', String(bots.length))}</div>
          <div className="oac-card-list">
            {bots.map((bot) => (
              <div className="oac-card" key={bot.slug}>
                <strong>{bot.name}</strong>
                <div className="oac-mono">{bot.slug} · oac-{bot.slug}</div>
                <div className="oac-muted">{bot.dshLlmProvider && bot.dshLlmModel ? `${bot.dshLlmProvider}/${bot.dshLlmModel}` : ''}</div>
                <Button type="button" onClick={() => { setEditing(bot); setError(null) }}>{t('edit')}</Button>
              </div>
            ))}
          </div>
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
