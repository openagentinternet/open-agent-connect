/**
 * Conversation header label for OAC Bot presets.
 *
 * The shipped agent-preset cell is replaced by the same slot id so the Bot
 * avatar sits exactly where DSH normally renders its preset glyph. Stock DSH
 * presets keep their original icon and localized label.
 */

import { useEffect, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAgentPresetOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import { chipAvatar, slugFromPresetId, type ChipBot, type ChipPresetOption } from '../chip-logic.ts'
import { BotAvatar } from './BotAvatar.tsx'
import type { BotPresetSeatState } from './preset-seat-store.ts'
import { presetDisplayText, type AgentPresetTranslate } from './preset-display.ts'

export interface BotPresetHeaderLabelInjected {
  hooks: {
    botPresetSeat: SnapshotStore<BotPresetSeatState>
  }
  load: () => Promise<void>
}

export type BotPresetHeaderLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<BotPresetHeaderLabelInjected>

function labelFor(
  option: ChipPresetOption,
  botsBySlug: Readonly<Record<string, Pick<ChipBot, 'name'>>>,
  t: AgentPresetTranslate,
): string {
  const slug = slugFromPresetId(option.id)
  const botName = slug === undefined ? undefined : botsBySlug[slug]?.name.trim()
  return botName || presetDisplayText(option, t).name
}

export function BotPresetHeaderLabel({
  sessionId,
  useSessions,
  useBotPresetSeat,
  load,
  t,
}: BotPresetHeaderLabelProps): ReactNode {
  const preset = useSessions((state) => {
    const value = state.byId[sessionId]?.projectionValues?.agentPreset
    return typeof value === 'string' ? value : undefined
  })
  const state = useBotPresetSeat((snapshot) => snapshot)

  useEffect(() => {
    if (preset !== undefined) void load()
  }, [preset, load])

  if (preset === undefined) return null

  const option = state.options.find((entry) => entry.id === preset)
  const name = option === undefined
    ? (state.botsBySlug[slugFromPresetId(preset) ?? '']?.name.trim() || preset)
    : labelFor(option, state.botsBySlug, t)
  const avatar = chipAvatar(preset, state.botsBySlug)
  const description = option === undefined ? undefined : presetDisplayText(option, t).description
  const oacBot = slugFromPresetId(preset) !== undefined

  return (
    <span className="oac-bot-preset-header-label" title={description ?? name}>
      {oacBot
        ? <BotAvatar name={name} src={avatar} className="oac-bot-preset-header-avatar" />
        : <IconAgentPresetOutlineRegular size={14} className="oac-bot-preset-header-icon" />}
      {name}
    </span>
  )
}
