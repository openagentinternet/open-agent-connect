import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { QA_BEHAVIOR_RULE } = require('../../dist/core/qanda/behaviorPrompt.js');
const { METAWEB_URI_FULL_FORM_RULE } = require('../../dist/core/metaweb/uri.js');
const { METABOT_IDENTITY_ADHERENCE_LINE } = require('../../dist/core/prompt/metabotIdentity.js');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * dsh-plugin is a separate package and cannot import the core prompt
 * constants at runtime, so it keeps verbatim mirrors. This test is the drift
 * guard: the mirror strings must match the canonical core text exactly.
 * It parses the plugin's single-quoted string-array constants.
 */
function readStringArrayConstant(source, constName) {
  const marker = `const ${constName} = [`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${constName} not found`);
  const end = source.indexOf('].join(', start);
  assert.notEqual(end, -1, `${constName} array terminator not found`);
  const body = source.slice(start + marker.length, end);
  const lines = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith("'")) continue;
    const inner = line.endsWith("',") ? line.slice(1, -2) : line.endsWith("'") ? line.slice(1, -1) : null;
    assert.notEqual(inner, null, `unparseable line in ${constName}: ${line}`);
    lines.push(inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  }
  return lines.join('\n');
}

test('dsh-plugin QA behavior section mirrors the core QA_BEHAVIOR_RULE verbatim', () => {
  const source = readFileSync(path.join(repoRoot, 'dsh-plugin/src/qa-tools.ts'), 'utf8');
  const mirrored = readStringArrayConstant(source, 'QA_BEHAVIOR_SECTION_TEXT');
  assert.equal(mirrored, QA_BEHAVIOR_RULE);
});

test('dsh-plugin full-form URI section embeds the core METAWEB_URI_FULL_FORM_RULE verbatim', () => {
  const source = readFileSync(path.join(repoRoot, 'dsh-plugin/src/metaweb-tools.ts'), 'utf8');
  const mirrored = readStringArrayConstant(source, 'METAWEB_URI_FULLFORM_TEXT');
  assert.ok(
    mirrored.includes(METAWEB_URI_FULL_FORM_RULE),
    'METAWEB_URI_FULLFORM_TEXT must embed the canonical METAWEB_URI_FULL_FORM_RULE verbatim',
  );
});

test('dsh-plugin preset persona carries the shared identity adherence line verbatim', () => {
  const source = readFileSync(path.join(repoRoot, 'dsh-plugin/src/persona.ts'), 'utf8');
  assert.ok(
    source.includes(METABOT_IDENTITY_ADHERENCE_LINE),
    'dsh-plugin buildPersonaPrompt must carry METABOT_IDENTITY_ADHERENCE_LINE verbatim',
  );
});
