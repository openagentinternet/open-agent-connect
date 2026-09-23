import assert from 'node:assert/strict'
import test from 'node:test'

const { configureMessageSources, oacMessageSource } = await import('../lib/message-source.js')

test('oacMessageSource: v3 wrapper by default, producer kind after v4 configure', () => {
  try {
    // Default (≤0.1.6): the retired v3 wrapper.
    assert.deepEqual(oacMessageSource('delegation'), { kind: 'plugin', plugin: 'oac-dsh', form: 'delegation' })

    // 0.1.7 (format v4): producer-owned kind matching the v3→v4 migration
    // rewrite, so native and migrated messages share one identity.
    configureMessageSources(true)
    assert.deepEqual(oacMessageSource('delegation'), { kind: 'plugin:oac-dsh', form: 'delegation' })

    configureMessageSources(false)
    assert.deepEqual(oacMessageSource('delegation'), { kind: 'plugin', plugin: 'oac-dsh', form: 'delegation' })
  } finally {
    configureMessageSources(false)
  }
})
