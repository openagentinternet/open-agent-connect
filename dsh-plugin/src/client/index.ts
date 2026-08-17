/**
 * Browser half of open-agent-connect-dsh: locale dictionaries, four Settings
 * sections, and the new-session preset chip. Does not shadow Settings →
 * Agent presets.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { api } from './api.ts'
import { A2AConversation, type A2AConversationInjected } from './A2AConversation.tsx'
import { AppsPanel } from './AppsPanel.tsx'
import { BotPanel } from './BotPanel.tsx'
import { BotPresetSeat, type BotPresetSeatInjected } from './BotPresetSeat.tsx'
import { appEn, APP_NS, appZh, type AppsLocaleKey } from './locale-apps.ts'
import { convEn, CONV_NS, convZh, type ConversationsLocaleKey } from './locale-conversations.ts'
import { en, NS, zh, type BotsLocaleKey } from './locale.ts'
import { svcEn, SVC_NS, svcZh, type ServicesLocaleKey } from './locale-services.ts'
import type { SeatApi, SeatSessionSummary } from './preset-seat-store.ts'
import { BotPresetSeatController } from './preset-seat-store.ts'
import { ServicesPanel } from './ServicesPanel.tsx'
import { BOTS_CSS, PRESETS_CSS } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.oac.bots': BotsLocaleKey
    'settings.oac.conversations': ConversationsLocaleKey
    'settings.oac.services': ServicesLocaleKey
    'settings.oac.apps': AppsLocaleKey
  }
  interface SlotMap {
    /** Sidebar-foot action above Settings; owner share is the column state. */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: { wide: boolean } }
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
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'oac-dsh: bots dictionary')
  ctx.effect(() => ctx.locale.register(CONV_NS, { zh: convZh, en: convEn }), 'oac-dsh: conversations dictionary')
  ctx.effect(() => ctx.locale.register(SVC_NS, { zh: svcZh, en: svcEn }), 'oac-dsh: services dictionary')
  ctx.effect(() => ctx.locale.register(APP_NS, { zh: appZh, en: appEn }), 'oac-dsh: apps dictionary')
  const t = ctx.locale.bind(NS)
  const tConv = ctx.locale.bind(CONV_NS)
  const tSvc = ctx.locale.bind(SVC_NS)
  const tApps = ctx.locale.bind(APP_NS)
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
      chatSkills: (from: string) => api.chatSkills(from),
      loadAutoReplyStatus: (from: string) => api.autoReplyStatus(from),
      autoReplyConfig: (
        from: string,
        patch: { enabled?: boolean; maxTurns?: number; cooldownMs?: number },
      ) => api.autoReplyConfig(from, patch),
    }),
  }, BotPanel))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'oac-a2a',
    order: 0,
    locale: CONV_NS,
    inject: (): A2AConversationInjected => ({
      bots: () => api.list(),
      list: (from: string) => api.conversations(from),
      thread: (from: string, peer: string) => api.conversationThread(from, peer),
      send: (from: string, to: string, content: string) => api.chatPrivate(from, to, content),
      guidance: (from: string, peer: string, guidance: string) =>
        api.conversationGuidance(from, peer, guidance),
    }),
  }, A2AConversation))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'oac-services',
    order: 22,
    label: () => tSvc('nav'),
    locale: SVC_NS,
    inject: () => ({
      bots: () => api.list(),
      owned: (from: string) => api.servicesOwned(from),
      orders: (from: string, serviceId: string) => api.servicesOrders(from, serviceId),
      publish: (from: string, payload: Record<string, unknown>) => api.servicesPublish(from, payload),
      revoke: (from: string, serviceId: string) => api.servicesRevoke(from, serviceId),
      call: (from: string, request: Record<string, unknown>, confirm?: boolean) =>
        api.servicesCall(from, request, confirm),
    }),
  }, ServicesPanel))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'oac-apps',
    order: 23,
    label: () => tApps('nav'),
    locale: APP_NS,
    inject: () => ({
      bots: () => api.list(),
      list: (from: string) => api.metaappList(from),
      publish: (from: string, payload: Record<string, unknown>) => api.metaappPublish(from, payload),
      remove: (from: string, targetPinId: string) => api.metaappDelete(from, targetPinId),
    }),
  }, AppsPanel))

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
