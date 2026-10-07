/**
 * First-run runtime setup card (My Bots section): when the host's
 * `runtime/check` reports the OAC runtime missing, stale, or not
 * auto-installable, this card replaces the scattered CLI errors with one
 * actionable surface. The install runs `npm i -g open-agent-connect@latest`
 * ONLY on an explicit button click — a global npm install is never silent.
 * Permission-class npm failures (EPERM/EACCES) degrade to a copyable manual
 * command.
 */
import { useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconCheckOutline16, IconLoadingOutline16, IconWarningOutline16 } from './icons.ts'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import { CopyIconButton } from './CopyIconButton.tsx'
import type { RuntimeCheckPayload, RuntimeInstallResult } from './api.ts'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export interface RuntimeSetupCardProps {
  runtime: RuntimeCheckPayload
  t: Translate
  install: () => Promise<RuntimeInstallResult>
  /** Notifies the owner (BotPanel) that the runtime became usable; it reloads the Bot list. */
  onInstalled: () => void
}

interface InstallFailure {
  message: string
  permission: boolean
  command: string
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  let text = template
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

export function RuntimeSetupCard({ runtime, t, install, onInstalled }: RuntimeSetupCardProps): ReactNode {
  const [installing, setInstalling] = useState(false)
  const [failure, setFailure] = useState<InstallFailure | null>(null)

  const runInstall = async (): Promise<void> => {
    if (installing) return
    setInstalling(true)
    setFailure(null)
    try {
      const result = await install()
      if (result.ok) {
        onInstalled()
      } else {
        setFailure({ message: result.message, permission: result.permission, command: result.command })
      }
    } catch (cause) {
      setFailure({
        message: cause instanceof Error ? cause.message : String(cause),
        permission: false,
        command: runtime.installCommand,
      })
    } finally {
      setInstalling(false)
    }
  }

  const manual = runtime.status === 'npm_unavailable'
  const title = manual
    ? t('setupTitleManual')
    : runtime.status === 'stale'
      ? t('setupTitleStale')
      : t('setupTitleMissing')
  const body = manual
    ? t('setupManualBody')
    : runtime.status === 'stale'
      ? interpolate(t('setupStaleBody', { found: runtime.runtimeVersion ?? '?', required: runtime.requiredVersion }), {
        found: runtime.runtimeVersion ?? '?',
        required: runtime.requiredVersion,
      })
      : t('setupMissingBody')
  const manualCommand = failure?.permission === true || manual
  const command = failure?.command ?? runtime.installCommand

  return (
    <div className="oac-setup-card" role="alert">
      <div className="oac-setup-card-head">
        <IconWarningOutline16 />
        <strong>{title}</strong>
      </div>
      <p className="oac-setup-card-body">{body}</p>
      {runtime.error ? (
        <p className="oac-hint">{interpolate(t('setupDetail', { message: runtime.error }), { message: runtime.error })}</p>
      ) : null}
      {manualCommand ? (
        <div className="oac-setup-card-command">
          {failure?.permission === true ? <p className="oac-hint">{t('setupPermissionHint')}</p> : null}
          <div className="oac-setup-card-command-row">
            <code>{command}</code>
            <CopyIconButton value={command} label={t('copy')} copiedLabel={t('copied')} />
          </div>
        </div>
      ) : null}
      {failure ? (
        <div className="oac-note error" role="alert">
          {failure.permission ? `${t('setupInstallFailed')}: ` : ''}
          {failure.message}
        </div>
      ) : null}
      {manual ? null : (
        <div className="oac-setup-card-actions">
          <Button
            type="button"
            variant="primary"
            disabled={installing}
            icon={installing ? <IconLoadingOutline16 className="oac-spin" /> : undefined}
            onClick={() => { void runInstall() }}
          >
            {installing
              ? t('setupInstalling')
              : runtime.status === 'stale' ? t('setupUpgrade') : t('setupInstall')}
          </Button>
          {failure && !installing ? (
            <Button type="button" variant="outline" onClick={() => { void runInstall() }}>
              {t('retry')}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** Transient success line BotPanel shows right after a guided install. */
export function RuntimeInstalledNote({ t }: { t: Translate }): ReactNode {
  return (
    <p className="oac-note success oac-setup-installed">
      <IconCheckOutline16 />
      {t('setupSuccess')}
    </p>
  )
}
