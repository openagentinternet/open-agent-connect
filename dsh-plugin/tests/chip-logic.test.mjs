import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

test('filterSelectablePresets drops broken rows and keeps stock plus oac-* ids', () => {
  const options = plugin.filterSelectablePresets([
    { id: 'standard', trust: 'system', name: 'Standard' },
    { id: 'oac-alice', trust: 'user', name: 'Alice' },
    { id: 'code', trust: 'system', name: 'Code', broken: 'missing composition' },
    { id: 'oac-bob', trust: 'user', name: 'Bob' },
  ])
  assert.deepEqual(options.map((row) => row.id), ['standard', 'oac-alice', 'oac-bob'])
})

test('chipDisplayName uses the Bot name for oac-* and the roster name otherwise', () => {
  const bots = { alice: { name: 'Alice' } }
  assert.equal(
    plugin.chipDisplayName({ id: 'oac-alice', name: 'preset.yml leftover' }, bots),
    'Alice',
  )
  assert.equal(
    plugin.chipDisplayName({ id: 'standard', name: 'Standard' }, bots),
    'Standard',
  )
  assert.equal(
    plugin.chipDisplayName({ id: 'oac-missing' }, bots),
    'oac-missing',
  )
})

test('shouldApplyStagedPreset only applies on a blank session that is not already on the pick', () => {
  assert.equal(plugin.shouldApplyStagedPreset({ blank: true, agentPreset: 'standard' }, 'oac-alice'), true)
  assert.equal(plugin.shouldApplyStagedPreset({ blank: true, agentPreset: 'oac-alice' }, 'oac-alice'), false)
  assert.equal(plugin.shouldApplyStagedPreset({ blank: false, agentPreset: 'standard' }, 'oac-alice'), false)
  assert.equal(plugin.shouldApplyStagedPreset(undefined, 'oac-alice'), false)
  assert.equal(plugin.shouldApplyStagedPreset({ blank: true }, undefined), false)
})

test('modelSelectionToApply uses the Bot store only when that pair is still advertised', () => {
  const bots = {
    alice: { dshLlmProvider: 'openai', dshLlmModel: 'gpt-4.1' },
  }
  const groups = [
    { id: 'openai', models: [{ id: 'gpt-4.1' }, { id: 'gpt-4.1-mini' }] },
    { id: 'anthropic', models: [{ id: 'claude-sonnet' }] },
  ]
  assert.deepEqual(
    plugin.modelSelectionToApply('oac-alice', bots, groups),
    { provider: 'openai', model: 'gpt-4.1' },
  )
  assert.equal(
    plugin.modelSelectionToApply('oac-alice', { alice: { dshLlmProvider: 'openai', dshLlmModel: 'gone' } }, groups),
    undefined,
  )
  assert.equal(
    plugin.modelSelectionToApply('standard', bots, groups),
    undefined,
  )
  assert.equal(
    plugin.advertisedModelForBot({ dshLlmProvider: null, dshLlmModel: 'gpt-4.1' }, groups),
    undefined,
  )
})

test('slugFromPresetId only unwraps oac-* ids', () => {
  assert.equal(plugin.slugFromPresetId('oac-alice'), 'alice')
  assert.equal(plugin.slugFromPresetId('standard'), undefined)
  assert.equal(plugin.isOacPresetId('oac-'), false)
})
