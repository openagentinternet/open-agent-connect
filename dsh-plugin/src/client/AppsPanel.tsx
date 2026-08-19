import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Button,
  IconCheckOutline16,
  IconCopyOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconLoadingOutline16,
  IconPlayOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconShareOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotRow, CommandEnvelope } from './api.ts'
import type { MetaAppListPayload, MetaAppRecord } from '../apps.ts'
import {
  chainTxids,
  displayValue,
  formatTimestamp,
  imageUrlForReference,
  metaAppUriFor,
  metaWebUrlFor,
  recordImage,
  recordName,
  recordPinId,
  recordSubtitle,
  recordTags,
  recordText,
  runUrlFor,
} from '../apps.ts'
import type { AppsLocaleKey } from './locale-apps.ts'
import { interpolate } from './parse.ts'
import { MetaAppForm } from './MetaAppForm.tsx'

type Translate = (key: AppsLocaleKey, vars?: Record<string, string | number>) => string

export interface AppsPanelInjected {
  bots: () => Promise<BotRow[]>
  list: (from: string, size?: number, cursor?: string) => Promise<MetaAppListPayload>
  publish: (from: string, payload: Record<string, unknown>) => Promise<CommandEnvelope>
  update: (from: string, targetPinId: string, payload: Record<string, unknown>) => Promise<CommandEnvelope>
  remove: (from: string, targetPinId: string) => Promise<CommandEnvelope>
  upload: (from: string, file: File) => Promise<{ metafileUri?: string; pinId?: string }>
}

type ModalState =
  | { kind: 'publish' }
  | { kind: 'edit'; record: MetaAppRecord }
  | { kind: 'detail'; record: MetaAppRecord }
  | { kind: 'share'; record: MetaAppRecord }
  | { kind: 'delete'; record: MetaAppRecord }
  | null

type ChainState = {
  mode: 'publish' | 'edit'
  phase: 'pending' | 'success' | 'error'
  displayName: string
  result?: CommandEnvelope
  errorText?: string
} | null

const PAGE_SIZE = 12

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function initialsOf(name: string): string {
  const chars = Array.from(name.trim()).filter((char) => char.trim()).slice(0, 2)
  return (chars.join('') || '?').toUpperCase()
}

export function AppsPanel({
  bots,
  list,
  publish,
  update,
  remove,
  upload,
  t,
}: AppsPanelInjected & { t: Translate }): ReactNode {
  const [profiles, setProfiles] = useState<BotRow[]>([])
  const [from, setFrom] = useState('')
  const [records, setRecords] = useState<MetaAppRecord[]>([])
  const [cursorStack, setCursorStack] = useState<string[]>([''])
  const [nextCursor, setNextCursor] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [chain, setChain] = useState<ChainState>(null)
  const [formBusy, setFormBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [copied, setCopied] = useState('')
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let current = true
    void bots().then(
      (rows) => {
        if (!current) return
        setProfiles(rows)
        setFrom((value) => value || rows[0]?.slug || '')
      },
      (cause: unknown) => { if (current) setError(`Bots: ${errorText(cause)}`) },
    )
    return () => { current = false }
  }, [bots])

  useEffect(() => {
    if (!from) return
    let current = true
    setLoading(true)
    void list(from, PAGE_SIZE).then(
      (data) => {
        if (!current) return
        setRecords(data.records)
        setNextCursor(data.nextCursor)
        setCursorStack([''])
        setError(null)
        setLoading(false)
      },
      (cause: unknown) => {
        if (!current) return
        setError(errorText(cause))
        setLoading(false)
      },
    )
    return () => { current = false; setLoading(false) }
  }, [from, list])

  const flashCopied = (key: string): void => {
    setCopied(key)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(''), 1200)
  }

  const copyText = async (key: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(value)
    } catch {}
    flashCopied(key)
  }

  const loadPage = async (cursor: string, stack: string[]): Promise<void> => {
    if (!from) return
    setLoading(true)
    try {
      const data = await list(from, PAGE_SIZE, cursor)
      setRecords(data.records)
      setNextCursor(data.nextCursor)
      setCursorStack(stack)
      setError(null)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setLoading(false)
    }
  }

  const reloadFirstPage = (): void => {
    void loadPage('', [''])
  }

  const runApp = (record: MetaAppRecord): void => {
    if (record.disabled === true) return
    const url = runUrlFor(record)
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const submitEditor = async (payload: Record<string, unknown>): Promise<void> => {
    if (!from || chain !== null) return
    const mode = modal?.kind === 'edit' ? 'edit' : 'publish'
    const target = modal?.kind === 'edit' && modal.record ? recordPinId(modal.record) : ''
    const displayName = String(payload.title || payload.appName || 'MetaApp')
    setChain({ mode, phase: 'pending', displayName })
    setModal(null)
    try {
      const result = mode === 'edit'
        ? await update(from, target, payload)
        : await publish(from, payload)
      setChain({ mode, phase: 'success', displayName, result })
      reloadFirstPage()
    } catch (cause) {
      const message = errorText(cause)
      setChain({
        mode,
        phase: 'error',
        displayName,
        errorText: interpolate(t(mode === 'edit' ? 'updateFailed' : 'publishFailed'), { message }),
      })
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!from || modal?.kind !== 'delete') return
    const pinId = recordPinId(modal.record)
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await remove(from, pinId)
      setModal(null)
      reloadFirstPage()
    } catch (cause) {
      setDeleteError(interpolate(t('deleteFailed'), { message: errorText(cause) }))
    } finally {
      setDeleteBusy(false)
    }
  }

  const tileCover = (record: MetaAppRecord): string =>
    imageUrlForReference(recordImage(record, ['coverImg', 'coverImage', 'cover']))
  const tileIcon = (record: MetaAppRecord): string =>
    imageUrlForReference(recordImage(record, ['icon', 'iconImg', 'iconImage']))

  const renderTile = (record: MetaAppRecord): ReactNode => {
    const name = recordName(record, t('untitled'))
    const pinId = recordPinId(record)
    const subtitle = recordSubtitle(record)
    const intro = recordText(record, ['intro'])
    const tags = recordTags(record)
    const coverSrc = tileCover(record)
    const iconSrc = tileIcon(record)
    const copyKey = `pin-${pinId}`
    return (
      <li
        className="oac-apps-card"
        key={pinId || name}
        tabIndex={0}
        onClick={() => setModal({ kind: 'detail', record })}
        onKeyDown={(event: KeyboardEvent<HTMLLIElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setModal({ kind: 'detail', record })
          }
        }}
      >
        <div className="oac-apps-card-cover">
          {coverSrc ? <img className="oac-apps-cover-img" src={coverSrc} alt="" loading="lazy" /> : null}
          {iconSrc
            ? <img className="oac-apps-card-icon" src={iconSrc} alt="" loading="lazy" />
            : <span className="oac-apps-card-icon oac-apps-icon-fallback" aria-hidden="true">{initialsOf(name)}</span>}
          <span className={`oac-apps-state-pill${record.disabled === true ? ' disabled' : ''}`}>
            {record.disabled === true ? t('disabledLabel') : t('runnable')}
          </span>
        </div>
        <div className="oac-apps-card-body">
          <div className="oac-apps-card-title">
            <h3>{name}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="oac-apps-pin-line">
            <code>{pinId}</code>
            <button
              type="button"
              className="oac-icon-btn"
              data-tip={copied === copyKey ? t('copied') : t('copyPin')}
              aria-label={t('copyPin')}
              onClick={(event) => { event.stopPropagation(); void copyText(copyKey, pinId) }}
            >
              <IconCopyOutline16 size={14} />
            </button>
          </div>
          {intro ? <p className="oac-apps-card-intro">{intro}</p> : null}
          {tags.length > 0 ? (
            <div className="oac-apps-tags">
              {tags.map((tag) => <span className="oac-apps-tag" key={tag}>{tag}</span>)}
            </div>
          ) : null}
        </div>
        <div className="oac-apps-card-foot">
          <button
            type="button"
            className="oac-icon-btn"
            data-tip={t('run')}
            aria-label={`${t('run')}: ${name}`}
            disabled={record.disabled === true}
            onClick={(event) => { event.stopPropagation(); runApp(record) }}
          >
            <IconPlayOutline16 />
          </button>
          <button
            type="button"
            className="oac-icon-btn"
            data-tip={t('edit')}
            aria-label={`${t('edit')}: ${name}`}
            onClick={(event) => { event.stopPropagation(); setModal({ kind: 'edit', record }) }}
          >
            <IconEditOutline16 />
          </button>
          <button
            type="button"
            className="oac-icon-btn"
            data-tip={t('share')}
            aria-label={`${t('share')}: ${name}`}
            onClick={(event) => { event.stopPropagation(); setModal({ kind: 'share', record }) }}
          >
            <IconShareOutline16 />
          </button>
          <button
            type="button"
            className="oac-icon-btn"
            data-tip={t('details')}
            aria-label={`${t('details')}: ${name}`}
            onClick={(event) => { event.stopPropagation(); setModal({ kind: 'detail', record }) }}
          >
            <IconEllipsisOutline16 />
          </button>
        </div>
      </li>
    )
  }

  const detailRows = (record: MetaAppRecord): Array<[string, unknown]> => {
    const globalMetaId = recordText(record, ['globalMetaId'])
      || (record.raw ? recordText(record.raw, ['globalMetaId']) || recordText(record.raw, ['globalMetaID']) : '')
    const createdAt = record.raw
      ? record.raw.createdAt ?? record.raw.timestamp
      : record.timestamp
    return [
      [t('fieldTitle'), record.title],
      [t('fieldAppName'), record.appName],
      [t('fieldPrompt'), record.prompt],
      [t('fieldIntro'), record.intro],
      [t('fieldIcon'), record.icon],
      [t('fieldCover'), record.coverImg],
      [t('fieldIntroImgs'), record.introImgs],
      [t('fieldRuntime'), record.runtime],
      [t('version'), record.version],
      [t('fieldContentType'), record.contentType],
      [t('fieldIndexFile'), record.indexFile],
      [t('fieldContent'), record.content],
      [t('fieldCode'), record.code],
      [t('fieldContentHash'), record.contentHash],
      [t('fieldCodeType'), record.codeType],
      [t('fieldDisabled'), record.disabled === true ? t('disabledLabel') : 'false'],
      [t('fieldTags'), record.tags],
      [t('fieldMetadata'), record.metadata],
      [t('pinId'), record.pinId],
      [t('detailFirstPinId'), record.firstPinId],
      [t('detailOperation'), record.operation],
      [t('detailOwnerAddress'), record.ownerAddress],
      [t('detailGlobalMetaId'), globalMetaId],
      [t('detailTxid'), record.txid],
      [t('detailTxids'), record.txids],
      [t('detailUpdatedAt'), formatTimestamp(record.timestamp)],
      [t('detailCreatedAt'), formatTimestamp(createdAt)],
      [t('detailRawData'), JSON.stringify(record.raw ?? record, null, 2)],
    ]
  }

  const renderDetailModal = (record: MetaAppRecord): ReactNode => {
    const name = recordName(record, t('untitled'))
    const iconSrc = tileIcon(record)
    const tags = recordTags(record, 8)
    const description = recordText(record, ['prompt']) || recordText(record, ['intro'])
    return (
      <Modal
        open
        onClose={() => setModal(null)}
        title={t('detailTitle')}
        description={t('detailDescription')}
        className="oac-apps-dialog-sm"
        footer={(
          <Button type="button" variant="primary" onClick={() => setModal(null)}>{t('close')}</Button>
        )}
      >
        <div className="oac-apps-modal-scroll">
        <div className="oac-apps-form" style={{ gap: 12 }}>
          <div className="oac-apps-detail-top">
            {iconSrc
              ? <img className="oac-apps-detail-icon" src={iconSrc} alt="" />
              : <span className="oac-apps-detail-icon oac-apps-icon-fallback" aria-hidden="true">{initialsOf(name)}</span>}
            <div className="oac-apps-detail-title">
              <h3>{name}</h3>
              {description ? <p>{description}</p> : null}
              {tags.length > 0 ? (
                <div className="oac-apps-tags">
                  {tags.map((tag) => <span className="oac-apps-tag" key={tag}>{tag}</span>)}
                </div>
              ) : null}
            </div>
          </div>
          <div className="oac-apps-detail-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              icon={<IconPlayOutline16 />}
              disabled={record.disabled === true}
              onClick={() => runApp(record)}
            >
              {t('run')}
            </Button>
            <Button type="button" size="sm" icon={<IconShareOutline16 />} onClick={() => setModal({ kind: 'share', record })}>
              {t('share')}
            </Button>
            <Button type="button" size="sm" icon={<IconEditOutline16 />} onClick={() => setModal({ kind: 'edit', record })}>
              {t('edit')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="oac-danger-outline"
              icon={<IconTrashOutline16 />}
              onClick={() => setModal({ kind: 'delete', record })}
            >
              {t('remove')}
            </Button>
          </div>
          <section className="oac-apps-form-section">
            <h3>{t('detailProtocolFields')}</h3>
            <div className="oac-info" style={{ gap: 6 }}>
              {detailRows(record).map(([label, value]) => (
                <div className="oac-apps-detail-field" key={label}>
                  <span>{label}</span>
                  <code>{displayValue(value)}</code>
                </div>
              ))}
            </div>
          </section>
        </div>
        </div>
      </Modal>
    )
  }

  const renderShareModal = (record: MetaAppRecord): ReactNode => {
    const rows: Array<[string, string]> = [
      [t('shareMetaAppUri'), metaAppUriFor(record)],
      [t('shareWebUrl'), metaWebUrlFor(record)],
    ]
    return (
      <Modal
        open
        onClose={() => setModal(null)}
        title={t('shareTitle')}
        description={t('shareDescription')}
        className="oac-apps-dialog-sm"
        footer={(
          <Button type="button" variant="primary" onClick={() => setModal(null)}>{t('close')}</Button>
        )}
      >
        <div className="oac-apps-form" style={{ gap: 8 }}>
          {rows.map(([label, value]) => (
            <div className="oac-apps-share-row" key={label}>
              <span>{label}</span>
              <code>{value}</code>
              <Button
                type="button"
                size="sm"
                icon={<IconCopyOutline16 />}
                onClick={() => { void copyText(value, value) }}
              >
                {copied === value ? t('copied') : t('shareCopyLink')}
              </Button>
            </div>
          ))}
        </div>
      </Modal>
    )
  }

  const renderDeleteModal = (record: MetaAppRecord): ReactNode => {
    const name = recordName(record, t('untitled'))
    return (
      <Modal
        open
        onClose={() => setModal(null)}
        title={t('deleteTitle')}
        className="oac-apps-dialog-delete"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={deleteBusy} onClick={() => setModal(null)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="oac-danger-outline"
              disabled={deleteBusy}
              onClick={() => { void confirmDelete() }}
            >
              {deleteBusy ? t('removing') : t('deleteConfirm')}
            </Button>
          </>
        )}
      >
        <p className="oac-dialog-body">{interpolate(t('deleteDescription'), { name })}</p>
        {deleteError ? <p className="oac-apps-field-error" role="alert">{deleteError}</p> : null}
      </Modal>
    )
  }

  const renderEditorModal = (): ReactNode => {
    const isEdit = modal?.kind === 'edit'
    const record = modal?.kind === 'edit' && modal.record ? modal.record : null
    const name = isEdit && record ? recordName(record, t('untitled')) : ''
    return (
      <Modal
        open
        onClose={() => setModal(null)}
        title={isEdit ? t('editTitle') : t('publishTitle')}
        description={isEdit
          ? interpolate(t('editDescription'), { name })
          : interpolate(t('publishDescription'), { from })}
        className="oac-apps-dialog"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={formBusy} onClick={() => setModal(null)}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              form="oac-metaapp-form"
              variant="primary"
              disabled={formBusy || chain !== null}
            >
              {isEdit ? t('saveChanges') : t('publishOnChain')}
            </Button>
          </>
        )}
      >
        <div className="oac-apps-modal-scroll">
          <MetaAppForm
            mode={isEdit ? 'edit' : 'publish'}
            record={record}
            from={from}
            busy={formBusy}
            upload={upload}
            t={t}
            onSubmit={(payload) => { void submitEditor(payload) }}
          />
        </div>
      </Modal>
    )
  }

  const renderChainModal = (): ReactNode => {
    if (!chain) return null
    const isEdit = chain.mode === 'edit'
    const pending = chain.phase === 'pending'
    const title = chain.phase === 'pending'
      ? (isEdit ? t('chainUpdatePendingTitle') : t('chainPublishPendingTitle'))
      : chain.phase === 'success'
        ? (isEdit ? t('chainUpdateSuccessTitle') : t('chainPublishSuccessTitle'))
        : t('chainErrorTitle')
    const txids = chain.phase === 'success' && chain.result ? chainTxids(chain.result.data) : []
    const bodyText = pending
      ? interpolate(isEdit ? t('chainUpdatePending') : t('chainPublishPending'), { name: chain.displayName })
      : chain.phase === 'success'
        ? interpolate(isEdit ? t('chainUpdateSuccess') : t('chainPublishSuccess'), { name: chain.displayName })
        : chain.errorText ?? ''
    return (
      <Modal
        open
        onClose={closeChain}
        title={title}
        className="oac-apps-dialog-sm"
        footer={!pending
          ? (<Button type="button" variant="primary" onClick={closeChain}>{t('close')}</Button>)
          : undefined}
      >
        <div className="oac-apps-chain">
          <div className="oac-apps-chain-head">
            <span className={`oac-apps-chain-badge ${chain.phase}`}>
              {pending
                ? <IconLoadingOutline16 />
                : chain.phase === 'success'
                  ? <IconCheckOutline16 />
                  : <IconWarningOutline16 />}
            </span>
            <div className="oac-apps-chain-copy">
              <strong>{chain.displayName}</strong>
              <p className={chain.phase === 'error' ? 'oac-apps-chain-error' : undefined}>{bodyText}</p>
            </div>
          </div>
          {chain.phase === 'success' ? (
            <>
              {txids.length > 0 ? (
                <section className="oac-apps-chain-section">
                  <h3>{t('chainTxids')}</h3>
                  {txids.map((txid) => (
                    <div className="oac-apps-txid-row" key={txid}>
                      <code>{txid}</code>
                      <Button
                        type="button"
                        size="sm"
                        icon={<IconCopyOutline16 />}
                        onClick={() => { void copyText(txid, txid) }}
                      >
                        {copied === txid ? t('copied') : t('chainCopyTxid')}
                      </Button>
                    </div>
                  ))}
                </section>
              ) : (
                <p className="oac-apps-chain-note">{t('chainNoTxid')}</p>
              )}
              <p className="oac-apps-chain-note">{t('chainSyncDelay')}</p>
            </>
          ) : null}
        </div>
      </Modal>
    )
  }

  const closeChain = (): void => {
    if (chain?.phase === 'pending') return
    setChain(null)
  }

  const hasPrevious = cursorStack.length > 1

  return (
    <div className="oac-panel">
      <div className="oac-row">
        <h2>{t('title')}</h2>
        <div className="oac-actions">
          <Button type="button" icon={<IconRefreshOutline16 />} disabled={loading || !from} onClick={reloadFirstPage}>
            {t('refresh')}
          </Button>
          <Button type="button" variant="primary" icon={<IconPlusOutline16 />} disabled={!from} onClick={() => { setModal({ kind: 'publish' }); setError(null) }}>
            {t('publish')}
          </Button>
        </div>
      </div>
      {error ? <div className="oac-error" role="alert">{error}</div> : null}
      <label className="oac-field">
        <span className="oac-field-label">{t('fieldBot')}</span>
        <select
          className="oac-input oac-input-select"
          value={from}
          disabled={profiles.length === 0}
          onChange={(event) => setFrom(event.target.value)}
        >
          <option value="">{t('pickBot')}</option>
          {profiles.map((bot) => (
            <option key={bot.slug} value={bot.slug}>{bot.name} ({bot.slug})</option>
          ))}
        </select>
      </label>
      {from ? (
        <section>
          <div className="oac-section-head" style={{ marginBottom: 10 }}>
            <div className="oac-section-text">
              <span className="oac-section-title">{t('galleryTitle')}</span>
            </div>
          </div>
          {loading && records.length === 0 ? <p className="oac-muted">{t('loading')}</p> : null}
          {!loading && records.length === 0 ? (
            <div className="oac-apps-empty">
              <strong>{t('emptyTitle')}</strong>
              <p>{t('emptyMessage')}</p>
            </div>
          ) : null}
          {records.length > 0 ? (
            <>
              <ul className="oac-apps-grid">
                {records.map((record) => renderTile(record))}
              </ul>
              <div className="oac-apps-pager" style={{ marginTop: 12 }}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loading || !hasPrevious}
                  onClick={() => {
                    const stack = cursorStack.slice(0, -1)
                    void loadPage(stack[stack.length - 1] ?? '', stack)
                  }}
                >
                  {t('pagePrev')}
                </Button>
                <span className="oac-apps-pager-label">{records.length}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loading || !nextCursor}
                  onClick={() => {
                    const stack = [...cursorStack, nextCursor]
                    void loadPage(nextCursor, stack)
                  }}
                >
                  {t('pageNext')}
                </Button>
              </div>
            </>
          ) : null}
        </section>
      ) : null}
      {modal?.kind === 'publish' || modal?.kind === 'edit' ? renderEditorModal() : null}
      {modal?.kind === 'detail' ? renderDetailModal(modal.record) : null}
      {modal?.kind === 'share' ? renderShareModal(modal.record) : null}
      {modal?.kind === 'delete' ? renderDeleteModal(modal.record) : null}
      {chain !== null ? renderChainModal() : null}
    </div>
  )
}
