import assert from 'node:assert/strict'
import test from 'node:test'

const plugin = await import('../lib/index.js')

const NOW = 1_800_000_000_000 // fixed reference instant

test('relativeTimeLabel renders IDBots-style compact labels', () => {
  assert.equal(plugin.relativeTimeLabel(NOW - 30_000, NOW), 'now')
  assert.equal(plugin.relativeTimeLabel(NOW - 59_000, NOW), 'now')
  assert.equal(plugin.relativeTimeLabel(NOW - 60_000, NOW), '1m')
  assert.equal(plugin.relativeTimeLabel(NOW - 45 * 60_000, NOW), '45m')
  assert.equal(plugin.relativeTimeLabel(NOW - 60 * 60_000, NOW), '1h')
  assert.equal(plugin.relativeTimeLabel(NOW - 23 * 3_600_000, NOW), '23h')
  assert.equal(plugin.relativeTimeLabel(NOW - 24 * 3_600_000, NOW), '1d')
  assert.equal(plugin.relativeTimeLabel(NOW - 45 * 86_400_000, NOW), '45d')
})

test('relativeTimeLabel degrades invalid and future values safely', () => {
  assert.equal(plugin.relativeTimeLabel(0, NOW), '-')
  assert.equal(plugin.relativeTimeLabel(Number.NaN, NOW), '-')
  // slight clock skew into the future still reads as "now"
  assert.equal(plugin.relativeTimeLabel(NOW + 5_000, NOW), 'now')
})
