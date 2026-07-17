import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  PERSONA_PRESET_CATALOG,
  PERSONA_PRESET_CATEGORIES,
} = require('../../dist/core/bot/personaPresets.js');

test('Persona preset catalog contains the 32 bilingual OAC presets', () => {
  assert.equal(PERSONA_PRESET_CATALOG.version, 1);
  assert.equal(PERSONA_PRESET_CATALOG.presets.length, 32);
  assert.deepEqual([...PERSONA_PRESET_CATEGORIES], [
    'relationship',
    'everyday',
    'learning',
    'creative',
    'professional',
  ]);

  const ids = new Set();
  const categoryCounts = new Map();
  for (const preset of PERSONA_PRESET_CATALOG.presets) {
    assert.equal(ids.has(preset.id), false, preset.id);
    ids.add(preset.id);
    assert.equal(preset.source, 'oac-original', preset.id);
    categoryCounts.set(preset.category, (categoryCounts.get(preset.category) ?? 0) + 1);

    for (const locale of ['en', 'zh-CN']) {
      const copy = preset.locales[locale];
      assert.ok(copy, `${preset.id}:${locale}`);
      for (const field of ['name', 'summary', 'role', 'soul', 'goal']) {
        assert.ok(copy[field].trim(), `${preset.id}:${locale}:${field}`);
      }
    }
  }

  assert.deepEqual(Object.fromEntries(categoryCounts), {
    relationship: 8,
    everyday: 6,
    learning: 6,
    creative: 6,
    professional: 6,
  });
});
