import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OwnerIdentityRow, OwnerWhoPayload, OwnerWritePayload } from './api.ts'
import type { UserLocaleKey } from './locale-user.ts'

type Translate = (key: UserLocaleKey, vars?: Record<string, string | number>) => string
type View = 'loading' | 'empty' | 'create' | 'import' | 'backup' | 'profile'

export interface UserPanelInjected {
  who: () => Promise<OwnerWhoPayload>
  create: (name: string) => Promise<OwnerWritePayload>
  importIdentity: (input: { name: string; mnemonic: string; path?: string }) => Promise<OwnerWritePayload>
  rename: (name: string) => Promise<OwnerWhoPayload>
  reveal: () => Promise<{ mnemonic: string }>
  deleteIdentity: () => Promise<{ deleted?: boolean }>
}

function CopyValue({ value, t }: { value: string; t: Translate }): ReactNode {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="oac-a2a-id"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      <code>{value}</code>
      <span>{copied ? t('copied') : t('copy')}</span>
    </button>
  )
}

function MnemonicGrid({ mnemonic }: { mnemonic: string }): ReactNode {
  const words = mnemonic.split(/\s+/).filter(Boolean)
  return (
    <ol className="oac-mnemonic-grid">
      {words.map((word, index) => (
        <li className="oac-mnemonic-word" key={`${index}-${word}`}>
          <span className="oac-mnemonic-index">{index + 1}</span>
          <span>{word}</span>
        </li>
      ))}
    </ol>
  )
}

export function UserPanel(injected: UserPanelInjected & { close: () => void; t: Translate }): ReactNode {
  const { t } = injected
  const [view, setView] = useState<View>('loading')
  const [identity, setIdentity] = useState<OwnerIdentityRow | null>(null)
  const [mnemonic, setMnemonic] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Create / import form state.
  const [nameDraft, setNameDraft] = useState('')
  const [mnemonicDraft, setMnemonicDraft] = useState('')
  const [pathDraft, setPathDraft] = useState('')

  // Profile view state.
  const [nameEdit, setNameEdit] = useState('')
  const [nameNote, setNameNote] = useState<'saving' | 'saved' | 'error' | null>(null)
  const [revealOpen, setRevealOpen] = useState(false)
  const [revealMnemonic, setRevealMnemonic] = useState('')
  const [logoutOpen, setLogoutOpen] = useState(false)

  const load = useCallback(() => {
    setView('loading')
    setError(null)
    void injected.who().then(
      (result) => {
        if (result.identity) {
          setIdentity(result.identity)
          setNameEdit(result.identity.name)
          setView('profile')
        } else {
          setIdentity(null)
          setView('empty')
        }
      },
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
        setView('empty')
      },
    )
  }, [injected])

  useEffect(() => { load() }, [load])

  const applyWrite = (result: OwnerWritePayload): void => {
    setIdentity(result.identity)
    setNameEdit(result.identity.name)
    setMnemonic(result.mnemonic ?? '')
    setView('backup')
  }

  const onCreate = (): void => {
    setBusy(true)
    setError(null)
    void injected.create(nameDraft.trim()).then(
      (result) => { applyWrite(result); setBusy(false) },
      (cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false) },
    )
  }

  const onImport = (): void => {
    setBusy(true)
    setError(null)
    const input = {
      name: nameDraft.trim(),
      mnemonic: mnemonicDraft.trim(),
      ...(pathDraft.trim() ? { path: pathDraft.trim() } : {}),
    }
    void injected.importIdentity(input).then(
      (result) => { applyWrite(result); setBusy(false) },
      (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        setError(/mnemonic/i.test(message) ? t('invalidMnemonic') : message)
        setBusy(false)
      },
    )
  }

  const finishBackup = (): void => {
    setMnemonic('')
    setView('profile')
  }

  const saveName = (): void => {
    const next = nameEdit.trim()
    if (!next || !identity || next === identity.name) return
    setNameNote('saving')
    void injected.rename(next).then(
      (result) => {
        if (result.identity) setIdentity(result.identity)
        setNameNote('saved')
      },
      () => setNameNote('error'),
    )
  }

  const openReveal = (): void => {
    setRevealOpen(true)
    setRevealMnemonic('')
    void injected.reveal().then(
      (result) => setRevealMnemonic(result.mnemonic ?? ''),
      () => setRevealMnemonic(''),
    )
  }

  const confirmLogout = (): void => {
    setBusy(true)
    void injected.deleteIdentity().then(
      () => {
        setBusy(false)
        setLogoutOpen(false)
        setIdentity(null)
        setNameDraft('')
        setMnemonicDraft('')
        setPathDraft('')
        setView('empty')
      },
      (cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); setLogoutOpen(false) },
    )
  }

  return (
    <div className="oac-panel">
      <div className="oac-row">
        <h2>{t('title')}</h2>
        <div className="oac-actions">
          <Button type="button" onClick={load}>{t('refresh')}</Button>
        </div>
      </div>
      {error ? <div className="oac-error">{error}</div> : null}

      {view === 'loading' ? <div className="oac-muted">{t('loading')}</div> : null}

      {view === 'empty' ? (
        <section className="oac-section-card oac-user-empty">
          <span className="oac-section-title">{t('emptyTitle')}</span>
          <p className="oac-hint">{t('emptyHint')}</p>
          <div className="oac-form-actions">
            <Button type="button" variant="primary" onClick={() => { setError(null); setView('create') }}>
              {t('emptyCreate')}
            </Button>
            <Button type="button" onClick={() => { setError(null); setView('import') }}>
              {t('emptyImport')}
            </Button>
          </div>
        </section>
      ) : null}

      {view === 'create' ? (
        <section className="oac-section-card">
          <span className="oac-section-title">{t('createTitle')}</span>
          <p className="oac-hint">{t('createHint')}</p>
          <div className="oac-form">
            <label className="oac-field">
              <span className="oac-field-label">{t('nameField')}</span>
              <Input value={nameDraft} placeholder={t('namePlaceholder')} onChange={(event) => setNameDraft(event.target.value)} />
            </label>
            <div className="oac-form-actions">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setView('empty')}>{t('cancel')}</Button>
              <Button type="button" variant="primary" disabled={busy} onClick={onCreate}>
                {busy ? t('working') : t('createSubmit')}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {view === 'import' ? (
        <section className="oac-section-card">
          <span className="oac-section-title">{t('importTitle')}</span>
          <p className="oac-hint">{t('importHint')}</p>
          <div className="oac-form">
            <label className="oac-field">
              <span className="oac-field-label">{t('nameField')}</span>
              <Input value={nameDraft} placeholder={t('namePlaceholder')} onChange={(event) => setNameDraft(event.target.value)} />
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('mnemonicField')}</span>
              <textarea
                className="oac-input"
                rows={3}
                value={mnemonicDraft}
                placeholder={t('mnemonicPlaceholder')}
                onChange={(event) => setMnemonicDraft(event.target.value)}
              />
            </label>
            <label className="oac-field">
              <span className="oac-field-label">{t('pathField')}</span>
              <Input value={pathDraft} placeholder={t('pathHint')} onChange={(event) => setPathDraft(event.target.value)} />
            </label>
            <div className="oac-form-actions">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setView('empty')}>{t('cancel')}</Button>
              <Button type="button" variant="primary" disabled={busy || !mnemonicDraft.trim()} onClick={onImport}>
                {busy ? t('working') : t('importSubmit')}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {view === 'backup' ? (
        <section className="oac-section-card">
          <span className="oac-section-title">{t('backupTitle')}</span>
          <p className="oac-note warn">{t('backupWarning')}</p>
          <MnemonicGrid mnemonic={mnemonic} />
          <div className="oac-form-actions">
            <CopyValue value={mnemonic} t={t} />
            <Button type="button" variant="primary" onClick={finishBackup}>{t('backupConfirm')}</Button>
          </div>
        </section>
      ) : null}

      {view === 'profile' && identity ? (
        <section className="oac-section-card">
          <div className="oac-section-head">
            <div className="oac-section-text">
              <span className="oac-section-title">{t('profileTitle')}</span>
              <span className="oac-section-hint">{t('profileHint')}</span>
            </div>
            <div className="oac-actions">
              <Button type="button" onClick={openReveal}>{t('backupBtn')}</Button>
              <Button type="button" variant="outline" className="oac-danger-outline" onClick={() => setLogoutOpen(true)}>
                {t('logoutBtn')}
              </Button>
            </div>
          </div>
          <div className="oac-form">
            <label className="oac-field">
              <span className="oac-field-label">{t('nameField')}</span>
              <Input value={nameEdit} onChange={(event) => { setNameEdit(event.target.value); setNameNote(null) }} />
            </label>
            <div className="oac-form-actions">
              <Button
                type="button"
                variant="primary"
                disabled={nameNote === 'saving' || !nameEdit.trim() || nameEdit.trim() === identity.name}
                onClick={saveName}
              >
                {nameNote === 'saving' ? t('savingName') : t('saveName')}
              </Button>
              {nameNote === 'saved' ? <span className="oac-note success">{t('nameSaved')}</span> : null}
            </div>
          </div>
          <div className="oac-info">
            {identity.globalMetaId ? (
              <div className="oac-info-row">
                <span className="oac-info-label">{t('fieldGlobalMetaId')}</span>
                <CopyValue value={identity.globalMetaId} t={t} />
              </div>
            ) : null}
            {identity.mvcAddress ? (
              <div className="oac-info-row">
                <span className="oac-info-label">{t('fieldMvcAddress')}</span>
                <CopyValue value={identity.mvcAddress} t={t} />
              </div>
            ) : null}
            {identity.metaId ? (
              <div className="oac-info-row">
                <span className="oac-info-label">{t('fieldMetaId')}</span>
                <CopyValue value={identity.metaId} t={t} />
              </div>
            ) : null}
            {identity.createdAt ? (
              <div className="oac-info-row">
                <span className="oac-info-label">{t('fieldCreatedAt')}</span>
                <span className="oac-info-value">{identity.createdAt}</span>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <Modal
        open={revealOpen}
        onClose={() => setRevealOpen(false)}
        title={t('revealTitle')}
        className="oac-dialog"
        footer={(
          <>
            <CopyValue value={revealMnemonic} t={t} />
            <Button type="button" variant="primary" onClick={() => setRevealOpen(false)}>{t('cancel')}</Button>
          </>
        )}
      >
        <p className="oac-note warn">{t('revealWarning')}</p>
        {revealMnemonic ? <MnemonicGrid mnemonic={revealMnemonic} /> : <div className="oac-muted">{t('loading')}</div>}
      </Modal>

      <Modal
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        title={t('logoutTitle')}
        className="oac-dialog-delete"
        footer={(
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setLogoutOpen(false)}>{t('cancel')}</Button>
            <Button type="button" variant="outline" className="oac-danger-outline" disabled={busy} onClick={confirmLogout}>
              {busy ? t('working') : t('logoutConfirm')}
            </Button>
          </>
        )}
      >
        <p className="oac-dialog-body">{t('logoutWarning')}</p>
      </Modal>
    </div>
  )
}
