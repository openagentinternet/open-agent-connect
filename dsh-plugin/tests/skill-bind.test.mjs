import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

const resolution = {
  cliPath: '/tmp/metabot.js',
  oacPath: '/tmp/oac.js',
  nodePath: '/tmp/node',
  nodeVersion: 'v24.13.1',
}

test('bootstrapHealth prefers oac install --host dsh when oacPath exists', async () => {
  const calls = []
  const health = await plugin.bootstrapHealth(
    {},
    async (args, opts) => {
      calls.push({ args, entry: opts?.entry })
      return {
        ok: true,
        state: 'success',
        data: { boundSkills: ['metabot-help', 'metabot-network-directory'] },
      }
    },
    () => resolution,
  )
  assert.equal(health.ok, true)
  assert.equal(health.skillBind.ok, true)
  assert.deepEqual(calls[0].args, ['daemon', 'start'])
  assert.deepEqual(calls[1].args, ['install', '--host', 'dsh'])
  assert.equal(calls[1].entry, 'oac')
})

test('bootstrapHealth falls back to metabot host bind-skills --host dsh', async () => {
  const calls = []
  const health = await plugin.bootstrapHealth(
    {},
    async (args, opts) => {
      calls.push({ args, entry: opts?.entry })
      return {
        ok: true,
        state: 'success',
        data: { boundSkills: ['metabot-help', 'metabot-network-directory'] },
      }
    },
    () => ({ ...resolution, oacPath: null }),
  )
  assert.equal(health.ok, true)
  assert.equal(health.skillBind.ok, true)
  assert.deepEqual(calls[1].args, ['host', 'bind-skills', '--host', 'dsh'])
  assert.equal(calls[1].entry, undefined)
})
