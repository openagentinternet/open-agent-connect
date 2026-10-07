import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const {
  checkRuntime,
  compareVersions,
  installRuntime,
  npmGlobalPackageCli,
  pluginVersion,
  RUNTIME_INSTALL_COMMAND,
} = await import('../lib/cli-bridge.js')
const { resolveNpmBinary, npmGlobalModulesRoot } = await import('../lib/node-runtime.js')

// Fixed node resolution so checkRuntime tests never touch the host machine.
const NODE = { ok: true, path: '/opt/fake/bin/node', version: 'v24.13.1' }
const NODE_MISSING = { ok: false, error: 'No Node.js >=20 <25 found. Set OAC_NODE_PATH to a supported binary.' }
const ENV = {}
const NPM = '/opt/fake/bin/npm'

function check(overrides = {}) {
  return checkRuntime({
    env: ENV,
    node: NODE,
    npmPath: NPM,
    readVersion: () => null,
    ...overrides,
  })
}

test('compareVersions: equal, greater, less, numeric (not lexicographic), prerelease, padding', () => {
  assert.equal(compareVersions('0.9.2', '0.9.2'), 0)
  assert.ok(compareVersions('0.9.3', '0.9.2') > 0)
  assert.ok(compareVersions('0.9.1', '0.9.2') < 0)
  // 0.10 > 0.9 numerically — a lexicographic compare would say the opposite.
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0)
  assert.ok(compareVersions('1.0.0', '0.9.99') > 0)
  // Prerelease suffixes are stripped, not parsed.
  assert.ok(compareVersions('0.9.3-rc.1', '0.9.2') > 0)
  // Missing segments pad with zero.
  assert.ok(compareVersions('0.9', '0.9.2') < 0)
  assert.equal(compareVersions('0.9.0', '0.9'), 0)
})

test('checkRuntime: missing CLI + npm available → missing with the manual command', () => {
  const result = check({ cliPath: undefined })
  assert.equal(result.status, 'missing')
  assert.equal(result.cliPath, null)
  assert.equal(result.npmPath, NPM)
  assert.equal(result.installCommand, RUNTIME_INSTALL_COMMAND)
  assert.match(result.error, /metabot CLI not found/)
})

test('checkRuntime: runtime version equal to the plugin version → ok (boundary)', () => {
  const result = check({ cliPath: '/opt/fake/lib/node_modules/open-agent-connect/dist/cli/main.js', readVersion: () => pluginVersion() })
  assert.equal(result.status, 'ok')
  assert.equal(result.runtimeVersion, pluginVersion())
})

test('checkRuntime: runtime version greater than the plugin version → ok', () => {
  const result = check({ cliPath: '/x/dist/cli/main.js', readVersion: () => '999.0.0' })
  assert.equal(result.status, 'ok')
})

test('checkRuntime: runtime version older than the plugin version → stale', () => {
  const result = check({ cliPath: '/x/dist/cli/main.js', readVersion: () => '0.0.1' })
  assert.equal(result.status, 'stale')
  assert.equal(result.runtimeVersion, '0.0.1')
  assert.equal(result.requiredVersion, pluginVersion())
  assert.match(result.error, /older than this plugin/)
})

test('checkRuntime: unknown runtime version never blocks behind a setup card', () => {
  const result = check({ cliPath: '/x/dist/cli/main.js', readVersion: () => null })
  assert.equal(result.status, 'ok')
  assert.equal(result.runtimeVersion, null)
})

test('checkRuntime: missing CLI + no npm → npm_unavailable', () => {
  const result = check({ cliPath: undefined, npmPath: undefined })
  assert.equal(result.status, 'npm_unavailable')
  assert.equal(result.npmPath, null)
  assert.match(result.error, /npm was not found/)
})

test('checkRuntime: stale CLI + no npm → npm_unavailable (keeps the version detail)', () => {
  const result = check({ cliPath: '/x/dist/cli/main.js', npmPath: undefined, readVersion: () => '0.0.1' })
  assert.equal(result.status, 'npm_unavailable')
  assert.equal(result.runtimeVersion, '0.0.1')
  assert.match(result.error, /older than this plugin/)
})

test('checkRuntime: no supported node → npm_unavailable with the node error', () => {
  const result = checkRuntime({ env: ENV, node: NODE_MISSING, npmPath: undefined, cliPath: undefined })
  assert.equal(result.status, 'npm_unavailable')
  assert.equal(result.nodePath, null)
  assert.equal(result.error, NODE_MISSING.error)
})

test('npm global-root candidate: a fresh npm i -g layout under the resolved node is resolvable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-global-'))
  try {
    const cli = join(root, 'lib', 'node_modules', 'open-agent-connect', 'dist', 'cli', 'main.js')
    const oac = join(root, 'lib', 'node_modules', 'open-agent-connect', 'dist', 'oac', 'main.js')
    await mkdir(join(root, 'lib', 'node_modules', 'open-agent-connect', 'dist', 'cli'), { recursive: true })
    await mkdir(join(root, 'lib', 'node_modules', 'open-agent-connect', 'dist', 'oac'), { recursive: true })
    await writeFile(cli, '// fake\n', 'utf8')
    await writeFile(oac, '// fake\n', 'utf8')
    const nodePath = join(root, 'bin', 'node')
    assert.equal(npmGlobalPackageCli('metabot', nodePath), cli)
    assert.equal(npmGlobalPackageCli('oac', nodePath), oac)
    assert.equal(npmGlobalPackageCli('metabot', undefined), undefined)
    if (process.platform !== 'win32') {
      assert.equal(npmGlobalModulesRoot(nodePath), join(root, 'lib', 'node_modules'))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resolveNpmBinary: OAC_NPM_PATH override wins, otherwise npm next to the node binary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-npm-'))
  try {
    const fakeNpm = join(root, 'npm')
    await writeFile(fakeNpm, '#!/bin/sh\n', 'utf8')
    assert.equal(resolveNpmBinary({ OAC_NPM_PATH: fakeNpm }, NODE_MISSING), fakeNpm)
    assert.equal(resolveNpmBinary({ OAC_NPM_PATH: join(root, 'absent') }, NODE), undefined)
    assert.equal(resolveNpmBinary({}, NODE_MISSING), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function missingCheck() {
  return checkRuntime({ env: ENV, node: NODE, npmPath: NPM, cliPath: undefined, readVersion: () => null })
}

function okCheck() {
  return checkRuntime({
    env: ENV,
    node: NODE,
    npmPath: NPM,
    cliPath: '/x/dist/cli/main.js',
    readVersion: () => pluginVersion(),
  })
}

test('installRuntime: already-ok runtime is a no-op success that never spawns npm', async () => {
  let spawned = 0
  const result = await installRuntime({
    check: okCheck,
    spawnNpm: async () => { spawned += 1; return { code: 0, stdout: '', stderr: '' } },
  })
  assert.equal(result.ok, true)
  assert.equal(spawned, 0)
  assert.equal(result.check.status, 'ok')
})

test('installRuntime: successful npm install re-checks to ok', async () => {
  const checks = [missingCheck(), okCheck()]
  let calls = 0
  const spawnedNpmPaths = []
  const result = await installRuntime({
    check: () => checks[calls++],
    spawnNpm: async (npmPath) => { spawnedNpmPaths.push(npmPath); return { code: 0, stdout: 'added 1 package', stderr: '' } },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(spawnedNpmPaths, [NPM])
  assert.equal(result.check.status, 'ok')
  assert.equal(calls, 2)
})

test('installRuntime: EPERM-class npm failure degrades to the manual command', async () => {
  const result = await installRuntime({
    check: missingCheck,
    spawnNpm: async () => ({
      code: 1,
      stdout: '',
      stderr: "npm ERR! Error: EACCES: permission denied, access '/usr/local/lib/node_modules'",
    }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.permission, true)
  assert.equal(result.command, RUNTIME_INSTALL_COMMAND)
  assert.match(result.message, /EACCES/)
})

test('installRuntime: non-permission npm failure reports the error without the manual downgrade', async () => {
  const result = await installRuntime({
    check: missingCheck,
    spawnNpm: async () => ({ code: 1, stdout: '', stderr: 'npm ERR! network request failed' }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.permission, false)
  assert.match(result.message, /network request failed/)
})

test('installRuntime: no npm → fails with the check error, no spawn', async () => {
  let spawned = 0
  const result = await installRuntime({
    check: () => checkRuntime({ env: ENV, node: NODE, npmPath: undefined, cliPath: undefined, readVersion: () => null }),
    spawnNpm: async () => { spawned += 1; return { code: 0, stdout: '', stderr: '' } },
  })
  assert.equal(result.ok, false)
  assert.equal(spawned, 0)
  assert.match(result.message, /npm was not found/)
})

test('installRuntime: spawn-level failure (timeout) surfaces the message', async () => {
  const result = await installRuntime({
    check: missingCheck,
    spawnNpm: async () => { throw new Error('npm install timed out after 300000ms') },
  })
  assert.equal(result.ok, false)
  assert.equal(result.permission, false)
  assert.match(result.message, /timed out/)
})

test('installRuntime: npm exit 0 but runtime still unresolved reports the post-check error', async () => {
  const result = await installRuntime({
    check: missingCheck, // post-check also "missing": npm wrote somewhere we do not resolve
    spawnNpm: async () => ({ code: 0, stdout: '', stderr: '' }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.check.status, 'missing')
  assert.match(result.message, /metabot CLI not found/)
})

test('the plugin surface exports the runtime setup entry points', async () => {
  const plugin = await import('../lib/index.js')
  assert.equal(typeof plugin.checkRuntime, 'function')
  assert.equal(typeof plugin.installRuntime, 'function')
  assert.equal(typeof plugin.compareVersions, 'function')
  assert.equal(plugin.RUNTIME_INSTALL_COMMAND, 'npm i -g open-agent-connect@latest')
})
