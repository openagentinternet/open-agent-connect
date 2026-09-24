import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { DICTIONARIES, createI18nContext } = require('../../dist/ui/i18n.js');

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EN = DICTIONARIES.en;
const EN_VALUES = new Set(Object.values(EN));

// The four pages paying down i18n debt plus the conversations page, which
// gained the group-task section in the same wave. Every user-facing English
// string on these pages must round-trip through src/ui/i18n.ts: server-rendered
// chrome uses i18n.t()/data-i18n-key, client-rendered copy uses uiText() (or
// the view models' injected translator) with a fallback that is byte-identical
// to the en dictionary value of its key.
const PAGE_SOURCES = [
  'src/ui/pages/bot/app.ts',
  'src/ui/pages/hub/app.ts',
  'src/ui/pages/hub/viewModel.ts',
  'src/ui/pages/publish/app.ts',
  'src/ui/pages/publish/viewModel.ts',
  'src/ui/pages/refund/app.ts',
  'src/ui/pages/conversations/app.ts',
];

const HTML_TEMPLATES = [
  'src/ui/pages/bot/index.html',
  'src/ui/pages/hub/index.html',
  'src/ui/pages/publish/index.html',
  'src/ui/pages/refund/index.html',
];

// The console pages whose <title> carries a dictionary key: the renderer tags
// `<title>` with `data-i18n-title="<key>"` and the shared client i18n script
// re-applies document.title on a live language switch.
const TITLE_KEY_PAGES = [
  ['kb', 'buildKbPageDefinition', 'kb.title'],
  ['surf', 'buildSurfPageDefinition', 'surf.title'],
  ['memory', 'buildMemoryPageDefinition', 'memory.title'],
  ['schedule', 'buildSchedulePageDefinition', 'schedule.title'],
  ['traffic', 'buildTrafficPageDefinition', 'traffic.title'],
];

// Non-copy literals that legitimately never enter the dictionary: brand and
// protocol proper nouns, currency/asset codes, enum-ish values mirrored from
// payloads, and structural single characters.
const ALLOWED_LITERALS = new Set([
  'MetaBot', 'MetaWeb', 'MetaID', 'MetaApp', 'MetaAPP', 'MetaFile',
  'GlobalMetaID', 'Twin Bot', 'Open Agent Connect', 'LLM', 'LLMs',
  'BTC', 'SPACE', 'DOGE', 'OPCAT', 'BTC-OPCAT', 'IMG', 'TXID', 'TxID',
  'text', 'image', 'video', 'audio', 'other', 'free', 'prepaid',
  'unknown', 'User', 'unspecified-capability', 'metaid://pending',
  'POST', 'GET', 'PUT', 'DELETE', 'application/json', 'json',
  'IBM Plex Mono,monospace',
]);

function unescapeJsString(raw) {
  return raw
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\');
}

function collectCallPairs(source, calleePattern) {
  const pairs = [];
  const callRegex = new RegExp(calleePattern + String.raw`\(\s*'([A-Za-z0-9.]+)'\s*,\s*'((?:[^'\\]|\\.)*)'`, 'g');
  let match;
  while ((match = callRegex.exec(source)) !== null) {
    pairs.push({ key: match[1], fallback: unescapeJsString(match[2]) });
  }
  return pairs;
}

test('i18n-debt pages keep every uiText fallback byte-identical to its en dictionary value', () => {
  for (const relative of PAGE_SOURCES) {
    const source = readFileSync(join(REPO_ROOT, relative), 'utf8');
    const pairs = [
      ...collectCallPairs(source, 'uiText'),
      ...collectCallPairs(source, '\\bt'),
    ];
    assert.ok(pairs.length > 0, `${relative} should route copy through uiText/t`);
    for (const { key, fallback } of pairs) {
      assert.ok(key in EN, `${relative}: key ${key} is missing from the en dictionary`);
      assert.equal(
        EN[key],
        fallback,
        `${relative}: fallback for ${key} must equal the en dictionary value`,
      );
    }
  }
});

test('i18n-debt pages keep every server-side i18n key and data-i18n-key in the dictionaries', () => {
  for (const relative of [...PAGE_SOURCES, ...HTML_TEMPLATES]) {
    const source = readFileSync(join(REPO_ROOT, relative), 'utf8');
    const seen = new Set();
    const keyRegex = /data-i18n-key="([A-Za-z0-9.]+)"/g;
    let match;
    while ((match = keyRegex.exec(source)) !== null) {
      if (seen.has(match[1])) continue;
      seen.add(match[1]);
      assert.ok(match[1] in EN, `${relative}: data-i18n-key ${match[1]} missing from the en dictionary`);
      assert.ok(match[1] in DICTIONARIES['zh-CN'], `${relative}: data-i18n-key ${match[1]} missing from the zh-CN dictionary`);
    }
  }
});

test('console pages expose the dictionary key behind their <title> in both languages', () => {
  for (const [page, builderName, key] of TITLE_KEY_PAGES) {
    const { [builderName]: build } = require(`../../dist/ui/pages/${page}/app.js`);
    const en = createI18nContext('en');
    const definition = build(en);

    assert.equal(definition.titleKey, key, `${page} should expose its title dictionary key`);
    assert.equal(definition.title, en.t(key), `${page} title should come from its dictionary key`);
    assert.ok(key in EN, `${key} should exist in the en dictionary`);
    assert.ok(key in DICTIONARIES['zh-CN'], `${key} should exist in the zh-CN dictionary`);
    assert.notEqual(
      createI18nContext('zh-CN').t(key),
      en.t(key),
      `${key} should be really localized, not a copy of the English title`,
    );

    // The key lives on the page definition, not in a per-page title script.
    const source = readFileSync(join(REPO_ROOT, `src/ui/pages/${page}/app.ts`), 'utf8');
    assert.match(
      source,
      new RegExp(`titleKey: '${key.replace(/[.]/g, '\\.')}'`),
      `${page}/app.ts should reserve ${key} for its title`,
    );
  }
});

test('i18n-debt pages expose no raw user-facing English literals outside the dictionary', () => {
  // Scan each page source for quoted literals that look like human copy
  // (letters plus a space, no code punctuation) and assert each one is either
  // an allowed proper noun/code or a value in the en dictionary.
  const literalRegex = /"((?:[^"\\]|\\.){2,})"|'((?:[^'\\]|\\.){2,})'/g;
  const CODE_FRAGMENT = /[/<>:={}$`()+&;]|\|\||&&|\?\s|\s\?|^[a-z]+[A-Z]|^[a-z][a-z0-9]*-|\s[-.]\s|^\s|\s$/;
  for (const relative of PAGE_SOURCES) {
    const source = readFileSync(join(REPO_ROOT, relative), 'utf8');
    let match;
    while ((match = literalRegex.exec(source)) !== null) {
      const raw = match[1] ?? match[2];
      const literal = unescapeJsString(raw);
      if (!/[A-Za-z]{2,}/.test(literal)) continue;
      if (!/[A-Z]/.test(literal) && !literal.includes(' ')) continue;
      if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9.]+)+$/.test(literal)) continue; // i18n key shapes
      if (/^[a-z0-9-]+( [a-z0-9-]+)+$/.test(literal)) continue; // CSS class lists
      if (EN_VALUES.has(literal) || ALLOWED_LITERALS.has(literal)) continue;
      if (CODE_FRAGMENT.test(literal)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      assert.fail(`${relative}:${line} uncovered user-facing literal: ${JSON.stringify(literal)}`);
    }
  }
});
