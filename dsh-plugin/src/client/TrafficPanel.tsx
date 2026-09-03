/**
 * Traffic (流量) settings panel — the DSH port of IDBots
 * `components/traffic/TrafficSettings.tsx`. Sections in one tab: billing-mode
 * toggle (account quota vs MetaBot self-pay), available quota with the
 * free-grant claim banner, redeem-code entry, usage (30-day summary, per-bot
 * daily table, ledger), and the advanced assist-service endpoint override.
 * Data comes from the `metabot traffic *` CLI verbs through the injected
 * face; copy lives in locale-traffic.ts; pure logic in ../traffic.ts.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  IconCheckOutline16,
  IconCopyOutline16,
  IconLoadingOutline16,
  IconQuestionOutline14,
  IconSparkle16,
  IconUserOutline16,
  IconWarningOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import { OacApiError, type BotRow, type OwnerWhoPayload } from './api.ts'
import {
  DEFAULT_FREE_GRANT_BYTES,
  TRAFFIC_LEDGER_DIRECTION_KEYS,
  TRAFFIC_LEDGER_KIND_KEYS,
  TRAFFIC_LEDGER_SOURCE_TYPE_KEYS,
  TRAFFIC_LOW_BALANCE_BYTES,
  formatTrafficLedgerTimestamp,
  isTrafficNetworkError,
  normalizeTrafficApiBase,
  shortTrafficAddress,
  splitTrafficAmount,
  trafficErrorCodeOf,
  trafficErrorLocaleKey,
  type TrafficAccountRecord,
  type TrafficApiBasePayload,
  type TrafficBalancePayload,
  type TrafficBindSummary,
  type TrafficClaimPayload,
  type TrafficDisplayUnit,
  type TrafficFreeGrantInfo,
  type TrafficLedgerEntry,
  type TrafficLedgerPayload,
  type TrafficMode,
  type TrafficModePayload,
  type TrafficRedeemPayload,
  type TrafficStatusPayload,
  type TrafficUsagePayload,
  type TrafficUsageSummary,
  type TrafficUsageRow,
} from '../traffic.ts'
import { interpolate } from './parse.ts'
import type { TrafficLocaleKey } from './locale-traffic.ts'

type Translate = (key: TrafficLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export interface TrafficPanelInjected {
  /** Owner identity (the traffic account binds to it), same call the User section uses. */
  who: () => Promise<OwnerWhoPayload>
  /** Local Bots, for display names in the usage table and ledger. */
  bots: () => Promise<BotRow[]>
  status: () => Promise<TrafficStatusPayload>
  /** `setMode('traffic')` also runs ensure-account + bind-all server-side. */
  setMode: (mode: TrafficMode) => Promise<TrafficModePayload>
  balance: () => Promise<TrafficBalancePayload>
  ledger: (cursor?: string, limit?: number) => Promise<TrafficLedgerPayload>
  usage: () => Promise<TrafficUsagePayload>
  claim: () => Promise<TrafficClaimPayload>
  redeem: (code: string) => Promise<TrafficRedeemPayload>
  apiBase: (action?: 'get' | 'set' | 'reset', value?: string) => Promise<TrafficApiBasePayload>
}

const TRAFFIC_UNIT_I18N_KEYS: Record<TrafficDisplayUnit, TrafficLocaleKey> = {
  bytes: 'trafficUnitBytes',
  kb: 'trafficUnitKb',
  mb: 'trafficUnitMb',
}

const TARIFF_ROWS = [
  { type: 'trafficTariffRowText', size: 'trafficTariffRowTextSize', capacity: 'trafficTariffRowTextCapacity' },
  { type: 'trafficTariffRowImage', size: 'trafficTariffRowImageSize', capacity: 'trafficTariffRowImageCapacity' },
  { type: 'trafficTariffRowHd', size: 'trafficTariffRowHdSize', capacity: 'trafficTariffRowHdCapacity' },
  { type: 'trafficTariffRowVideo', size: 'trafficTariffRowVideoSize', capacity: 'trafficTariffRowVideoCapacity' },
  { type: 'trafficTariffRowVector', size: 'trafficTariffRowVectorSize', capacity: 'trafficTariffRowVectorCapacity' },
] as const

function errorMessageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Copyable short TXID badge: click copies the full id, hover shows it in full. */
function LedgerTxIdBadge({ txId, t }: { txId: string; t: Translate }): ReactNode {
  const [copied, setCopied] = useState(false)
  const short = shortTrafficAddress(txId)

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(txId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable (permissions) — the title tooltip still shows the full id
    }
  }

  const label = copied ? t('trafficLedgerTxidCopied') : t('trafficLedgerCopyTxid')
  return (
    <span className="oac-traffic-txid" title={txId}>
      <code>{short}</code>
      <button
        type="button"
        className="oac-icon-btn oac-traffic-txid-btn"
        data-tip={label}
        aria-label={label}
        onClick={() => { void handleCopy() }}
      >
        {copied
          ? <IconCheckOutline16 size={12} className="oac-traffic-check" />
          : <IconCopyOutline16 size={12} />}
      </button>
    </span>
  )
}

export function TrafficPanel(injected: TrafficPanelInjected & { t: Translate }): ReactNode {
  const { t } = injected
  const [identityChecked, setIdentityChecked] = useState(false)
  const [identityAddress, setIdentityAddress] = useState('')
  const [statusReady, setStatusReady] = useState(false)
  const [mode, setMode] = useState<TrafficMode>('traffic')
  const [apiBase, setApiBase] = useState('')
  const [modeSaving, setModeSaving] = useState(false)
  const [bindState, setBindState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [bindSummary, setBindSummary] = useState<TrafficBindSummary | null>(null)
  const [bindError, setBindError] = useState('')
  const [balance, setBalance] = useState<TrafficAccountRecord | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceError, setBalanceError] = useState('')
  const [campaign, setCampaign] = useState<TrafficFreeGrantInfo | null>(null)
  const [campaignReady, setCampaignReady] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState('')
  const [claimNotice, setClaimNotice] = useState('')
  const [redeemOpen, setRedeemOpen] = useState(false)
  const [tariffOpen, setTariffOpen] = useState(false)
  const [rechargeNotice, setRechargeNotice] = useState('')
  const [redeemCodeInput, setRedeemCodeInput] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState('')
  const [redeemSuccess, setRedeemSuccess] = useState<TrafficRedeemPayload | null>(null)
  const [summary, setSummary] = useState<TrafficUsageSummary | null>(null)
  const [dailyRows, setDailyRows] = useState<TrafficUsageRow[]>([])
  const [usageError, setUsageError] = useState('')
  const [ledgerEntries, setLedgerEntries] = useState<TrafficLedgerEntry[]>([])
  const [ledgerCursor, setLedgerCursor] = useState('')
  const [ledgerDone, setLedgerDone] = useState(false)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState('')
  const [botNames, setBotNames] = useState<Record<string, string>>({})
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [apiBaseInput, setApiBaseInput] = useState('')
  const [apiBaseSaving, setApiBaseSaving] = useState(false)
  const [apiBaseError, setApiBaseError] = useState('')
  const [apiBaseNotice, setApiBaseNotice] = useState('')

  // Single funnel for error text shown in this panel: backend error codes
  // (data.errorCode) map to friendly copy first; network-level failures get
  // the friendly copy with the raw message appended; everything else passes
  // through unchanged. Same contract as IDBots describeTrafficError.
  const describeTrafficError = useCallback((raw: string, fallbackKey: TrafficLocaleKey, errorCode?: string): string => {
    const codeKey = trafficErrorLocaleKey(errorCode)
    if (codeKey) return t(codeKey as TrafficLocaleKey)
    const text = String(raw || '').trim()
    if (!text) return t(fallbackKey)
    if (isTrafficNetworkError(text)) {
      return `${t('trafficErrFriendly')} (${text})`
    }
    return text
  }, [t])

  // Adaptive traffic formatter (decimal: 1000 B = 1 KB, 1_000_000 B = 1 MB).
  const formatTraffic = useCallback((bytes: number): string => {
    const { amount, unit } = splitTrafficAmount(bytes)
    return `${amount} ${t(TRAFFIC_UNIT_I18N_KEYS[unit])}`
  }, [t])

  const formatBytesExact = useCallback(
    (bytes: number): string => `${bytes.toLocaleString()} ${t('trafficUnitBytes')}`,
    [t],
  )

  const formatAmountWithSign = useCallback((direction: number, amountBytes: number): string => {
    const sign = direction === 1 || direction === 4 ? '+' : '-'
    return `${sign}${formatTraffic(amountBytes)}`
  }, [formatTraffic])

  const applyStatus = useCallback((status: TrafficStatusPayload): void => {
    setMode(status.mode)
    setApiBase(status.apiBase)
    setStatusReady(true)
    setBalance(status.account)
    setCampaign(status.freeGrant)
    setCampaignReady(true)
  }, [])

  const refreshBalance = useCallback(async (): Promise<void> => {
    setBalanceLoading(true)
    setBalanceError('')
    try {
      const res = await injected.balance()
      if (res.account) {
        setBalance(res.account)
      } else {
        setBalance(null)
        // The assist service has no /v1/traffic/* — say so with the friendly copy.
        if (res.featureUnavailable) setBalanceError(t('trafficErrFriendly'))
      }
    } catch (cause) {
      setBalanceError(describeTrafficError(errorMessageOf(cause), 'trafficErrLoadBalance', trafficErrorCodeOf(cause)))
    } finally {
      setBalanceLoading(false)
    }
  }, [injected, t, describeTrafficError])

  // `traffic/usage` already folds in the CLI-side local-journal fallback; the
  // notice appears whenever the numbers did not come from the service.
  const loadUsage = useCallback(async (): Promise<void> => {
    try {
      const res = await injected.usage()
      setSummary(res.summary)
      setDailyRows(res.daily)
      setUsageError(res.source === 'service' ? '' : t('trafficUsageUnavailable'))
    } catch (cause) {
      setUsageError(describeTrafficError(errorMessageOf(cause), 'trafficUsageUnavailable', trafficErrorCodeOf(cause)))
    }
  }, [injected, t, describeTrafficError])

  const loadLedger = useCallback(async (cursor: string): Promise<void> => {
    setLedgerLoading(true)
    setLedgerError('')
    try {
      const res = await injected.ledger(cursor, 20)
      setLedgerEntries((previous) => (cursor ? [...previous, ...res.entries] : res.entries))
      const nextCursor = res.nextCursor ?? ''
      setLedgerCursor(nextCursor)
      setLedgerDone(!nextCursor || res.entries.length === 0)
    } catch (cause) {
      setLedgerError(describeTrafficError(errorMessageOf(cause), 'trafficErrLoadLedger', trafficErrorCodeOf(cause)))
    } finally {
      setLedgerLoading(false)
    }
  }, [injected, describeTrafficError])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const who = await injected.who().catch(() => null)
      if (cancelled) return
      const identity = who?.identity ?? null
      setIdentityAddress(identity?.mvcAddress ?? '')
      setIdentityChecked(true)
      if (!identity) return

      void injected.bots().then((rows) => {
        if (cancelled) return
        const names: Record<string, string> = {}
        for (const bot of rows) {
          if (bot.mvcAddress && bot.name) {
            names[bot.mvcAddress.toLowerCase()] = bot.name
          }
        }
        setBotNames(names)
      }).catch(() => {})

      const status = await injected.status().catch(() => null)
      if (cancelled) return
      if (status) {
        applyStatus(status)
        if (status.mode === 'traffic') {
          // Silent ensure-account + bind-all on panel open (idempotent, same
          // as IDBots); re-read status so a freshly ensured account shows up.
          void injected.setMode('traffic')
            .then(() => injected.status())
            .then((fresh) => { if (!cancelled) applyStatus(fresh) })
            .catch(() => {})
        }
      } else {
        setCampaignReady(true)
      }
      await refreshBalance()
      if (cancelled) return
      void loadUsage()
      void loadLedger('')
    })()
    return () => { cancelled = true }
  }, [injected, applyStatus, refreshBalance, loadUsage, loadLedger])

  const resolveBotLabel = useCallback((address: string, hint?: string): string => {
    const normalized = String(address || '').toLowerCase()
    if (!normalized) return '—'
    if (identityAddress && normalized === identityAddress.toLowerCase()) {
      return `${t('trafficYouIdentity')} · ${shortTrafficAddress(address)}`
    }
    const name = botNames[normalized] ?? hint
    return name ? `${name} · ${shortTrafficAddress(address)}` : shortTrafficAddress(address)
  }, [botNames, identityAddress, t])

  const resolveLedgerKindLabel = useCallback((kind: string): string => {
    const normalized = String(kind || '').trim().toLowerCase()
    if (!normalized) return ''
    const key = TRAFFIC_LEDGER_KIND_KEYS[normalized]
    if (key) return t(key as TrafficLocaleKey)
    // Unknown kind: shorthand for the raw path ('/protocols/paycomment' -> 'paycomment').
    if (normalized.startsWith('/protocols/')) return normalized.slice('/protocols/'.length)
    return normalized
  }, [t])

  // Ledger source column: friendly kind + bot name for locally enriched
  // entries; the raw sourceType/remark pair for everything else.
  const resolveLedgerSourceLabel = useCallback((entry: TrafficLedgerEntry): string => {
    const parts: string[] = []
    const kindLabel = resolveLedgerKindLabel(entry.kind ?? '')
    if (kindLabel) parts.push(kindLabel)
    const botAddress = String(entry.botAddress || '')
    if (botAddress) {
      const normalized = botAddress.toLowerCase()
      if (identityAddress && normalized === identityAddress.toLowerCase()) {
        parts.push(t('trafficYouIdentity'))
      } else {
        parts.push(botNames[normalized] ?? entry.botName ?? shortTrafficAddress(botAddress))
      }
    }
    if (parts.length > 0) return parts.join(' · ')
    const sourceKey = TRAFFIC_LEDGER_SOURCE_TYPE_KEYS[entry.sourceType]
    const sourceLabel = sourceKey ? t(sourceKey as TrafficLocaleKey) : entry.sourceType
    return `${sourceLabel}${entry.remark ? ` · ${entry.remark}` : ''}`
  }, [botNames, identityAddress, resolveLedgerKindLabel, t])

  const ledgerDirectionLabel = useCallback((direction: number): string => {
    const key = TRAFFIC_LEDGER_DIRECTION_KEYS[direction]
    return key
      ? t(key as TrafficLocaleKey)
      : interpolate(t('trafficLedgerTypeUnknown'), { direction })
  }, [t])

  // Failure fallback picks the stage off the CLI error code
  // (`traffic_ensure_failed` / `traffic_bind_failed` / other).
  const bindFallbackKey = (cause: unknown): TrafficLocaleKey => {
    const code = cause instanceof OacApiError ? cause.code : ''
    if (code.includes('ensure')) return 'trafficEnsureAccountFailed'
    if (code.includes('bind')) return 'trafficBindBotsFailed'
    return 'trafficBindFailed'
  }

  const handleSelectMode = async (next: TrafficMode): Promise<void> => {
    if (!statusReady || modeSaving || mode === next) return
    setModeSaving(true)
    if (next === 'traffic') {
      setBindState('running')
      setBindError('')
      setBindSummary(null)
    }
    try {
      const res = await injected.setMode(next)
      setMode(res.mode)
      if (next === 'traffic') {
        if (res.bindSummary) {
          setBindSummary(res.bindSummary)
          setBindState('done')
        } else {
          setBindState('idle')
        }
        // The account/free-grant may have just been created; re-read status.
        const fresh = await injected.status().catch(() => null)
        if (fresh) applyStatus(fresh)
      }
    } catch (cause) {
      if (next === 'traffic') {
        setBindState('error')
        setBindError(describeTrafficError(errorMessageOf(cause), bindFallbackKey(cause), trafficErrorCodeOf(cause)))
      }
    } finally {
      setModeSaving(false)
    }
  }

  const handleSaveApiBase = async (value: string): Promise<void> => {
    if (apiBaseSaving) return
    let normalized = ''
    try {
      normalized = normalizeTrafficApiBase(value)
    } catch (cause) {
      setApiBaseError(describeTrafficError(errorMessageOf(cause), 'trafficErrSaveApiBase'))
      return
    }
    setApiBaseSaving(true)
    setApiBaseError('')
    setApiBaseNotice('')
    try {
      const res = normalized
        ? await injected.apiBase('set', normalized)
        : await injected.apiBase('reset')
      setApiBase(res.apiBase)
      setApiBaseInput('')
      setApiBaseNotice(t('trafficApiBaseSaved'))
      void refreshBalance()
    } catch (cause) {
      setApiBaseError(describeTrafficError(errorMessageOf(cause), 'trafficErrSaveApiBase', trafficErrorCodeOf(cause)))
    } finally {
      setApiBaseSaving(false)
    }
  }

  const handleClaimFreeGrant = async (): Promise<void> => {
    if (claiming) return
    setClaiming(true)
    setClaimError('')
    setClaimNotice('')
    try {
      const res = await injected.claim()
      setClaimNotice(interpolate(t('trafficFreeGrantClaimSuccess'), { amount: formatTraffic(res.grantBytes) }))
      setCampaign({
        enabled: true,
        grantBytes: res.grantBytes,
        claimed: true,
        claimable: false,
      })
      const fresh = await injected.status().catch(() => null)
      if (fresh) applyStatus(fresh)
      void loadLedger('')
    } catch (cause) {
      setClaimError(describeTrafficError(errorMessageOf(cause), 'trafficErrClaimFailed', trafficErrorCodeOf(cause)))
    } finally {
      setClaiming(false)
    }
  }

  const handleRedeemCode = async (): Promise<void> => {
    const code = redeemCodeInput.trim()
    if (redeeming || !code) return
    setRedeeming(true)
    setRedeemError('')
    setRedeemSuccess(null)
    try {
      const res = await injected.redeem(code)
      setRedeemSuccess(res)
      setRedeemCodeInput('')
      void refreshBalance()
      void loadUsage()
      void loadLedger('')
    } catch (cause) {
      setRedeemError(describeTrafficError(errorMessageOf(cause), 'trafficRedeemFailed', trafficErrorCodeOf(cause)))
    } finally {
      setRedeeming(false)
    }
  }

  const openRedeem = (): void => {
    setRedeemOpen(true)
    setRedeemError('')
    setRedeemSuccess(null)
  }

  const notifyRechargeSoon = (): void => {
    setRechargeNotice(t('trafficRechargeSoon'))
    window.setTimeout(() => setRechargeNotice(''), 2500)
  }

  // Prefer the server claimable flag; also treat enabled && !claimed as
  // claimable (same backend formula) so a missing/false claimable field
  // cannot hide the button. If status failed after the account exists,
  // keep the button so a fresh install can still claim.
  const canClaimFreeGrant = campaign
    ? Boolean(!campaign.claimed && (campaign.claimable || campaign.enabled))
    : Boolean(campaignReady && balance)
  const freeGrantBytes = campaign?.grantBytes || DEFAULT_FREE_GRANT_BYTES

  if (!identityChecked) {
    return (
      <div className="oac-panel">
        <p className="oac-muted">{t('trafficLoading')}</p>
      </div>
    )
  }

  if (!identityAddress) {
    return (
      <div className="oac-panel">
        <section className="oac-section-card oac-traffic-identity-empty">
          <IconUserOutline16 className="oac-traffic-identity-icon" />
          <div className="oac-section-text">
            <span className="oac-section-title">{t('trafficCreateIdentityFirst')}</span>
            <span className="oac-section-hint">{t('trafficCreateIdentityDesc')}</span>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="oac-panel">
      <div className="oac-row">
        <h2>{t('title')}</h2>
      </div>

      {/* Mode */}
      <section className="oac-traffic-section">
        <span className="oac-section-title">{t('trafficModeTitle')}</span>
        <p className="oac-hint">{t('trafficModeDesc')}</p>
        <div className="oac-traffic-seg" role="group">
          {([
            { value: 'traffic' as const, title: t('trafficModeTrafficTitle') },
            { value: 'selfpay' as const, title: t('trafficModeSelfpayTitle') },
          ]).map((option) => (
            <button
              key={option.value}
              type="button"
              className="oac-traffic-seg-btn"
              data-active={mode === option.value}
              disabled={modeSaving || !statusReady}
              onClick={() => { void handleSelectMode(option.value) }}
            >
              {option.title}
            </button>
          ))}
        </div>
        <p className="oac-hint">
          {t(mode === 'selfpay' ? 'trafficModeSelfpayHint' : 'trafficModeTrafficHint')}
        </p>

        {bindState === 'running' ? (
          <p className="oac-hint">{t('trafficBindingRunning')}</p>
        ) : null}
        {bindState === 'done' && bindSummary ? (
          <p className="oac-note oac-traffic-accent">
            {interpolate(t('trafficBindSummary'), {
              bound: bindSummary.boundCount,
              boundPlural: bindSummary.boundCount === 1 ? '' : 'es',
              conflictClause: bindSummary.conflictCount > 0
                ? interpolate(t('trafficBindSummaryConflict'), { count: bindSummary.conflictCount })
                : '',
            })}
          </p>
        ) : null}
        {bindState === 'error' ? (
          <p className="oac-note error">{bindError || t('trafficBindFailed')}</p>
        ) : null}
      </section>

      {/* Balance */}
      <section className="oac-section-card">
        <div className="oac-traffic-balance-top">
          <div className="oac-traffic-balance-main">
            <span className="oac-field-label oac-traffic-balance-label">
              {t('trafficBalanceTitle')}
              <button
                type="button"
                className="oac-icon-btn oac-traffic-tariff-btn"
                data-tip={t('trafficTariffAria')}
                aria-label={t('trafficTariffAria')}
                onClick={() => setTariffOpen(true)}
              >
                <IconQuestionOutline14 />
              </button>
            </span>
            <div className="oac-traffic-balance-row">
              <span
                className="oac-traffic-balance-value"
                title={balance ? formatBytesExact(balance.balanceBytes) : undefined}
              >
                {balance ? formatTraffic(balance.balanceBytes) : '—'}
              </span>
              {balanceLoading ? <IconLoadingOutline16 className="oac-traffic-spin" /> : null}
            </div>
            {balance ? (
              <p className="oac-hint">
                {interpolate(t('trafficBalanceStats'), {
                  reserved: formatTraffic(balance.reservedBytes),
                  spent: formatTraffic(balance.spentBytesTotal),
                })}
              </p>
            ) : null}
          </div>
          <div className="oac-traffic-balance-actions">
            <div className="oac-traffic-btn-row">
              <Button type="button" variant="outline" disabled={balanceLoading} onClick={() => { void refreshBalance() }}>
                {t('trafficRefresh')}
              </Button>
              <Button type="button" variant="outline" onClick={openRedeem}>
                {t('trafficRedeemCode')}
              </Button>
              <Button type="button" variant="primary" icon={<IconSparkle16 />} onClick={notifyRechargeSoon}>
                {t('trafficRecharge')}
              </Button>
            </div>
            {rechargeNotice ? <p className="oac-note oac-traffic-accent">{rechargeNotice}</p> : null}
          </div>
        </div>
        {(canClaimFreeGrant || claimNotice) ? (
          <div className="oac-traffic-grant">
            <p>{claimNotice || t('trafficFreeGrantHint')}</p>
            {canClaimFreeGrant && !claimNotice ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => { void handleClaimFreeGrant() }}
                disabled={claiming}
              >
                {claiming
                  ? t('trafficFreeGrantClaiming')
                  : interpolate(t('trafficFreeGrantClaim'), { amount: formatTraffic(freeGrantBytes) })}
              </Button>
            ) : null}
          </div>
        ) : null}
        {claimError ? <p className="oac-note error">{claimError}</p> : null}
        {balanceError ? (
          <div className="oac-traffic-error-row">
            <p className="oac-note error">{balanceError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => { void refreshBalance() }}>
              {t('trafficRetry')}
            </Button>
          </div>
        ) : null}
        {balance && balance.balanceBytes < TRAFFIC_LOW_BALANCE_BYTES ? (
          <div className="oac-traffic-low">
            <IconWarningOutline16 />
            <p>{t('trafficLowBalanceWarning')}</p>
          </div>
        ) : null}
      </section>

      {/* Usage */}
      <section className="oac-traffic-section">
        <span className="oac-section-title">{t('trafficUsageTitle')}</span>
        {summary ? (
          <div className="oac-traffic-summary-grid">
            {([
              { label: t('trafficSummaryToday'), bytes: summary.todayBytes },
              { label: t('trafficSummaryWeek'), bytes: summary.weekBytes },
              { label: t('trafficSummaryMonth'), bytes: summary.monthBytes },
            ]).map((item) => (
              <div key={item.label} className="oac-traffic-stat">
                <div className="oac-traffic-stat-value">{formatTraffic(item.bytes)}</div>
                <div className="oac-traffic-stat-label">{item.label}</div>
              </div>
            ))}
          </div>
        ) : null}

        {usageError ? <p className="oac-hint">{usageError}</p> : null}
        {dailyRows.length > 0 ? (
          <div className="oac-traffic-table-wrap">
            <table className="oac-traffic-table">
              <thead>
                <tr>
                  <th>{t('trafficTableDate')}</th>
                  <th>{t('trafficTableBot')}</th>
                  <th className="num">{t('trafficTableTraffic')}</th>
                  <th className="num">{t('trafficTableWrites')}</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((row) => (
                  <tr key={`${row.date}|${row.botAddress}`}>
                    <td className="num">{row.date}</td>
                    <td>{resolveBotLabel(row.botAddress, row.botName)}</td>
                    <td className="num" title={formatBytesExact(row.bytes)}>{formatTraffic(row.bytes)}</td>
                    <td className="num">{row.txCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !usageError ? <p className="oac-hint">{t('trafficUsageEmpty')}</p> : null
        )}

        <span className="oac-section-title oac-traffic-ledger-title">{t('trafficLedgerTitle')}</span>
        {ledgerEntries.length > 0 ? (
          <div className="oac-section-card oac-traffic-ledger">
            {ledgerEntries.map((entry) => (
              <div key={entry.id} className="oac-traffic-ledger-row">
                <span className="oac-traffic-ledger-time">{formatTrafficLedgerTimestamp(entry.timestamp)}</span>
                <span className="oac-traffic-ledger-dir">{ledgerDirectionLabel(entry.direction)}</span>
                <span
                  className="oac-traffic-ledger-src"
                  title={[entry.kind, entry.botAddress].filter(Boolean).join(' · ') || undefined}
                >
                  {resolveLedgerSourceLabel(entry)}
                </span>
                {entry.txId ? <LedgerTxIdBadge txId={entry.txId} t={t} /> : null}
                <span className="oac-traffic-ledger-amount">{formatAmountWithSign(entry.direction, entry.amountBytes)}</span>
              </div>
            ))}
          </div>
        ) : (
          !ledgerError ? <p className="oac-hint">{t('trafficLedgerEmpty')}</p> : null
        )}
        {ledgerError ? (
          <div className="oac-traffic-error-row">
            <p className="oac-note error">{ledgerError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => { void loadLedger('') }}>
              {t('trafficRetry')}
            </Button>
          </div>
        ) : null}
        {!ledgerDone && ledgerEntries.length > 0 ? (
          <div className="oac-traffic-ledger-more">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { void loadLedger(ledgerCursor) }}
              disabled={ledgerLoading}
            >
              {ledgerLoading ? t('trafficLedgerLoading') : t('trafficLedgerLoadMore')}
            </Button>
          </div>
        ) : null}
      </section>

      {/* Advanced: assist-service endpoint override (integration testing) */}
      <section className="oac-section-card">
        <button
          type="button"
          className="oac-traffic-disclosure"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <span className="oac-section-title">{t('trafficAdvanced')}</span>
          <span className="oac-hint">{advancedOpen ? t('trafficAdvancedHide') : t('trafficAdvancedShow')}</span>
        </button>
        {advancedOpen ? (
          <div className="oac-traffic-advanced">
            <span className="oac-field-label">{t('trafficApiBaseLabel')}</span>
            <p className="oac-hint">
              {interpolate(t('trafficApiBaseCurrent'), { value: apiBase ? apiBase : t('trafficApiBaseDefault') })}
            </p>
            <p className="oac-hint">{t('trafficApiBaseDesc')}</p>
            <div className="oac-traffic-apibase-row">
              <input
                type="text"
                className="oac-input"
                value={apiBaseInput}
                onChange={(event) => {
                  setApiBaseInput(event.target.value)
                  setApiBaseError('')
                  setApiBaseNotice('')
                }}
                placeholder={t('trafficApiBasePlaceholder')}
              />
              <Button
                type="button"
                variant="primary"
                onClick={() => { void handleSaveApiBase(apiBaseInput) }}
                disabled={apiBaseSaving || !apiBaseInput.trim()}
              >
                {apiBaseSaving ? t('trafficApiBaseSaving') : t('trafficApiBaseSave')}
              </Button>
              {apiBase ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { void handleSaveApiBase('') }}
                  disabled={apiBaseSaving}
                >
                  {t('trafficApiBaseReset')}
                </Button>
              ) : null}
            </div>
            {apiBaseError ? <p className="oac-note error">{apiBaseError}</p> : null}
            {apiBaseNotice ? <p className="oac-note oac-traffic-accent">{apiBaseNotice}</p> : null}
          </div>
        ) : null}
      </section>

      <Modal
        closeLabel={t('trafficClose')}
        open={redeemOpen}
        onClose={() => setRedeemOpen(false)}
        title={t('trafficRedeemTitle')}
        description={t('trafficRedeemDesc')}
        className="oac-dialog"
      >
        <div className="oac-traffic-redeem">
          <div className="oac-traffic-redeem-row">
            <input
              type="text"
              className="oac-input oac-traffic-redeem-input"
              value={redeemCodeInput}
              onChange={(event) => {
                setRedeemCodeInput(event.target.value.toUpperCase())
                setRedeemError('')
                setRedeemSuccess(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleRedeemCode()
                }
              }}
              placeholder={t('trafficRedeemPlaceholder')}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="primary"
              onClick={() => { void handleRedeemCode() }}
              disabled={redeeming || !redeemCodeInput.trim()}
            >
              {redeeming ? t('trafficRedeeming') : t('trafficRedeemButton')}
            </Button>
          </div>
          {redeemError ? <p className="oac-note error">{redeemError}</p> : null}
          {redeemSuccess ? (
            <div className="oac-traffic-redeem-success">
              <IconCheckOutline16 className="oac-traffic-check" />
              <div className="oac-section-text">
                <span className="oac-section-title">
                  {interpolate(t('trafficRedeemSuccess'), { traffic: formatTraffic(redeemSuccess.trafficBytes) })}
                </span>
                <span className="oac-section-hint">
                  {interpolate(t('trafficNewBalance'), { balance: formatTraffic(redeemSuccess.balanceAfter) })}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        closeLabel={t('trafficClose')}
        open={tariffOpen}
        onClose={() => setTariffOpen(false)}
        title={t('trafficTariffTitle')}
        className="oac-traffic-tariff-dialog"
      >
        <table className="oac-traffic-table oac-traffic-tariff-table">
          <thead>
            <tr>
              <th>{t('trafficTariffColType')}</th>
              <th>{t('trafficTariffColSize')}</th>
              <th className="num">{t('trafficTariffColCapacity')}</th>
            </tr>
          </thead>
          <tbody>
            {TARIFF_ROWS.map((row) => (
              <tr key={row.type}>
                <td className="oac-traffic-tariff-type">{t(row.type)}</td>
                <td className="num">{t(row.size)}</td>
                <td className="num oac-traffic-tariff-capacity">{t(row.capacity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </div>
  )
}
