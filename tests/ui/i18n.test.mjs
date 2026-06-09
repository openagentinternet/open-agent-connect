import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  DEFAULT_LANGUAGE_PREFERENCE,
  normalizeLanguagePreference,
  resolveConcreteLanguage,
} = require('../../dist/ui/i18n.js');

test('i18n resolver maps Simplified Chinese locales to zh-CN and all others to en', () => {
  assert.equal(DEFAULT_LANGUAGE_PREFERENCE, 'auto');
  assert.equal(normalizeLanguagePreference(undefined), 'auto');
  assert.equal(normalizeLanguagePreference(''), 'auto');
  assert.equal(normalizeLanguagePreference('de'), 'auto');
  assert.equal(normalizeLanguagePreference('zh-CN'), 'zh-CN');
  assert.equal(normalizeLanguagePreference('en'), 'en');

  assert.equal(resolveConcreteLanguage('auto', ['zh-CN']), 'zh-CN');
  assert.equal(resolveConcreteLanguage('auto', ['zh-Hans']), 'zh-CN');
  assert.equal(resolveConcreteLanguage('auto', ['zh-SG']), 'zh-CN');
  assert.equal(resolveConcreteLanguage('auto', ['zh-TW']), 'en');
  assert.equal(resolveConcreteLanguage('auto', ['zh-HK']), 'en');
  assert.equal(resolveConcreteLanguage('auto', ['zh-MO']), 'en');
  assert.equal(resolveConcreteLanguage('auto', ['fr-FR']), 'en');
  assert.equal(resolveConcreteLanguage('auto', []), 'en');

  assert.equal(resolveConcreteLanguage('zh-CN', ['en-US']), 'zh-CN');
  assert.equal(resolveConcreteLanguage('en', ['zh-CN']), 'en');
});
