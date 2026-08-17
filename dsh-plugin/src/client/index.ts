/**
 * Browser half of open-agent-connect-dsh: locale dictionaries, the Bots
 * settings section (`oac-bots`), and the new-session preset chip. Does not
 * shadow Settings → Agent presets. Conversations / Services / Apps sections
 * register in a later round.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { api } from './api.ts'
import { BotPanel } from './BotPanel.tsx'
import { BotPresetSeat, type BotPresetSeatInjected } from './BotPresetSeat.tsx'
import { en, NS, zh, type BotsLocaleKey } from './locale.ts'
import type { SeatApi, SeatSessionSummary } from './preset-seat-store.ts'
import { BotPresetSeatController } from './preset-seat-store.ts'
import { BOTS_CSS, PRESETS_CSS } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.oac.bots': BotsLocaleKey
  }
}

export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'open-agent-connect-dsh'
    tag.textContent = BOTS_CSS + PRESETS_CSS
    document.head.append(tag)
    return () => { tag.remove() }
  }, 'oac-dsh: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'oac-dsh: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'oac-bots',
    order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({
      list: () => api.list(),
      create: (input: Parameters<typeof api.create>[0]) => api.create(input),
      update: (slug: string, patch: Record<string, unknown>) => api.update(slug, patch),
      remove: (slug: string) => api.remove(slug),
      llmDirectory: () => api.llmDirectory(),
    }),
  }, BotPanel))

  ctx.inject(['slots', 'conversation', 'sessions'], (scope: ClientContext) => {
    const connection = ctx.get('connection') as { api: SeatApi }
    const seat = new BotPresetSeatController(
      connection.api,
      async () => (await api.list()).map((bot) => ({
        name: bot.name,
        slug: bot.slug,
        ...(bot.avatarDataUrl === undefined ? {} : { avatarDataUrl: bot.avatarDataUrl }),
        dshLlmProvider: bot.dshLlmProvider,
        dshLlmModel: bot.dshLlmModel,
      })),
      (): SeatSessionSummary | undefined => {
        const state = scope.sessions.list.getSnapshot()
        const summary = state.current === undefined ? undefined : state.byId[state.current]
        return summary === undefined
          ? undefined
          : {
            id: summary.id,
            blank: summary.blank,
            ...(summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset }),
          }
      },
      (sessionId, agentPreset) => {
        scope.sessions.noteAgentPreset(sessionId as never, agentPreset)
      },
    )

    const seatInjected = (): BotPresetSeatInjected => ({
      hooks: { botPresetSeat: seat.store },
      load: () => seat.load(),
      select: (id: string) => seat.select(id),
    })

    scope.effect(() => {
      const stop = scope.sessions.list.subscribe(() => { void seat.apply() })
      const chip = scope.slots.register({
        name: 'conversation.hero.agentPreset',
        priority: -1,
        locale: 'settings.agentPreset',
        inject: seatInjected,
      }, BotPresetSeat)
      return () => {
        stop()
        chip()
      }
    }, 'oac-dsh: preset chip')
  })
}
