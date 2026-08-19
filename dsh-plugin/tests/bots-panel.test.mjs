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
