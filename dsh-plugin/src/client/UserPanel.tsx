import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommonKeyOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { OwnerIdentityRow, OwnerOnboardingPayload, OwnerUpdateInput, OwnerUpdatePayload, OwnerWhoPayload, OwnerWritePayload } from './api.ts'
import { BotAvatar } from './BotAvatar.tsx'
import { CopyIconButton } from './CopyIconButton.tsx'
import type { UserLocaleKey } from './locale-user.ts'

type Translate = (key: UserLocaleKey | CommonKeyOf, vars?: Record<string, string | number>) => string
type View = 'loading' | 'empty' | 'create' | 'import' | 'backup' | 'profile'

export interface UserPanelInjected {
  who: () => Promise<OwnerWhoPayload>
  /** Zero-touch onboarding progress (optional: older hosts may omit it). */
  onboarding?: () => Promise<OwnerOnboardingPayload>
  create: (name: string) => Promise<OwnerWritePayload>
  importIdentity: (input: { name: string; mnemonic: string; path?: string }) => Promise<OwnerWritePayload>
  /** Name/avatar profile save; publishes the changed fields on-chain. */
  update: (input: OwnerUpdateInput) => Promise<OwnerUpdatePayload>
  reveal: () => Promise<{ mnemonic: string }>
  deleteIdentity: () => Promise<{ deleted?: boolean }>
}

/** Compact one-line onboarding summary for the profile header. */
function onboardingSummaryLine(
  payload: OwnerOnboardingPayload | null,
  t: Translate,
): string | null {
  const state = payload?.onboarding
  if (!state || state.status === 'opted_out') return null
  const granted = Number(state.freeGrantBytes) > 0
    ? ` ${t('onboardingGranted', { amount: formatOnboardingTraffic(Number(state.freeGrantBytes)) })}`
    : ''
  if (state.status === 'ready') return `${t('onboardingReady')}${granted}`
  return `${t('onboardingPending')}${granted}`
}

function formatOnboardingTraffic(bytes: number): string {
  const mb = Math.round((bytes / 1_000_000) * 10) / 10
  return `${Number.isInteger(mb) ? mb.toFixed(0) : mb.toFixed(1)} MB`
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

/** Read-only identity value row: right-aligned label, mono value, copy icon. */
function InfoRow({ label, value, t }: { label: string; value: string; t: Translate }): ReactNode {
  return (
    <div className="oac-info-row">
      <span className="oac-info-label">{label}</span>
      <code className="oac-info-value">{value}</code>
      <CopyIconButton value={value} label={t('copy')} copiedLabel={t('copied')} />
    </div>
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
  const [avatarDraft, setAvatarDraft] = useState('')
  const [profileNote, setProfileNote] = useState<{ tone: 'saving' | 'success' | 'error'; text: string } | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [revealOpen, setRevealOpen] = useState(false)
  const [revealMnemonic, setRevealMnemonic] = useState('')
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [onboardingLine, setOnboardingLine] = useState<string | null>(null)

  const load = useCallback(() => {
    setView('loading')
    setError(null)
    // Best-effort onboarding progress (older CLI builds have no verb yet).
    if (injected.onboarding) {
      void injected.onboarding().then(
        (payload) => setOnboardingLine(onboardingSummaryLine(payload, injected.t)),
        () => setOnboardingLine(null),
      )
    }
    void injected.who().then(
      (result) => {
        if (result.identity) {
          setIdentity(result.identity)
          setNameEdit(result.identity.name)
          setAvatarDraft(result.identity.avatarDataUrl ?? '')
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
    setAvatarDraft(result.identity.avatarDataUrl ?? '')
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

  // Avatar picker (Bot editor parity): the image becomes a data URL draft
  // (200KB cap, matching the daemon's avatar validation); an empty draft
  // clears the stored avatar. Saving publishes name/avatar on-chain.
  const onAvatarFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 200 * 1024) {
      setProfileNote({ tone: 'error', text: t('avatarTooLarge') })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setAvatarDraft(typeof reader.result === 'string' ? reader.result : '')
      setProfileNote({ tone: 'success', text: t('avatarReadyToSave') })
    }
    reader.onerror = () => setProfileNote({ tone: 'error', text: t('avatarUploadFailed') })
    reader.readAsDataURL(file)
  }

  const saveProfile = (): void => {
    if (!identity) return
    const nextName = nameEdit.trim()
    if (!nextName) return
    const nameChanged = nextName !== identity.name
    const avatarChanged = avatarDraft !== (identity.avatarDataUrl ?? '')
    if (!nameChanged && !avatarChanged) return
    const input: OwnerUpdateInput = {
      ...(nameChanged ? { name: nextName } : {}),
      ...(avatarChanged ? { avatarDataUrl: avatarDraft } : {}),
    }
    setProfileNote({ tone: 'saving', text: t('savingName') })
    void injected.update(input).then(
      (result) => {
        if (result.identity) {
          setIdentity(result.identity)
          setNameEdit(result.identity.name)
          setAvatarDraft(result.identity.avatarDataUrl ?? '')
        }
        setProfileNote({ tone: 'success', text: t('nameSaved') })
      },
      (cause: unknown) => {
        setProfileNote({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) })
      },
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
      {onboardingLine ? <p className="oac-hint">{onboardingLine}</p> : null}

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
            <div className="oac-user-name-row">
              <div className="oac-user-avatar-col">
                <button
                  type="button"
                  className="oac-avatar-btn"
                  title={t('avatarChange')}
                  aria-label={t('avatarChange')}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  <BotAvatar name={nameEdit.trim() || identity.name} src={avatarDraft || undefined} className="oac-bot-avatar-lg" />
                </button>
                {avatarDraft ? (
                  <button
                    type="button"
                    className="oac-user-avatar-remove"
                    onClick={() => { setAvatarDraft(''); setProfileNote(null) }}
                  >
                    {t('avatarRemove')}
                  </button>
                ) : null}
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  style={{ display: 'none' }}
                  onChange={onAvatarFile}
                />
              </div>
              <label className="oac-field oac-user-name-field">
                <span className="oac-field-label">{t('nameField')}</span>
                <Input value={nameEdit} onChange={(event) => { setNameEdit(event.target.value); setProfileNote(null) }} />
              </label>
            </div>
            <div className="oac-form-actions">
              <Button
                type="button"
                variant="primary"
                disabled={
                  profileNote?.tone === 'saving'
                  || !nameEdit.trim()
                  || (nameEdit.trim() === identity.name && avatarDraft === (identity.avatarDataUrl ?? ''))
                }
                onClick={saveProfile}
              >
                {profileNote?.tone === 'saving' ? t('savingName') : t('saveName')}
              </Button>
              {profileNote && profileNote.tone !== 'saving' ? (
                <span className={`oac-note ${profileNote.tone}`}>{profileNote.text}</span>
              ) : null}
            </div>
          </div>
          <div className="oac-info oac-user-info">
            {identity.globalMetaId ? <InfoRow label={t('fieldGlobalMetaId')} value={identity.globalMetaId} t={t} /> : null}
            {identity.mvcAddress ? <InfoRow label={t('fieldMvcAddress')} value={identity.mvcAddress} t={t} /> : null}
          </div>
        </section>
      ) : null}

      <Modal
        closeLabel={t('close')}
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
        closeLabel={t('close')}
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
