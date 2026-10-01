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
  assert.match(apps, /nav: 'Apps'/)
  assert.match(apps, /nav: '应用'/)
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

test('client registers the Bots main panel with its panellist row and the five page sections, leaving Settings stock', async () => {
  const text = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  // The five sections moved out of Settings onto the Bots page: not one
  // settings.section registration remains, so DSH Settings renders stock.
  assert.doesNotMatch(text, /name: 'settings\.section'/)
  assert.match(text, /name: 'oac\.bots\.section'/)
  assert.match(text, /children: \{ 'oac\.bots\.section': \{ kind: 'list', scope: 'root' \} \}/)
  // The left-rail row and the main panel share the 'oac-bots' id/key, the
  // same mechanism the stock 插件 row uses for the plugin manager.
  assert.match(text, /name: 'sidebar\.panellist'/)
  assert.match(text, /name: 'main'/)
  assert.match(text, /key: 'oac-bots'/)
  assert.match(text, /\}, BotsPageGlyph\)/)
  assert.match(text, /\}, BotsPage\)/)
  // The nav's section-ledger projection feeds the page through the inject hooks face.
  assert.match(text, /ctx\.slots\.entries\('oac\.bots\.section'\)/)
  assert.match(text, /resolveSlotLabel\(entry\.options\.label\)/)
  assert.match(text, /hooks: \{ sections: botsPageSections \}/)
  // Sections keep their Settings-era ids/orders.
  assert.match(text, /id: 'oac-bots'/)
  assert.doesNotMatch(text, /id: 'oac-services'/)
  assert.match(text, /id: 'oac-apps'/)
  assert.doesNotMatch(text, /id: 'oac-conversations'/)
  assert.match(text, /id: 'oac-memory'/)
  assert.match(text, /id: 'oac-user'/)
  assert.match(text, /id: 'oac-traffic'/)
  assert.match(text, /name: 'shell\.overlay'/)
  assert.match(text, /if \(SHOW_A2A_PANELLIST_ROW\)/)
  assert.match(text, /id: 'oac-a2a'/)
  assert.doesNotMatch(text, /key: 'oac-a2a'/)
  assert.doesNotMatch(text, /sidebar\.footer\.action/)
  assert.match(text, /order: 20/)
  assert.match(text, /order: 21/)
  assert.match(text, /order: 22/)
  assert.match(text, /order: 23/)
  assert.match(text, /order: 24/)
  assert.doesNotMatch(text, /id: 'oac'/)
})

test('the Bots page projects the section ledger into a keep-alive vertical nav', async () => {
  const text = await readFile(join(root, 'src/client/bots-page.tsx'), 'utf8')
  assert.match(text, /'oac\.bots\.section': \{/)
  assert.match(text, /kind: 'list'/)
  assert.match(text, /owner: OacBotsSectionOwnerProps/)
  assert.match(text, /renderSlot\('oac\.bots\.section', \{ close, openBotPage: openDock \}, \{ only: row\.id \}\)/)
  assert.match(text, /visitedIds/)
  assert.match(text, /hidden=\{!selected\}/)
  assert.match(text, /role="tablist"/)
  assert.match(text, /aria-orientation="vertical"/)
  assert.match(text, /aria-current=\{selected \? 'true' : undefined\}/)
  assert.match(text, /oac-dsh:bots-page-section:v1/)
  assert.match(text, /window\.localStorage/)
  // Each nav row carries a per-section icon (Settings left-nav parity).
  assert.match(text, /'oac-bots': IconAgentPresetOutline16/)
  assert.match(text, /'oac-memory': IconThinkOutline16/)
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

test('the Bot card opens the editor as a whole; the avatar opens the in-page Bot Page dock', async () => {
  const panel = await readFile(join(root, 'src/client/BotPanel.tsx'), 'utf8')
  // The whole card opens the editor…
  assert.match(panel, /role="button"/)
  assert.match(panel, /tabIndex=\{0\}/)
  assert.match(panel, /onClick=\{\(\) => \{ setEditing\(bot\); setError\(null\) \}\}/)
  // …while the inner controls keep their own actions and never reach the card.
  assert.match(panel, /event\.stopPropagation\(\); void toggleAvailability\(bot\)/)
  assert.match(panel, /event\.stopPropagation\(\); void onCardResync\(bot\)/)
  // The avatar opens the Bot Page in the page's own dock; the card-foot
  // Bot-Page and edit icon buttons are gone, and nothing on the panel still
  // drives the right-Sidebar reveal (that surface unmounts under a main panel).
  assert.match(panel, /event\.stopPropagation\(\)\s*\n\s*openBotPage\(`metaid:\/\/\$\{bot\.globalMetaId\}`, bot\.name\)/)
  assert.doesNotMatch(panel, /IconRightUpOutline16|IconEditOutline16|oac-bot-foot-right/)
  // The panel no longer drives the right-Sidebar reveal (that surface
  // unmounts under a main panel) — the t('browserOpen') locale KEY stays.
  assert.doesNotMatch(panel, /browserOpen[=:(]|browserOpen,/)
  const editor = await readFile(join(root, 'src/client/BotEditor.tsx'), 'utf8')
  assert.match(editor, /openBotPage=\{openBotPage\}/)
  assert.doesNotMatch(editor, /browserOpen/)
  const advanced = await readFile(join(root, 'src/client/BotAdvancedSection.tsx'), 'utf8')
  assert.match(advanced, /openBotPage\(`metaid:\/\/\$\{bot\.globalMetaId\}`, bot\.name\)/)
  assert.doesNotMatch(advanced, /browserOpen/)
})

test('the Bots page dock resolves URIs side-effect-free and renders the shared BrowserStage', async () => {
  const page = await readFile(join(root, 'src/client/bots-page.tsx'), 'utf8')
  assert.match(page, /oac-bots-page-dock/)
  assert.match(page, /resolveBotPage/)
  assert.match(page, /<BrowserStage url=\{dock\.url\} title=\{dock\.title\} onIframe=\{\(\) => undefined\} \/>/)
  const api = await readFile(join(root, 'src/client/api.ts'), 'utf8')
  assert.match(api, /browserResolve/)
  assert.match(api, /post<\{ localUiUrl\?: unknown \}>\('browser\/resolve', \{ uri: uri \?\? '' \}\)/)
  const index = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(index, /resolveBotPage: \(uri: string \| null\) => api\.browserResolve\(uri\)/)
  const host = await readFile(join(root, 'src/index.ts'), 'utf8')
  assert.match(host, /method === 'browser\/resolve'/)
  const bridge = await readFile(join(root, 'src/browser-bridge.ts'), 'utf8')
  assert.match(bridge, /resolve\(uri: string \| null\): \{ uri: string \| null; localUiUrl: string \} \| null/)
  const styles = await readFile(join(root, 'src/client/styles.ts'), 'utf8')
  assert.match(styles, /\.oac-bot-card \{[^}]*cursor: pointer/)
  assert.match(styles, /\.oac-bot-card:focus-visible/)
  assert.match(styles, /\.oac-bots-page-dock \{/)
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
