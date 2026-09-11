/**
 * Browser half of open-agent-connect-dsh: locale dictionaries, the Settings
 * sections, the new-session preset chip, the right-Sidebar `bot-browser` tab
 * type, and the A2A Chat main panel with its `sidebar.panellist` glyph. Does
 * not shadow Settings → Agent presets.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { api } from './api.ts'
import { A2AConversation, type A2AConversationInjected } from './A2AConversation.tsx'
import { A2APanelGlyph, type A2APanelGlyphInjected } from './A2APanelGlyph.tsx'
import { AppsPanel } from './AppsPanel.tsx'
import { BotBrowserTab, BotBrowserTabTitle, type BotBrowserTabInjected } from './BotBrowserTab.tsx'
import { BotPanel } from './BotPanel.tsx'
import { BotPresetSeat, type BotPresetSeatInjected } from './BotPresetSeat.tsx'
import { SessionIdHeader } from './SessionIdHeader.tsx'
import { A2AUnreadController } from './a2a-unread-store.ts'
import { A2ABrowserDockStore } from './a2a-browser-dock-store.ts'
import { BotBrowserStore } from './browser-store.ts'
import { openBrowser, startBrowserEventSource } from './browser-events.ts'
import { startAgentLinkInterceptor } from './browser-links.ts'
import { BotBrowserIframeBridge } from './browser-iframe.ts'
import {
  BOT_BROWSER_TAB_ID,
  BOT_BROWSER_TAB_KIND,
  openA2ABrowserDock,
  revealBotBrowserTab,
  type BotBrowserOpenFace,
} from '../browser-open-flow.ts'
import { appEn, APP_NS, appZh, type AppsLocaleKey } from './locale-apps.ts'
import { browserEn, BROWSER_NS, browserZh, type BrowserLocaleKey } from './locale-browser.ts'
import { convEn, CONV_NS, convZh, type ConversationsLocaleKey } from './locale-conversations.ts'
import { en, NS, zh, type BotsLocaleKey } from './locale.ts'
import { memoryEn, MEMORY_NS, memoryZh, type MemoryLocaleKey } from './locale-memory.ts'
import { userEn, USER_NS, userZh, type UserLocaleKey } from './locale-user.ts'
import { svcEn, SVC_NS, svcZh, type ServicesLocaleKey } from './locale-services.ts'
import { trafficEn, TRAFFIC_NS, trafficZh, type TrafficLocaleKey } from './locale-traffic.ts'
import { MemoryPanel } from './MemoryPanel.tsx'
import { TrafficPanel } from './TrafficPanel.tsx'
import { UserPanel } from './UserPanel.tsx'
import type { SeatSessionSummary } from './preset-seat-store.ts'
import { BotPresetSeatController } from './preset-seat-store.ts'
import { startHeroIdentityMount } from './hero-identity.ts'
import { ServicesPanel } from './ServicesPanel.tsx'
import { APPS_CSS, BOTS_CSS, BROWSER_CSS, GROUPTASK_CSS, HERO_CSS, MEMORY_CSS, PRESETS_CSS, TRAFFIC_CSS, USER_CSS } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.oac.bots': BotsLocaleKey
    'settings.oac.browser': BrowserLocaleKey
    'settings.oac.conversations': ConversationsLocaleKey
    'settings.oac.services': ServicesLocaleKey
    'settings.oac.apps': AppsLocaleKey
    'settings.oac.traffic': TrafficLocaleKey
    'settings.oac.memory': MemoryLocaleKey
    'settings.oac.user': UserLocaleKey
  }
}

export const inject = [
  'slots',
  'locale',
  'remote',
  'remote.agentPresets',
  'remote.session',
  'layout',
  'sidebarRight',
  'sidebarRightTabs',
]

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'open-agent-connect-dsh'
    tag.textContent = BOTS_CSS + PRESETS_CSS + HERO_CSS + APPS_CSS + TRAFFIC_CSS + BROWSER_CSS + MEMORY_CSS + USER_CSS + GROUPTASK_CSS
    document.head.append(tag)
    return () => { tag.remove() }
  }, 'oac-dsh: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'oac-dsh: bots dictionary')
  ctx.effect(() => ctx.locale.register(BROWSER_NS, { zh: browserZh, en: browserEn }), 'oac-dsh: browser dictionary')
  ctx.effect(() => ctx.locale.register(CONV_NS, { zh: convZh, en: convEn }), 'oac-dsh: conversations dictionary')
  ctx.effect(() => ctx.locale.register(SVC_NS, { zh: svcZh, en: svcEn }), 'oac-dsh: services dictionary')
  ctx.effect(() => ctx.locale.register(APP_NS, { zh: appZh, en: appEn }), 'oac-dsh: apps dictionary')
  ctx.effect(() => ctx.locale.register(TRAFFIC_NS, { zh: trafficZh, en: trafficEn }), 'oac-dsh: traffic dictionary')
  ctx.effect(() => ctx.locale.register(MEMORY_NS, { zh: memoryZh, en: memoryEn }), 'oac-dsh: memory dictionary')
  ctx.effect(() => ctx.locale.register(USER_NS, { zh: userZh, en: userEn }), 'oac-dsh: user dictionary')
  const t = ctx.locale.bind(NS)
  const tBrowser = ctx.locale.bind(BROWSER_NS)
  const tConv = ctx.locale.bind(CONV_NS)
  const tSvc = ctx.locale.bind(SVC_NS)
  const tApps = ctx.locale.bind(APP_NS)
  const tTraffic = ctx.locale.bind(TRAFFIC_NS)
  const tMemory = ctx.locale.bind(MEMORY_NS)
  const tUser = ctx.locale.bind(USER_NS)

  // Right-Sidebar Bot Browser: one store and one iframe bridge per activation.
  // The store is the reactive face the tab body/title read; the bridge tracks
  // the live iframe, reports snapshots to the host, and runs host tab commands.
  // Every entry point (Settings buttons, avatar links, daemon SSE) reveals the
  // tab through openFace → revealBotBrowserTab.
  const browserStore = new BotBrowserStore()
  const iframeBridge = new BotBrowserIframeBridge(browserStore, (snapshot) => api.browserState(snapshot))
  const openFace: BotBrowserOpenFace = {
    browserOpen: (uri) => api.browserOpen(uri),
    selectConversation: () => { ctx.layout.selectPanel(null) },
    openTab: (params) => { ctx.sidebarRight.openTab(BOT_BROWSER_TAB_KIND, { params }) },
    reportError: (message) => {
      console.error(`[oac-dsh] bot browser open: ${message}`)
      browserStore.fail(message)
      // Best-effort: surface the tab so its landing state shows the failure.
      // The inner reveal reports nowhere — a second failure must not recurse.
      void revealBotBrowserTab({ ...openFace, reportError: () => {} }, {})
    },
  }
  const openBrowserNow = (uri: string | null): Promise<void> => openBrowser(openFace, iframeBridge, uri)
  // A2A in-panel browser dock: opens originating in the A2A global main panel
  // (link, avatar, and group-task clicks) land here. The official right
  // Sidebar's Session seat unmounts while a global main panel is selected, so
  // revealing it would flip the main column back to the Conversation.
  const a2aDock = new A2ABrowserDockStore()
  const openA2ADockNow = (uri: string | null): Promise<void> => openA2ABrowserDock({
    browserOpen: (target) => api.browserOpen(target),
    show: (url, target) => a2aDock.show(url, target),
    reportError: (message) => {
      console.error(`[oac-dsh] a2a browser dock open: ${message}`)
      a2aDock.fail(message)
    },
  }, uri, iframeBridge.liveUrl())
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: BOT_BROWSER_TAB_ID,
    kind: BOT_BROWSER_TAB_KIND,
    title: () => tBrowser('title'),
    guide: [{
      order: 20,
      title: () => tBrowser('guideTitle'),
      description: () => tBrowser('guideDesc'),
      icon: IconBrowseOutline16,
    }],
  }), 'oac-dsh: bot browser tab type')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: BOT_BROWSER_TAB_ID,
    locale: BROWSER_NS,
    inject: (): BotBrowserTabInjected => ({
      hooks: { browser: browserStore },
      onIframe: (element, url) => iframeBridge.setIframe(element, url),
      openHome: () => { void openBrowserNow(null) },
    }),
  }, BotBrowserTab))
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: BOT_BROWSER_TAB_ID,
    inject: (): Pick<BotBrowserTabInjected, 'hooks'> => ({ hooks: { browser: browserStore } }),
  }, BotBrowserTabTitle))
  ctx.effect(() => {
    const stopBridge = iframeBridge.start()
    const stopEvents = startBrowserEventSource(iframeBridge, {
      liveUrl: () => iframeBridge.liveUrl(),
      reveal: (params) => revealBotBrowserTab(openFace, params),
    })
    const stopLinks = startAgentLinkInterceptor((uri, anchor) => {
      // Clicks inside the A2A panel dock in-panel: revealing the official
      // right Sidebar would switch the main column back to the Conversation.
      if (anchor.closest('.oac-a2a-panel') !== null) void openA2ADockNow(uri)
      else void openBrowserNow(uri)
    })
    return () => {
      stopEvents()
      stopLinks()
      stopBridge()
    }
  }, 'oac-dsh: bot browser wiring')

  // A2A Chat: a global main panel (key `oac-a2a`) plus its panellist glyph.
  // The unread feed lives at apply scope so the glyph's dot works no matter
  // which panel is selected; the panel feeds its live view back through
  // setView so the thread being read stays read.
  const unreadController = new A2AUnreadController({
    list: (from) => api.conversations(from),
    thread: (from, peer) => api.conversationThread(from, peer),
  })
  ctx.effect(() => unreadController.start(), 'oac-dsh: a2a unread feed')
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: 'oac-a2a',
    locale: CONV_NS,
    inject: (): A2AConversationInjected => ({
      bots: () => api.list(),
      list: (from: string) => api.conversations(from),
      thread: (from: string, peer: string) => api.conversationThread(from, peer),
      send: (from: string, to: string, content: string) => api.chatPrivate(from, to, content),
      guidance: (from: string, peer: string, guidance: string) =>
        api.conversationGuidance(from, peer, guidance),
      meta: (from, peer, patch) => api.conversationMeta(from, peer, patch),
      browserOpen: (uri?: string) => openA2ADockNow(uri ?? null),
      dock: {
        close: () => a2aDock.close(),
        onIframe: (element, url) => iframeBridge.setIframe(element, url),
        t: tBrowser,
      },
      grouptask: {
        list: (tab, includeArchived) => api.grouptaskList(tab, includeArchived),
        detail: (chair, taskId) => api.grouptaskDetail(chair, taskId),
        create: (input) => api.grouptaskCreate(input),
        post: (chair, taskId, input) => api.grouptaskPost(chair, taskId, input),
        close: (chair, taskId, input) => api.grouptaskClose(chair, taskId, input),
        reopen: (chair, taskId, reason) => api.grouptaskReopen(chair, taskId, reason),
        kick: (chair, taskId, member, reason) => api.grouptaskKick(chair, taskId, member, reason),
        rename: (chair, taskId, displayName) => api.grouptaskRename(chair, taskId, displayName),
        pin: (chair, taskId, pinned) => api.grouptaskPin(chair, taskId, pinned),
        archive: (chair, taskId, archived) => api.grouptaskArchive(chair, taskId, archived),
        invite: (chair, taskId, input) => api.grouptaskInvite(chair, taskId, input),
        collabs: () => api.grouptaskCollabs(),
        collabMessages: (slug, groupId) => api.grouptaskCollabMessages(slug, groupId),
        health: () => api.grouptaskHealth(),
        staffingList: () => api.grouptaskStaffingList(),
        staffingDecide: (chair, proposalId, decision) => api.grouptaskStaffingDecide(chair, proposalId, decision),
        staffingCreate: (proposalId) => api.grouptaskStaffingCreate(proposalId),
      },
      hooks: {
        unread: unreadController.source,
        dock: a2aDock,
        browser: browserStore,
      },
      clearPrivateUnread: (from, peer) => unreadController.clearPrivateUnread(from, peer),
      clearGroupUnread: (key) => unreadController.clearGroupUnread(key),
      setView: (view) => unreadController.setView(view),
    }),
  }, A2AConversation))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: 'oac-a2a',
    order: 0,
    label: () => tConv('nav'),
    inject: (): A2APanelGlyphInjected => ({ hooks: { unread: unreadController.source } }),
  }, A2APanelGlyph))

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
      browserOpen: (uri?: string) => openBrowserNow(uri ?? null),
      botWallet: (slug: string) => api.botWallet(slug),
      botBackup: (slug: string) => api.botBackup(slug),
      botSetupRetry: (slug: string) => api.botSetupRetry(slug),
      botHomepageUpload: (slug: string, fileName: string, contentType: string, base64: string) =>
        api.botHomepageUpload(slug, fileName, contentType, base64),
      metaappList: (from: string, size?: number, cursor?: string) => api.metaappList(from, size, cursor),
    }),
  }, BotPanel))
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
      memoryUnarchive: (from: string, id: string) => api.memoryUnarchive(from, id),
      memoryStats: (from: string) => api.memoryStats(from),
      memoryPolicyGet: (from: string) => api.memoryPolicyGet(from),
      memoryPolicySet: (from: string, patch: Record<string, unknown>) => api.memoryPolicySet(from, patch),
      memoryPolicyDelete: (from: string) => api.memoryPolicyDelete(from),
      hygieneStatus: (from: string) => api.hygieneStatus(from),
      hygieneRun: (from: string, noDeep?: boolean) => api.hygieneRun(from, noDeep),
      hygieneConfigSet: (from: string, config: Record<string, unknown>) => api.hygieneConfigSet(from, config),
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
      publish: (from: string, payload: Record<string, unknown>, opId?: string) =>
        api.metaappPublish(from, payload, opId),
      update: (from: string, targetPinId: string, payload: Record<string, unknown>, opId?: string) =>
        api.metaappUpdate(from, targetPinId, payload, opId),
      remove: (from: string, targetPinId: string) => api.metaappDelete(from, targetPinId),
      fork: (from: string, pinId: string, title?: string) => api.metaappFork(from, pinId, title),
      upload: (from: string, file: File) => api.metaappUpload(from, file),
    }),
  }, AppsPanel))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'oac-traffic',
    order: 24,
    label: () => tTraffic('nav'),
    locale: TRAFFIC_NS,
    inject: () => ({
      who: () => api.userWho(),
      bots: () => api.list(),
      status: () => api.trafficStatus(),
      setMode: (mode: 'traffic' | 'selfpay') => api.trafficMode(mode),
      balance: () => api.trafficBalance(),
      ledger: (cursor?: string, limit?: number) => api.trafficLedger(cursor, limit),
      usage: () => api.trafficUsage(),
      claim: () => api.trafficClaim(),
      redeem: (code: string) => api.trafficRedeem(code),
      apiBase: (action?: 'get' | 'set' | 'reset', value?: string) => api.trafficApiBase(action, value),
    }),
  }, TrafficPanel))

  ctx.inject(['slots', 'conversation', 'sessions'], (scope: ClientContext) => {
    const remote = ctx.remote
    // Captured once while the context is active: re-resolving `scope.sessions`
    // after the context retires throws "inactive context" inside subscriptions.
    const sessionsList = scope.sessions.list
    const seat = new BotPresetSeatController(
      {
        agentPresets: {
          list: () => remote.agentPresets.list(),
          select: (sessionId, agentPreset) => remote.agentPresets.select(
            sessionId as Parameters<typeof remote.agentPresets.select>[0],
            agentPreset,
          ),
        },
        sessions: {
          modelCatalog: () => remote.session.modelCatalog(),
          selectModel: (input) => remote.session.selectModel(
            input as Parameters<typeof remote.session.selectModel>[0],
          ),
        },
      },
      async () => (await api.list()).map((bot) => ({
        name: bot.name,
        slug: bot.slug,
        ...(bot.avatarDataUrl === undefined ? {} : { avatarDataUrl: bot.avatarDataUrl }),
        ...(bot.botType === undefined || bot.botType === null ? {} : { botType: bot.botType }),
        dshLlmProvider: bot.dshLlmProvider,
        dshLlmModel: bot.dshLlmModel,
        ...(bot.role === undefined || bot.role === null ? {} : { role: bot.role }),
        ...(bot.createdAt === undefined ? {} : { createdAt: bot.createdAt }),
        isAvailable: bot.isAvailable !== false,
      })),
      (): SeatSessionSummary | undefined => {
        const state = sessionsList.getSnapshot()
        const summary = state.current === undefined ? undefined : state.byId[state.current]
        if (summary === undefined) return undefined
        const agentPreset = summary.projectionValues?.agentPreset
        return {
          id: summary.id,
          blank: summary.blank,
          ...(typeof agentPreset === 'string' ? { agentPreset } : {}),
        }
      },
    )

    const seatInjected = (): BotPresetSeatInjected => ({
      hooks: { botPresetSeat: seat.store },
      load: () => seat.load(),
      select: (id: string) => seat.select(id),
    })

    scope.effect(() => {
      const stop = sessionsList.subscribe(() => { void seat.apply() })
      const headerId = scope.slots.register({
        name: 'conversation.session.header.actions',
        id: 'oac-session-id',
        order: -9,
        locale: CONV_NS,
        // Session-scoped slots hand the factory the rendered session's id.
        inject: (sessionId: string) => ({ sessionId }),
      }, SessionIdHeader)
      const chip = scope.slots.register({
        name: 'conversation.hero.agentPreset',
        priority: -1,
        locale: 'settings.agentPreset',
        inject: seatInjected,
      }, BotPresetSeat)
      return () => {
        stop()
        chip()
        headerId()
      }
    }, 'oac-dsh: preset chip')

    // The selected Bot's big avatar + name under the blank-session hero
    // headline. DSH offers no slot between the headline and the chip row, so
    // this mounts through the DOM (hero-identity.ts) and reads the same seat
    // store the chip drives.
    scope.effect(() => startHeroIdentityMount(seat.store), 'oac-dsh: hero bot identity')
  })
}
