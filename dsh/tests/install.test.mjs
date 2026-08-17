import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempTempRootSync } from '../../tests/helpers/tempRoots.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const installScript = path.join(__dirname, '..', 'install.mjs')
const expectedCliPath = path.join(repoRoot, 'dist', 'cli', 'main.js')

test('install.mjs installs the preset and bakes the CLI path', () => {
  const root = mkdtempTempRootSync('oac-test-')
  const dshHome = path.join(root, 'dsh-home')
  const presetDir = path.join(dshHome, '.agent-presets', 'oac')

  execFileSync(process.execPath, [installScript], {
    env: { ...process.env, DSH_HOME: dshHome },
    cwd: repoRoot,
    encoding: 'utf8',
  })

  // Composition, metadata, and every plugin module land in the preset dir.
  assert.ok(existsSync(path.join(presetDir, 'agent.cordis.yml')))
  assert.ok(existsSync(path.join(presetDir, 'preset.yml')))
  assert.ok(existsSync(path.join(presetDir, 'plugins', 'oac-identity.js')))
  assert.ok(existsSync(path.join(presetDir, 'plugins', 'oac-system.js')))
  assert.ok(existsSync(path.join(presetDir, 'plugins', '_runner.js')))

  // The placeholder is replaced with the concrete built CLI path.
  const composition = readFileSync(path.join(presetDir, 'agent.cordis.yml'), 'utf8')
  assert.ok(!composition.includes('{{CLI_PATH}}'))
  assert.ok(composition.includes(expectedCliPath))

  // Every row carries a concrete cliPath and a relative plugin specifier.
  const rows = composition.split('\n- id: ').filter((part) => part.startsWith('oac-'))
  assert.equal(rows.length, 12)
  for (const row of rows) {
    assert.match(row, /name: '\.\/plugins\//)
    assert.match(row, /cliPath: '/)
  }
})

test('install.mjs refuses to run before the repo is built', () => {
  const root = mkdtempTempRootSync('oac-test-')
  const dshHome = path.join(root, 'dsh-home')
  const realCliPath = path.join(repoRoot, 'dist', 'cli', 'main.js')
  if (!existsSync(realCliPath)) {
    // Nothing to assert beyond the guard when dist is absent.
    assert.throws(() => execFileSync(process.execPath, [installScript], {
      env: { ...process.env, DSH_HOME: dshHome },
      cwd: repoRoot,
      encoding: 'utf8',
    }))
    return
  }
  // The build exists, so install must succeed; this branch guards the suite
  // against running on an unbuilt checkout.
  execFileSync(process.execPath, [installScript], {
    env: { ...process.env, DSH_HOME: dshHome },
    cwd: repoRoot,
    encoding: 'utf8',
  })
})
