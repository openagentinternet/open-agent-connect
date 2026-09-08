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
const { createMetaAppWriteGuard } = require('../../dist/core/metaapp/writeGuard.js');

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
  assert.equal(result.data.firstPinId, PIN);
  assert.equal(writes[0].operation, 'create');
  assert.equal(writes[0].path, '/protocols/metaapp');
  assert.equal(writes[0].contentType, 'application/json');
  assert.equal(JSON.parse(writes[0].payload).icon, 'https://cdn.example/icon.png');
});

test('updateMetaAppPayload writes modify at target pin when confirmed', async () => {
  const updatedPin = `${'e'.repeat(64)}i0`;
  const writes = [];
  const { ctx } = actor({
    writePin: async (input) => {
      writes.push(input);
      return { pinId: updatedPin, firstPinId: PIN, txids: ['tx'], network: input.network ?? 'mvc' };
    },
  });
  const result = await updateMetaAppPayload(ctx, { ...payload(), targetPinId: PIN, confirm: true });

  assert.equal(result.ok, true);
  assert.equal(result.data.pinId, updatedPin);
  assert.equal(result.data.firstPinId, PIN);
  assert.equal(result.data.metaappUri, `metaapp://${PIN}`);
  assert.equal(result.data.metawebUrl, `https://openagentinternet.org/browser/metaapp/${PIN}`);
  assert.equal(writes[0].operation, 'modify');
  assert.equal(writes[0].path, `@${PIN}`);
});

test('deleteMetaAppPin writes revoke at target pin when confirmed', async () => {
  const { ctx, writes } = actor();
  const result = await deleteMetaAppPin(ctx, { targetPinId: PIN, confirm: true });

  assert.equal(result.ok, true);
  assert.equal(writes[0].operation, 'revoke');
  assert.equal(writes[0].path, `@${PIN}`);
  assert.equal(writes[0].contentType, 'application/json');
  assert.equal(writes[0].payload, '');
});

test('deleteMetaAppPin sends a chain-write-safe revoke payload', async () => {
  const writes = [];
  const { ctx } = actor({
    writePin: async (input) => {
      if (typeof input.payload !== 'string' && !Buffer.isBuffer(input.payload)) {
        throw new Error('Chain write payload must be a string or Buffer.');
      }
      writes.push(input);
      return { pinId: PIN, txids: ['tx'], network: input.network ?? 'mvc' };
    },
  });
  const result = await deleteMetaAppPin(ctx, { targetPinId: PIN, confirm: true });

  assert.equal(result.ok, true);
  assert.equal(writes[0].operation, 'revoke');
  assert.equal(writes[0].payload, '');
});

test('owner write helpers reject missing confirmation before chain writes', async () => {
  const { ctx, writes } = actor();
  const result = await publishMetaAppPayload(ctx, payload());

  assert.equal(result.ok, false);
  assert.equal(result.code, 'confirmation_required');
  assert.deepEqual(writes, []);
});

test('publishMetaAppPayload rejects chain writes without pinId after attempting one write', async () => {
  const writes = [];
  const { ctx } = actor({
    writePin: async (input) => {
      writes.push(input);
      return { txids: ['tx'], network: input.network ?? 'mvc' };
    },
  });

  await assert.rejects(
    () => publishMetaAppPayload(ctx, { ...payload(), confirm: true }),
    /MetaAPP chain write did not return pinId\./,
  );
  assert.equal(writes.length, 1);
});

test('deleteMetaAppPin rejects chain writes without pinId after attempting one write', async () => {
  const writes = [];
  const { ctx } = actor({
    writePin: async (input) => {
      writes.push(input);
      return { txids: ['tx'], network: input.network ?? 'mvc' };
    },
  });

  await assert.rejects(
    () => deleteMetaAppPin(ctx, { targetPinId: PIN, confirm: true }),
    /MetaAPP chain write did not return pinId\./,
  );
  assert.equal(writes.length, 1);
});

test('publishMetaAppPayload replays an identical confirmed write inside the idempotency window', async () => {
  const guard = createMetaAppWriteGuard();
  const { ctx, writes } = actor();
  const first = await publishMetaAppPayload(ctx, { ...payload(), confirm: true, network: 'mvc' }, guard);
  const second = await publishMetaAppPayload(ctx, { ...payload(), confirm: true, network: 'mvc' }, guard);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.data.idempotent, true);
  assert.equal(second.data.pinId, first.data.pinId);
  assert.equal(writes.length, 1);
});

test('publishMetaAppPayload without a guard writes every time (legacy callers)', async () => {
  const { ctx, writes } = actor();
  await publishMetaAppPayload(ctx, { ...payload(), confirm: true, network: 'mvc' });
  await publishMetaAppPayload(ctx, { ...payload(), confirm: true, network: 'mvc' });
  assert.equal(writes.length, 2);
});

test('updateMetaAppPayload serializes guarded writes on the same target pin', async () => {
  const guard = createMetaAppWriteGuard();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  const writes = [];
  const { ctx } = actor({
    writePin: async (input) => {
      const title = JSON.parse(input.payload).title;
      order.push(`start:${title}`);
      if (order.length === 1) await gate;
      order.push(`end:${title}`);
      writes.push(input);
      return { pinId: `${'e'.repeat(64)}i0`, firstPinId: PIN, txids: ['tx'], network: input.network ?? 'mvc' };
    },
  });
  const first = updateMetaAppPayload(ctx, { ...payload({ title: 'One' }), targetPinId: PIN, confirm: true }, guard);
  const second = updateMetaAppPayload(ctx, { ...payload({ title: 'Two' }), targetPinId: PIN, confirm: true }, guard);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, second]);

  assert.deepEqual(order, ['start:One', 'end:One', 'start:Two', 'end:Two']);
  assert.equal(writes.length, 2);
});

test('deleteMetaAppPin replays an identical revoke inside the idempotency window', async () => {
  const guard = createMetaAppWriteGuard();
  const { ctx, writes } = actor();
  const first = await deleteMetaAppPin(ctx, { targetPinId: PIN, confirm: true }, guard);
  const second = await deleteMetaAppPin(ctx, { targetPinId: PIN, confirm: true }, guard);

  assert.equal(first.ok, true);
  assert.equal(second.data.idempotent, true);
  assert.equal(second.data.revokedPinId, PIN);
  assert.equal(writes.length, 1);
});
