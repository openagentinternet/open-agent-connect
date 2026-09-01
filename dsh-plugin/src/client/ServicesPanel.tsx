import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { BotRow, CommandEnvelope } from './api.ts'
import type { ServicesLocaleKey } from './locale-services.ts'
import { asRecordArray, interpolate, textOf } from './parse.ts'

type Translate = (key: ServicesLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string

export interface ServicesPanelInjected {
  bots: () => Promise<BotRow[]>
  owned: (from: string) => Promise<unknown>
  orders: (from: string, serviceId: string) => Promise<unknown>
  publish: (from: string, payload: Record<string, unknown>) => Promise<CommandEnvelope>
  revoke: (from: string, serviceId: string) => Promise<CommandEnvelope>
  call: (from: string, request: Record<string, unknown>, confirm?: boolean) => Promise<CommandEnvelope>
}

export function ServicesPanel({
  bots,
  owned,
  orders,
  publish,
  revoke,
  call,
  t,
}: ServicesPanelInjected & { t: Translate }): ReactNode {
  const [profiles, setProfiles] = useState<BotRow[]>([])
  const [from, setFrom] = useState('')
  const [tab, setTab] = useState<'owned' | 'call'>('owned')
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const [orderRows, setOrderRows] = useState<Record<string, unknown>[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const [publishing, setPublishing] = useState(false)
  const [revoking, setRevoking] = useState<Record<string, unknown> | null>(null)
  const [pendingCall, setPendingCall] = useState<CommandEnvelope | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [serviceName, setServiceName] = useState('')
  const [description, setDescription] = useState('')
  const [skill, setSkill] = useState('')
  const [price, setPrice] = useState('0')
  const [currency, setCurrency] = useState('SPACE')
  const [outputType, setOutputType] = useState('text')
  const [servicePinId, setServicePinId] = useState('')
  const [provider, setProvider] = useState('')
  const [task, setTask] = useState('')
  const [spendAmount, setSpendAmount] = useState('')
  const [spendCurrency, setSpendCurrency] = useState('SPACE')
  const [lastRequest, setLastRequest] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    void bots().then((list) => {
      setProfiles(list)
      setFrom((current) => current || list[0]?.slug || '')
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [bots])

  useEffect(() => {
    if (!from || tab !== 'owned') return
    let current = true
    setRows(null)
    setSelected(null)
    setOrderRows([])
    void owned(from).then(
      (data) => {
        if (!current) return
        setRows(asRecordArray(data, ['items', 'services']))
        setError(null)
      },
      (cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => { current = false }
  }, [from, owned, tab, tick])

  const open = async (row: Record<string, unknown>): Promise<void> => {
    const id = textOf(row, ['currentPinId', 'serviceId', 'id', 'sourceServicePinId'])
    setSelected(row)
    if (!from || !id) return
    try {
      const data = await orders(from, id)
      setOrderRows(asRecordArray(data, ['items', 'orders']))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const onPublish = async (): Promise<void> => {
    if (!from) return
    setBusy(true)
    try {
      await publish(from, {
        displayName,
        serviceName,
        description,
        providerSkill: skill,
        price,
        currency,
        outputType,
      })
      setPublishing(false)
      setTick((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const onRevoke = async (): Promise<void> => {
    if (!from || !revoking) return
    const id = textOf(revoking, ['currentPinId', 'serviceId', 'id'])
    if (!id) return
    setBusy(true)
    try {
      await revoke(from, id)
      setRevoking(null)
      setTick((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const runCall = async (confirm: boolean): Promise<void> => {
    if (!from) return
    const request = lastRequest ?? {
      servicePinId,
      providerGlobalMetaId: provider,
      userTask: task,
      ...(spendAmount.trim()
        ? { spendCap: { amount: spendAmount.trim(), currency: spendCurrency } }
        : {}),
    }
    setLastRequest(request)
    setBusy(true)
    try {
      const result = await call(from, request, confirm)
      if (result.state === 'awaiting_confirmation') {
        setPendingCall(result)
        return
      }
      setPendingCall(null)
      setLastRequest(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="oac-panel">
      <div className="oac-row">
        <h2>{t('title')}</h2>
        <div className="oac-actions">
          <Button type="button" onClick={() => setTick((value) => value + 1)}>{t('refresh')}</Button>
          {tab === 'owned' ? (
            <Button type="button" onClick={() => { setPublishing(true); setError(null) }}>{t('publish')}</Button>
          ) : null}
        </div>
      </div>
      {error ? <div className="oac-error">{error}</div> : null}
      <label className="oac-form">
        {t('fieldBot')}
        <select value={from} onChange={(event) => setFrom(event.target.value)}>
          <option value="">{t('pickBot')}</option>
          {profiles.map((bot) => (
            <option key={bot.slug} value={bot.slug}>{bot.name} ({bot.slug})</option>
          ))}
        </select>
      </label>
      <div className="oac-tabs">
        <button type="button" data-active={tab === 'owned' ? 'true' : 'false'} onClick={() => setTab('owned')}>{t('tabOwned')}</button>
        <button type="button" data-active={tab === 'call' ? 'true' : 'false'} onClick={() => setTab('call')}>{t('tabCall')}</button>
      </div>
      {tab === 'owned' ? (
        <div className="oac-split">
          <div className="oac-card-list">
            {rows === null && from ? <div className="oac-muted">{t('loading')}</div> : null}
            {rows && rows.length === 0 ? <div className="oac-muted">{t('empty')}</div> : null}
            {rows?.map((row) => {
              const id = textOf(row, ['currentPinId', 'serviceId', 'id'])
              const name = textOf(row, ['title', 'displayName', 'serviceName'], id)
              return (
                <div className="oac-card" key={id || name}>
                  <button type="button" onClick={() => { void open(row) }}><strong>{name}</strong></button>
                  <div className="oac-mono">{id}</div>
                  <div className="oac-muted">{textOf(row, ['priceLabel', 'price'])} {textOf(row, ['currency'])}</div>
                  <Button type="button" onClick={() => setRevoking(row)}>{t('revoke')}</Button>
                </div>
              )
            })}
          </div>
          <div className="oac-card">
            <strong>{t('orders')}</strong>
            {selected === null ? <div className="oac-muted">{t('emptyOrders')}</div> : null}
            {orderRows.length === 0 && selected ? <div className="oac-muted">{t('emptyOrders')}</div> : null}
            {orderRows.map((row, index) => (
              <div className="oac-muted" key={textOf(row, ['orderId', 'orderTxid', 'key'], String(index))}>
                {textOf(row, ['statusLabel', 'status'])} · {textOf(row, ['buyerLabel', 'buyer'])} · {textOf(row, ['paymentLabel', 'paymentTxid'])}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <form className="oac-form" onSubmit={(event) => { event.preventDefault(); setLastRequest(null); void runCall(false) }}>
          <h3>{t('callTitle')}</h3>
          <label>{t('fieldServicePin')}<Input value={servicePinId} onChange={(event) => setServicePinId(event.target.value)} /></label>
          <label>{t('fieldProvider')}<Input value={provider} onChange={(event) => setProvider(event.target.value)} /></label>
          <label>{t('fieldTask')}<Input value={task} onChange={(event) => setTask(event.target.value)} /></label>
          <label>{t('fieldSpendAmount')}<Input value={spendAmount} onChange={(event) => setSpendAmount(event.target.value)} /></label>
          <label>{t('fieldSpendCurrency')}<Input value={spendCurrency} onChange={(event) => setSpendCurrency(event.target.value)} /></label>
          <div className="oac-actions">
            <Button type="submit" disabled={busy || !from || !servicePinId.trim() || !provider.trim() || !task.trim()}>
              {busy ? t('calling') : t('call')}
            </Button>
          </div>
        </form>
      )}
      <Modal open={publishing} onClose={() => setPublishing(false)} title={t('publishTitle')} closeLabel={t('close')}>
        <form className="oac-form" onSubmit={(event) => { event.preventDefault(); void onPublish() }}>
          <p>{interpolate(t('publishConfirm'), { from })}</p>
          <label>{t('fieldDisplayName')}<Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label>{t('fieldServiceName')}<Input value={serviceName} onChange={(event) => setServiceName(event.target.value)} /></label>
          <label>{t('fieldDescription')}<Input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <label>{t('fieldSkill')}<Input value={skill} onChange={(event) => setSkill(event.target.value)} /></label>
          <label>{t('fieldPrice')}<Input value={price} onChange={(event) => setPrice(event.target.value)} /></label>
          <label>{t('fieldCurrency')}<Input value={currency} onChange={(event) => setCurrency(event.target.value)} /></label>
          <label>{t('fieldOutputType')}<Input value={outputType} onChange={(event) => setOutputType(event.target.value)} /></label>
          <div className="oac-actions">
            <Button type="button" onClick={() => setPublishing(false)}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy || !from || !displayName.trim() || !serviceName.trim()}>
              {busy ? t('publishing') : t('confirmPublish')}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={revoking !== null} onClose={() => setRevoking(null)} title={t('revokeTitle')} closeLabel={t('close')}>
        <p>{interpolate(t('revokeConfirm'), {
          name: revoking ? textOf(revoking, ['title', 'displayName', 'serviceName'], 'service') : '',
          id: revoking ? textOf(revoking, ['currentPinId', 'serviceId', 'id']) : '',
        })}</p>
        <div className="oac-actions">
          <Button type="button" onClick={() => setRevoking(null)}>{t('cancel')}</Button>
          <Button type="button" disabled={busy} onClick={() => { void onRevoke() }}>{busy ? t('revoking') : t('confirmRevoke')}</Button>
        </div>
      </Modal>
      <Modal open={pendingCall !== null} onClose={() => setPendingCall(null)} title={t('confirmPaid')} closeLabel={t('close')}>
        <p>{t('paidConfirm')}</p>
        <pre className="oac-mono">{JSON.stringify(pendingCall?.data ?? {}, null, 2)}</pre>
        <div className="oac-actions">
          <Button type="button" onClick={() => setPendingCall(null)}>{t('cancel')}</Button>
          <Button type="button" disabled={busy} onClick={() => { void runCall(true) }}>{busy ? t('calling') : t('confirmPaid')}</Button>
        </div>
      </Modal>
    </div>
  )
}
