/**
 * DSH 0.2.2+ unified session context-menu integration (client wiring).
 *
 * The client bundle is a single closure artifact, so the wiring is asserted
 * against sources; the pure slug mapping is exercised through the registered
 * resolve shape the sources must show.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('session menu: the contribution registers behind the 0.2.2+ contextMenus service', async () => {
  const entry = await readFile(join(root, 'src', 'client', 'index.ts'), 'utf8')
  assert.match(entry, /ctx\.inject\(\['contextMenus', 'sessions'\]/, 'the inject IS the feature detection (pending on 0.2.1)')
  assert.match(entry, /registerSessionMenu\(/, 'the contribution registers through the session-menu module')
  assert.match(entry, /declare module '@deepseek-ai\/cordis'/, 'the contextMenus service face is declared structurally')
})

test('session menu: the resolver maps oac-<slug> presets and opens the editor', async () => {
  const source = await readFile(join(root, 'src', 'client', 'session-menu.ts'), 'utf8')
  assert.match(source, /id: 'oac\.editBot'/, 'one namespaced contribution')
  assert.match(source, /target: 'session'/, 'attached to host session rows')
  assert.match(source, /startsWith\('oac-'\)/, 'only oac-* sessions resolve actions')
  assert.match(source, /preset\.slice\('oac-'\.length\)/, 'the slug is the preset minus the oac- prefix')
  assert.match(source, /requestBotEditor\(slug\)/, 'the action focuses the Bot editor')
  assert.match(source, /set\(\{ open: true \}\)/, 'the action opens the Bots page overlay')
  assert.match(source, /label: label\(\)/, 'the label is read per resolve (fresh locale)')
})

test('session menu: BotPanel consumes editor requests', async () => {
  const panel = await readFile(join(root, 'src', 'client', 'BotPanel.tsx'), 'utf8')
  assert.match(panel, /subscribeToBotEditorRequests/, 'the panel subscribes to editor requests')
  const bus = await readFile(join(root, 'src', 'client', 'bot-editor-requests.ts'), 'utf8')
  assert.match(bus, /export function requestBotEditor/, 'the request bus publishes slugs')
  assert.match(bus, /export function subscribeToBotEditorRequests/, 'the request bus fans out to panels')
})
