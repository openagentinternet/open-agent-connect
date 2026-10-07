import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { nodeCandidates, resolveNodeBinary, discoveryNodePaths, wellKnownNpmGlobalRoots } from '../lib/node-runtime.js'

const EXEC = '/plain/node'
const nvmDir = join(mkdtempSync(join(tmpdir(), 'oac-nvm-')), 'nvm')
mkdirSync(join(nvmDir, 'versions', 'node', 'v22.14.0', 'bin'), { recursive: true })

test('plain-Node hosts probe process.execPath first (after OAC_NODE_PATH)', () => {
  const candidates = nodeCandidates({ OAC_NODE_PATH: '/override/node' }, nvmDir, EXEC, false)
  assert.deepEqual(candidates.slice(0, 2), [{ path: '/override/node' }, { path: EXEC }])
})

test('Electron hosts without a usable embedded Node still skip process.execPath', () => {
  const candidates = nodeCandidates({}, nvmDir, EXEC, true, 'v26.1.0')
  assert.ok(!candidates.some((c) => c.path === EXEC))
})

test('Electron hosts re-add execPath LAST with ELECTRON_RUN_AS_NODE when the embedded Node is in range', () => {
  const candidates = nodeCandidates({}, nvmDir, EXEC, true, 'v24.18.1')
  const last = candidates[candidates.length - 1]
  assert.deepEqual(last, {
    path: EXEC,
    env: { ELECTRON_RUN_AS_NODE: '1' },
    versionHint: 'v24.18.1',
  })
  // A real node binary (nvm) still outranks the Electron binary.
  const nvmEntry = candidates.find((c) => c.path.includes(join('versions', 'node')))
  assert.ok(nvmEntry, 'nvm candidate present')
  assert.match(nvmEntry.path, /bin[/\\]node$/)
  assert.ok(!nvmEntry.env, 'nvm candidate spawns without extra env')
})

test('resolveNodeBinary hands candidates (not bare paths) to the version reader', () => {
  // A candidate carrying versionHint (the Electron run-as-node shape) is
  // answered from the hint; a hint-less candidate is probed and skipped when
  // it answers nothing — resolution continues down the list, never throws.
  const exec = join(mkdtempSync(join(tmpdir(), 'oac-exec-')), 'electron-app')
  writeFileSync(exec, '#!/bin/sh\nexit 0\n')
  const readVersionCalls = []
  const resolution = resolveNodeBinary(
    { OAC_NODE_PATH: exec },
    (candidate) => {
      readVersionCalls.push(candidate.path)
      // Hint-aware like the default reader; the plain execPath candidate
      // answers its own version, everything else stays silent.
      return candidate.versionHint ?? (candidate.path === process.execPath ? 'v24.1.0' : undefined)
    },
  )
  assert.ok(readVersionCalls.includes(exec), 'the override candidate was probed first')
  assert.ok(readVersionCalls.length > 1, 'resolution continued past the silent candidate')
  assert.equal(resolution.ok, true)
  assert.equal(resolution.path, process.execPath)
  assert.equal(resolution.spawnEnv, undefined)
})

test('discoveryNodePaths includes the resolved node, execPath, and every nvm version (any range)', () => {
  const root = mkdtempSync(join(tmpdir(), 'oac-disc-'))
  const nvm = join(root, 'nvm')
  mkdirSync(join(nvm, 'versions', 'node', 'v26.7.0', 'bin'), { recursive: true })
  mkdirSync(join(nvm, 'versions', 'node', 'v22.14.0', 'bin'), { recursive: true })
  const paths = discoveryNodePaths({ NVM_DIR: nvm }, '/fake/exec')
  assert.ok(paths.includes('/fake/exec'), 'execPath is probed for discovery')
  assert.ok(paths.some((p) => p.includes('v26.7.0')), 'out-of-range nvm versions are probed for discovery')
  assert.ok(paths.some((p) => p.includes('v22.14.0')), 'in-range nvm versions are probed for discovery')
  assert.equal(new Set(paths).size, paths.length, 'deduped')
})

test('wellKnownNpmGlobalRoots lists the platform global roots without any node binary', () => {
  const roots = wellKnownNpmGlobalRoots()
  assert.ok(Array.isArray(roots) && roots.length > 0)
  if (process.platform !== 'win32') {
    assert.ok(roots.includes('/opt/homebrew/lib/node_modules'))
    assert.ok(roots.includes('/usr/local/lib/node_modules'))
  }
})
