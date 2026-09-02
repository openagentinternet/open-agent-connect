import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { LlmDirectory } from './api.ts'
import type { BotsLocaleKey } from './locale.ts'

type Translate = (key: BotsLocaleKey, vars?: Record<string, string | number>) => string

/** Provider/model/reasoning-effort triple the picker edits as one unit. */
export interface LlmSelection {
  provider: string
  model: string
  /** off/low/high/max; absent keeps the provider default. */
  reasoningEffort?: string
}

const EFFORT_KEYS = ['off', 'low', 'high', 'max'] as const
const EFFORT_LABEL_KEYS = {
  off: 'llmEffortOff',
  low: 'llmEffortLow',
  high: 'llmEffortHigh',
  max: 'llmEffortMax',
} as const

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort'

/**
 * Model + reasoning-effort picker for the Bot editor, ported from the DSH
 * composer's ModelSelect (ui-model-selection): a trigger chip showing
 * "model · effort", and a two-level menu — root Model/Effort cells drilling
 * into the provider-grouped model list and the effort levels. The catalog is
 * the plugin's `llm/directory`; efforts use the DSH adapter vocabulary
 * (off/low/high/max) plus a provider-default row.
 */
export function LlmPicker({
  value,
  directory,
  onChange,
  t,
  locked = false,
  invalid = false,
}: {
  value: LlmSelection
  directory: LlmDirectory | null
  onChange: (next: LlmSelection) => void
  t: Translate
  locked?: boolean
  /** Highlight an incomplete required selection (primary brain not chosen). */
  invalid?: boolean
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const id = useId()

  const groups = useMemo(() => (directory?.providers ?? []).map((provider) => ({
    id: provider.id,
    name: provider.name,
    models: directory?.modelsByProvider[provider.id] ?? [],
  })), [directory])

  const hasModel = value.provider !== '' && value.model !== ''
  const modelName = useMemo(() => {
    if (!hasModel) return ''
    const provider = groups.find((row) => row.id === value.provider)
    return provider?.models.find((row) => row.id === value.model)?.name ?? `${value.provider}/${value.model}`
  }, [groups, hasModel, value.provider, value.model])
  const effortLabel = value.reasoningEffort
    ? t(EFFORT_LABEL_KEYS[value.reasoningEffort as keyof typeof EFFORT_LABEL_KEYS] ?? 'llmEffortOff')
    : ''
  const triggerLabel = !hasModel ? t('llmSelectModel') : effortLabel ? `${modelName} · ${effortLabel}` : modelName

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setPane('root')
      }
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter((item) => item !== null)
    if (items.length === 0) return
    const active = items.findIndex((item) => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const chooseModel = (provider: string, model: string): void => {
    onChange({ provider, model, ...(value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}) })
    close(true)
  }

  const chooseEffort = (effort: string): void => {
    onChange({ ...value, ...(effort ? { reasoningEffort: effort } : { reasoningEffort: undefined }) })
    close(true)
  }

  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex
    itemIndex += 1
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className="oac-llm-picker" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={invalid ? 'oac-llm-trigger oac-llm-trigger-invalid' : 'oac-llm-trigger'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={`${t('llmPickerAria')}: ${triggerLabel}`}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) close()
          else {
            setPane('root')
            setOpen(true)
          }
        }}
      >
        <span className="oac-llm-trigger-label">{triggerLabel}</span>
        {effortLabel ? <span className="oac-llm-trigger-effort">{effortLabel}</span> : null}
        <IconChevronDownOutline14 className={open ? 'oac-llm-chevron oac-llm-chevron-open' : 'oac-llm-chevron'} />
      </button>

      {open ? (
        <div id={`${id}-menu`} className="oac-llm-menu" role="menu" aria-label={t('llmMenuAria')}>
          {pane === 'root' ? (
            <>
              <button ref={itemRef()} type="button" role="menuitem" className="oac-llm-cell" onClick={() => { setPane('model') }}>
                <span className="oac-llm-cell-label">{t('llmMenuModel')}</span>
                <span className="oac-llm-cell-value">{hasModel ? modelName : t('llmSelectModel')}</span>
                <IconChevronRightOutline14 className="oac-llm-cell-chevron" />
              </button>
              {hasModel ? (
                <button ref={itemRef()} type="button" role="menuitem" className="oac-llm-cell" onClick={() => { setPane('effort') }}>
                  <span className="oac-llm-cell-label">{t('llmMenuEffort')}</span>
                  <span className="oac-llm-cell-value">{effortLabel || t('llmEffortDefault')}</span>
                  <IconChevronRightOutline14 className="oac-llm-cell-chevron" />
                </button>
              ) : null}
            </>
          ) : null}

          {pane === 'model' ? (
            <div className="oac-llm-groups">
              {directory === null ? <div className="oac-llm-status">{t('llmLoading')}</div> : null}
              {directory !== null && groups.length === 0 ? <div className="oac-llm-status">{t('llmEmptyModels')}</div> : null}
              {groups.map((group) => {
                const headingId = `${id}-${group.id}`
                return (
                  <section role="group" aria-labelledby={headingId} className="oac-llm-group" key={group.id}>
                    <div className="oac-llm-group-title" id={headingId}>{group.name}</div>
                    {group.models.map((model) => {
                      const selected = value.provider === group.id && value.model === model.id
                      return (
                        <button
                          ref={itemRef()}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          className={selected ? 'oac-llm-option selected' : 'oac-llm-option'}
                          key={model.id}
                          title={model.name}
                          onClick={() => chooseModel(group.id, model.id)}
                        >
                          <span className="oac-llm-option-name">{model.name}</span>
                          <span className="oac-llm-check">{selected ? <IconCheckOutline16 /> : null}</span>
                        </button>
                      )
                    })}
                  </section>
                )
              })}
            </div>
          ) : null}

          {pane === 'effort' ? (
            <>
              <button
                ref={itemRef()}
                type="button"
                role="menuitemradio"
                aria-checked={!value.reasoningEffort}
                className={!value.reasoningEffort ? 'oac-llm-option selected' : 'oac-llm-option'}
                onClick={() => chooseEffort('')}
              >
                <span className="oac-llm-option-name">{t('llmEffortDefault')}</span>
                <span className="oac-llm-check">{!value.reasoningEffort ? <IconCheckOutline16 /> : null}</span>
              </button>
              {EFFORT_KEYS.map((effort) => {
                const selected = value.reasoningEffort === effort
                return (
                  <button
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={selected ? 'oac-llm-option selected' : 'oac-llm-option'}
                    key={effort}
                    onClick={() => chooseEffort(effort)}
                  >
                    <span className="oac-llm-option-name">{t(EFFORT_LABEL_KEYS[effort])}</span>
                    <span className="oac-llm-check">{selected ? <IconCheckOutline16 /> : null}</span>
                  </button>
                )
              })}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
