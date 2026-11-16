process.env.OAC_DSH_NO_LOCAL_READ = '1'

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { parseMetaidFence } = await import('../lib/metaid-fence-logic.js')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('fence parse: one URI per matching line, in order', () => {
  const content = parseMetaidFence([
    'metaid://pin/abc123 i0',
    'metaapp://app/demo',
    '',
    'pin://xyz/9',
  ].join('\n'))
  assert.deepEqual(content, { uris: ['metaid://pin/abc123', 'metaapp://app/demo', 'pin://xyz/9'] })
})

test('fence parse: title and note lines, first occurrence wins', () => {
  const content = parseMetaidFence([
    'title: My Pin',
    'note: 从知识库找到的资源',
    'metaid://pin/abc123',
    'title: ignored duplicate',
  ].join('\n'))
  assert.deepEqual(content, { title: 'My Pin', note: '从知识库找到的资源', uris: ['metaid://pin/abc123'] })
})

test('fence parse: the meta info string seeds the title; an explicit title line wins', () => {
  assert.equal(parseMetaidFence('metaid://pin/abc123', 'search result').title, 'search result')
  assert.equal(parseMetaidFence('title: explicit\nmetaid://pin/abc123', 'seeded').title, 'explicit')
})

test('fence parse: blank meta and blank lines are ignored', () => {
  const content = parseMetaidFence('\n\nmetaid://pin/abc123\n\n', '   ')
  assert.deepEqual(content, { uris: ['metaid://pin/abc123'] })
})

test('fence parse: non-URI prose lines are ignored, not misparsed', () => {
  const content = parseMetaidFence('just some prose\nmore prose\nmetaid://pin/abc123')
  assert.deepEqual(content, { uris: ['metaid://pin/abc123'] })
})

test('fence parse: the URI stops at characters outside the scheme charset', () => {
  const content = parseMetaidFence('see metaid://pin/abc123) and metaid://pin/def456.')
  assert.deepEqual(content.uris, ['metaid://pin/abc123', 'metaid://pin/def456'])
})

test('fence parse: no URI at all returns null (the plain code block fallback)', () => {
  assert.equal(parseMetaidFence('title: nothing here\nnote: still nothing'), null)
  assert.equal(parseMetaidFence(''), null)
  assert.equal(parseMetaidFence('https://example.com/not-metaid'), null)
})

test('fence parse: every scheme family the link interceptor handles', () => {
  const content = parseMetaidFence([
    'metaid://a/1', 'metaapp://a/2', 'map://a/3', 'metafile://a/4', 'pin://a/5', 'pinid://a/6', 'preview-metaapp://a/7',
  ].join('\n'))
  assert.equal(content.uris.length, 7)
})

test('fence card: the layer registers into the rc.2+ hoc slot with fallback discipline', async () => {
  const entry = await readFile(join(root, 'src', 'client', 'index.ts'), 'utf8')
  assert.match(entry, /ctx\.slots\.inject\('conversation\.chat\.markdown\.fence'/, 'the slot inject IS the feature detection (pending on pre-rc.2 kernels)')
  assert.match(entry, /id: 'oac\.metaid-card'/, 'one namespaced hoc layer')
  assert.match(entry, /key: 'metaid'/, 'serves the lowercased metaid language')
  const card = await readFile(join(root, 'src', 'client', 'MetaidFenceCard.tsx'), 'utf8')
  assert.match(card, /return props\.children \?\? null/, 'an unparseable fence renders the wrapped plain code block')
  assert.match(card, /parseMetaidFence\(/, 'the card parses through the shared logic module')
})
