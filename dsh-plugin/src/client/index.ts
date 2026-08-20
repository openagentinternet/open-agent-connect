/**
 * Browser half of open-agent-connect-dsh: locale dictionaries, the Settings
 * sections, and the new-session preset chip. Does not shadow Settings →
 * Agent presets.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { api } from './api.ts'
import { A2AConversation, type A2AConversationInjected } from './A2AConversation.tsx'
import { AppsPanel } from './AppsPanel.tsx'
import { BotBrowserBoundary, BotBrowserSidebar, type BrowserLocaleFace } from './BotBrowserSidebar.tsx'
import { BotPanel } from './BotPanel.tsx'
import { BotPresetSeat, type BotPresetSeatInjected } from './BotPresetSeat.tsx'
import { BotBrowserStore } from './browser-store.ts'
import { openBrowser, startBrowserEventSource } from './browser-events.ts'
import { appEn, APP_NS, appZh, type AppsLocaleKey } from './locale-apps.ts'
import { browserEn, BROWSER_NS, browserZh, type BrowserLocaleKey } from './locale-browser.ts'
import { convEn, CONV_NS, convZh, type ConversationsLocaleKey } from './locale-conversations.ts'
import { en, NS, zh, type BotsLocaleKey } from './locale.ts'
import { memoryEn, MEMORY_NS, memoryZh, type MemoryLocaleKey } from './locale-memory.ts'
import { userEn, USER_NS, userZh, type UserLocaleKey } from './locale-user.ts'
import { svcEn, SVC_NS, svcZh, type ServicesLocaleKey } from './locale-services.ts'
import { MemoryPanel } from './MemoryPanel.tsx'
import { UserPanel } from './UserPanel.tsx'
import type { SeatApi, SeatSessionSummary } from './preset-seat-store.ts'
import { BotPresetSeatController } from './preset-seat-store.ts'
import { ServicesPanel } from './ServicesPanel.tsx'
import { APPS_CSS, BOTS_CSS, BROWSER_CSS, MEMORY_CSS, PRESETS_CSS, USER_CSS } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.oac.bots': BotsLocaleKey
    'settings.oac.browser': BrowserLocaleKey
    'settings.oac.conversations': ConversationsLocaleKey
    'settings.oac.services': ServicesLocaleKey
    'settings.oac.apps': AppsLocaleKey
    'settings.oac.memory': MemoryLocaleKey
    'settings.oac.user': UserLocaleKey
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
    tag.textContent = BOTS_CSS + PRESETS_CSS + APPS_CSS + BROWSER_CSS + MEMORY_CSS + USER_CSS
    document.head.append(tag)
    return () => { tag.remove() }
  }, 'oac-dsh: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'oac-dsh: bots dictionary')
  ctx.effect(() => ctx.locale.register(BROWSER_NS, { zh: browserZh, en: browserEn }), 'oac-dsh: browser dictionary')
  ctx.effect(() => ctx.locale.register(CONV_NS, { zh: convZh, en: convEn }), 'oac-dsh: conversations dictionary')
  ctx.effect(() => ctx.locale.register(SVC_NS, { zh: svcZh, en: svcEn }), 'oac-dsh: services dictionary')
  ctx.effect(() => ctx.locale.register(APP_NS, { zh: appZh, en: appEn }), 'oac-dsh: apps dictionary')
  ctx.effect(() => ctx.locale.register(MEMORY_NS, { zh: memoryZh, en: memoryEn }), 'oac-dsh: memory dictionary')
  ctx.effect(() => ctx.locale.register(USER_NS, { zh: userZh, en: userEn }), 'oac-dsh: user dictionary')
  const t = ctx.locale.bind(NS)
  const tConv = ctx.locale.bind(CONV_NS)
  const tSvc = ctx.locale.bind(SVC_NS)
  const tApps = ctx.locale.bind(APP_NS)
  const tMemory = ctx.locale.bind(MEMORY_NS)
  const tUser = ctx.locale.bind(USER_NS)

  // Right-sidebar Bot Browser: one store per activation, shared by the mounted
  // panel, the Settings > Bots entry buttons, and the daemon-event listener.
  const browserStore = new BotBrowserStore()
  ctx.effect(() => {
    const host = document.createElement('div')
    host.dataset.plugin = 'open-agent-connect-dsh'
    host.dataset.oacBrowser = ''
    document.body.appendChild(host)
    const fail = (phase: string, error: unknown): void => {
      const message = `[oac-dsh] bot browser ${phase}: ${error instanceof Error ? error.message : String(error)}`
      console.error(message, error)
      try {
        const bar = document.createElement('div')
        bar.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483000;max-width:70vw;'
          + 'padding:8px 12px;font:12px/1.5 ui-monospace,Menlo,monospace;color:#f2a1a1;'
          + 'background:#1b1b22;border:1px solid #f2a1a1;border-radius:8px;white-space:pre-wrap'
        bar.textContent = message
        document.body.appendChild(bar)
      } catch {
        // nothing left to report with
      }
    }
    try {
      const root = createRoot(host)
      root.render(createElement(BotBrowserBoundary, null,
        createElement(BotBrowserSidebar, {
          store: browserStore,
          locale: ctx.locale as unknown as BrowserLocaleFace,
          openHome: () => openBrowser(browserStore, null),
        }),
      ))
      const stopEvents = startBrowserEventSource(browserStore)
      return () => {
        stopEvents()
        root.unmount()
        host.remove()
      }
    } catch (error) {
      fail('mount', error)
      return () => { host.remove() }
    }
  }, 'oac-dsh: bot browser sidebar')
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
      browserOpen: (uri?: string) => openBrowser(browserStore, uri ?? null),
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
  // Services settings section hidden until the service plugin matures; the
  // ServicesPanel, its locale dictionary, and the host routes stay in tree.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'oac-memory',
    order: 21,
    label: () => tMemory('nav'),
    locale: MEMORY_NS,
    inject: () => ({
      bots: () => api.list(),
      twinCurrent: () => api.twinCurrent(),
      memoryList: (from: string, options?: Record<string, unknown>) => api.memoryList(from, options),
      memoryAdd: (from: string, entry: Record<string, unknown>) => api.memoryAdd(from, entry),
      memoryUpdate: (from: string, entry: Record<string, unknown>) => api.memoryUpdate(from, entry),
      memoryDelete: (from: string, id: string) => api.memoryDelete(from, id),
      memoryStats: (from: string) => api.memoryStats(from),
      memoryPolicyGet: (from: string) => api.memoryPolicyGet(from),
      memoryPolicySet: (from: string, patch: Record<string, unknown>) => api.memoryPolicySet(from, patch),
      memoryPolicyDelete: (from: string) => api.memoryPolicyDelete(from),
      knowledgeList: (from: string, options?: Record<string, unknown>) => api.knowledgeList(from, options),
      knowledgeUpdate: (from: string, entry: Record<string, unknown>) => api.knowledgeUpdate(from, entry),
      knowledgeArchive: (from: string, id: string) => api.knowledgeArchive(from, id),
      knowledgeDelete: (from: string, id: string) => api.knowledgeDelete(from, id),
      impressionsList: (from: string) => api.impressionsList(from),
      impressionsShow: (from: string, subject: string) => api.impressionsShow(from, subject),
      dreamSummaries: (from: string, limit?: number) => api.dreamSummaries(from, limit),
      dreamStatus: (from: string) => api.dreamStatus(from),
      dreamSelfIdentity: (from: string) => api.dreamSelfIdentity(from),
      dreamRun: (from: string, date: string) => api.dreamRun(from, date),
    }),
  }, MemoryPanel))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'oac-user',
    order: 22,
    label: () => tUser('nav'),
    locale: USER_NS,
    inject: () => ({
      who: () => api.userWho(),
      create: (name: string) => api.userCreate(name),
      importIdentity: (input: { name: string; mnemonic: string; path?: string }) => api.userImport(input),
      rename: (name: string) => api.userRename(name),
      reveal: () => api.userReveal(),
      deleteIdentity: () => api.userDelete(),
    }),
  }, UserPanel))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'oac-apps',
    order: 23,
    label: () => tApps('nav'),
    locale: APP_NS,
    inject: () => ({
      bots: () => api.list(),
      list: (from: string, size?: number, cursor?: string) => api.metaappList(from, size, cursor),
      publish: (from: string, payload: Record<string, unknown>) => api.metaappPublish(from, payload),
      update: (from: string, targetPinId: string, payload: Record<string, unknown>) =>
        api.metaappUpdate(from, targetPinId, payload),
      remove: (from: string, targetPinId: string) => api.metaappDelete(from, targetPinId),
      upload: (from: string, file: File) => api.metaappUpload(from, file),
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
