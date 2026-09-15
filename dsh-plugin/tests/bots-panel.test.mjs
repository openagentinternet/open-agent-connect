import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

function objectKeys(block) {
  return [...block.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1])
}

test('en and zh Bots locale dictionaries share the same keys', async () => {
  const text = await readFile(join(dirname(fileURLToPath(import.meta.url)), '../src/client/locale.ts'), 'utf8')
  const en = text.slice(text.indexOf('export const en = {'), text.indexOf('export const zh = {'))
  const zh = text.slice(text.indexOf('export const zh = {'), text.indexOf('export type BotsLocaleKey'))
  assert.deepEqual(objectKeys(en).sort(), objectKeys(zh).sort())
  assert.ok(objectKeys(en).includes('nav'))
  assert.ok(objectKeys(en).includes('createNew'))
  assert.ok(objectKeys(en).includes('tabAdvanced'))
})

test('English empty-state copy is the product empty line; zh dictionary is present', async () => {
  const text = await readFile(join(dirname(fileURLToPath(import.meta.url)), '../src/client/locale.ts'), 'utf8')
  assert.match(text, /empty: 'No Bots yet/)
  assert.match(text, /empty: '还没有 Bot/)
  assert.match(text, /nav: 'Bots'/)
})

test('the listing-head availability filter persists locally and uses the chip availability rule', async () => {
  const text = await readFile(join(dirname(fileURLToPath(import.meta.url)), '../src/client/BotPanel.tsx'), 'utf8')
  assert.match(text, /AVAILABLE_ONLY_STORAGE_KEY = 'oac-dsh:bots-available-only:v1'/)
  assert.match(text, /useState<boolean>\(readAvailableOnly\)/)
  assert.match(text, /writeAvailableOnly\(next\)/)
  assert.match(text, /availableOnly \? bots\.filter\(\(bot\) => isChipBotAvailable\(bot\)\) : bots/)
  const styles = await readFile(join(dirname(fileURLToPath(import.meta.url)), '../src/client/styles.ts'), 'utf8')
  assert.match(styles, /\.oac-bot-listing-head \{ display: flex; align-items: center/)
})
