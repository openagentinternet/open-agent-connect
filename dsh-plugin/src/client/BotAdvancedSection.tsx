import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  Button,
  IconDownloadOutline16,
  IconRightUpOutline16,
  IconTrashOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import {
  METAAPP_METAFILE_REFERENCE_PATTERN,
  METAAPP_PIN_ID_PATTERN,
  recordName,
  type MetaAppListPayload,
  type MetaAppRecord,
} from '../apps.ts'
import type {
  BotBackupPayload,
  BotHomepageUploadPayload,
  BotRow,
  BotWalletPayload,
} from './api.ts'
import { BotBackupModal } from './BotBackupModal.tsx'
import { BotWalletModal } from './BotWalletModal.tsx'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string
type NoteTone = 'saving' | 'success' | 'warn' | 'error'
type HomepageSource = 'default' | 'metafile' | 'metaapp'

type HomepageDraft = {
  source: HomepageSource
  metafilePin: string
  metaappPin: string
  metafileContentType: string
}

/** Extension → content type guess for a manually entered MetaFile pin. */
const HOMEPAGE_CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.xml': 'application/xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function stripUriPrefix(value: string, scheme: 'metafile://' | 'metaapp://'): string {
  const trimmed = value.trim()
  return trimmed.toLowerCase().startsWith(scheme) ? trimmed.slice(scheme.length).trim() : trimmed
}

function contentTypeForPin(pin: string): string {
  const match = /\.([a-z0-9][a-z0-9+-]{0,31})$/iu.exec(pin)
  if (!match) return ''
  return HOMEPAGE_CONTENT_TYPE_BY_EXT[`.${match[1].toLowerCase()}`] ?? ''
}

function draftFromHomepage(homepage: BotRow['homepage']): HomepageDraft {
  const uri = typeof homepage?.uri === 'string' ? homepage.uri.trim() : ''
  if (uri.toLowerCase().startsWith('metaapp://')) {
    return { source: 'metaapp', metafilePin: '', metaappPin: stripUriPrefix(uri, 'metaapp://'), metafileContentType: '' }
  }
  if (uri.toLowerCase().startsWith('metafile://')) {
    return {
      source: 'metafile',
      metafilePin: stripUriPrefix(uri, 'metafile://'),
      metaappPin: '',
      metafileContentType: typeof homepage?.contentType === 'string' ? homepage.contentType : '',
    }
  }
  return { source: 'default', metafilePin: '', metaappPin: '', metafileContentType: '' }
}

function sameDraft(left: HomepageDraft, right: HomepageDraft): boolean {
  return left.source === right.source
    && left.metafilePin === right.metafilePin
    && left.metaappPin === right.metaappPin
    && left.metafileContentType === right.metafileContentType
}

export function BotAdvancedSection({
  bot,
  t,
  busy,
  browserOpen,
  botWallet,
  botBackup,
  botHomepageUpload,
  metaappList,
  onSave,
  onRequestDelete,
}: {
  bot: BotRow
  t: Translate
  busy: boolean
  browserOpen: (uri?: string) => Promise<void>
  botWallet: (slug: string) => Promise<BotWalletPayload>
  botBackup: (slug: string) => Promise<BotBackupPayload>
  botHomepageUpload: (
    slug: string,
    fileName: string,
    contentType: string,
    base64: string,
  ) => Promise<BotHomepageUploadPayload>
  metaappList: (from: string, size?: number, cursor?: string) => Promise<MetaAppListPayload>
  onSave: (patch: Record<string, unknown>) => Promise<void>
  onRequestDelete: () => void
}): ReactNode {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<HomepageDraft>(() => draftFromHomepage(bot.homepage))
  const [baseline, setBaseline] = useState<HomepageDraft>(() => draftFromHomepage(bot.homepage))
  const [note, setNote] = useState<{ tone: NoteTone; text: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerStatus, setPickerStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pickerError, setPickerError] = useState('')
  const [pickerRecords, setPickerRecords] = useState<MetaAppRecord[]>([])
  const [walletOpen, setWalletOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)

  // Re-initialize only when another Bot loads into the same mounted editor.
  useEffect(() => {
    const next = draftFromHomepage(bot.homepage)
    setDraft(next)
    setBaseline(next)
    setNote(null)
    setUploadError('')
    setPickerOpen(false)
  }, [bot.slug])

  const patchDraft = (patch: Partial<HomepageDraft>): void => {
    setDraft((prev) => ({ ...prev, ...patch }))
    setNote(null)
  }

  const dirty = !sameDraft(draft, baseline)

  const onHomepageFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError('')
    const reader = new FileReader()
    reader.onload = () => {
      void (async () => {
        try {
          const result = typeof reader.result === 'string' ? reader.result : ''
          const base64 = /^data:[^;]*;base64,(.+)$/u.exec(result)?.[1] ?? ''
          if (!base64) throw new Error(t('homepageUploadFailed'))
          const uploaded = await botHomepageUpload(
            bot.slug,
            file.name || 'homepage-upload.bin',
            file.type || 'application/octet-stream',
            base64,
          )
          patchDraft({
            source: 'metafile',
            metafilePin: stripUriPrefix(uploaded.uri, 'metafile://'),
            metafileContentType: uploaded.contentType,
          })
        } catch (cause) {
          setUploadError(errorText(cause))
        } finally {
          setUploading(false)
        }
      })()
    }
    reader.onerror = () => {
      setUploadError(t('homepageUploadFailed'))
      setUploading(false)
    }
    reader.readAsDataURL(file)
  }

  const loadMetaApps = (): void => {
    setPickerStatus('loading')
    setPickerError('')
    void metaappList(bot.slug, 24).then(
      (payload) => {
        setPickerRecords(payload.records.filter((record) => record.pinId !== ''))
        setPickerStatus('ready')
      },
      (cause: unknown) => {
        setPickerRecords([])
        setPickerStatus('error')
        setPickerError(errorText(cause))
      },
    )
  }

  const openPicker = (): void => {
    setPickerOpen(true)
    loadMetaApps()
  }

  const saveHomepage = async (): Promise<void> => {
    let patch: Record<string, unknown>
    if (draft.source === 'default') {
      patch = { homepage: null }
    } else if (draft.source === 'metafile') {
      const pin = stripUriPrefix(draft.metafilePin, 'metafile://')
      if (!pin) {
        setNote({ tone: 'error', text: t('homepageErrNoFile') })
        return
      }
      if (!METAAPP_METAFILE_REFERENCE_PATTERN.test(pin)) {
        setNote({ tone: 'error', text: t('homepageErrInvalidMetafilePin') })
        return
      }
      patch = {
        homepage: {
          uri: `metafile://${pin}`,
          renderer: 'auto',
          contentType: contentTypeForPin(pin) || draft.metafileContentType || 'application/octet-stream',
        },
      }
    } else {
      const pin = stripUriPrefix(draft.metaappPin, 'metaapp://')
      if (!METAAPP_PIN_ID_PATTERN.test(pin)) {
        setNote({ tone: 'error', text: t('homepageErrInvalidPin') })
        return
      }
      patch = {
        homepage: { uri: `metaapp://${pin}`, renderer: 'metaapp', contentType: 'application/vnd.metaapp' },
      }
    }
    setNote({ tone: 'saving', text: t('saving') })
    try {
      await onSave(patch)
      setBaseline(draft)
      setNote({ tone: 'success', text: t('saved') })
    } catch (cause) {
      setNote({ tone: 'error', text: errorText(cause) })
    }
  }

  return (
    <>
      <div className="oac-field">
        <span className="oac-field-label">{t('homepage')}</span>
        <div className="oac-homepage-row">
          <select
            className="oac-input oac-input-select"
            aria-label={t('homepage')}
            value={draft.source}
            disabled={busy || uploading}
            onChange={(event) => {
              patchDraft({ source: event.target.value as HomepageSource })
              setUploadError('')
            }}
          >
            <option value="default">{t('homepageDefault')}</option>
            <option value="metafile">{t('homepageMetafile')}</option>
            <option value="metaapp">{t('homepageMetaapp')}</option>
          </select>
          {draft.source === 'default' && bot.globalMetaId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<IconRightUpOutline16 />}
              onClick={() => { void browserOpen(`metaid://${bot.globalMetaId}`) }}
            >
              {t('homepageView')}
            </Button>
          ) : null}
          {draft.source === 'metafile' ? (
            <>
              <input ref={fileInputRef} type="file" hidden onChange={onHomepageFile} />
              <span className="oac-protocol-input">
                <span className="oac-protocol-prefix">metafile://</span>
                <input
                  className="oac-protocol-field"
                  value={draft.metafilePin}
                  placeholder={t('homepageMetafilePinPlaceholder')}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => patchDraft({ metafilePin: event.target.value })}
                />
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? t('homepageUploading') : t('homepageMetafileUpload')}
              </Button>
            </>
          ) : null}
          {draft.source === 'metaapp' ? (
            <>
              <span className="oac-protocol-input">
                <span className="oac-protocol-prefix">metaapp://</span>
                <input
                  className="oac-protocol-field"
                  value={draft.metaappPin}
                  placeholder={t('homepageMetaappPinPlaceholder')}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => patchDraft({ metaappPin: event.target.value })}
                />
              </span>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={openPicker}>
                {t('homepageMetaappSelect')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<IconRightUpOutline16 />}
                disabled={!draft.metaappPin.trim()}
                onClick={() => { void browserOpen(`metaapp://${stripUriPrefix(draft.metaappPin, 'metaapp://')}`) }}
              >
                {t('homepageMetaappPreview')}
              </Button>
            </>
          ) : null}
        </div>
        {draft.source === 'default' ? <span className="oac-hint">{t('homepageDefaultDesc')}</span> : null}
        {uploadError ? <p className="oac-note error">{uploadError}</p> : null}
        <span className="oac-hint">{t('homepageHint')}</span>
        {note ? <p className={`oac-note ${note.tone}`}>{note.text}</p> : null}
        <div className="oac-form-actions">
          <Button
            type="button"
            variant="outline"
            disabled={busy || uploading || !dirty}
            onClick={() => {
              setDraft(baseline)
              setNote(null)
              setUploadError('')
            }}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || uploading}
            onClick={() => { void saveHomepage() }}
          >
            {busy ? t('saving') : t('save')}
          </Button>
        </div>
      </div>

      <div className="oac-adv-card">
        <div className="oac-adv-card-head">{t('sectionChainWallet')}</div>
        <div className="oac-adv-card-divider" />
        <div className="oac-adv-card-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => setWalletOpen(true)}>
            {t('wallet')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<IconDownloadOutline16 />}
            onClick={() => setBackupOpen(true)}
          >
            {t('backup')}
          </Button>
        </div>
      </div>

      <div className="oac-adv-card oac-adv-danger">
        <div className="oac-adv-card-head">{t('sectionDangerZone')}</div>
        <div className="oac-adv-card-divider" />
        <div className="oac-adv-danger-row">
          <p className="oac-hint">{t('deleteBotWarning')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="oac-danger-outline"
            icon={<IconTrashOutline16 />}
            onClick={onRequestDelete}
          >
            {t('remove')}
          </Button>
        </div>
      </div>

      <Modal
        closeLabel={t('close')}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('homepageMetaappSelect')}
        className="oac-dialog"
      >
        {pickerStatus === 'loading' ? <p className="oac-note saving">{t('homepageLoadingMetaApps')}</p> : null}
        {pickerStatus === 'error' ? (
          <div className="oac-homepage-picker-error">
            <p className="oac-note error">{t('homepageMetaAppsLoadFailed')}</p>
            {pickerError ? <p className="oac-note error">{pickerError}</p> : null}
            <div className="oac-form-actions">
              <Button type="button" variant="outline" size="sm" onClick={loadMetaApps}>
                {t('retry')}
              </Button>
            </div>
          </div>
        ) : null}
        {pickerStatus === 'ready' && pickerRecords.length === 0 ? (
          <div className="oac-homepage-picker-empty">
            <p className="oac-dialog-body">{t('homepageNoMetaAppsTitle')}</p>
            <p className="oac-hint">{t('homepageNoMetaAppsMessage')}</p>
          </div>
        ) : null}
        {pickerStatus === 'ready' && pickerRecords.length > 0 ? (
          <ul className="oac-homepage-app-list">
            {pickerRecords.map((record) => (
              <li key={record.pinId}>
                <button
                  type="button"
                  className="oac-homepage-app-item"
                  onClick={() => {
                    patchDraft({ metaappPin: record.pinId })
                    setPickerOpen(false)
                  }}
                >
                  <span className="oac-homepage-app-name">{recordName(record, t('homepageUntitledMetaApp'))}</span>
                  <code className="oac-homepage-app-pin">{record.pinId}</code>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Modal>
      {walletOpen ? (
        <BotWalletModal bot={bot} t={t} botWallet={botWallet} onClose={() => setWalletOpen(false)} />
      ) : null}
      {backupOpen ? (
        <BotBackupModal bot={bot} t={t} botBackup={botBackup} onClose={() => setBackupOpen(false)} />
      ) : null}
    </>
  )
}
