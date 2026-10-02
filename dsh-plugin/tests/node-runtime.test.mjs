import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { nodeCandidates } from '../lib/node-runtime.js'

const EXEC = '/plain/node'
const nvmDir = join(mkdtempSync(join(tmpdir(), 'oac-nvm-')), 'nvm')
mkdirSync(join(nvmDir, 'versions', 'node', 'v22.14.0', 'bin'), { recursive: true })

test('plain-Node hosts probe process.execPath first (after OAC_NODE_PATH)', () => {
  const candidates = nodeCandidates({ OAC_NODE_PATH: '/override/node' }, nvmDir, EXEC, false)
  assert.deepEqual(candidates.slice(0, 2), ['/override/node', EXEC])
})

test('Electron hosts skip process.execPath: spawning the Electron binary cannot run a plain Node script', () => {
  const candidates = nodeCandidates({}, nvmDir, EXEC, true)
  assert.ok(!candidates.includes(EXEC))
})

test('nvm candidates follow the override on both host kinds', () => {
  for (const electron of [false, true]) {
    const candidates = nodeCandidates({}, nvmDir, EXEC, electron)
    const nvmEntry = candidates.find((c) => c.includes(join('versions', 'node')))
    assert.ok(nvmEntry, 'nvm candidate present')
    assert.match(nvmEntry, /bin[/\\]node$/)
  }
})
