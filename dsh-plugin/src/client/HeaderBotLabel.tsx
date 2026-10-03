/**
 * Session-header Bot label — the plugin's shadow of the stock
 * `AgentPresetLabel` cell (`conversation.session.header.actions`, list id
 * `agent-preset`). The slots framework renders a list cell's lowest-priority
 * entry, so registering the same id at priority -1 replaces the stock label
 * for every session, and the stock label returns unchanged the moment this
 * registration retires (plugin disabled or removed). An `oac-*` preset
 * resolves to its Bot: the Bot's avatar (`BotAvatar` — chain refs ride the
 * daemon avatar proxy, initials stand in when the Bot has no image) beside
 * the Bot's current name. Every other preset re-renders the stock label face
 * (compat preset icon + roster copy), so stock DSH sessions look exactly as
 * shipped.
 */

import { useEffect, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { IconAgentPresetOutline16 } from './icons.ts'
import {
  chipAvatar,
  chipDescription,
  chipDisplayName,
  slugFromPresetId,
} from '../chip-logic.ts'
import type { BotPresetSeatState } from './preset-seat-store.ts'
import { presetDisplayText } from './preset-display.ts'
import { BotAvatar } from './BotAvatar.tsx'

export interface HeaderBotLabelInjected {
  hooks: {
    botPresetSeat: SnapshotStore<BotPresetSeatState>
  }
  /** Refresh the preset roster + Bot list (avatar data included). */
  load: () => Promise<void>
}

export type HeaderBotLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<HeaderBotLabelInjected>

export function HeaderBotLabel({
  sessionId,
  useSessions,
  useBotPresetSeat,
  load,
  t,
}: HeaderBotLabelProps): ReactNode {
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
  const slug = slugFromPresetId(preset)
  const bot = slug === undefined ? undefined : state.botsBySlug[slug]
  if (bot === undefined) {
    // Stock DSH preset (or a Bot the roster has not loaded yet): the stock
    // label face — roster copy over the raw id, same as AgentPresetLabel.
    const text = option === undefined ? undefined : presetDisplayText(option, t)
    return (
      <span className="oac-header-bot-label" title={text?.description ?? t('headerHint')}>
        <IconAgentPresetOutline16 size={14} className="oac-header-bot-label-icon" />
        {text?.name ?? preset}
      </span>
    )
  }
  return (
    <span
      className="oac-header-bot-label"
      title={chipDescription(
        { id: preset, ...(option?.description === undefined ? {} : { description: option.description }) },
        state.botsBySlug,
        t('headerHint'),
      )}
    >
      <BotAvatar
        name={bot.name}
        src={chipAvatar(preset, state.botsBySlug)}
        className="oac-header-bot-label-avatar"
      />
      <span className="oac-header-bot-label-name">
        {chipDisplayName({ id: preset, ...(option?.name === undefined ? {} : { name: option.name }) }, state.botsBySlug)}
      </span>
    </span>
  )
}
