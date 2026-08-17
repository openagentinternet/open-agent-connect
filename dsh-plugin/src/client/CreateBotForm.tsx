import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LlmDirectory } from './api.ts'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey, vars?: Record<string, string | number>) => string

export type CreateBotInput = {
  name: string
  dshLlmProvider: string
  dshLlmModel: string
  dshLlmFallbackProvider?: string
  dshLlmFallbackModel?: string
}

export function CreateBotForm({
  t,
  directory,
  busy,
  error,
  formId,
  onValidityChange,
  onSubmit,
}: {
  t: Translate
  directory: LlmDirectory | null
  busy: boolean
  error: string | null
  formId: string
  onValidityChange: (valid: boolean) => void
  onSubmit: (input: CreateBotInput) => Promise<void>
}): ReactNode {
  const providers = directory?.providers ?? []
  const [name, setName] = useState('')
  const [provider, setProvider] = useState(providers[0]?.id ?? '')
  const [model, setModel] = useState('')
  const [fallbackProvider, setFallbackProvider] = useState('')
  const [fallbackModel, setFallbackModel] = useState('')

  useEffect(() => {
    if (!provider && providers[0]) setProvider(providers[0].id)
  }, [provider, providers])

  const models = directory?.modelsByProvider[provider] ?? []
  const fallbackModels = fallbackProvider ? directory?.modelsByProvider[fallbackProvider] ?? [] : []

  // The modal footer owns the actions; it needs the same gating this form
  // computes, so the validity travels up through the injected callback.
  const canSubmit = Boolean(name.trim() && provider && model) && !busy
  useEffect(() => { onValidityChange(canSubmit) }, [canSubmit, onValidityChange])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    await onSubmit({
      name: name.trim(),
      dshLlmProvider: provider,
      dshLlmModel: model,
      ...(fallbackProvider && fallbackModel
        ? { dshLlmFallbackProvider: fallbackProvider, dshLlmFallbackModel: fallbackModel }
        : {}),
    })
  }

  return (
    <form className="oac-form" id={formId} onSubmit={(event) => { void submit(event) }}>
      {error ? <div className="oac-error" role="alert">{error}</div> : null}
      <label className="oac-field">
        <span className="oac-field-label">{t('fieldName')}</span>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('fieldNamePlaceholder')}
          autoFocus
        />
      </label>
      <label className="oac-field">
        <span className="oac-field-label">{t('fieldProvider')}</span>
        <select
          className="oac-input oac-input-select"
          value={provider}
          onChange={(event) => { setProvider(event.target.value); setModel('') }}
        >
          <option value="">{t('fieldProvider')}</option>
          {providers.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </label>
      <label className="oac-field">
        <span className="oac-field-label">{t('fieldModel')}</span>
        <select
          className="oac-input oac-input-select"
          value={model}
          disabled={!provider}
          onChange={(event) => setModel(event.target.value)}
        >
          <option value="">{t('fieldModel')}</option>
          {models.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </label>
      <label className="oac-field">
        <span className="oac-field-label">{t('fieldFallbackProvider')}</span>
        <select
          className="oac-input oac-input-select"
          value={fallbackProvider}
          onChange={(event) => { setFallbackProvider(event.target.value); setFallbackModel('') }}
        >
          <option value=""></option>
          {providers.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </label>
      <label className="oac-field">
        <span className="oac-field-label">{t('fieldFallbackModel')}</span>
        <select
          className="oac-input oac-input-select"
          value={fallbackModel}
          disabled={!fallbackProvider}
          onChange={(event) => setFallbackModel(event.target.value)}
        >
          <option value=""></option>
          {fallbackModels.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </label>
    </form>
  )
}
