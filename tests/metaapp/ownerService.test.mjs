import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  listOwnerMetaApps,
  publishMetaAppPayload,
  updateMetaAppPayload,
  deleteMetaAppPin,
} = require('../../dist/core/metaapp/ownerService.js');

const PIN = 'f'.repeat(64) + 'i0';

function actor(overrides = {}) {
  const writes = [];
  return {
    ctx: {
      from: 'alice',
      homeDir: '/tmp/oac-owner-service',
      mvcAddress: '12ghVWG1yAgNjzXj4mr3qK9DgyornMUikZ',
      writePin: async (input) => {
        writes.push(input);
        return { pinId: PIN, txids: ['tx'], network: input.network ?? 'mvc' };
      },
      ...overrides,
    },
    writes,
  };
}

function payload(overrides = {}) {
  return {
    title: 'Demo App',
    appName: 'demo-app',
    icon: 'https://cdn.example/icon.png',
    coverImg: 'https://cdn.example/cover.png',
    introImgs: ['https://cdn.example/one.png'],
    runtime: ['browser'],
    contentType: 'application/zip',
    content: PIN,
    code: PIN,
    ...overrides,
  };
}

test('listOwnerMetaApps uses the actor MVC address and pagination', async () => {
  const calls = [];
  const { ctx } = actor();
  const result = await listOwnerMetaApps(ctx, {
    cursor: 'cursor-1',
    size: 12,
    manClient: {
      listByAddress: async (input) => {
        calls.push(input);
        return { records: [], nextCursor: 'cursor-2' };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ address: ctx.mvcAddress, cursor: 'cursor-1', size: 12 }]);
  assert.equal(result.data.nextCursor, 'cursor-2');
});

test('publishMetaAppPayload writes create /protocols/metaapp when confirmed', async () => {
  const { ctx, writes } = actor();
  const result = await publishMetaAppPayload(ctx, { ...payload(), confirm: true, network: 'mvc' });

  assert.equal(result.ok, true);
  assert.equal(writes[0].operation, 'create');
  assert.equal(writes[0].path, '/protocols/metaapp');
  assert.equal(writes[0].contentType, 'application/json');
  assert.equal(JSON.parse(writes[0].payload).icon, 'https://cdn.example/icon.png');
});

test('updateMetaAppPayload writes modify at target pin when confirmed', async () => {
  const { ctx, writes } = actor();
  const result = await updateMetaAppPayload(ctx, { ...payload(), targetPinId: PIN, confirm: true });

  assert.equal(result.ok, true);
  assert.equal(writes[0].operation, 'modify');
  assert.equal(writes[0].path, `@${PIN}`);
});

test('deleteMetaAppPin writes revoke at target pin when confirmed', async () => {
  const { ctx, writes } = actor();
  const result = await deleteMetaAppPin(ctx, { targetPinId: PIN, confirm: true });

  assert.equal(result.ok, true);
  assert.equal(writes[0].operation, 'revoke');
  assert.equal(writes[0].path, `@${PIN}`);
});

test('owner write helpers reject missing confirmation before chain writes', async () => {
  const { ctx, writes } = actor();
  const result = await publishMetaAppPayload(ctx, payload());

  assert.equal(result.ok, false);
  assert.equal(result.code, 'confirmation_required');
  assert.deepEqual(writes, []);
});
