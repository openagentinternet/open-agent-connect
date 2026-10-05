import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createOwnerIdentity } = require('../../dist/core/owner/ownerIdentity.js');
const {
  OWNER_BINDING_ALGORITHM,
  OWNER_BINDING_PATH,
  buildOwnerBindingMessage,
  buildOwnerBindingPayload,
  parseOwnerBindingPayload,
  signOwnerBinding,
  verifyOwnerBinding,
} = require('../../dist/core/owner/ownerBinding.js');
const {
  convertToGlobalMetaId,
  decodeGlobalMetaIdPayload,
} = require('../../dist/core/identity/deriveIdentity.js');

// Any syntactically valid GlobalMetaID works for the binding message: verify
// only matches the signed statement against the expected Bot id.
const TEST_BOT_GLOBAL_META_ID = 'idq1testbot0000000000000000000000000000';

test('buildOwnerBindingMessage prefixes and lowercases the Bot GlobalMetaID', () => {
  assert.equal(
    buildOwnerBindingMessage('idQ1MIXEDcase'),
    'metabot-owner-binding:idq1mixedcase',
  );
  assert.equal(buildOwnerBindingMessage('  idq1x  '), 'metabot-owner-binding:idq1x');
});

test('owner binding payload round-trips through parse', () => {
  const payload = buildOwnerBindingPayload({
    ownerGlobalMetaId: 'IDQ1OWNER00000000000000000000000000000',
    ownerPublicKey: 'aabbcc',
    botGlobalMetaId: TEST_BOT_GLOBAL_META_ID,
    signature: 'sig',
  });
  const parsed = parseOwnerBindingPayload(payload);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.owner, 'idq1owner00000000000000000000000000000');
  assert.equal(parsed.ownerPublicKey, 'aabbcc');
  assert.equal(parsed.signedMessage, buildOwnerBindingMessage(TEST_BOT_GLOBAL_META_ID));
  assert.equal(parsed.signature, 'sig');
  assert.equal(parsed.algorithm, OWNER_BINDING_ALGORITHM);
  assert.equal(OWNER_BINDING_PATH, '/info/owner');

  assert.equal(parseOwnerBindingPayload('not json'), null);
  assert.equal(parseOwnerBindingPayload(null), null);
  assert.equal(parseOwnerBindingPayload(JSON.stringify({ version: 1 })), null);
});

test('signOwnerBinding + verifyOwnerBinding accept a genuine signature', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-binding-');
  const owner = await createOwnerIdentity(systemHomeDir, { name: 'Alice' });

  const signed = await signOwnerBinding(owner, TEST_BOT_GLOBAL_META_ID);
  assert.equal(signed.signedMessage, buildOwnerBindingMessage(TEST_BOT_GLOBAL_META_ID));
  assert.ok(signed.publicKey.length > 0);
  assert.ok(verifyOwnerBinding(signed.payload, TEST_BOT_GLOBAL_META_ID));

  // Wrong expected Bot id -> the signed statement no longer matches.
  assert.equal(verifyOwnerBinding(signed.payload, 'idq1someotherbot00000000000000000000'), false);
  // Tampered signature -> ECDSA verification fails.
  const tamperedSignature = JSON.parse(signed.payload);
  tamperedSignature.signature = Buffer.from('b'.repeat(65)).toString('base64');
  assert.equal(verifyOwnerBinding(JSON.stringify(tamperedSignature), TEST_BOT_GLOBAL_META_ID), false);
  // Foreign owner key -> hash160(publicKey) no longer matches the owner id.
  const foreignKey = JSON.parse(signed.payload);
  foreignKey.ownerPublicKey = 'ab'.repeat(33);
  assert.equal(verifyOwnerBinding(JSON.stringify(foreignKey), TEST_BOT_GLOBAL_META_ID), false);
  // Garbage input never throws.
  assert.equal(verifyOwnerBinding('garbage', TEST_BOT_GLOBAL_META_ID), false);
  assert.equal(verifyOwnerBinding(null, TEST_BOT_GLOBAL_META_ID), false);
});

test('decodeGlobalMetaIdPayload inverts convertToGlobalMetaId', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-decode-');
  const owner = await createOwnerIdentity(systemHomeDir, { name: 'Alice' });

  const globalMetaId = convertToGlobalMetaId(owner.mvcAddress);
  assert.equal(globalMetaId, owner.globalMetaId);

  const decoded = decodeGlobalMetaIdPayload(globalMetaId);
  assert.ok(decoded, 'expected a decoded id payload');
  assert.equal(decoded.version, 0);
  assert.equal(decoded.payload.length, 20);

  assert.equal(decodeGlobalMetaIdPayload('nope'), null);
  assert.equal(decodeGlobalMetaIdPayload('idq1short'), null);
  // Corrupt checksum in an otherwise well-formed id.
  const corrupted = globalMetaId.slice(0, -2) + (globalMetaId.endsWith('qq') ? 'pp' : 'qq');
  assert.equal(decodeGlobalMetaIdPayload(corrupted), null);
});
