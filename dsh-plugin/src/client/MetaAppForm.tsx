import { useRef, useState, type ReactNode } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  METAAPP_CODE_TYPE_OPTIONS,
  METAAPP_CONTENT_TYPE_OPTIONS,
  METAAPP_RUNTIME_OPTIONS,
  bumpVersion,
  metadataFromInput,
  metadataToInput,
  normalizeImageList,
  normalizeImageReference,
  normalizeMetafileReference,
  normalizeRuntimeSelection,
  recordRuntimeList,
  recordText,
  splitList,
  type MetaAppRecord,
} from '../apps.ts'
import type { AppsLocaleKey } from './locale-apps.ts'

type Translate = (key: AppsLocaleKey, vars?: Record<string, string | number>) => string

export interface MetaAppFormProps {
  mode: 'publish' | 'edit'
  record: MetaAppRecord | null
  from: string
  busy: boolean
  upload: (from: string, file: File) => Promise<{ metafileUri?: string; pinId?: string }>
  t: Translate
  onSubmit: (payload: Record<string, unknown>) => void
}

export type FieldError = Record<string, string>

interface AssetField {
  name: 'icon' | 'coverImg' | 'introImgs' | 'content' | 'code'
  label: AppsLocaleKey
  multiple: boolean
  image: boolean
}

const ASSET_FIELDS: AssetField[] = [
  { name: 'icon', label: 'fieldIcon', multiple: false, image: true },
  { name: 'coverImg', label: 'fieldCover', multiple: false, image: true },
  { name: 'introImgs', label: 'fieldIntroImgs', multiple: true, image: true },
  { name: 'content', label: 'fieldContent', multiple: false, image: false },
  { name: 'code', label: 'fieldCode', multiple: false, image: false },
]

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** SHA-256 hex for an uploaded content bundle (guarded: no WebCrypto → empty). */
async function sha256HexFromFile(file: File): Promise<string> {
  if (!file || typeof file.arrayBuffer !== 'function') return ''
  const subtle = globalThis.crypto?.subtle
  if (!subtle || typeof subtle.digest !== 'function') return ''
  const buffer = await file.arrayBuffer()
  const digest = await subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function assetInitialValue(record: MetaAppRecord | null, field: AssetField): string {
  if (!record) return ''
  const raw = record[field.name]
  if (Array.isArray(raw)) return raw.map((item) => String(item)).join('\n')
  return typeof raw === 'string' ? raw : ''
}

/**
 * The publish/edit form matching the OAC `src/ui/pages/apps` MetaApp form:
 * basic information, assets (pin references + upload), and technical fields.
 * Payload construction and reference normalization mirror appsProtocol.
 */
export function MetaAppForm({
  mode,
  record,
  from,
  busy,
  upload,
  t,
  onSubmit,
}: MetaAppFormProps): ReactNode {
  const isEdit = mode === 'edit'
  const [appName, setAppName] = useState(record?.appName ?? '')
  const [title, setTitle] = useState(record?.title ?? '')
  const [prompt, setPrompt] = useState(record?.prompt ?? '')
  const [intro, setIntro] = useState(record?.intro ?? '')
  const [tags, setTags] = useState(() => {
    const raw = record?.tags
    if (Array.isArray(raw)) return raw.join(', ')
    return typeof raw === 'string' ? raw : ''
  })
  const [assets, setAssets] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const field of ASSET_FIELDS) initial[field.name] = assetInitialValue(record, field)
    return initial
  })
  const [runtime, setRuntime] = useState<string[]>(() => {
    const selected = recordRuntimeList(record)
    return selected.length > 0 ? selected : ['browser']
  })
  const [indexFile, setIndexFile] = useState(record?.indexFile ?? 'index.html')
  const [version, setVersion] = useState(isEdit ? bumpVersion(record?.version ?? '') : record?.version ?? 'v1.0.0')
  const [contentType, setContentType] = useState(record?.contentType ?? METAAPP_CONTENT_TYPE_OPTIONS[0])
  const [codeType, setCodeType] = useState(record?.codeType ?? METAAPP_CODE_TYPE_OPTIONS[0])
  const [contentHash, setContentHash] = useState(record?.contentHash ?? '')
  const [metadata, setMetadata] = useState(() => metadataToInput(record))
  const [disabled, setDisabled] = useState(record?.disabled === true)
  const [errors, setErrors] = useState<FieldError>({})
  const [assetStatus, setAssetStatus] = useState<Record<string, { tone: 'success' | 'error'; text: string }>>({})

  const previousVersion = isEdit ? recordText(record, ['version']) : ''
  const prevVersion = useRef(previousVersion).current

  const setAsset = (name: string, value: string): void => {
    setAssets((current) => ({ ...current, [name]: value }))
    setAssetStatus((current) => {
      const next = { ...current }
      delete next[name]
      return next
    })
  }

  const onAssetUpload = async (field: AssetField, file: File | undefined): Promise<void> => {
    if (!file) return
    const fieldLabel = t(field.label)
    setAssetStatus((current) => ({ ...current, [field.name]: { tone: 'success', text: '' } }))
    let hash = ''
    if (field.name === 'content') {
      try {
        hash = await sha256HexFromFile(file)
      } catch {}
    }
    try {
      const result = await upload(from, file)
      const uri = result.metafileUri
        ?? (result.pinId ? `metafile://${result.pinId}` : '')
      if (!uri) {
        setAssetStatus((current) => ({ ...current, [field.name]: { tone: 'error', text: t('uploadFailed', { message: 'no metafile uri' }) } }))
        return
      }
      setAsset(field.name, field.multiple && assets[field.name].trim() !== '' ? `${assets[field.name]}\n${uri}` : uri)
      if (field.name === 'content' && hash) setContentHash(hash)
      setAssetStatus((current) => ({ ...current, [field.name]: { tone: 'success', text: t('uploadStored') } }))
    } catch (cause) {
      setAssetStatus((current) => ({ ...current, [field.name]: { tone: 'error', text: t('uploadFailed', { message: errorText(cause) }) } }))
    }
  }

  const submit = (): void => {
    const nextErrors: FieldError = {}
    const normalizedAppName = appName.trim()
    if (!normalizedAppName) nextErrors.appName = t('appNameRequired')
    let contentRef = ''
    try {
      contentRef = normalizeMetafileReference(assets.content, t('fieldContent'))
    } catch (cause) {
      nextErrors.content = errorText(cause)
    }
    if (!contentRef && !nextErrors.content) nextErrors.content = t('contentRequired')
    if (metadata.trim() !== '') {
      try {
        metadataFromInput(metadata)
      } catch (cause) {
        nextErrors.metadata = errorText(cause)
      }
    }
    for (const field of ASSET_FIELDS) {
      if (field.name === 'content') continue
      const value = assets[field.name]
      if (!value.trim()) continue
      try {
        if (field.multiple) {
          normalizeImageList(value, t(field.label))
        } else if (field.image) {
          normalizeImageReference(value, t(field.label))
        } else {
          normalizeMetafileReference(value, t(field.label))
        }
      } catch (cause) {
        nextErrors[field.name] = errorText(cause)
      }
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    onSubmit({
      appName: normalizedAppName,
      title: title.trim() || normalizedAppName,
      prompt: prompt.trim(),
      intro: intro.trim(),
      tags: splitList(tags),
      icon: normalizeImageReference(assets.icon, t('fieldIcon')),
      coverImg: normalizeImageReference(assets.coverImg, t('fieldCover')),
      introImgs: normalizeImageList(assets.introImgs, t('fieldIntroImgs')),
      content: contentRef,
      code: normalizeMetafileReference(assets.code, t('fieldCode')),
      runtime: normalizeRuntimeSelection(runtime),
      indexFile: indexFile.trim() || 'index.html',
      version: version.trim() || 'v1.0.0',
      contentType: contentType || METAAPP_CONTENT_TYPE_OPTIONS[0],
      codeType: codeType || METAAPP_CODE_TYPE_OPTIONS[0],
      contentHash: contentHash.trim(),
      metadata: metadataFromInput(metadata),
      disabled,
    })
  }

  const field = (
    name: 'appName' | 'title' | 'intro' | 'prompt' | 'tags',
    label: AppsLocaleKey,
    wide = false,
  ): ReactNode => {
    const required = name === 'appName'
    const value = name === 'appName'
      ? appName
      : name === 'title'
        ? title
        : name === 'intro'
          ? intro
          : name === 'prompt'
            ? prompt
            : tags
    const set = name === 'appName'
      ? setAppName
      : name === 'title'
        ? setTitle
        : name === 'intro'
          ? setIntro
          : name === 'prompt'
            ? setPrompt
            : setTags
    if (name === 'prompt' || name === 'intro' || name === 'tags') {
      return (
        <label className={`oac-field ${wide ? 'span-2' : ''}`}>
          <span className="oac-field-label">
            {t(label)}
            {required ? <span className="oac-apps-required-mark" aria-hidden="true">*</span> : null}
          </span>
          <textarea
            className="oac-input"
            rows={name === 'tags' ? 2 : 3}
            value={value}
            onChange={(event) => set(event.target.value)}
          />
          {errors[name] ? <p className="oac-apps-field-error">{errors[name]}</p> : null}
        </label>
      )
    }
    return (
      <label className="oac-field">
        <span className="oac-field-label">
          {t(label)}
          {required ? <span className="oac-apps-required-mark" aria-hidden="true">*</span> : null}
        </span>
        <Input value={value} onChange={(event) => set(event.target.value)} />
        {errors[name] ? <p className="oac-apps-field-error">{errors[name]}</p> : null}
      </label>
    )
  }

  const assetField = (assetFieldDef: AssetField): ReactNode => {
    const status = assetStatus[assetFieldDef.name]
    const isContent = assetFieldDef.name === 'content'
    return (
      <div className={`oac-apps-asset ${isContent ? 'span-2' : ''}`} key={assetFieldDef.name}>
        <div className="oac-apps-asset-head">
          <span className="oac-field-label">
            {t(assetFieldDef.label)}
            {assetFieldDef.name === 'content'
              ? <span className="oac-apps-required-mark" aria-hidden="true">*</span>
              : <span className="oac-apps-optional-mark">{t('optional')}</span>}
          </span>
          <label className="oac-apps-upload-btn">
            <input
              type="file"
              hidden
              disabled={busy}
              multiple={assetFieldDef.multiple}
              onChange={(event) => { void onAssetUpload(assetFieldDef, event.target.files?.[0]); event.target.value = '' }}
            />
            {t('upload')}
          </label>
        </div>
        {assetFieldDef.multiple ? (
          <textarea
            className="oac-input"
            rows={2}
            placeholder={t('introImgsHint')}
            value={assets[assetFieldDef.name]}
            onChange={(event) => setAsset(assetFieldDef.name, event.target.value)}
          />
        ) : (
          <Input
            placeholder="metafile://…"
            value={assets[assetFieldDef.name]}
            onChange={(event) => setAsset(assetFieldDef.name, event.target.value)}
          />
        )}
        <p className="oac-hint">{t('assetPinHelp')}</p>
        {errors[assetFieldDef.name]
          ? <p className="oac-apps-field-error">{errors[assetFieldDef.name]}</p>
          : status
            ? <p className={`oac-apps-asset-status ${status.tone}`}>{status.text}</p>
            : null}
      </div>
    )
  }

  return (
    <form id="oac-metaapp-form" className="oac-apps-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
      <section className="oac-apps-form-section">
        <h3>{t('basicInfo')}</h3>
        <div className="oac-apps-form-grid">
          {field('appName', 'fieldAppName')}
          {field('title', 'fieldTitle')}
          {field('prompt', 'fieldPrompt', true)}
          {field('intro', 'fieldIntro', true)}
          {field('tags', 'fieldTags', true)}
        </div>
        <p className="oac-hint">{t('tagsHelp')}</p>
      </section>

      <section className="oac-apps-form-section">
        <h3>{t('assets')}</h3>
        <div className="oac-apps-form-grid">
          {ASSET_FIELDS.map((assetFieldDef) => assetField(assetFieldDef))}
        </div>
      </section>

      <section className="oac-apps-form-section">
        <h3>{t('technicalInfo')}</h3>
        <div className="oac-field">
          <span className="oac-field-label">{t('fieldRuntime')}</span>
          <div className="oac-apps-runtime">
            {METAAPP_RUNTIME_OPTIONS.map((option) => {
              const key = `runtime${option[0].toUpperCase()}${option.slice(1)}` as AppsLocaleKey
              const label = t(key)
              return (
                <label className="oac-apps-runtime-option" key={option}>
                  <input
                    type="checkbox"
                    checked={runtime.includes(option)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...runtime, option]
                        : runtime.filter((item) => item !== option)
                      setRuntime(next.length > 0 ? next : ['browser'])
                    }}
                  />
                  {label}
                </label>
              )
            })}
          </div>
        </div>
        <div className="oac-apps-form-grid">
          <label className="oac-field">
            <span className="oac-field-label">
              {t('fieldIndexFile')}
              <span className="oac-apps-optional-mark">{t('optional')}</span>
            </span>
            <Input value={indexFile} onChange={(event) => setIndexFile(event.target.value)} />
          </label>
          <label className="oac-field">
            <span className="oac-field-label">{t('fieldVersion')}</span>
            <Input value={version} onChange={(event) => setVersion(event.target.value)} />
            {prevVersion ? <p className="oac-apps-version-note">{t('previousVersion', { version: prevVersion })}</p> : null}
          </label>
          <label className="oac-field">
            <span className="oac-field-label">{t('fieldContentType')}</span>
            <select className="oac-input oac-input-select" value={contentType} onChange={(event) => setContentType(event.target.value)}>
              {METAAPP_CONTENT_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="oac-field">
            <span className="oac-field-label">{t('fieldCodeType')}</span>
            <select className="oac-input oac-input-select" value={codeType} onChange={(event) => setCodeType(event.target.value)}>
              {METAAPP_CODE_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="oac-field span-2">
            <span className="oac-field-label">
              {t('fieldContentHash')}
              <span className="oac-apps-optional-mark">{t('optional')}</span>
            </span>
            <Input value={contentHash} onChange={(event) => setContentHash(event.target.value)} />
          </label>
          <label className="oac-field span-2">
            <span className="oac-field-label">
              {t('fieldMetadata')}
              <span className="oac-apps-optional-mark">{t('optional')}</span>
            </span>
            <textarea
              className="oac-input"
              rows={4}
              spellCheck={false}
              placeholder={t('metadataPlaceholder')}
              value={metadata}
              onChange={(event) => setMetadata(event.target.value)}
            />
            {errors.metadata ? <p className="oac-apps-field-error">{errors.metadata}</p> : null}
          </label>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={disabled}
          className={disabled ? 'oac-switch on' : 'oac-switch'}
          onClick={() => setDisabled((current) => !current)}
        >
          <span className="oac-switch-track"><span className="oac-switch-thumb" /></span>
          <span className="oac-switch-text">{t('fieldDisabled')}</span>
        </button>
        <p className="oac-hint">{t('disabledHelp')}</p>
      </section>
    </form>
  )
}
