import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildOwnerProfileChainWrites,
  writeOwnerProfileChainRequests,
  OWNER_NAME_CHAIN_PATH,
} = require('../../dist/core/owner/ownerProfilePublish.js');

// 1x1 transparent PNG.
const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('buildOwnerProfileChainWrites maps the name change to /info/name', () => {
  const requests = buildOwnerProfileChainWrites({ name: 'Alice' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, OWNER_NAME_CHAIN_PATH);
  assert.equal(requests[0].operation, 'create');
  assert.equal(requests[0].contentType, 'text/plain');
  assert.equal(requests[0].payload, 'Alice');
  assert.equal(requests[0].encoding, 'utf-8');
  assert.equal(requests[0].network, 'mvc');
});

test('buildOwnerProfileChainWrites maps the avatar change to a binary /info/avatar write', () => {
  const requests = buildOwnerProfileChainWrites({ avatarDataUrl: TINY_PNG_DATA_URL });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/info/avatar');
  assert.equal(requests[0].contentType, 'image/png;binary');
  assert.equal(requests[0].encoding, 'binary');
  assert.ok(Buffer.isBuffer(requests[0].payload));
  assert.ok(requests[0].payload.length > 0);
});

test('buildOwnerProfileChainWrites clears the avatar with an empty text write', () => {
  const requests = buildOwnerProfileChainWrites({ avatarDataUrl: '' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/info/avatar');
  assert.equal(requests[0].contentType, 'text/plain');
  assert.equal(requests[0].payload, '');
});

test('buildOwnerProfileChainWrites combines name and avatar, skipping blanks', () => {
  const both = buildOwnerProfileChainWrites({ name: 'Alice', avatarDataUrl: TINY_PNG_DATA_URL });
  assert.deepEqual(both.map((request) => request.path), ['/info/name', '/info/avatar']);
  assert.deepEqual(buildOwnerProfileChainWrites({}), []);
  assert.deepEqual(buildOwnerProfileChainWrites({ name: '   ' }), []);
});

test('writeOwnerProfileChainRequests writes sequentially through the signer', async () => {
  const calls = [];
  const signer = {
    writePin: async (input) => {
      calls.push(input);
      return { txids: [`tx-${calls.length}`], pinId: `pin-${calls.length}`, path: input.path };
    },
  };
  const requests = buildOwnerProfileChainWrites({ name: 'Alice', avatarDataUrl: TINY_PNG_DATA_URL });
  const results = await writeOwnerProfileChainRequests(signer, requests, { delayMs: 0 });
  assert.deepEqual(calls.map((call) => call.path), ['/info/name', '/info/avatar']);
  assert.deepEqual(results.map((result) => result.pinId), ['pin-1', 'pin-2']);
});

test('writeOwnerProfileChainRequests stops on the first failed write', async () => {
  const calls = [];
  const signer = {
    writePin: async (input) => {
      calls.push(input);
      throw new Error('broadcast failed');
    },
  };
  const requests = buildOwnerProfileChainWrites({ name: 'Alice', avatarDataUrl: TINY_PNG_DATA_URL });
  await assert.rejects(
    () => writeOwnerProfileChainRequests(signer, requests, { delayMs: 0 }),
    /broadcast failed/,
  );
  assert.equal(calls.length, 1);
});
