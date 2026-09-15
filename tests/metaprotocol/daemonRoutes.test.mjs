import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');

const ALICE_MVC_ADDRESS = '16UjcYNBG9GTK4uq2f7yYEbuifqCzoLMGS';

function aliceIdentity() {
  return {
    metabotId: 1,
    name: 'alice',
    createdAt: 1_777_600_000_000,
    path: "m/44'/10001'/0'/0/0",
    publicKey: 'alice-public-key',
    chatPublicKey: 'alice-chat-public-key',
    addresses: { mvc: ALICE_MVC_ADDRESS },
    mvcAddress: ALICE_MVC_ADDRESS,
    metaId: 'metaid-alice',
    globalMetaId: 'idq1alice',
    subsidyState: 'claimed',
    syncState: 'synced',
  };
}

function fakeSigner(writes) {
  return {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async (input) => {
      writes.push(input);
      return {
        pinId: `${String.fromCharCode(97 + writes.length).repeat(64)}i0`,
        txids: ['tx-1'],
        totalCost: 432,
        network: input.network,
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: 'utf-8',
        globalMetaId: 'idq1alice',
        mvcAddress: ALICE_MVC_ADDRESS,
      };
    },
  };
}

async function createAliceFixture(t) {
  const homeDir = await createProfileHome('metabot-protocol-routes-', 'alice');
  const systemHomeDir = deriveSystemHome(homeDir);
  t.after(async () => cleanupProfileHome(homeDir));
  await upsertIdentityProfile({
    systemHomeDir,
    name: 'alice',
    homeDir,
    globalMetaId: 'idq1alice',
    mvcAddress: ALICE_MVC_ADDRESS,
  });
  await createRuntimeStateStore(homeDir).writeState({
    identity: aliceIdentity(),
    services: [],
    traces: [],
    sellerOrders: [],
  });
  return { homeDir, systemHomeDir };
}

async function startProtocolServer(t, { handlers } = {}) {
  const server = createHttpServer(handlers ?? {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const post = async (path, body) => {
    const response = await new Promise((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json' } },
        resolve,
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
    const text = await new Promise((resolve) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve(data));
    });
    return { status: response.statusCode, body: JSON.parse(text) };
  };
  return { post };
}

/** Swap globalThis.fetch so the daemon-side MetaSo/MANAPI prechecks hit the
 * fake index (the core client reads globalThis.fetch per call). */
function fakeSoIndex(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = await handler(String(url));
    return { status: 200, json: async () => body };
  };
  t.after(() => { globalThis.fetch = original; });
}

function registeredByAlice(overrides = {}) {
  return {
    protocolPath: '/protocols/simplebuzz',
    title: 'Simple Buzz',
    protocolName: 'SimpleBuzz',
    intro: '',
    version: '1.0.9',
    chainName: 'mvc',
    pinId: 'a'.repeat(64) + 'i0',
    currentPinId: 'a'.repeat(64) + 'i0',
    createdAt: 1757000000,
    updatedAt: 1757000000,
    confirmed: true,
    author: { address: ALICE_MVC_ADDRESS, metaid: 'metaid-alice', globalMetaId: 'idq1alice', name: 'alice' },
    conflictsCount: 0,
    payload: {
      title: 'Simple Buzz',
      path: '/protocols/simplebuzz',
      version: '1.0.9',
      authors: 'alice',
      intro: '',
      protocolName: 'SimpleBuzz',
      protocolAttachments: [],
      metadata: '',
      protocolContent: '{}',
      protocolContentType: 'application/json',
    },
    ...overrides,
  };
}

test('protocol publish handler publishes a schema-gated pin on the registry path', async (t) => {
  const { homeDir, systemHomeDir } = await createAliceFixture(t);
  const writes = [];
  fakeSoIndex(t, () => ({ code: 0, data: { path: '/protocols/myproto', available: true, existing: null } }));
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(writes),
  });
  const { post } = await startProtocolServer(t, { handlers });
  const result = await post('/api/protocol/publish', {
    from: 'alice',
    title: 'My Proto',
    protocolName: 'MyProto',
    intro: 'a test protocol',
    body: { flag: { value: true, description: 'the flag' } },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].operation, 'create');
  assert.equal(writes[0].path, '/protocols/metaprotocol');
  assert.equal(writes[0].version, '1.0.0');
  const payload = JSON.parse(writes[0].payload);
  assert.equal(payload.path, '/protocols/myproto');
  assert.equal(payload.version, '1.0.0');
  assert.equal(payload.authors, 'alice');
  assert.match(payload.protocolContent, /\/\*\* the flag \*\//);
  assert.match(result.body.data.formatted, /Protocol published on-chain: \/protocols\/myproto v1\.0\.0/);
});

test('protocol publish handler refuses an occupied path with the registrant info, never writing', async (t) => {
  const { homeDir, systemHomeDir } = await createAliceFixture(t);
  const writes = [];
  fakeSoIndex(t, (url) => {
    if (url.includes('/protocols/check')) {
      return { code: 0, data: { path: '/protocols/simplebuzz', available: false, existing: registeredByAlice({ author: { address: '16other', metaid: 'other', globalMetaId: 'idq1someoneelse', name: 'someoneelse' } }) } };
    }
    throw new Error('unexpected call');
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(writes),
  });
  const { post } = await startProtocolServer(t, { handlers });
  const result = await post('/api/protocol/publish', {
    from: 'alice',
    title: 'Simple Buzz Clone',
    protocolName: 'simplebuzz',
    protocolContent: '{ x: 1 }',
  });
  assert.equal(result.body.ok, false);
  assert.equal(result.body.code, 'protocol_path_taken');
  assert.match(result.body.message, /already registered by someoneelse/);
  assert.equal(writes.length, 0);
});

test('protocol publish handler refuses when registry and fallback are both down', async (t) => {
  const { homeDir, systemHomeDir } = await createAliceFixture(t);
  const writes = [];
  fakeSoIndex(t, () => Promise.reject(new Error('network down')));
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(writes),
  });
  const { post } = await startProtocolServer(t, { handlers });
  const result = await post('/api/protocol/publish', {
    from: 'alice',
    title: 'My Proto',
    protocolName: 'MyProto',
    protocolContent: '{ x: 1 }',
  });
  assert.equal(result.body.ok, false);
  assert.equal(result.body.code, 'protocol_path_taken');
  assert.match(result.body.message, /registry and fallback both failed/);
  assert.equal(writes.length, 0);
});

test('protocol publish handler rejects XOR-invalid and schema-invalid payloads pre-wallet', async (t) => {
  const { homeDir, systemHomeDir } = await createAliceFixture(t);
  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(writes),
  });
  const { post } = await startProtocolServer(t, { handlers });
  const xor = await post('/api/protocol/publish', { from: 'alice', title: 'T', protocolName: 'T' });
  assert.equal(xor.body.ok, false);
  assert.equal(xor.body.code, 'invalid_request');
  assert.match(xor.body.message, /exactly one of body/);

  // protocolName with an uppercase path-deriving failure hits the schema gate.
  const schemaFailure = await post('/api/protocol/publish', {
    from: 'alice',
    title: 'T',
    protocolName: 'My Proto',
    protocolContent: '{ x: 1 }',
  });
  assert.equal(schemaFailure.body.ok, false);
  assert.equal(schemaFailure.body.code, 'invalid_payload');
  assert.match(schemaFailure.body.message, /Invalid protocol payload/);
  assert.equal(writes.length, 0);
});

test('protocol update handler writes the modify pin only for the registrant', async (t) => {
  const { homeDir, systemHomeDir } = await createAliceFixture(t);
  const writes = [];
  fakeSoIndex(t, (url) => {
    if (url.includes('/protocols/detail')) {
      return { code: 0, data: { record: registeredByAlice(), versions: [], conflicts: [], invalidModifies: [] } };
    }
    throw new Error('unexpected call ' + url);
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(writes),
  });
  const { post } = await startProtocolServer(t, { handlers });
  const result = await post('/api/protocol/update', {
    from: 'alice',
    title: 'Simple Buzz',
    protocolName: 'SimpleBuzz',
    target: '/protocols/simplebuzz',
    protocolContent: '{ x: 2 }',
  });
  assert.equal(result.body.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].operation, 'modify');
  assert.equal(writes[0].path, '@' + 'a'.repeat(64) + 'i0');
  assert.equal(writes[0].version, '1.0.9');
  assert.equal(JSON.parse(writes[0].payload).version, '1.1.0');
  assert.match(result.body.data.formatted, /Protocol updated on-chain: \/protocols\/simplebuzz v1\.1\.0/);
});

test('protocol update handler refuses a non-registrant with the spec text', async (t) => {
  const { homeDir, systemHomeDir } = await createAliceFixture(t);
  const writes = [];
  fakeSoIndex(t, (url) => {
    if (url.includes('/protocols/detail')) {
      return { code: 0, data: { record: registeredByAlice({ author: { address: '16other', metaid: 'other', globalMetaId: 'idq1someoneelse', name: 'someoneelse' } }) } };
    }
    throw new Error('unexpected call ' + url);
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(writes),
  });
  const { post } = await startProtocolServer(t, { handlers });
  const result = await post('/api/protocol/update', {
    from: 'alice',
    title: 'Simple Buzz',
    protocolName: 'SimpleBuzz',
    target: '/protocols/simplebuzz',
    protocolContent: '{ x: 2 }',
  });
  assert.equal(result.body.ok, false);
  assert.equal(result.body.code, 'not_registrant');
  assert.match(result.body.message, /Only the original registrant can update/);
  assert.match(result.body.message, /registered by someoneelse/);
  assert.equal(writes.length, 0);
});

test('protocol update handler points an unregistered target at publish', async (t) => {
  const { homeDir, systemHomeDir } = await createAliceFixture(t);
  const writes = [];
  fakeSoIndex(t, () => ({ code: 40400, data: null, message: 'not found' }));
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(writes),
  });
  const { post } = await startProtocolServer(t, { handlers });
  const result = await post('/api/protocol/update', {
    from: 'alice',
    title: 'Ghost',
    protocolName: 'Ghost',
    target: '/protocols/ghost',
    protocolContent: '{ x: 1 }',
  });
  assert.equal(result.body.ok, false);
  assert.equal(result.body.code, 'protocol_not_found');
  assert.match(result.body.message, /Use action "publish" instead/);
  assert.equal(writes.length, 0);
});

test('protocol routes reject wrong methods and fail soft without handlers', async (t) => {
  const server = createHttpServer({});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const get = await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/api/protocol/publish', method: 'GET' }, resolve);
    req.on('error', reject);
    req.end();
  });
  assert.equal(get.statusCode, 405);

  const post = async (path, body) => {
    const response = await new Promise((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json' } },
        resolve,
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
    const text = await new Promise((resolve) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve(data));
    });
    return JSON.parse(text);
  };
  const unimplemented = await post('/api/protocol/publish', {});
  assert.equal(unimplemented.ok, false);
  assert.equal(unimplemented.code, 'not_implemented');
});
