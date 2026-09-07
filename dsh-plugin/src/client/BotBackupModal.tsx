import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconWarningOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { BotBackupPayload, BotRow } from './api.ts'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function BotBackupModal({
  bot,
  t,
  botBackup,
  onClose,
}: {
  bot: BotRow
  t: Translate
  botBackup: (slug: string) => Promise<BotBackupPayload>
  onClose: () => void
}): ReactNode {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [words, setWords] = useState<string[]>([])

  useEffect(() => {
    let current = true
    void botBackup(bot.slug).then(
      (payload) => {
        if (!current) return
        setWords(payload.words)
        setStatus('ready')
      },
      (cause: unknown) => {
        if (!current) return
        setErrorMessage(errorText(cause))
        setStatus('error')
      },
    )
    return () => { current = false }
  }, [bot.slug, botBackup])

  return (
    <Modal
      closeLabel={t('close')}
      open
      onClose={onClose}
      title={`${t('backupMnemonic')}: ${bot.name}`}
      className="oac-dialog"
      footer={(
        <Button type="button" variant="outline" onClick={onClose}>
          {t('close')}
        </Button>
      )}
    >
      <div className="oac-backup-warn">
        <IconWarningOutline16 />
        <p>{t('backupMnemonicHint')}</p>
      </div>
      <div className="oac-mnemonic-box">
        {status === 'loading' ? <p className="oac-note saving">{t('balanceLoading')}</p> : null}
        {status === 'error' ? <p className="oac-note error">{errorMessage || t('mnemonicLoadFailed')}</p> : null}
        {status === 'ready' && words.length === 0 ? <p className="oac-note error">{t('mnemonicEmpty')}</p> : null}
        {status === 'ready' && words.length > 0 ? (
          <ol className="oac-mnemonic-grid">
            {words.map((word, index) => (
              <li key={`${index}-${word}`}>
                <span className="oac-mnemonic-index">{index + 1}.</span>
                <span>{word}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </Modal>
  )
}
