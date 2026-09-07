import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { IconCloseOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LlmDirectory } from './api.ts'
import type { BotsLocaleKey } from './locale.ts'
import { LlmPicker } from './LlmPicker.tsx'

type Translate = (key: BotsLocaleKey, vars?: Record<string, string | number>) => string

export type CreateBotInput = {
  name: string
  dshLlmProvider: string
  dshLlmModel: string
  dshLlmReasoningEffort?: string
  dshLlmFallbackProvider?: string
  dshLlmFallbackModel?: string
  dshLlmFallbackReasoningEffort?: string
}

export function CreateBotForm({
  t,
  directory,
  busy,
  error,
  formId,
  existingNames,
  onValidityChange,
  onSubmit,
}: {
  t: Translate
  directory: LlmDirectory | null
  busy: boolean
  error: string | null
  formId: string
  /** Names of the Bots already on this machine, for the duplicate pre-check. */
  existingNames: string[]
  onValidityChange: (valid: boolean) => void
  onSubmit: (input: CreateBotInput) => Promise<void>
}): ReactNode {
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState('')
  const [fallbackProvider, setFallbackProvider] = useState('')
  const [fallbackModel, setFallbackModel] = useState('')
  const [fallbackReasoningEffort, setFallbackReasoningEffort] = useState('')
  const fallbackSet = Boolean(fallbackProvider && fallbackModel)

  // Name duplicate pre-check (the daemon stays authoritative via name_taken);
  // the message shows on blur/submit, the submit gate applies immediately.
  const trimmedName = name.trim()
  const nameDuplicate = trimmedName !== ''
    && existingNames.some((existing) => existing.trim().toLowerCase() === trimmedName.toLowerCase())
  const showNameError = nameDuplicate && nameTouched

  // The modal footer owns the actions; it needs the same gating this form
  // computes, so the validity travels up through the injected callback.
  const canSubmit = Boolean(trimmedName && provider && model) && !nameDuplicate && !busy
  useEffect(() => { onValidityChange(canSubmit) }, [canSubmit, onValidityChange])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setNameTouched(true)
    if (nameDuplicate || !canSubmit) return
    await onSubmit({
      name: trimmedName,
      dshLlmProvider: provider,
      dshLlmModel: model,
      ...(reasoningEffort ? { dshLlmReasoningEffort: reasoningEffort } : {}),
      ...(fallbackProvider && fallbackModel
        ? {
          dshLlmFallbackProvider: fallbackProvider,
          dshLlmFallbackModel: fallbackModel,
          ...(fallbackReasoningEffort ? { dshLlmFallbackReasoningEffort: fallbackReasoningEffort } : {}),
        }
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
          onBlur={() => setNameTouched(true)}
          placeholder={t('fieldNamePlaceholder')}
          autoFocus
        />
        {showNameError ? <span className="oac-error" role="alert">{t('nameDuplicate')}</span> : null}
      </label>
      <div className="oac-field">
        <span className="oac-field-label">{t('llmBrain')}</span>
        <LlmPicker
          value={{ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) }}
          directory={directory}
          locked={busy}
          invalid={!provider || !model}
          onChange={(next) => {
            setProvider(next.provider)
            setModel(next.model)
            setReasoningEffort(next.reasoningEffort ?? '')
          }}
          t={t}
        />
      </div>
      <div className="oac-field">
        <span className="oac-field-label">{t('llmFallback')}</span>
        {fallbackSet ? (
          <div className="oac-llm-fallback-row">
            <LlmPicker
              value={{
                provider: fallbackProvider,
                model: fallbackModel,
                ...(fallbackReasoningEffort ? { reasoningEffort: fallbackReasoningEffort } : {}),
              }}
              directory={directory}
              locked={busy}
              onChange={(next) => {
                setFallbackProvider(next.provider)
                setFallbackModel(next.model)
                setFallbackReasoningEffort(next.reasoningEffort ?? '')
              }}
              t={t}
            />
            <button
              type="button"
              className="oac-llm-clear"
              aria-label={t('llmClearFallback')}
              title={t('llmClearFallback')}
              disabled={busy}
              onClick={() => {
                setFallbackProvider('')
                setFallbackModel('')
                setFallbackReasoningEffort('')
              }}
            >
              <IconCloseOutline16 size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="oac-a2a-guidance-toggle"
            disabled={busy || !provider || !model}
            onClick={() => {
              setFallbackProvider(provider)
              setFallbackModel(model)
              setFallbackReasoningEffort(reasoningEffort)
            }}
          >
            {t('llmSetFallback')}
          </button>
        )}
        <span className="oac-hint">{t('llmFallbackHint')}</span>
      </div>
    </form>
  )
}
