import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function objectKeys(block) {
  return [...block.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1])
}

async function assertLocalePair(file, enName, zhName, typeName) {
  const text = await readFile(join(root, 'src/client', file), 'utf8')
  const en = text.slice(text.indexOf(`export const ${enName} = {`), text.indexOf(`export const ${zhName} = {`))
  const zh = text.slice(text.indexOf(`export const ${zhName} = {`), text.indexOf(`export type ${typeName}`))
  assert.deepEqual(objectKeys(en).sort(), objectKeys(zh).sort())
  return text
}

test('en and zh dictionaries stay in sync for Conversations, Services, and Apps', async () => {
  const conversations = await assertLocalePair(
    'locale-conversations.ts',
    'convEn',
    'convZh',
    'ConversationsLocaleKey',
  )
  assert.match(conversations, /nav: 'A2A Chat'/)
  assert.match(conversations, /nav: 'A2A 对话'/)
  const services = await assertLocalePair('locale-services.ts', 'svcEn', 'svcZh', 'ServicesLocaleKey')
  assert.match(services, /nav: 'Services'/)
  assert.match(services, /nav: '服务'/)
  assert.match(services, /confirmPaid/)
  assert.match(services, /revokeConfirm/)
  const apps = await assertLocalePair('locale-apps.ts', 'appEn', 'appZh', 'AppsLocaleKey')
  assert.match(apps, /nav: 'MetaApps'/)
  assert.match(apps, /nav: '元应用'/)
  assert.match(apps, /tabChain: 'On-chain MetaApps'/)
  assert.match(apps, /tabChain: '链上元应用'/)
  assert.match(apps, /tabLocal: 'Local MetaApps'/)
  assert.match(apps, /tabLocal: '本机元应用'/)
  assert.match(apps, /metaapp delete --confirm/)
})

test('en and zh dictionaries stay in sync for Memory and User', async () => {
  const memory = await assertLocalePair('locale-memory.ts', 'memoryEn', 'memoryZh', 'MemoryLocaleKey')
  assert.match(memory, /nav: 'Memory'/)
  assert.match(memory, /nav: '记忆'/)
  const user = await assertLocalePair('locale-user.ts', 'userEn', 'userZh', 'UserLocaleKey')
  assert.match(user, /nav: 'User'/)
  assert.match(user, /nav: '用户'/)
})

test('client registers the Bots overlay with its panellist row and the remaining page sections, leaving Settings stock', async () => {
  const text = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  // The six sections moved out of Settings onto the Bots page: not one
  // settings.section registration remains, so DSH Settings renders stock.
  assert.doesNotMatch(text, /name: 'settings\.section'/)
  assert.match(text, /name: 'oac\.bots\.section'/)
  assert.match(text, /children: \{ 'oac\.bots\.section': \{ kind: 'list', scope: 'root' \} \}/)
  // The page is a shell.overlay (the A2A pattern — the official right Sidebar
  // stays mounted), never a kernel main panel; the left-rail row's click is
  // capture-intercepted into the overlay store.
  assert.doesNotMatch(text, /name: 'main'/)
  assert.match(text, /name: 'sidebar\.panellist'/)
  assert.match(text, /startPanelRowInterceptor\(BOTS_PANEL_ROW_MARK/)
  assert.match(text, /ctx\.layout\.selectPanel\(null\)/)
  assert.match(text, /botsPagePanel\.set\(\{ open: true \}\)/)
  assert.match(text, /\}, BotsPageGlyph\)/)
  assert.match(text, /\}, BotsPageOverlay\)/)
  // The nav's section-ledger projection feeds the page through the inject hooks face.
  assert.match(text, /ctx\.slots\.entries\('oac\.bots\.section'\)/)
  assert.match(text, /resolveSlotLabel\(entry\.options\.label\)/)
  assert.match(text, /hooks: \{ sections: botsPageSections, panel: botsPagePanel \}/)
  // Section ids and orders: My Bots, User, Apps, Traffic. Scheduled tasks and
  // Memory now live inside the selected Bot editor.
  assert.match(text, /id: 'oac-bots'/)
  assert.doesNotMatch(text, /id: 'oac-services'/)
  assert.doesNotMatch(text, /id: 'oac-schedule'/)
  assert.doesNotMatch(text, /SchedulePanel/)
  assert.match(text, /id: 'oac-apps'/)
  assert.doesNotMatch(text, /id: 'oac-conversations'/)
  assert.doesNotMatch(text, /id: 'oac-memory'/)
  assert.match(text, /id: 'oac-user'/)
  assert.match(text, /id: 'oac-traffic'/)
  assert.match(text, /name: 'shell\.overlay'/)
  assert.match(text, /if \(SHOW_A2A_PANELLIST_ROW\)/)
  assert.match(text, /id: 'oac-a2a'/)
  assert.doesNotMatch(text, /key: 'oac-a2a'/)
  assert.doesNotMatch(text, /sidebar\.footer\.action/)
  assert.match(text, /order: 20/)
  assert.match(text, /order: 23/)
  assert.match(text, /order: 24/)
  assert.match(text, /order: 25/)
  assert.doesNotMatch(text, /id: 'oac'/)
})

test('the Bots page projects the section ledger into a keep-alive vertical nav', async () => {
  const text = await readFile(join(root, 'src/client/bots-page.tsx'), 'utf8')
  assert.match(text, /'oac\.bots\.section': \{/)
  assert.match(text, /kind: 'list'/)
  assert.match(text, /owner: OacBotsSectionOwnerProps/)
  assert.match(text, /renderSlot\('oac\.bots\.section', \{ close, openBotPage \}, \{ only: row\.id \}\)/)
  assert.match(text, /visitedIds/)
  assert.match(text, /hidden=\{!selected\}/)
  assert.match(text, /role="tablist"/)
  assert.match(text, /aria-orientation="vertical"/)
  assert.match(text, /aria-current=\{selected \? 'true' : undefined\}/)
  assert.match(text, /oac-dsh:bots-page-section:v1/)
  assert.match(text, /window\.localStorage/)
  // Each nav row carries a per-section icon (Settings left-nav parity).
  assert.match(text, /'oac-bots': IconAgentPresetOutline16/)
  assert.doesNotMatch(text, /'oac-schedule': IconAlarmClockOutline16/)
  assert.doesNotMatch(text, /'oac-memory': IconThinkOutline16/)
  assert.match(text, /'oac-user': IconUserOutline16/)
  assert.match(text, /'oac-apps': IconGlobeOutline16/)
  assert.match(text, /'oac-traffic': IconGaugeOutline16/)
  assert.match(text, /oac-bots-page-nav-icon/)
  assert.match(text, /oac-bots-page-nav-label/)
  const styles = await readFile(join(root, 'src/client/styles.ts'), 'utf8')
  // The nav cells replicate the Settings modal's left-nav tokens, and the
  // section content column centers its 720px measure.
  assert.match(styles, /\.oac-bots-page-nav-item\[data-active='true'\] \{ background: var\(--dsw-specific-sidebar-nav-item-active/)
  assert.match(styles, /\.oac-bots-page-nav-item:hover \{ background: var\(--dsw-specific-sidebar-nav-item-hover/)
  assert.match(styles, /\.oac-bots-page-content > \[role='tabpanel'\] \{ max-width: 720px; margin-inline: auto; \}/)
  const index = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(index, /CONVTABS_CSS \+ BOTSPAGE_CSS/)
  // The first nav item reads 我的 Bot / My Bots; the rail row keeps "Bots".
  assert.match(index, /label: \(\) => t\('navSection'\)/)
})

test('the Bot card opens the editor as a whole; the avatar opens the right-Sidebar Bot Page', async () => {
  const panel = await readFile(join(root, 'src/client/BotPanel.tsx'), 'utf8')
  // The whole card opens the editor…
  assert.match(panel, /role="button"/)
  assert.match(panel, /tabIndex=\{0\}/)
  assert.match(panel, /onClick=\{\(\) => \{ setEditing\(bot\); setError\(null\) \}\}/)
  // …while the inner controls keep their own actions and never reach the card.
  assert.match(panel, /event\.stopPropagation\(\); void toggleAvailability\(bot\)/)
  assert.match(panel, /event\.stopPropagation\(\); void onCardResync\(bot\)/)
  // The avatar opens the Bot Page through the owner-prop face (the page is an
  // overlay, so the official right Sidebar stays mounted); the card-foot
  // Bot-Page and edit icon buttons are gone.
  assert.match(panel, /event\.stopPropagation\(\)\s*\n\s*openBotPage\(`metaid:\/\/\$\{bot\.globalMetaId\}`\)/)
  assert.doesNotMatch(panel, /IconRightUpOutline16|IconEditOutline16|oac-bot-foot-right/)
  // The panel no longer drives the reveal directly — the t('browserOpen')
  // locale KEY stays.
  assert.doesNotMatch(panel, /browserOpen[=:(]|browserOpen,/)
  const editor = await readFile(join(root, 'src/client/BotEditor.tsx'), 'utf8')
  assert.match(editor, /openBotPage=\{openBotPage\}/)
  assert.doesNotMatch(editor, /browserOpen/)
  const advanced = await readFile(join(root, 'src/client/BotAdvancedSection.tsx'), 'utf8')
  assert.match(advanced, /openBotPage\(`metaid:\/\/\$\{bot\.globalMetaId\}`\)/)
  assert.doesNotMatch(advanced, /browserOpen/)
})

test('scheduled tasks are no longer a Bots-page section and Surf/Memory are Bot editor tabs', async () => {
  const panel = await readFile(join(root, 'src/client/SchedulePanel.tsx'), 'utf8')
  assert.match(panel, /scheduleListAll\(\)/)
  const editor = await readFile(join(root, 'src/client/BotEditor.tsx'), 'utf8')
  assert.doesNotMatch(editor, /ScheduledTab|tabScheduled|'scheduled'/)
  assert.match(editor, /id: 'surf', label: 'tabSurf'/)
  assert.match(editor, /id: 'memory', label: 'tabMemory'/)
  assert.match(editor, /<SurfSection bot=\{bot\} t=\{t\} \/>/)
  assert.match(editor, /<MemoryPanel \{\.\.\.memory\} botSlug=\{bot\.slug\}/)
  const styles = await readFile(join(root, 'src/client/styles.ts'), 'utf8')
  assert.match(styles, /\.oac-sch-table \{/)
})

test('the Bots page is a center-column overlay on the shared frame, so the right-Sidebar Bot Browser stays mounted', async () => {
  const page = await readFile(join(root, 'src/client/bots-page.tsx'), 'utf8')
  assert.match(page, /<CenterOverlayFrame open=\{open\} usePanelInfo=\{usePanelInfo\}>/)
  assert.match(page, /usePanel\(\(state\) => state\.open\)/)
  assert.match(page, /BotsPagePanelState/)
  // The glyph syncs the kernel's selected look onto the row (overlays never
  // get the kernel's panelActive class).
  assert.match(page, /classList\.toggle\('oac-bots-row-active', open\)/)
  assert.match(page, /BOTS_PANEL_ROW_MARK/)
  // Opening a Bot page goes to the right-Sidebar Bot Browser; `close` closes
  // the overlay. No in-page dock, no main panel.
  assert.doesNotMatch(page, /oac-bots-page-dock|BrowserStage|resolveBotPage/)
  const index = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(index, /openBotPage: \(uri: string \| null\) => \{ void openBrowserNow\(uri\) \}/)
  assert.match(index, /close: \(\) => \{ botsPagePanel\.close\(\) \}/)
  assert.doesNotMatch(index, /browserResolve|resolveBotPage/)
  const host = await readFile(join(root, 'src/index.ts'), 'utf8')
  assert.doesNotMatch(host, /browser\/resolve/)
  const styles = await readFile(join(root, 'src/client/styles.ts'), 'utf8')
  assert.match(styles, /button\.oac-bots-row-active/)
  assert.match(styles, /\.oac-bot-card \{[^}]*cursor: pointer/)
  assert.match(styles, /\.oac-bot-card:focus-visible/)
  const frame = await readFile(join(root, 'src/client/overlay-frame.tsx'), 'utf8')
  assert.match(frame, /closest\('\[data-shell-overlay\]'\)/)
  assert.match(frame, /MutationObserver/)
  assert.match(frame, /gridTemplateColumns/)
})

test('the Bots row exits stock main panels before opening the overlay', async () => {
  const index = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(index, /if \(botsPagePanel\.getSnapshot\(\)\.open\) \{[\s\S]*?botsPagePanel\.close\(\)[\s\S]*?return\n\s*\}/)
  assert.match(index, /ctx\.layout\.selectPanel\(null\)\n\s*botsPagePanel\.set\(\{ open: true \}\)/)
  // Selecting any stock main panel must close overlays too, including the
  // optional DSH Automation tasks bundle.
  assert.match(index, /if \(panelId !== null\) \{[\s\S]*?a2aPanel\.close\(\)[\s\S]*?botsPagePanel\.close\(\)[\s\S]*?\}/)
})

test('services and apps panels keep confirmation gates', async () => {
  const services = await readFile(join(root, 'src/client/ServicesPanel.tsx'), 'utf8')
  assert.match(services, /awaiting_confirmation/)
  assert.match(services, /confirmPaid/)
  assert.match(services, /revokeConfirm/)
  const apps = await readFile(join(root, 'src/client/AppsPanel.tsx'), 'utf8')
  assert.match(apps, /deleteConfirm/)
  assert.match(apps, /deleteDescription/)
  assert.match(apps, /publishOnChain/)
  assert.match(apps, /saveChanges/)
  assert.match(apps, /confirmDelete/)
})

test('the MetaApps section hosts the on-chain feed tab with author rows into the Bot Browser', async () => {
  const panel = await readFile(join(root, 'src/client/AppsPanel.tsx'), 'utf8')
  // Two tabs, chain first by default (IDBots 链上 MetaApps parity).
  assert.match(panel, /useState<'chain' \| 'local'>\('chain'\)/)
  assert.match(panel, /oac-tablist/)
  // Chain cards drop edit/details and open the app in the right-Sidebar Bot Browser.
  assert.match(panel, /openBotPage\(`metaapp:\/\/\$\{viewPin\}`\)/)
  // The author row opens the author's Bot page the same way.
  assert.match(panel, /openBotPage\(`metaid:\/\/\$\{chainRow\.publisherGlobalMetaId\}`\)/)
  assert.match(panel, /oac-apps-author/)
  assert.match(panel, /BotAvatar/)
  const index = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(index, /search: \(size\?: number, cursor\?: string\) => api\.metaappSearch\(size, cursor\)/)
  const api = await readFile(join(root, 'src/client/api.ts'), 'utf8')
  assert.match(api, /post<\{ items\?: unknown; hasMore\?: unknown; nextCursor\?: unknown \}>\(\s*'metaapp\/search'/)
  const sections = await readFile(join(root, 'src/sections.ts'), 'utf8')
  assert.match(sections, /method === 'metaapp\/search'/)
  assert.match(sections, /\['metaapp', 'search', '--limit', String\(size\)\]/)
  const styles = await readFile(join(root, 'src/client/styles.ts'), 'utf8')
  assert.match(styles, /\.oac-apps-author \{/)
  assert.match(styles, /\.oac-apps-card-foot-chain \.oac-apps-author \{ margin-right: auto/)
})

test('Bot pickers share the available-only twin-first BotPicker; app cards pin a fixed foot', async () => {
  const picker = await readFile(join(root, 'src/client/BotPicker.tsx'), 'utf8')
  assert.match(picker, /sortAvailableBotsTwinFirst/)
  assert.match(picker, /BotAvatar name=\{selected\.name\}/)
  assert.match(picker, /BotAvatar name=\{bot\.name\}/)
  assert.match(picker, /role=\"listbox\"/)
  assert.match(picker, /role=\"option\"/)
  for (const file of ['AppsPanel.tsx', 'MemoryPanel.tsx', 'ConvTabs.tsx']) {
    const text = await readFile(join(root, 'src/client', file), 'utf8')
    assert.match(text, /<BotPicker/, `${file} renders the shared BotPicker`)
  }
  // Default selection everywhere is the available Twin.
  const apps = await readFile(join(root, 'src/client/AppsPanel.tsx'), 'utf8')
  assert.match(apps, /pickDefaultAvailableBotSlug\(rows\)/)
  const memory = await readFile(join(root, 'src/client/MemoryPanel.tsx'), 'utf8')
  assert.match(memory, /pickDefaultAvailableBotSlug\(rows\)/)
  const conv = await readFile(join(root, 'src/client/ConvTabs.tsx'), 'utf8')
  assert.match(conv, /pickDefaultAvailableBotSlug\(rows\)/)
  const a2a = await readFile(join(root, 'src/client/A2AConversation.tsx'), 'utf8')
  assert.match(a2a, /pickDefaultAvailableBotSlug\(rows\)/)
  const styles = await readFile(join(root, 'src/client/styles.ts'), 'utf8')
  // The cover grew ~25% and the foot is fixed-height, pinned to the bottom
  // (the body stretches), so short-content cards never grow a tall foot.
  assert.match(styles, /\.oac-apps-card-cover \{[^}]*height: 120px/)
  assert.match(styles, /\.oac-apps-card-body \{[^}]*flex: 1 1 auto/)
  assert.match(styles, /\.oac-apps-card-foot \{[^}]*height: 38px/)
})
