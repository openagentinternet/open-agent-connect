/**
 * Browser half of open-agent-connect-dsh: locale dictionaries, the Bots page
 * (a left-rail `sidebar.panellist` row + `shell.overlay` entry — the A2A Chat
 * pattern, so the official right Sidebar stays mounted — hosting the
 * `oac.bots.section` pages — My Bots, MetaApps, and the merged Plugin
 * Settings (User + Traffic as top tabs) — the surfaces that used to be
 * Settings sections; DSH Settings itself stays stock), the new-session preset
 * chip, the right-Sidebar `bot-browser` tab type, and the A2A Chat
 * `shell.overlay` panel. The left-rail A2A glyph is currently hidden
 * (`SHOW_A2A_PANELLIST_ROW`). Does not shadow Settings → Agent presets.
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
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { IconBrowseOutline16 } from './icons.ts'
import { api } from './api.ts'
import { A2AOverlay, type A2AOverlayInjected } from './A2AOverlay.tsx'
import { A2APanelGlyph, type A2APanelGlyphInjected } from './A2APanelGlyph.tsx'
import { AppsPanel } from './AppsPanel.tsx'
import { BotBrowserTab, BotBrowserTabTitle, type BotBrowserTabInjected } from './BotBrowserTab.tsx'
import { BotPanel } from './BotPanel.tsx'
import { BotsPageGlyph, BotsPageOverlay, type BotsPageGlyphInjected, type BotsPageOverlayInjected, type BotsPageSectionRow } from './bots-page.tsx'
import { BotsPagePanelStore } from './bots-page-store.ts'
import { BotPresetSeat, type BotPresetSeatInjected } from './BotPresetSeat.tsx'
import { HeaderBotLabel, type HeaderBotLabelInjected } from './HeaderBotLabel.tsx'
import { SessionIdHeader } from './SessionIdHeader.tsx'
import { PluginSettingsPanel } from './PluginSettingsPanel.tsx'
import { TrackingTasksPanel } from './TrackingTasksPanel.tsx'
import { A2AUnreadController } from './a2a-unread-store.ts'
import { A2APanelStore, type A2APanelTarget } from './a2a-panel-store.ts'
import { ConvTabStore } from './conv-tab-store.ts'
import { startConvTabMount } from './conv-tab-mount.ts'
import { currentMainViewSessionId } from '../current-session.ts'
import { BOTS_PANEL_ROW_MARK, SHOW_A2A_PANELLIST_ROW, startA2APanelRowInterceptor, startPanelRowInterceptor } from './a2a-panel-row.ts'
import { BotBrowserStore } from './browser-store.ts'
import { openBrowser, startBrowserEventSource } from './browser-events.ts'
import { subscribeToBotChanges } from './bot-catalog.ts'
import { startAgentLinkInterceptor } from './browser-links.ts'
import { BotBrowserIframeBridge } from './browser-iframe.ts'
import {
  BOT_BROWSER_TAB_ID,
  BOT_BROWSER_TAB_KIND,
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
import type { SeatSessionSummary } from './preset-seat-store.ts'
import { BotPresetSeatController } from './preset-seat-store.ts'
import { startHeroIdentityMount } from './hero-identity.ts'
import { ServicesPanel } from './ServicesPanel.tsx'
import { APPS_CSS, BOTS_CSS, BOTSPAGE_CSS, BROWSER_CSS, CONVTABS_CSS, GROUPTASK_CSS, HERO_CSS, MEMORY_CSS, PRESETS_CSS, TRACKING_CSS, TRAFFIC_CSS, USER_CSS } from './styles.ts'

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
    tag.textContent = BOTS_CSS + PRESETS_CSS + HERO_CSS + APPS_CSS + TRAFFIC_CSS + BROWSER_CSS + MEMORY_CSS + USER_CSS + GROUPTASK_CSS + CONVTABS_CSS + TRACKING_CSS + BOTSPAGE_CSS
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
  // A2A Chat overlay: one apply-scope open state. The panellist row's click
  // is capture-intercepted into a toggle (a kernel global-panel selection
  // would unmount the right Sidebar); navigation back to the conversation
  // column — session switch or 新会话 — closes it again (the two watchers
  // below).
  const a2aPanel = new A2APanelStore()
  // The Bots page is an overlay like A2A Chat: the right Sidebar stays
  // mounted, so the Bot Browser opens natively beside the page.
  const botsPagePanel = new BotsPagePanelStore()
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: BOT_BROWSER_TAB_ID,
    kind: BOT_BROWSER_TAB_KIND,
    title: () => tBrowser('title'),
    guide: [{
      id: 'bot-browser',
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
    const stopPanelRow = SHOW_A2A_PANELLIST_ROW
      ? startA2APanelRowInterceptor(() => a2aPanel.toggle())
      : () => {}
    // The Bots row is always live: one center-column overlay at a time.
    const stopBotsPanelRow = startPanelRowInterceptor(BOTS_PANEL_ROW_MARK, () => {
      if (botsPagePanel.getSnapshot().open) {
        botsPagePanel.close()
        return
      }
      a2aPanel.close()
      // A stock DSH panel (including the optional Automation tasks bundle)
      // owns the center column while selected. Return to the conversation
      // column before opening this overlay; otherwise CenterOverlayFrame
      // correctly keeps rendering it hidden behind the active main panel.
      ctx.layout.selectPanel(null)
      botsPagePanel.set({ open: true })
    })
    // Every Agent Internet URI click (any surface) reveals the right-Sidebar
    // Bot Browser — the A2A overlay keeps that Sidebar mounted, so one path
    // serves transcripts, avatars, and group-task links alike.
    const stopLinks = startAgentLinkInterceptor((uri) => { void openBrowserNow(uri) })
    return () => {
      stopEvents()
      stopLinks()
      stopPanelRow()
      stopBotsPanelRow()
      stopBridge()
    }
  }, 'oac-dsh: bot browser wiring')

  // A2A Chat: a `shell.overlay` panel (id `oac-a2a`) covering the center
  // column only. The left-rail panellist glyph is gated off
  // (`SHOW_A2A_PANELLIST_ROW`); unread still lives at apply scope so the
  // 线上对话 / 群任务 tab dots work. The panel feeds its live view back
  // through setView so the thread being read stays read.
  const unreadController = new A2AUnreadController({
    list: (from) => api.conversations(from),
    thread: (from, peer) => api.conversationThread(from, peer),
  })
  ctx.effect(() => unreadController.start(), 'oac-dsh: a2a unread feed')
  // One grouptask api face shared by the A2A overlay (task detail) and the
  // conversation-list tabs (the 群任务 list surface).
  const grouptaskApi = {
    list: (tab: Parameters<typeof api.grouptaskList>[0], includeArchived: boolean) => api.grouptaskList(tab, includeArchived),
    detail: (chair: string, taskId: number) => api.grouptaskDetail(chair, taskId),
    invites: (chair: string, taskId: number) => api.grouptaskInvites(chair, taskId),
    create: (input: Parameters<typeof api.grouptaskCreate>[0]) => api.grouptaskCreate(input),
    post: (chair: string, taskId: number, input: Parameters<typeof api.grouptaskPost>[2]) => api.grouptaskPost(chair, taskId, input),
    close: (chair: string, taskId: number, input: Parameters<typeof api.grouptaskClose>[2]) => api.grouptaskClose(chair, taskId, input),
    reopen: (chair: string, taskId: number, reason?: string) => api.grouptaskReopen(chair, taskId, reason),
    kick: (chair: string, taskId: number, member: { slug?: string; globalMetaId?: string }, reason?: string) =>
      api.grouptaskKick(chair, taskId, member, reason),
    rename: (chair: string, taskId: number, displayName: string) => api.grouptaskRename(chair, taskId, displayName),
    pin: (chair: string, taskId: number, pinned: boolean) => api.grouptaskPin(chair, taskId, pinned),
    archive: (chair: string, taskId: number, archived: boolean) => api.grouptaskArchive(chair, taskId, archived),
    invite: (chair: string, taskId: number, input: Parameters<typeof api.grouptaskInvite>[2]) => api.grouptaskInvite(chair, taskId, input),
    collabs: () => api.grouptaskCollabs(),
    collabMessages: (slug: string, groupId: string) => api.grouptaskCollabMessages(slug, groupId),
    health: () => api.grouptaskHealth(),
    staffingList: () => api.grouptaskStaffingList(),
    staffingDecide: (chair: string, proposalId: number, decision: 'confirm' | 'revise' | 'skip' | 'reject') =>
      api.grouptaskStaffingDecide(chair, proposalId, decision),
    staffingCreate: (proposalId: number) => api.grouptaskStaffingCreate(proposalId),
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'oac-a2a',
    order: 0,
    locale: CONV_NS,
    inject: (): A2AOverlayInjected => ({
      bots: () => api.list(),
      list: (from: string) => api.conversations(from),
      thread: (from: string, peer: string) => api.conversationThread(from, peer),
      send: (from: string, to: string, content: string) => api.chatPrivate(from, to, content),
      guidance: (from: string, peer: string, guidance: string) =>
        api.conversationGuidance(from, peer, guidance),
      browserOpen: (uri?: string) => openBrowserNow(uri ?? null),
      grouptask: grouptaskApi,
      hooks: {
        unread: unreadController.source,
        panel: a2aPanel,
      },
      clearPrivateUnread: (from, peer) => unreadController.clearPrivateUnread(from, peer),
      clearGroupUnread: (key) => unreadController.clearGroupUnread(key),
      setView: (view) => unreadController.setView(view),
      consumeTarget: () => a2aPanel.consumeTarget(),
    }),
  }, A2AOverlay))
  if (SHOW_A2A_PANELLIST_ROW) {
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: 'oac-a2a',
      order: 0,
      label: () => tConv('nav'),
      inject: (): A2APanelGlyphInjected => ({ hooks: { unread: unreadController.source, panel: a2aPanel } }),
    }, A2APanelGlyph))
  }
  // Conversation-list tabs (本地对话 / 线上对话 / 群任务): the strip + list
  // bodies mount above the official browsing region (no slot exists there);
  // rows navigate by opening the A2A overlay pre-positioned on their thread
  // (the pending-target path above). Started after the unread feed so the
  // dots have data from the first paint.
  const convTabs = new ConvTabStore()
  // Row clicks must also work while a kernel main panel (插件 / Bots) is
  // active: the overlay renders nothing until activePanelId returns to null,
  // so exit to the conversation column first — the same destination a local
  // conversation's click reaches through kernel session navigation. The exit
  // runs ONLY when a panel is actually active: the selectPanel(null) wrap
  // closes both overlays and force-resets the tabs to 本地对话 on every
  // call, so an unconditional exit made every row click pay the close/reset
  // dance and re-arm it by hand — pure churn while the column is already
  // active, and the first thing to break when ordering drifts. openOn runs
  // last and unconditionally, so the target is never eaten by the exit.
  const openA2A = (target: A2APanelTarget): void => {
    if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) {
      const tab = convTabs.getSnapshot().tab
      ctx.layout.selectPanel(null)
      convTabs.setTab(tab)
    }
    botsPagePanel.close()
    a2aPanel.openOn(target)
  }
  ctx.effect(() => startConvTabMount(convTabs, {
    bots: () => api.list(),
    list: (from: string) => api.conversations(from),
    grouptaskList: () => api.grouptaskList('all', false),
    grouptask: grouptaskApi,
    meta: (from, peer, patch) => api.conversationMeta(from, peer, patch),
    openPrivate: (from, peer) => openA2A({ mode: 'private', from, peer }),
    openGroupTask: (taskKey) => openA2A({ mode: 'grouptask', taskKey }),
    openCollab: (slug, groupId) => openA2A({ mode: 'collab', slug, groupId }),
    hooks: { unread: unreadController.source },
    t: tConv,
  }), 'oac-dsh: conversation tabs mount')
  // Session navigation closes the A2A overlay (the conversation underneath
  // never unmounted, so the switch shows the moment it closes) and returns
  // the conversation-list tabs to 本地对话 — the new session should be
  // visible, not hidden behind the online/group lists.
  ctx.inject(['sessions'], (scope: ClientContext) => {
    // Captured once while the context is active (the preset chip below does
    // the same): re-resolving after the context retires throws.
    const sessionsList = scope.sessions.list
    let previous = currentMainViewSessionId(sessionsList.getSnapshot())
    scope.effect(() => sessionsList.subscribe(() => {
      const current = currentMainViewSessionId(sessionsList.getSnapshot())
      const navigated = current !== previous
      previous = current
      if (navigated) {
        a2aPanel.close()
        botsPagePanel.close()
        convTabs.setTab('local')
      }
    }), 'oac-dsh: a2a overlay session watch')
  })
  // ...but 新会话 (startSession) REUSES the workspace's existing blank
  // session: when that session is already the current one, sessions.list
  // never changes and the watch above cannot fire — the overlay stayed stuck
  // over the new-session page. Every kernel path back to the conversation
  // column (openSession from the tree, startSession with or without a
  // target) routes through layout.selectPanel(null), so wrap it: selecting
  // the conversation column closes the overlay and returns the tabs too.
  // Re-equips when the layout service reloads; cleanup restores the
  // prototype method.
  ctx.inject(['layout'], (scope: ClientContext) => {
    const layout = scope.layout
    const original = layout.selectPanel.bind(layout)
    layout.selectPanel = (panelId: Parameters<typeof original>[0]): void => {
      if (panelId !== null) {
        a2aPanel.close()
        botsPagePanel.close()
      }
      if (panelId === null) {
        a2aPanel.close()
        botsPagePanel.close()
        convTabs.setTab('local')
      }
      original(panelId)
    }
    return () => { delete (layout as { selectPanel?: unknown }).selectPanel }
  })

  // The Bots page: one left-rail row (order 1, directly below 插件's order 0)
  // whose click is capture-intercepted into toggling the `shell.overlay` entry
  // — NOT a kernel `main` panel, so the official right Sidebar stays mounted
  // and the Bot Browser opens natively beside the page (drag-resize,
  // fullscreen, native tabs). The overlay registration declares the
  // `oac.bots.section` child slot; the sections below register into it with
  // the same ids/orders/labels/inject faces they carried as Settings
  // sections, and the page chrome projects them into its left nav. Settings
  // itself registers nothing from us anymore.
  let sectionsVersion = -1
  let sectionsRevision = -1
  let sectionsSnapshot: BotsPageSectionRow[] = []
  // The nav's section-ledger projection, memoized on (slot version, locale
  // revision) so label thunks follow the active locale — the same snapshot
  // shape the Plugins settings section builds for its tabs.
  const botsPageSections: ObservableSnapshot<BotsPageSectionRow[]> = {
    getSnapshot: () => {
      const version = ctx.slots.getVersion('oac.bots.section')
      const revision = ctx.locale.getSnapshot().revision
      if (version !== sectionsVersion || revision !== sectionsRevision) {
        sectionsVersion = version
        sectionsRevision = revision
        sectionsSnapshot = ctx.slots.entries('oac.bots.section')
          .map((entry) => ({
            id: entry.options.id ?? '',
            order: entry.options.order ?? 0,
            label: resolveSlotLabel(entry.options.label) ?? '',
          }))
          .sort((a, b) => a.order - b.order)
      }
      return sectionsSnapshot
    },
    subscribe: (listener: () => void) => {
      const offSlots = ctx.slots.subscribe('oac.bots.section', listener)
      const offLocale = ctx.locale.subscribe(listener)
      return () => {
        offSlots()
        offLocale()
      }
    },
  }
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: 'oac-bots',
    order: 1,
    label: () => t('nav'),
    inject: (): BotsPageGlyphInjected => ({ hooks: { panel: botsPagePanel } }),
  }, BotsPageGlyph))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'oac-bots',
    order: 1,
    locale: NS,
    inject: (): BotsPageOverlayInjected => ({
      hooks: { sections: botsPageSections, panel: botsPagePanel },
      // The sections' settings-era `close` contract ("leave this surface")
      // closes the overlay; opening a Bot page goes to the right-Sidebar Bot
      // Browser, which stays mounted because the page is not a main panel.
      close: () => { botsPagePanel.close() },
      openBotPage: (uri: string | null) => { void openBrowserNow(uri) },
    }),
    children: { 'oac.bots.section': { kind: 'list', scope: 'root' } },
  }, BotsPageOverlay))
  ctx.slots.inject('oac.bots.section', () => ctx.slots.register({
    name: 'oac.bots.section',
    id: 'oac-bots',
    order: 20,
    label: () => t('navSection'),
    locale: NS,
    inject: () => ({
      memoryT: tMemory,
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
      botWallet: (slug: string) => api.botWallet(slug),
      botBackup: (slug: string) => api.botBackup(slug),
      botSetupRetry: (slug: string) => api.botSetupRetry(slug),
      botHomepageUpload: (slug: string, fileName: string, contentType: string, base64: string) =>
        api.botHomepageUpload(slug, fileName, contentType, base64),
      metaappList: (from: string, size?: number, cursor?: string) => api.metaappList(from, size, cursor),
      runtimeCheck: () => api.runtimeCheck(),
      runtimeInstall: () => api.runtimeInstall(),
      bots: () => api.list(),
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
  }, BotPanel))
  ctx.slots.inject('oac.bots.section', () => ctx.slots.register({
    name: 'oac.bots.section',
    id: 'oac-apps',
    order: 24,
    label: () => tApps('nav'),
    locale: APP_NS,
    inject: () => ({
      bots: () => api.list(),
      list: (from: string, size?: number, cursor?: string) => api.metaappList(from, size, cursor),
      search: (size?: number, cursor?: string) => api.metaappSearch(size, cursor),
      publish: (from: string, payload: Record<string, unknown>, opId?: string) =>
        api.metaappPublish(from, payload, opId),
      update: (from: string, targetPinId: string, payload: Record<string, unknown>, opId?: string) =>
        api.metaappUpdate(from, targetPinId, payload, opId),
      remove: (from: string, targetPinId: string) => api.metaappDelete(from, targetPinId),
      fork: (from: string, pinId: string, title?: string) => api.metaappFork(from, pinId, title),
      upload: (from: string, file: File) => api.metaappUpload(from, file),
    }),
  }, AppsPanel))
  // The former User and Traffic sections merged into one 插件设置 (Plugin
  // Settings) section: both panels survive verbatim as top tabs inside
  // PluginSettingsPanel, so this registration carries the union of their
  // injected faces plus their per-tab translators. Order 25 keeps the merged
  // section at the nav's end, where settings-type entries belong.
  // Tracking Tasks (追踪任务) section: the wide MetaTask board + detail panel
  // (a Long-term tab is reserved inside). Order 21 = after 我的Bot (20),
  // before 元应用. The panel fetches its data through the plugin's own
  // metatask/* host routes (the daemon route behind the same dispatch).
  ctx.slots.inject('oac.bots.section', () => ctx.slots.register({
    name: 'oac.bots.section',
    id: 'oac-tracking',
    order: 21,
    label: () => t('navTracking'),
    locale: NS,
    inject: () => ({
      mt: (key: string, vars?: Record<string, string | number>) => t(key as BotsLocaleKey, vars),
      metataskBoard: (refresh?: boolean) => api.metataskBoard(refresh),
      metataskTask: (root: string, refresh?: boolean) => api.metataskTask(root, refresh),
      metataskDraft: (root: string, lang?: 'en' | 'zh') => api.metataskDraft(root, lang),
      mtApi: {
        metataskTask: (root: string, refresh?: boolean) => api.metataskTask(root, refresh),
      },
    }),
  }, TrackingTasksPanel))

  ctx.slots.inject('oac.bots.section', () => ctx.slots.register({
    name: 'oac.bots.section',
    id: 'oac-settings',
    order: 25,
    label: () => t('navSettings'),
    locale: NS,
    inject: () => ({
      userT: tUser,
      trafficT: tTraffic,
      who: () => api.userWho(),
      onboarding: () => api.userOnboarding(),
      create: (name: string) => api.userCreate(name),
      importIdentity: (input: { name: string; mnemonic: string; path?: string }) => api.userImport(input),
      update: (input: { name?: string; avatarDataUrl?: string }) => api.userUpdate(input),
      reveal: () => api.userReveal(),
      deleteIdentity: () => api.userDelete(),
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
  }, PluginSettingsPanel))

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
        const currentId = currentMainViewSessionId(state)
        const summary = currentId === undefined ? undefined : state.byId[currentId as keyof typeof state.byId]
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

    const labelInjected = (): HeaderBotLabelInjected => ({
      hooks: { botPresetSeat: seat.store },
      load: () => seat.load(),
    })

    scope.effect(() => {
      const stop = sessionsList.subscribe(() => { void seat.apply() })
      // A Bot created after the chip mounted (the Bots page overlays the
      // hero; 新会话 reuses the blank session) must appear in the picker
      // without a reload: reload roster + Bots on every bots-changed push.
      const stopBotsFeed = subscribeToBotChanges(() => { void seat.load() })
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
      // Shadow of the stock agent-preset header cell: same list id, lower
      // priority — the Bot's avatar + name for oac-* sessions, the stock
      // label face re-rendered for every other preset.
      const label = scope.slots.register({
        name: 'conversation.session.header.actions',
        id: 'agent-preset',
        order: -10,
        priority: -1,
        locale: 'settings.agentPreset',
        inject: labelInjected,
      }, HeaderBotLabel)
      return () => {
        stop()
        stopBotsFeed()
        chip()
        headerId()
        label()
      }
    }, 'oac-dsh: preset chip')

    // The selected Bot's big avatar + name under the blank-session hero
    // headline. DSH offers no slot between the headline and the chip row, so
    // this mounts through the DOM (hero-identity.ts) and reads the same seat
    // store the chip drives.
    scope.effect(() => startHeroIdentityMount(seat.store), 'oac-dsh: hero bot identity')
  })
}
