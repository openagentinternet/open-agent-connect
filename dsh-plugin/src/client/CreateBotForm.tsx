import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
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
  onCancel,
  onSubmit,
}: {
  t: Translate
  directory: LlmDirectory | null
  busy: boolean
  error: string | null
  onCancel: () => void
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

  const canSubmit = Boolean(name.trim() && provider && model) && !busy

  return (
    <form className="oac-form" onSubmit={(event) => { void submit(event) }}>
      <h2>{t('createTitle')}</h2>
      <p className="oac-muted">{t('fieldLlmHint')}</p>
      {error ? <div className="oac-error">{error}</div> : null}
      <label>
        {t('fieldName')}
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('fieldNamePlaceholder')} />
      </label>
      <label>
        {t('fieldProvider')}
        <select value={provider} onChange={(event) => { setProvider(event.target.value); setModel('') }}>
          <option value="">{t('fieldProvider')}</option>
          {providers.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </label>
      <label>
        {t('fieldModel')}
        <select value={model} onChange={(event) => setModel(event.target.value)} disabled={!provider}>
          <option value="">{t('fieldModel')}</option>
          {models.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </label>
      <label>
        {t('fieldFallbackProvider')}
        <select value={fallbackProvider} onChange={(event) => { setFallbackProvider(event.target.value); setFallbackModel('') }}>
          <option value=""></option>
          {providers.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </label>
      <label>
        {t('fieldFallbackModel')}
        <select value={fallbackModel} onChange={(event) => setFallbackModel(event.target.value)} disabled={!fallbackProvider}>
          <option value=""></option>
          {fallbackModels.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </label>
      <div className="oac-actions">
        <Button type="button" onClick={onCancel}>{t('cancel')}</Button>
        <Button type="submit" disabled={!canSubmit}>{busy ? t('creating') : t('create')}</Button>
      </div>
    </form>
  )
}
