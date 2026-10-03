import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');
const { createUserDaemonHandlers } = require('../../dist/daemon/userHandlers.js');

/**
 * The /api/user/* owner-identity routes (additive next to the Bot-profile
 * /api/identity/* routes): dispatch + validation against stub handlers, the
 * local-daemon cross-site write boundary, and a real-handler round trip on a
 * scratch system home (never the developer's real ~/.metabot).
 */

async function startServer() {
  const calls = {
    who: [],
    create: [],
    import: [],
    rename: [],
    update: [],
    reveal: [],
    delete: [],
  };
  const server = createHttpServer({
    user: {
      who: async () => {
        calls.who.push({});
        return commandSuccess({ identity: null });
      },
      create: async (input) => {
        calls.create.push(input);
        return commandSuccess({ identity: { name: input.name }, mnemonic: 'w1 w2' });
      },
      import: async (input) => {
        calls.import.push(input);
        return commandSuccess({ identity: { name: input.name ?? '' }, mnemonic: input.mnemonic });
      },
      rename: async (input) => {
        calls.rename.push(input);
        return commandSuccess({ identity: { name: input.name } });
      },
      update: async (input) => {
        calls.update.push(input);
        return commandSuccess({ identity: { name: input.name ?? 'Alice' }, chainWrites: [], chainSync: { ok: true } });
      },
      reveal: async () => {
        calls.reveal.push({});
        return commandSuccess({ mnemonic: 'w1 w2' });
      },
      delete: async () => {
        calls.delete.push({});
        return commandSuccess({ deleted: true });
      },
    },
  });
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return {
    calls,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test('/api/user/who reads and the write verbs forward JSON bodies', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const who = await fetch(`${server.baseUrl}/api/user/who`);
  const whoPayload = await who.json();
  assert.equal(who.status, 200);
  assert.equal(whoPayload.ok, true);
  assert.deepEqual(server.calls.who, [{}]);

  const checks = [
    ['/api/user/create', 'create', { name: 'Alice' }],
    ['/api/user/import', 'import', { name: 'Alice', mnemonic: 'word1 word2', path: "m/44'/10001'/0'/0/0" }],
    ['/api/user/rename', 'rename', { name: 'Alice II' }],
    ['/api/user/update', 'update', { name: 'Alice II', avatarDataUrl: 'data:image/png;base64,AAAA' }],
    ['/api/user/reveal', 'reveal', {}],
    ['/api/user/delete', 'delete', {}],
  ];
  for (const [path, key, body] of checks) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, path);
    assert.equal(payload.ok, true, path);
    assert.deepEqual(server.calls[key], [body], path);
  }
});

test('/api/user write verbs validate required fields and methods', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const missingMnemonic = await fetch(`${server.baseUrl}/api/user/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Alice' }),
  });
  const mnemonicPayload = await missingMnemonic.json();
  assert.equal(missingMnemonic.status, 200);
  assert.equal(mnemonicPayload.ok, false);
  assert.equal(mnemonicPayload.code, 'missing_mnemonic');
  assert.deepEqual(server.calls.import, []);

  const missingName = await fetch(`${server.baseUrl}/api/user/rename`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const namePayload = await missingName.json();
  assert.equal(namePayload.ok, false);
  assert.equal(namePayload.code, 'missing_name');
  assert.deepEqual(server.calls.rename, []);

  const emptyUpdate = await fetch(`${server.baseUrl}/api/user/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const updatePayload = await emptyUpdate.json();
  assert.equal(updatePayload.ok, false);
  assert.equal(updatePayload.code, 'missing_update');
  assert.deepEqual(server.calls.update, []);

  const wrongMethod = await fetch(`${server.baseUrl}/api/user/create?name=Alice`, { method: 'GET' });
  const wrongPayload = await wrongMethod.json();
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongPayload.code, 'method_not_allowed');
  assert.deepEqual(server.calls.create, []);

  const whoMethod = await fetch(`${server.baseUrl}/api/user/who`, { method: 'POST' });
  assert.equal(whoMethod.status, 405);
});

test('local daemon boundary rejects cross-site POSTs to /api/user/delete before handlers run', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/user/delete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://attacker.example',
    },
    body: JSON.stringify({}),
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.code, 'forbidden_origin');
  assert.deepEqual(server.calls.delete, []);
});

test('user daemon handlers run a full owner round trip on a scratch system home', async (t) => {
  const systemHomeDir = await mkdtempTempRoot('oac-user-handlers-');
  const group = createUserDaemonHandlers({ systemHomeDir });

  const whoBefore = await group.who();
  assert.equal(whoBefore.ok, true);
  assert.equal(whoBefore.data.identity, null);

  const created = await group.create({ name: 'Alice' });
  assert.equal(created.ok, true);
  assert.equal(created.data.identity.name, 'Alice');
  assert.ok(typeof created.data.mnemonic === 'string' && created.data.mnemonic.split(' ').length >= 12);
  assert.equal(created.data.identity.mnemonic, undefined, 'public identity never carries the mnemonic');

  // Creating over an existing identity fails like the CLI verb.
  const duplicate = await group.create({ name: 'Bob' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'owner_exists');

  const whoAfter = await group.who();
  assert.equal(whoAfter.data.identity.name, 'Alice');
  assert.ok(whoAfter.data.identity.globalMetaId);

  const renamed = await group.rename({ name: 'Alice II' });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.data.identity.name, 'Alice II');

  const emptyRename = await group.rename({});
  assert.equal(emptyRename.ok, false);
  assert.equal(emptyRename.code, 'missing_name');

  const revealed = await group.reveal();
  assert.equal(revealed.ok, true);
  assert.equal(revealed.data.mnemonic, created.data.mnemonic);

  const deleted = await group.delete();
  assert.equal(deleted.ok, true);
  const whoFinal = await group.who();
  assert.equal(whoFinal.data.identity, null);

  // Import path: a garbage mnemonic fails with the BIP39 validation error.
  const badImport = await group.import({ name: 'Carol', mnemonic: 'not a mnemonic at all' });
  assert.equal(badImport.ok, false);
  assert.equal(badImport.code, 'invalid_mnemonic');
});

// 1x1 transparent PNG.
const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function makeRecordingSigner(writeCalls, { fail = false } = {}) {
  return () => ({
    writePin: async (input) => {
      writeCalls.push(input);
      if (fail) throw new Error('broadcast failed');
      return {
        txids: [`tx-${writeCalls.length}`],
        pinId: `pin-${writeCalls.length}`,
        totalCost: 1000,
        network: 'mvc',
        operation: 'create',
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding,
        globalMetaId: 'id-test',
        mvcAddress: 'mvc-test',
      };
    },
  });
}

test('user update publishes name and avatar on-chain before saving locally', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-user-update-');
  const writeCalls = [];
  const group = createUserDaemonHandlers({
    systemHomeDir,
    createSigner: makeRecordingSigner(writeCalls),
    chainWriteDelayMs: 0,
  });

  await group.create({ name: 'Alice' });
  const updated = await group.update({ name: 'Alicia', avatarDataUrl: TINY_PNG_DATA_URL });
  assert.equal(updated.ok, true);
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name', '/info/avatar']);
  assert.equal(writeCalls[0].payload, 'Alicia');
  assert.equal(writeCalls[1].contentType, 'image/png;binary');
  assert.ok(Buffer.isBuffer(writeCalls[1].payload));
  assert.equal(updated.data.chainWrites.length, 2);
  assert.deepEqual(updated.data.chainSync, { ok: true });
  assert.equal(updated.data.identity.name, 'Alicia');
  assert.equal(updated.data.identity.avatarDataUrl, TINY_PNG_DATA_URL);

  // The local record reflects the published profile.
  const who = await group.who();
  assert.equal(who.data.identity.name, 'Alicia');
  assert.equal(who.data.identity.avatarDataUrl, TINY_PNG_DATA_URL);

  // A no-change update is a no-op: no chain writes, still ok.
  const noop = await group.update({ name: 'Alicia', avatarDataUrl: TINY_PNG_DATA_URL });
  assert.equal(noop.ok, true);
  assert.equal(noop.data.chainWrites.length, 0);
  assert.equal(writeCalls.length, 2);

  // Clearing the avatar writes an empty /info/avatar pin and drops it locally.
  const cleared = await group.update({ avatarDataUrl: '' });
  assert.equal(cleared.ok, true);
  assert.equal(writeCalls.length, 3);
  assert.equal(writeCalls[2].path, '/info/avatar');
  assert.equal(writeCalls[2].payload, '');
  assert.equal(cleared.data.identity.avatarDataUrl, undefined);
});

test('user update fails chain-first: a failed publish leaves the local record untouched', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-user-update-fail-');
  const writeCalls = [];
  const group = createUserDaemonHandlers({
    systemHomeDir,
    createSigner: makeRecordingSigner(writeCalls, { fail: true }),
    chainWriteDelayMs: 0,
  });

  await group.create({ name: 'Alice' });
  const failed = await group.update({ name: 'Alicia' });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'chain_sync_failed');
  assert.equal(writeCalls.length, 1);

  const who = await group.who();
  assert.equal(who.data.identity.name, 'Alice', 'local name is unchanged when the chain write fails');
});

test('user update validates input and requires a configured signer', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-user-update-validation-');
  const group = createUserDaemonHandlers({ systemHomeDir });

  // No identity yet.
  const missing = await group.update({ name: 'Alice' });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'owner_missing');

  await group.create({ name: 'Alice' });

  const neither = await group.update({});
  assert.equal(neither.ok, false);
  assert.equal(neither.code, 'missing_update');

  const emptyName = await group.update({ name: '   ' });
  assert.equal(emptyName.ok, false);
  assert.equal(emptyName.code, 'missing_name');

  const badAvatar = await group.update({ avatarDataUrl: 'data:text/plain;base64,aGVsbG8=' });
  assert.equal(badAvatar.ok, false);
  assert.equal(badAvatar.code, 'invalid_avatar');

  // No adapters/createSigner configured: the publish cannot run.
  const noSigner = await group.update({ name: 'Alicia' });
  assert.equal(noSigner.ok, false);
  assert.equal(noSigner.code, 'chain_unavailable');

  const who = await group.who();
  assert.equal(who.data.identity.name, 'Alice');
});
