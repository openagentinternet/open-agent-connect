import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const {
  TrafficApiError,
  DEFAULT_TRAFFIC_API_BASE_URL,
} = require('../../dist/core/traffic/trafficAccountService.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');

const OWNER_IDENTITY = {
  version: 1,
  name: 'Owner',
  // Never used for signing: the traffic account service is faked in every test.
  mnemonic: 'test test test test test test test test test test test junk',
  path: "m/44'/10001'/0'/0/0",
  publicKey: 'owner-pubkey',
  chatPublicKey: 'owner-chat-pubkey',
  mvcAddress: 'mvc-owner-address',
  metaId: 'metaid-owner',
  globalMetaId: 'idq1owner',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function writeOwnerIdentity(systemHome) {
  const ownerDir = path.join(systemHome, '.metabot', 'owner');
  mkdirSync(ownerDir, { recursive: true });
  writeFileSync(path.join(ownerDir, 'identity.json'), `${JSON.stringify(OWNER_IDENTITY, null, 2)}\n`, 'utf8');
}

function createAccount(overrides = {}) {
  return {
    accountId: 'idq1owner',
    identityAddress: 'mvc-owner-address',
    balanceBytes: 10_000_000,
    reservedBytes: 0,
    grantedBytesTotal: 10_000_000,
    spentBytesTotal: 0,
    status: 1,
    ...overrides,
  };
}

function createFakeTrafficService(overrides = {}) {
  const calls = {
    ensureAccount: 0,
    bindAll: 0,
    balance: [],
    ledger: [],
    redeem: [],
    setSettings: [],
  };
  const account = createAccount();
  const service = {
    store: null,
    ensureTrafficAccount: async () => {
      calls.ensureAccount += 1;
      return account;
    },
    getLocalTrafficAccount: async () => account,
    bindAllLocalBots: async () => {
      calls.bindAll += 1;
      return {
        accountId: account.accountId,
        results: [{ botAddress: 'mvc-bot-1', status: 'bound' }],
        boundCount: 1,
        conflictCount: 0,
        failedCount: 0,
      };
    },
    getTrafficBalance: async (options) => {
      calls.balance.push(options);
      return account;
    },
    getTrafficLedger: async (input) => {
      calls.ledger.push(input);
      return {
        entries: [
          {
            id: 2,
            direction: 2,
            amountBytes: 1200,
            balanceAfter: 9_998_800,
            sourceType: 'sponsor_spend',
            sourceId: 'order-2',
            remark: '',
            timestamp: 1_775_000_100_000,
            txId: 'tx-2',
            botAddress: 'mvc-bot-1',
            kind: '/protocols/simplemsg',
          },
          {
            id: 1,
            direction: 1,
            amountBytes: 10_000_000,
            balanceAfter: 10_000_000,
            sourceType: 'free_grant',
            sourceId: 'grant-1',
            remark: '',
            timestamp: 1_775_000_000_000,
          },
        ],
        nextCursor: 42,
      };
    },
    getTrafficDailyUsage: async () => [],
    getTrafficDailyUsageWithFallback: async () => ({
      rows: [{ date: '2026-09-03', botAddress: 'mvc-bot-1', bytes: 1200, txCount: 1 }],
      source: 'remote',
      error: '',
    }),
    getTrafficUsageSummary: async () => ({ todayBytes: 1200, weekBytes: 5000, monthBytes: 8000 }),
    getTrafficPricing: async () => [],
    createRechargeOrder: async () => { throw new Error('not used'); },
    getRechargeOrder: async () => { throw new Error('not used'); },
    mockConfirmRechargeOrder: async () => { throw new Error('not used'); },
    getFreeGrantCampaignStatus: async () => ({ enabled: true, grantBytes: 10_000_000, claimed: false, claimable: true }),
    claimFreeGrant: async () => ({ grantId: 7, grantBytes: 10_000_000, balanceAfter: 20_000_000 }),
    redeemTrafficCode: async (code) => {
      calls.redeem.push(code);
      return { codeId: 3, trafficBytes: 5_000_000, balanceAfter: 15_000_000 };
    },
    getTrafficPinMode: async () => 'traffic',
    getTrafficSettingsSnapshot: async () => ({ mode: 'traffic', fallbackPolicy: 'selfpay', apiBase: '' }),
    setTrafficSettingsSnapshot: async (input) => {
      calls.setSettings.push(input);
      return { mode: input.mode ?? 'traffic', fallbackPolicy: 'selfpay', apiBase: input.apiBase ?? '' };
    },
    getConfiguredTrafficApiBase: async () => undefined,
    recordLocalTrafficSpend: async () => {},
    listLocalTrafficJournal: async () => [],
    resolveSponsorTrafficAccount: async () => undefined,
    ...overrides,
  };
  return { service, calls };
}

async function startTrafficServer({ service, withOwnerIdentity = false, withBotProfile = false } = {}) {
  const homeDir = await createProfileHome('metabot-traffic-routes-');
  const systemHome = deriveSystemHome(homeDir);
  if (withOwnerIdentity) {
    writeOwnerIdentity(systemHome);
  }
  if (withBotProfile) {
    await upsertIdentityProfile({
      systemHomeDir: systemHome,
      name: 'Alice Bot',
      homeDir: path.join(systemHome, '.metabot', 'profiles', 'alice-bot'),
      globalMetaId: 'idq1alice',
      mvcAddress: 'mvc-bot-1',
    });
  }
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir: systemHome,
    getDaemonRecord: () => null,
    trafficAccountService: service,
  });
  const server = createHttpServer(handlers);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP traffic route server');
  }
  return {
    homeDir,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await cleanupProfileHome(homeDir);
    },
  };
}

async function postTraffic(baseUrl, verb, body = {}) {
  const response = await fetch(`${baseUrl}/api/traffic/${verb}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

test('POST /api/traffic/status returns null sections when no owner identity exists', async (t) => {
  const { service, calls } = createFakeTrafficService();
  const app = await startTrafficServer({ service });
  t.after(async () => app.close());

  const response = await postTraffic(app.baseUrl, 'status');

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.deepEqual(response.payload.data, {
    mode: 'traffic',
    apiBase: '',
    account: null,
    freeGrant: null,
    featureUnavailable: false,
    identity: null,
  });
  assert.equal(calls.ensureAccount, 0);
});

test('POST /api/traffic/status lazily ensures the account when an owner identity exists', async (t) => {
  const { service, calls } = createFakeTrafficService();
  const app = await startTrafficServer({ service, withOwnerIdentity: true });
  t.after(async () => app.close());

  const response = await postTraffic(app.baseUrl, 'status');

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.deepEqual(response.payload.data.identity, {
    name: 'Owner',
    globalMetaId: 'idq1owner',
    mvcAddress: 'mvc-owner-address',
  });
  assert.equal(response.payload.data.account.accountId, 'idq1owner');
  assert.equal(response.payload.data.account.balanceBytes, 10_000_000);
  assert.deepEqual(response.payload.data.freeGrant, {
    enabled: true,
    grantBytes: 10_000_000,
    claimed: false,
    claimable: true,
  });
  assert.equal(response.payload.data.featureUnavailable, false);
  assert.equal(calls.ensureAccount, 1);
});

test('POST /api/traffic/status soft-degrades to featureUnavailable on a backend 404', async (t) => {
  const { service } = createFakeTrafficService({
    ensureTrafficAccount: async () => {
      throw new TrafficApiError({ stage: 'account', message: 'Not found.', status: 404, featureUnavailable: true });
    },
  });
  const app = await startTrafficServer({ service, withOwnerIdentity: true });
  t.after(async () => app.close());

  const response = await postTraffic(app.baseUrl, 'status');

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.data.account, null);
  assert.equal(response.payload.data.freeGrant, null);
  assert.equal(response.payload.data.featureUnavailable, true);
  assert.equal(response.payload.data.identity.mvcAddress, 'mvc-owner-address');
});

test('POST /api/traffic/mode reads the current mode and switches with a bindSummary', async (t) => {
  const { service, calls } = createFakeTrafficService();
  const app = await startTrafficServer({ service });
  t.after(async () => app.close());

  const getResponse = await postTraffic(app.baseUrl, 'mode');
  assert.equal(getResponse.payload.ok, true);
  assert.deepEqual(getResponse.payload.data, { mode: 'traffic' });
  assert.equal(calls.bindAll, 0);

  const setTraffic = await postTraffic(app.baseUrl, 'mode', { mode: 'traffic' });
  assert.equal(setTraffic.payload.ok, true);
  assert.equal(setTraffic.payload.data.mode, 'traffic');
  assert.deepEqual(calls.setSettings, [{ mode: 'traffic' }]);
  assert.equal(calls.bindAll, 1);
  assert.deepEqual(setTraffic.payload.data.bindSummary, {
    accountId: 'idq1owner',
    results: [{ botAddress: 'mvc-bot-1', status: 'bound' }],
    boundCount: 1,
    conflictCount: 0,
    failedCount: 0,
  });

  const setSelfpay = await postTraffic(app.baseUrl, 'mode', { mode: 'selfpay' });
  assert.equal(setSelfpay.payload.ok, true);
  assert.deepEqual(setSelfpay.payload.data, { mode: 'selfpay' });
  assert.equal(calls.bindAll, 1);
});

test('POST /api/traffic/mode rejects unknown mode values without touching settings', async (t) => {
  const { service, calls } = createFakeTrafficService();
  const app = await startTrafficServer({ service });
  t.after(async () => app.close());

  const response = await postTraffic(app.baseUrl, 'mode', { mode: 'bogus' });

  assert.equal(response.status, 400);
  assert.equal(response.payload.ok, false);
  assert.equal(response.payload.code, 'invalid_argument');
  assert.deepEqual(calls.setSettings, []);
  assert.equal(calls.bindAll, 0);
});

test('POST /api/traffic/balance force-refreshes and soft-degrades on 404', async (t) => {
  const { service, calls } = createFakeTrafficService();
  const app = await startTrafficServer({ service });
  t.after(async () => app.close());

  const okResponse = await postTraffic(app.baseUrl, 'balance');
  assert.equal(okResponse.payload.ok, true);
  assert.equal(okResponse.payload.data.account.accountId, 'idq1owner');
  assert.equal(okResponse.payload.data.featureUnavailable, false);
  assert.deepEqual(calls.balance, [{ forceRefresh: true }]);

  const unavailable = createFakeTrafficService({
    getTrafficBalance: async () => {
      throw new TrafficApiError({ stage: 'balance', message: 'Not found.', status: 404, featureUnavailable: true });
    },
  });
  const downApp = await startTrafficServer({ service: unavailable.service });
  t.after(async () => downApp.close());

  const softResponse = await postTraffic(downApp.baseUrl, 'balance');
  assert.equal(softResponse.status, 200);
  assert.deepEqual(softResponse.payload.data, { account: null, featureUnavailable: true });
});

test('POST /api/traffic/ledger passes cursor/limit through and enriches botName', async (t) => {
  const { service, calls } = createFakeTrafficService();
  const app = await startTrafficServer({ service, withBotProfile: true });
  t.after(async () => app.close());

  const response = await postTraffic(app.baseUrl, 'ledger', { cursor: '5', limit: 10 });

  assert.equal(response.payload.ok, true);
  assert.deepEqual(calls.ledger, [{ cursor: 5, limit: 10 }]);
  const [spend, grant] = response.payload.data.entries;
  assert.equal(spend.botAddress, 'mvc-bot-1');
  assert.equal(spend.botName, 'Alice Bot');
  assert.equal(spend.txId, 'tx-2');
  assert.equal(spend.kind, '/protocols/simplemsg');
  assert.equal(grant.sourceType, 'free_grant');
  assert.equal('botName' in grant, false);
  assert.equal(response.payload.data.nextCursor, '42');
});

test('POST /api/traffic/ledger defaults limit to 20 and maps nextCursor 0 to null', async (t) => {
  const { service, calls } = createFakeTrafficService({
    getTrafficLedger: async (input) => {
      calls.ledger.push(input);
      return { entries: [], nextCursor: 0 };
    },
  });
  const app = await startTrafficServer({ service });
  t.after(async () => app.close());

  const response = await postTraffic(app.baseUrl, 'ledger');

  assert.equal(response.payload.ok, true);
  assert.deepEqual(calls.ledger, [{ limit: 20 }]);
  assert.deepEqual(response.payload.data, { entries: [], nextCursor: null });
});

test('POST /api/traffic/ledger soft-degrades on a backend 404', async (t) => {
  const { service } = createFakeTrafficService({
    getTrafficLedger: async () => {
      throw new TrafficApiError({ stage: 'ledger', message: 'Not found.', status: 404, featureUnavailable: true });
    },
  });
  const app = await startTrafficServer({ service });
  t.after(async () => app.close());

  const response = await postTraffic(app.baseUrl, 'ledger');

  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.data, { entries: [], nextCursor: null, featureUnavailable: true });
});

test('POST /api/traffic/usage reports source service when the API answers', async (t) => {
  const { service } = createFakeTrafficService();
  const app = await startTrafficServer({ service, withBotProfile: true });
  t.after(async () => app.close());

  const response = await postTraffic(app.baseUrl, 'usage');

  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.data.source, 'service');
  assert.deepEqual(response.payload.data.summary, { todayBytes: 1200, weekBytes: 5000, monthBytes: 8000 });
  assert.deepEqual(response.payload.data.daily, [
    { date: '2026-09-03', botAddress: 'mvc-bot-1', botName: 'Alice Bot', bytes: 1200, txCount: 1 },
  ]);
});

test('POST /api/traffic/usage falls back to local journal rows and then to unavailable', async (t) => {
  const local = createFakeTrafficService({
    getTrafficUsageSummary: async () => {
      throw new TrafficApiError({ stage: 'usage', message: 'boom', status: 500 });
    },
    getTrafficDailyUsageWithFallback: async () => ({
      rows: [{ date: '2026-09-03', botAddress: 'mvc-bot-1', bytes: 640, txCount: 2 }],
      source: 'local',
      error: 'boom',
    }),
  });
  const localApp = await startTrafficServer({ service: local.service });
  t.after(async () => localApp.close());

  const localResponse = await postTraffic(localApp.baseUrl, 'usage');
  assert.equal(localResponse.payload.ok, true);
  assert.equal(localResponse.payload.data.source, 'local');
  assert.equal(localResponse.payload.data.summary, null);
  assert.equal(localResponse.payload.data.daily.length, 1);

  const unavailable = createFakeTrafficService({
    getTrafficUsageSummary: async () => {
      throw new TrafficApiError({ stage: 'usage', message: 'Not found.', status: 404, featureUnavailable: true });
    },
    getTrafficDailyUsageWithFallback: async () => ({ rows: [], source: 'local', error: 'Not found.' }),
  });
  const emptyApp = await startTrafficServer({ service: unavailable.service });
  t.after(async () => emptyApp.close());

  const emptyResponse = await postTraffic(emptyApp.baseUrl, 'usage');
  assert.equal(emptyResponse.payload.ok, true);
  assert.equal(emptyResponse.payload.data.source, 'unavailable');
  assert.equal(emptyResponse.payload.data.summary, null);
  assert.deepEqual(emptyResponse.payload.data.daily, []);
  assert.equal(emptyResponse.payload.data.featureUnavailable, true);
});

test('POST /api/traffic/claim returns grant fields and maps campaign errors with errorCode', async (t) => {
  const { service } = createFakeTrafficService();
  const app = await startTrafficServer({ service });
  t.after(async () => app.close());

  const okResponse = await postTraffic(app.baseUrl, 'claim');
  assert.equal(okResponse.payload.ok, true);
  assert.deepEqual(okResponse.payload.data, {
    grantId: '7',
    grantBytes: 10_000_000,
    balanceAfter: 20_000_000,
  });

  const failing = createFakeTrafficService({
    claimFreeGrant: async () => {
      throw new TrafficApiError({ stage: 'campaign', message: 'Already claimed.', errorCode: 'ALREADY_CLAIMED' });
    },
  });
  const failingApp = await startTrafficServer({ service: failing.service });
  t.after(async () => failingApp.close());

  const failedResponse = await postTraffic(failingApp.baseUrl, 'claim');
  assert.equal(failedResponse.status, 400);
  assert.equal(failedResponse.payload.ok, false);
  assert.equal(failedResponse.payload.code, 'traffic_campaign_failed');
  assert.equal(failedResponse.payload.data.errorCode, 'ALREADY_CLAIMED');
  assert.equal(failedResponse.payload.data.featureUnavailable, false);
});

test('POST /api/traffic/redeem validates the code and passes redeem errors through', async (t) => {
  const { service, calls } = createFakeTrafficService();
  const app = await startTrafficServer({ service });
  t.after(async () => app.close());

  const okResponse = await postTraffic(app.baseUrl, 'redeem', { code: 'IDB-AAAA-BBBB-CCCC' });
  assert.equal(okResponse.payload.ok, true);
  assert.deepEqual(okResponse.payload.data, { codeId: 3, trafficBytes: 5_000_000, balanceAfter: 15_000_000 });
  assert.deepEqual(calls.redeem, ['IDB-AAAA-BBBB-CCCC']);

  const missingResponse = await postTraffic(app.baseUrl, 'redeem', {});
  assert.equal(missingResponse.status, 400);
  assert.equal(missingResponse.payload.code, 'missing_argument');
  assert.deepEqual(calls.redeem, ['IDB-AAAA-BBBB-CCCC']);

  const failing = createFakeTrafficService({
    redeemTrafficCode: async () => {
      throw new TrafficApiError({ stage: 'redeem', message: 'Code used.', status: 400, errorCode: 'CODE_USED' });
    },
  });
  const failingApp = await startTrafficServer({ service: failing.service });
  t.after(async () => failingApp.close());

  const usedResponse = await postTraffic(failingApp.baseUrl, 'redeem', { code: 'IDB-XXXX-YYYY-ZZZZ' });
  assert.equal(usedResponse.status, 400);
  assert.equal(usedResponse.payload.code, 'traffic_redeem_failed');
  assert.equal(usedResponse.payload.data.errorCode, 'CODE_USED');
  assert.equal(usedResponse.payload.data.featureUnavailable, false);
});

test('POST /api/traffic/api-base reads, validates, sets, and resets the override', async (t) => {
  const { service, calls } = createFakeTrafficService();
  const app = await startTrafficServer({ service });
  t.after(async () => app.close());

  const getResponse = await postTraffic(app.baseUrl, 'api-base');
  assert.equal(getResponse.payload.ok, true);
  assert.deepEqual(getResponse.payload.data, {
    apiBase: '',
    effectiveApiBase: DEFAULT_TRAFFIC_API_BASE_URL,
  });

  const setResponse = await postTraffic(app.baseUrl, 'api-base', { action: 'set', value: 'https://traffic.test/' });
  assert.equal(setResponse.payload.ok, true);
  assert.deepEqual(setResponse.payload.data, {
    apiBase: 'https://traffic.test',
    effectiveApiBase: 'https://traffic.test',
  });
  assert.deepEqual(calls.setSettings, [{ apiBase: 'https://traffic.test' }]);

  const invalidResponse = await postTraffic(app.baseUrl, 'api-base', { action: 'set', value: 'ftp://nope' });
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidResponse.payload.code, 'invalid_argument');
  assert.deepEqual(calls.setSettings, [{ apiBase: 'https://traffic.test' }]);

  const missingResponse = await postTraffic(app.baseUrl, 'api-base', { action: 'set' });
  assert.equal(missingResponse.status, 400);
  assert.equal(missingResponse.payload.code, 'missing_argument');

  const unknownResponse = await postTraffic(app.baseUrl, 'api-base', { action: 'bogus' });
  assert.equal(unknownResponse.status, 400);
  assert.equal(unknownResponse.payload.code, 'invalid_argument');

  const resetResponse = await postTraffic(app.baseUrl, 'api-base', { action: 'reset' });
  assert.equal(resetResponse.payload.ok, true);
  assert.deepEqual(resetResponse.payload.data, {
    apiBase: '',
    effectiveApiBase: DEFAULT_TRAFFIC_API_BASE_URL,
  });
  assert.deepEqual(calls.setSettings, [{ apiBase: 'https://traffic.test' }, { apiBase: '' }]);
});

test('traffic routes reject non-POST methods and unknown subpaths', async (t) => {
  const { service } = createFakeTrafficService();
  const app = await startTrafficServer({ service });
  t.after(async () => app.close());

  const getResponse = await fetch(`${app.baseUrl}/api/traffic/status`);
  assert.equal(getResponse.status, 405);
  const getPayload = await getResponse.json();
  assert.equal(getPayload.code, 'method_not_allowed');

  const unknownResponse = await fetch(`${app.baseUrl}/api/traffic/nope`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(unknownResponse.status, 404);
  const unknownPayload = await unknownResponse.json();
  assert.equal(unknownPayload.code, 'not_found');
});
