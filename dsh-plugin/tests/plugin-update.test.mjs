import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkPluginUpdate,
  compareVersions,
  currentPluginVersion,
  resetUpdateCacheForTests,
  updateRegistry,
} from '../lib/plugin-update.js'

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('compareVersions orders stable and prerelease versions', () => {
  assert.equal(compareVersions('0.9.7', '0.9.6'), 1)
  assert.equal(compareVersions('0.9.6', '0.9.6'), 0)
  assert.equal(compareVersions('0.9.5', '0.9.6'), -1)
  assert.equal(compareVersions('0.9.6-beta.2', '0.9.6-beta.1'), 1)
  assert.equal(compareVersions('0.9.6', '0.9.6-beta.9'), 1)
  assert.equal(compareVersions('0.9.6-beta.1', '0.9.6'), -1)
})

test('updateRegistry validates the configured registry and defaults to npm', () => {
  assert.equal(updateRegistry({}), 'https://registry.npmjs.org')
  assert.equal(updateRegistry({ OAC_DSH_UPDATE_REGISTRY: 'https://registry.example.test///' }), 'https://registry.example.test')
  assert.equal(updateRegistry({ OAC_DSH_UPDATE_REGISTRY: 'ftp://registry.example.test' }), undefined)
})

test('checkPluginUpdate reports a newer npm latest and checks the expected endpoint', async () => {
  resetUpdateCacheForTests()
  let requested
  const status = await checkPluginUpdate({
    currentVersion: '0.9.6',
    registry: 'https://registry.example.test',
    now: () => 1000,
    fetchImpl: async (url) => {
      requested = String(url)
      return response({ name: 'open-agent-connect-dsh', version: '0.9.7' })
    },
  })
  assert.equal(requested, 'https://registry.example.test/open-agent-connect-dsh/latest')
  assert.equal(status.ok, true)
  assert.equal(status.current, '0.9.6')
  assert.equal(status.latest, '0.9.7')
  assert.equal(status.updateAvailable, true)
  assert.match(status.releaseUrl, /0\.9\.7$/)
})

test('checkPluginUpdate does not offer the installed version', async () => {
  resetUpdateCacheForTests()
  const status = await checkPluginUpdate({
    currentVersion: '0.9.6',
    registry: 'https://registry.example.test',
    now: () => 2000,
    fetchImpl: async () => response({ name: 'open-agent-connect-dsh', version: '0.9.6' }),
  })
  assert.equal(status.ok, true)
  assert.equal(status.updateAvailable, false)
})

test('checkPluginUpdate rejects malformed registry answers', async () => {
  resetUpdateCacheForTests()
  const status = await checkPluginUpdate({
    currentVersion: '0.9.6',
    registry: 'https://registry.example.test',
    now: () => 3000,
    fetchImpl: async () => response({ name: 'some-other-package', version: '1.0.0' }),
  })
  assert.equal(status.ok, false)
  assert.equal(status.code, 'invalid_response')
  assert.equal(status.updateAvailable, false)
})

test('the built package version is readable at runtime', () => {
  assert.match(currentPluginVersion(), /^\d+\.\d+\.\d+/)
})

test('applyPluginUpdate removes the bundle and installs the exact target through DSH', async () => {
  const calls = []
  const manager = {
    async listBundles() {
      return [{ name: 'open-agent-connect-dsh', version: '0.9.7', source: 'open-agent-connect-dsh@^0.9.7', removable: true }]
    },
    async removeBundle(name) {
      calls.push(['remove', name])
      return { application: 'applied' }
    },
    async installBundle(spec, options) {
      calls.push(['install', spec, options])
      return { application: 'applied', version: '0.9.8' }
    },
  }
  const { applyPluginUpdate } = await import('../lib/plugin-update.js')
  const result = await applyPluginUpdate(
    { get: key => key === 'pluginManager' ? manager : undefined },
    { check: async () => ({ ok: true, current: '0.9.7', latest: '0.9.8', updateAvailable: true, registry: 'test', checkedAt: 1 }) },
  )
  assert.equal(result.ok, true)
  assert.equal(result.application, 'applied')
  assert.deepEqual(calls, [
    ['remove', 'open-agent-connect-dsh'],
    ['install', 'open-agent-connect-dsh@0.9.8', { enabled: true, saveExact: true }],
  ])
})

test('applyPluginUpdate rolls back the prior installed spec after a failed install', async () => {
  const calls = []
  const manager = {
    async listBundles() {
      return [{ name: 'open-agent-connect-dsh', version: '0.9.7', source: 'open-agent-connect-dsh@^0.9.7', removable: true }]
    },
    async removeBundle(name) {
      calls.push(['remove', name])
      return { application: 'applied' }
    },
    async installBundle(spec) {
      calls.push(['install', spec])
      if (spec.endsWith('@0.9.8')) return { application: 'failed', error: { code: 'network', message: 'registry offline' } }
      return { application: 'applied' }
    },
  }
  const { applyPluginUpdate } = await import('../lib/plugin-update.js')
  const result = await applyPluginUpdate(
    { get: key => key === 'pluginManager' ? manager : undefined },
    { check: async () => ({ ok: true, current: '0.9.7', latest: '0.9.8', updateAvailable: true, registry: 'test', checkedAt: 1 }) },
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, 'network')
  assert.deepEqual(calls, [
    ['remove', 'open-agent-connect-dsh'],
    ['install', 'open-agent-connect-dsh@0.9.8'],
    ['install', 'open-agent-connect-dsh@^0.9.7'],
  ])
})

test('applyPluginUpdate rolls back when pnpm installs a different version than requested', async () => {
  const calls = []
  const manager = {
    async listBundles() {
      return [{ name: 'open-agent-connect-dsh', version: '0.9.7', source: 'open-agent-connect-dsh@^0.9.7', removable: true }]
    },
    async removeBundle(name) {
      calls.push(['remove', name])
      return { application: 'applied' }
    },
    async installBundle(spec) {
      calls.push(['install', spec])
      if (spec.endsWith('@0.9.8')) return { application: 'applied', version: '0.9.6' }
      return { application: 'applied' }
    },
  }
  const { applyPluginUpdate } = await import('../lib/plugin-update.js')
  const result = await applyPluginUpdate(
    { get: key => key === 'pluginManager' ? manager : undefined },
    { check: async () => ({ ok: true, current: '0.9.7', latest: '0.9.8', updateAvailable: true, registry: 'test', checkedAt: 1 }) },
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, 'version_mismatch')
  assert.deepEqual(calls, [
    ['remove', 'open-agent-connect-dsh'],
    ['install', 'open-agent-connect-dsh@0.9.8'],
    ['install', 'open-agent-connect-dsh@^0.9.7'],
  ])
})

test('applyPluginUpdate refuses a non-newer target before touching the profile', async () => {
  let touched = false
  const manager = {
    async listBundles() { touched = true; return [] },
    async removeBundle() { touched = true; return { application: 'failed' } },
    async installBundle() { touched = true; return { application: 'failed' } },
  }
  const { applyPluginUpdate } = await import('../lib/plugin-update.js')
  const result = await applyPluginUpdate(
    { get: key => key === 'pluginManager' ? manager : undefined },
    { check: async () => ({ ok: true, current: '0.9.7', latest: '0.9.6', updateAvailable: false, registry: 'test', checkedAt: 1 }) },
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, 'not_available')
  assert.equal(touched, false)
})
