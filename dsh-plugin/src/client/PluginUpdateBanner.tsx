/**
 * Non-blocking update notice for the Bots page.
 *
 * The host checks the configured npm registry and exposes only a read-only
 * status. The button asks the host to hand the update to DSH pluginManager;
 * no package file is ever replaced by OAC itself. When DSH removes this
 * plugin to install the new version, this component naturally unmounts.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import { pluginUpdateApply, pluginUpdateProgress, pluginUpdateStatus, type PluginUpdateCheckPayload, type PluginUpdateProgressPayload } from './api.ts'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

const STEP_KEYS: Record<NonNullable<PluginUpdateProgressPayload['step']>, BotsLocaleKey> = {
  checking: 'updateStepChecking',
  removing: 'updateStepRemoving',
  installing: 'updateStepInstalling',
  restoring: 'updateStepRestoring',
}

export function PluginUpdateBanner({ t }: { t: Translate }): ReactNode {
  const [status, setStatus] = useState<PluginUpdateCheckPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [step, setStep] = useState<PluginUpdateProgressPayload['step'] | null>(null)

  useEffect(() => {
    let live = true
    void pluginUpdateStatus().then((next) => { if (live) setStatus(next) }, () => undefined)
    return () => { live = false }
  }, [])

  // Native DSH 0.2.2+ updates announce progress steps; poll while applying.
  // Old kernels never report active progress, so the label stays on the
  // generic "Updating..." text.
  useEffect(() => {
    if (!busy) {
      setStep(null)
      return
    }
    let live = true
    const poll = (): void => {
      void pluginUpdateProgress().then((next) => {
        if (live && next?.active === true && next.step !== undefined) setStep(next.step)
      }, () => undefined)
    }
    poll()
    const timer = setInterval(poll, 1200)
    return () => { live = false; clearInterval(timer) }
  }, [busy])

  if (status === null || (status.updateAvailable === false && message === null)) return null
  const latest = status.latest ?? ''

  const apply = (): void => {
    setBusy(true)
    setMessage(null)
    void pluginUpdateApply().then(
      (result) => {
        if (result.application === 'restart-required') setMessage(t('updateRestart'))
        setBusy(false)
        void pluginUpdateStatus(true).then((next) => setStatus(next), () => undefined)
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error)
        setMessage(t('updateFailed', { message: reason }))
        setBusy(false)
      },
    )
  }

  return (
    <div
      role="status"
      data-oac-update-banner=""
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        margin: '0 0 12px',
        padding: '10px 12px',
        border: '1px solid var(--dsw-alias-border-l2, #e6e7eb)',
        borderRadius: 12,
        background: 'var(--dsw-alias-bg-layer-1, #f7f7f8)',
      }}
    >
      <div style={{ display: 'grid', gap: 2, flex: '1 1 auto', minWidth: 0 }}>
        <strong style={{ fontSize: 13 }}>{t('updateAvailable')}</strong>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {t('updateVersion', { current: status.current, latest })}
        </span>
        {message === null ? null : <span style={{ fontSize: 12, opacity: 0.8 }}>{message}</span>}
      </div>
      <Button variant="outline" size="sm" disabled={busy} onClick={apply}>
        {busy ? (step === null ? t('updating') : t(STEP_KEYS[step])) : t('updateNow')}
      </Button>
    </div>
  )
}
