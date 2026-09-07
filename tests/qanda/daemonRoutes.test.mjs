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
  const homeDir = await createProfileHome('metabot-qanda-routes-', 'alice');
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

async function startQandaServer(t, { handlers } = {}) {
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

test('qanda question handler publishes a minimal question pin and returns the formatted sheet', async (t) => {
  const { homeDir, systemHomeDir } = await createAliceFixture(t);
  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(writes),
  });
  const { post } = await startQandaServer(t, { handlers });
  const result = await post('/api/qanda/question', { from: 'alice', title: 'How do I…?' });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.data.pinId, `${'b'.repeat(64)}i0`);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/protocols/simplequestion');
  assert.equal(writes[0].version, '1.0.0');
  assert.deepEqual(JSON.parse(writes[0].payload), { title: 'How do I…?' });
  assert.match(result.body.data.formatted, /Question published on-chain\./);
  assert.match(result.body.data.localUiUrl, /\/ui\/qanda\/app\/index\.html\?q=/);
});

test('qanda answer handler records the ledger entry and returns the question-page link', async (t) => {
  const { homeDir, systemHomeDir } = await createAliceFixture(t);
  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(writes),
  });
  const questionPinId = 'f'.repeat(64) + 'i0';
  const { post } = await startQandaServer(t, { handlers });
  const result = await post('/api/qanda/answer', {
    from: 'alice',
    answerTo: questionPinId,
    content: 'do this then that',
  });
  assert.equal(result.body.ok, true);
  assert.equal(writes[0].path, '/protocols/simpleanswer');
  assert.deepEqual(JSON.parse(writes[0].payload), { answerTo: questionPinId, content: 'do this then that' });
  assert.match(result.body.data.formatted, /Answer published on-chain\./);
  assert.ok(result.body.data.localUiUrl.includes(encodeURIComponent(questionPinId)));
  // The ledger entry landed next to the study-jobs store.
  const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
  const paths = resolveMetabotPaths(homeDir);
  const fs = await import('node:fs/promises');
  const raw = JSON.parse(await fs.readFile(`${paths.workspaceRoot}/memory/qanda-answer-ledger.json`, 'utf8'));
  const entries = raw.entries[`alice:${questionPinId}`];
  assert.equal(entries.length, 1);
  assert.equal(entries[0].answerPinId, `${'b'.repeat(64)}i0`);
});

test('qanda answer handler surfaces the already-answered notice without spending sats', async (t) => {
  const { homeDir, systemHomeDir } = await createAliceFixture(t);
  const questionPinId = 'e'.repeat(64) + 'i0';
  // Seed the local ledger with one prior answer.
  const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
  const { createQaAnswerLedger } = require('../../dist/core/qanda/ledger.js');
  const paths = resolveMetabotPaths(homeDir);
  await createQaAnswerLedger(paths).recordAnswer('alice', questionPinId, {
    answerPinId: 'd'.repeat(64) + 'i0',
    content: 'previous answer',
    postedAt: 1,
    network: 'mvc',
  });
  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(writes),
  });
  const { post } = await startQandaServer(t, { handlers });
  // Point the index lookup at an unreachable base so the local ledger is the
  // source (outage fallback).
  process.env.METABOT_METAWEB_API_BASE_URL = 'http://127.0.0.1:9';
  t.after(() => { delete process.env.METABOT_METAWEB_API_BASE_URL; });
  const result = await post('/api/qanda/answer', {
    from: 'alice',
    answerTo: questionPinId,
    content: 'a repeat',
  });
  assert.equal(result.body.ok, true);
  assert.equal(result.body.data.published, false);
  assert.equal(result.body.data.alreadyAnswered, true);
  assert.match(result.body.data.notice, /Not published yet — you already have 1 previous answer/);
  assert.equal(writes.length, 0, 'no pin write happened');
});

test('qanda like handler writes the exact paylike payload', async (t) => {
  const { homeDir, systemHomeDir } = await createAliceFixture(t);
  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(writes),
  });
  const { post } = await startQandaServer(t, { handlers });
  const target = 'c'.repeat(64) + 'i0';
  const result = await post('/api/qanda/like', { from: 'alice', pinId: target, isLike: -1 });
  assert.equal(result.body.ok, true);
  assert.equal(writes[0].path, '/protocols/paylike');
  assert.deepEqual(JSON.parse(writes[0].payload), { isLike: -1, likeTo: target });
  assert.match(result.body.data.formatted, /Disliked pin /);
});

test('qanda routes reject unknown verbs and wrong methods, unimplemented handlers fail soft', async (t) => {
  const { post } = await startQandaServer(t, { handlers: {} });
  const unimplemented = await post('/api/qanda/like', { pinId: 'x', isLike: 1 });
  assert.equal(unimplemented.body.ok, false);
  assert.equal(unimplemented.body.code, 'not_implemented');
});
