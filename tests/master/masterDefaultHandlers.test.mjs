import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createProviderPresenceStateStore } = require('../../dist/core/provider/providerPresenceState.js');

function createIdentity() {
  return {
    metabotId: 1,
    name: 'Provider Bot',
    createdAt: 1_775_000_000_000,
    path: "m/44'/10001'/0'/0/0",
    publicKey: 'pubkey',
    chatPublicKey: 'chat-pubkey',
    mvcAddress: 'mvc-provider-address',
    btcAddress: 'btc-provider-address',
    dogeAddress: 'doge-provider-address',
    metaId: 'metaid-provider',
    globalMetaId: 'idq1provider',
  };
}

function loadTemplateFixture() {
  return JSON.parse(
    readFileSync(
      path.resolve('templates/master-service/debug-master.template.json'),
      'utf8'
    )
  );
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

test('default master handlers publish a validated master-service and surface it in master.list', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-master-default-handlers-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(homeDir);
  await runtimeStateStore.writeState({
    identity: createIdentity(),
    services: [],
    traces: [],
  });
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-1',
    lastHeartbeatTxid: 'heartbeat-tx-1',
  });

  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    chainApiBaseUrl: 'https://chain.test',
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:25200' }),
    signer: {
      async writePin(input) {
        writes.push(input);
        return {
          txids: ['master-tx-1'],
          pinId: 'master-pin-1',
          totalCost: 1,
          network: 'mvc',
          operation: 'create',
          path: '/protocols/master-service',
          contentType: 'application/json',
          encoding: 'utf-8',
          globalMetaId: 'idq1provider',
          mvcAddress: 'mvc-provider-address',
        };
      },
    },
  });

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/chain\.test\/pin\/path\/list\?/);
    return jsonResponse({
      data: {
        list: [],
        nextCursor: null,
      },
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const published = await handlers.master.publish(loadTemplateFixture());
  assert.equal(published.ok, true);
  assert.equal(published.data.masterPinId, 'master-pin-1');
  assert.equal(published.data.displayName, 'Official Debug Master');
  assert.equal(published.data.online, true);
  assert.equal(published.data.providerDaemonBaseUrl, 'http://127.0.0.1:25200');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/protocols/master-service');

  const listed = await handlers.master.list({});
  assert.equal(listed.ok, true);
  assert.equal(listed.data.masters.length, 1);
  assert.equal(listed.data.masters[0].masterPinId, 'master-pin-1');
  assert.equal(listed.data.masters[0].displayName, 'Official Debug Master');
  assert.equal(listed.data.masters[0].online, true);
});
