import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, IconRefreshOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { BotRow, BotWalletPayload } from './api.ts'
import { CopyIconButton } from './CopyIconButton.tsx'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

/** Chain table of the OAC /ui/bot wallet panel (label + display unit). */
const WALLET_CHAINS = [
  { chain: 'btc', label: 'BTC', unit: 'BTC' },
  { chain: 'mvc', label: 'MVC', unit: 'SPACE' },
  { chain: 'doge', label: 'DOGE', unit: 'Doge' },
  { chain: 'opcat', label: 'OPCAT', unit: 'OPCAT-BTC' },
] as const

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function shortAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address
}

function formatBalance(balance: { totalSatoshis?: number } | undefined, unit: string): string {
  const satoshis = typeof balance?.totalSatoshis === 'number' ? balance.totalSatoshis : 0
  return `${(satoshis / 1e8).toFixed(8)} ${unit}`
}

export function BotWalletModal({
  bot,
  t,
  botWallet,
  onClose,
}: {
  bot: BotRow
  t: Translate
  botWallet: (slug: string) => Promise<BotWalletPayload>
  onClose: () => void
}): ReactNode {
  const [wallet, setWallet] = useState<BotWalletPayload | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState('')

  const refresh = useCallback((): void => {
    setStatus('loading')
    setErrorMessage('')
    void botWallet(bot.slug).then(
      (payload) => {
        setWallet(payload)
        setStatus('ready')
      },
      (cause: unknown) => {
        // Keep the last loaded addresses: rows fall back to the per-row
        // "Error" balance text while the banner carries the failure detail.
        setStatus('error')
        setErrorMessage(errorText(cause))
      },
    )
  }, [bot.slug, botWallet])

  useEffect(() => {
    refresh()
  }, [refresh])

  const rows = WALLET_CHAINS
    .map((row) => ({ ...row, address: wallet?.addresses[row.chain] ?? '' }))
    .filter((row) => row.address !== '')

  return (
    <Modal
      closeLabel={t('close')}
      open
      onClose={onClose}
      title={t('wallet')}
      description={bot.name}
      className="oac-dialog"
      footer={(
        <>
          <Button
            type="button"
            variant="outline"
            icon={<IconRefreshOutline16 />}
            disabled={status === 'loading'}
            title={t('refreshBalances')}
            onClick={refresh}
          >
            {t('refreshBalances')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('close')}
          </Button>
        </>
      )}
    >
      {status === 'error' ? <p className="oac-note error">{errorMessage || t('balanceError')}</p> : null}
      {rows.length === 0 && status === 'loading' ? <p className="oac-note saving">{t('balanceLoading')}</p> : null}
      {rows.length === 0 && status === 'ready' ? <p className="oac-hint">{t('walletEmpty')}</p> : null}
      {rows.length > 0 ? (
        <div className="oac-wallet-rows">
          {rows.map((row) => (
            <div className="oac-wallet-row" key={row.chain}>
              <span className="oac-wallet-chain">{row.label}</span>
              <code className="oac-wallet-address" title={row.address}>{shortAddress(row.address)}</code>
              <span className="oac-wallet-balance">
                {status === 'loading'
                  ? t('balanceLoading')
                  : status === 'error'
                    ? t('balanceError')
                    : formatBalance(wallet?.balances[row.chain], row.unit)}
              </span>
              <CopyIconButton value={row.address} label={t('copyAddress')} copiedLabel={t('addressCopied')} />
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  )
}
