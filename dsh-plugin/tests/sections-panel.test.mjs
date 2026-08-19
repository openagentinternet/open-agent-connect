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

test('client registers three settings sections and the A2A sidebar footer action', async () => {
  const text = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(text, /id: 'oac-bots'/)
  assert.match(text, /id: 'oac-services'/)
  assert.match(text, /id: 'oac-apps'/)
  assert.doesNotMatch(text, /id: 'oac-conversations'/)
  assert.match(text, /name: 'sidebar\.footer\.action'/)
  assert.match(text, /id: 'oac-a2a'/)
  assert.match(text, /order: 20/)
  assert.match(text, /order: 22/)
  assert.match(text, /order: 23/)
  assert.doesNotMatch(text, /id: 'oac'/)
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
