/**
 * Shadow of the new-session agent-preset chip (`conversation.hero.agentPreset`,
 * priority -1). OAC presets show the Bot name/avatar; every other preset stays
 * a stock DSH row. Does not shadow Settings → Agent presets.
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAgentPresetOutline16, IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { chipAvatar, slugFromPresetId, type ChipBot, type ChipPresetOption } from '../chip-logic.ts'
import type { BotPresetSeatState } from './preset-seat-store.ts'
import { presetDisplayText, type AgentPresetTranslate } from './preset-display.ts'

export interface BotPresetSeatInjected {
  hooks: {
    botPresetSeat: SnapshotStore<BotPresetSeatState>
  }
  load: () => Promise<void>
  select: (id: string) => Promise<void>
}

export type BotPresetSeatProps =
  PropsRuntime<'conversation.hero.agentPreset'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<BotPresetSeatInjected>

function optionLabel(
  option: ChipPresetOption,
  botsBySlug: Readonly<Record<string, Pick<ChipBot, 'name'>>>,
  t: AgentPresetTranslate,
): string {
  const slug = slugFromPresetId(option.id)
  if (slug !== undefined) {
    const botName = botsBySlug[slug]?.name.trim()
    if (botName) return botName
  }
  return presetDisplayText(option, t).name
}

function PresetGlyph({ avatar, className }: { avatar: string | undefined; className: string }): ReactNode {
  if (avatar !== undefined) {
    return <img src={avatar} alt="" className={`oac-preset-avatar ${className}`} />
  }
  return <IconAgentPresetOutline16 className={className} />
}

export function BotPresetSeat({
  load,
  select,
  useBotPresetSeat,
  t,
}: BotPresetSeatProps): ReactNode {
  const state = useBotPresetSeat((snapshot) => snapshot)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const chosen = state.options.find((option) => option.id === state.current)
  const label = chosen === undefined ? state.current : optionLabel(chosen, state.botsBySlug, t)
  const ready = state.options.length > 0 && state.current !== ''
  if (!ready) return null

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={state.options.map((option) => {
        const text = presetDisplayText(option, t)
        return {
          id: option.id,
          icon: (
            <PresetGlyph
              avatar={chipAvatar(option.id, state.botsBySlug)}
              className="oac-preset-seat-item-icon"
            />
          ),
          label: (
            <span className="oac-preset-seat-item">
              <span className="oac-preset-seat-item-name">{optionLabel(option, state.botsBySlug, t)}</span>
              <span className="oac-preset-seat-item-desc">{text.description ?? t('noDescription')}</span>
            </span>
          ),
        }
      })}
      selectedId={state.current}
      onSelect={(id) => {
        setOpen(false)
        void select(id)
      }}
      align="start"
      portal
      anchor={(
        <button
          type="button"
          className="oac-preset-seat"
          aria-haspopup="menu"
          aria-expanded={open}
          title={state.error ?? t('seatHint')}
          disabled={state.busy}
          onClick={() => { setOpen((value) => !value) }}
        >
          <PresetGlyph
            avatar={chipAvatar(state.current, state.botsBySlug)}
            className="oac-preset-seat-icon"
          />
          {label}
          <IconChevronDownOutline14 className="oac-preset-seat-chevron" />
        </button>
      )}
    />
  )
}
