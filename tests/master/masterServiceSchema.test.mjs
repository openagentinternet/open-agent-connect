import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { validateMasterServicePayload } = require('../../dist/core/master/masterServiceSchema.js');

function loadTemplateFixture() {
  return JSON.parse(
    readFileSync(
      path.resolve('templates/master-service/debug-master.template.json'),
      'utf8'
    )
  );
}

test('validateMasterServicePayload accepts the official debug master template', () => {
  const payload = loadTemplateFixture();
  const result = validateMasterServicePayload(payload);

  assert.equal(result.ok, true);
  assert.equal(result.value.serviceName, 'official-debug-master');
  assert.equal(result.value.masterKind, 'debug');
  assert.deepEqual(result.value.hostModes, ['codex']);
  assert.equal(result.value.currency, 'SPACE');
  assert.equal(result.value.official, true);
});

test('validateMasterServicePayload rejects missing required fields', () => {
  const payload = loadTemplateFixture();
  delete payload.serviceName;

  const result = validateMasterServicePayload(payload);

  assert.equal(result.ok, false);
  assert.match(result.message, /serviceName/i);
});
