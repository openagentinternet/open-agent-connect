import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('dsh.client inject loads conversation so the hero chip slot exists', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
})

test('client shadows the hero chip at priority -1 and does not duplicate Agent presets nav', async () => {
  const text = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(text, /name: 'conversation\.hero\.agentPreset'/)
  assert.match(text, /priority: -1/)
  assert.doesNotMatch(text, /id: 'agent-presets'/)
  assert.doesNotMatch(text, /id: 'settings\.agentPreset'/)
  assert.match(text, /id: 'oac-bots'/)
})

test('chip lists stock DSH rows beside oac-* Bot names', async () => {
  const seat = await readFile(join(root, 'src/client/BotPresetSeat.tsx'), 'utf8')
  assert.match(seat, /optionLabel/)
  assert.match(seat, /state\.options\.map/)
  assert.match(seat, /oac-preset-seat/)
  const logic = await readFile(join(root, 'src/chip-logic.ts'), 'utf8')
  assert.match(logic, /OAC presets show the Bot name/)
  assert.match(logic, /every other preset keeps its own roster copy/)
})

test('blank-session select applies stored DSH model only when advertised', async () => {
  const store = await readFile(join(root, 'src/client/preset-seat-store.ts'), 'utf8')
  assert.match(store, /shouldApplyStagedPreset/)
  assert.match(store, /selectModel/)
  assert.match(store, /modelSelectionToApply/)
  assert.match(store, /composer model picker remains available/)
})
