import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createRatingDetailStateStore } = require('../../dist/core/ratings/ratingDetailState.js');
const { createSellerOrderRecord } = require('../../dist/core/orders/sellerOrderState.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');

function createIdentity(overrides = {}) {
  const slug = overrides.slug ?? 'alpha-bot';
  return {
    metabotId: overrides.metabotId ?? 1,
    name: overrides.name ?? 'Alpha Bot',
    createdAt: 1_775_000_000_000,
    path: "m/44'/10001'/0'/0/0",
    publicKey: `${slug}-public-key`,
    chatPublicKey: `${slug}-chat-public-key`,
    mvcAddress: `${slug}-mvc-address`,
    addresses: {
      mvc: `${slug}-mvc-address`,
      btc: `${slug}-btc-address`,
      doge: `${slug}-doge-address`,
      opcat: `${slug}-opcat-address`,
    },
    metaId: `${slug}-metaid`,
    globalMetaId: overrides.globalMetaId ?? `idq1${slug.replace(/-/gu, '')}`,
  };
}

function createService(overrides = {}) {
  const currentPinId = overrides.currentPinId ?? 'alpha-service-v2';
  const sourceServicePinId = overrides.sourceServicePinId ?? 'alpha-service-v1';
  return {
    id: sourceServicePinId,
    sourceServicePinId,
    currentPinId,
    chainPinIds: overrides.chainPinIds ?? [sourceServicePinId, currentPinId],
    creatorMetabotId: overrides.creatorMetabotId ?? 1,
    providerGlobalMetaId: overrides.providerGlobalMetaId ?? 'idq1alphabot',
    providerSkill: overrides.providerSkill ?? 'metabot-weather-oracle',
    serviceName: overrides.serviceName ?? 'weather-oracle',
    displayName: overrides.displayName ?? 'Weather Oracle',
    description: overrides.description ?? 'Returns a precise forecast.',
    serviceIcon: overrides.serviceIcon ?? null,
    price: overrides.price ?? '0.00003',
    currency: overrides.currency ?? 'SPACE',
    skillDocument: '',
    inputType: 'text',
    outputType: overrides.outputType ?? 'text',
    endpoint: 'simplemsg',
    paymentAddress: overrides.paymentAddress ?? 'alpha-bot-mvc-address',
    payloadJson: '{}',
    available: overrides.available ?? 1,
    revokedAt: overrides.revokedAt ?? null,
    updatedAt: overrides.updatedAt ?? 1_775_000_030_000,
  };
}

function createClosedOrder(overrides = {}) {
  const state = overrides.state ?? 'completed';
  return createSellerOrderRecord({
    id: overrides.id ?? `seller-order-${state}`,
    state,
    localMetabotId: overrides.localMetabotId ?? 1,
    localMetabotSlug: overrides.localMetabotSlug ?? 'alpha-bot',
    providerGlobalMetaId: overrides.providerGlobalMetaId ?? 'idq1alphabot',
    buyerGlobalMetaId: overrides.buyerGlobalMetaId ?? 'idq1buyer',
    servicePinId: overrides.servicePinId ?? 'alpha-service-v1',
    currentServicePinId: overrides.currentServicePinId ?? 'alpha-service-v2',
    serviceName: overrides.serviceName ?? 'Weather Oracle',
    providerSkill: overrides.providerSkill ?? 'metabot-weather-oracle',
    orderMessageId: overrides.orderMessageId ?? `order-message-${state}`,
    orderTxid: overrides.orderTxid ?? `${state}-order-txid`,
    paymentTxid: overrides.paymentTxid ?? `${state}-payment-txid`,
    paymentAmount: overrides.paymentAmount ?? '0.00003',
    paymentCurrency: overrides.paymentCurrency ?? 'SPACE',
    paymentChain: overrides.paymentChain ?? 'mvc',
    traceId: overrides.traceId ?? `trace-${state}`,
    a2aSessionId: overrides.a2aSessionId ?? `session-${state}`,
    runtimeId: overrides.runtimeId ?? 'runtime-codex',
    runtimeProvider: overrides.runtimeProvider ?? 'codex',
    llmSessionId: overrides.llmSessionId ?? `llm-${state}`,
    deliveredAt: overrides.deliveredAt,
    refundCompletedAt: overrides.refundCompletedAt,
    createdAt: overrides.createdAt ?? 1_775_000_040_000,
    updatedAt: overrides.updatedAt ?? 1_775_000_050_000,
  });
}

function createRuntime() {
  const now = '2026-05-13T00:00:00.000Z';
  return {
    id: 'runtime-codex',
    provider: 'codex',
    displayName: 'Codex',
    binaryPath: '/bin/codex',
    version: '1.0.0',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

async function prepareProviderRuntimeSkill(homeDir, skillName = 'metabot-weather-oracle') {
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [createRuntime()],
  });
  await createLlmBindingStore(homeDir).write({
    version: 1,
    bindings: [{
      id: 'binding-codex-primary',
      metaBotSlug: path.basename(homeDir),
      llmRuntimeId: 'runtime-codex',
      role: 'primary',
      priority: 0,
      enabled: true,
      createdAt: '2026-05-13T00:00:00.000Z',
      updatedAt: '2026-05-13T00:00:00.000Z',
    }],
  });
  await mkdir(path.join(homeDir, '.codex', 'skills', skillName), { recursive: true });
  await writeFile(path.join(homeDir, '.codex', 'skills', skillName, 'SKILL.md'), '# Weather Oracle\n', 'utf8');
}

async function startServer(handlers) {
  const server = createHttpServer(handlers);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function fetchJson(baseUrl, routePath, options = {}) {
  const response = await fetch(`${baseUrl}${routePath}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    payload: await response.json(),
  };
}

test('/api/services/my routes forward queries and mutation bodies', async (t) => {
  const calls = [];
  const app = await startServer({
    services: {
      listMyServices: async (input) => {
        calls.push(['list', input]);
        return commandSuccess({ page: input.page, pageSize: input.pageSize, refresh: input.refresh, items: [] });
      },
      listMyServiceOrders: async (input) => {
        calls.push(['orders', input]);
        return commandSuccess({ serviceId: input.serviceId, page: input.page, pageSize: input.pageSize, items: [] });
      },
      modifyMyService: async (input) => {
        calls.push(['modify', input]);
        return commandSuccess({ currentPinId: 'modified-pin' });
      },
      revokeMyService: async (input) => {
        calls.push(['revoke', input]);
        return commandSuccess({ revokedPinId: 'revoke-pin' });
      },
    },
  });
  t.after(async () => app.close());

  await fetchJson(app.baseUrl, '/api/services/my?page=2&pageSize=5&refresh=true');
  await fetchJson(app.baseUrl, '/api/services/my/orders?serviceId=alpha-service-v2&page=3&pageSize=4');
  await fetchJson(app.baseUrl, '/api/services/my/modify', {
    method: 'POST',
    body: { serviceId: 'alpha-service-v2', displayName: 'Updated' },
  });
  await fetchJson(app.baseUrl, '/api/services/my/revoke', {
    method: 'POST',
    body: { serviceId: 'alpha-service-v2' },
  });

  assert.deepEqual(calls, [
    ['list', { page: 2, pageSize: 5, refresh: true }],
    ['orders', { serviceId: 'alpha-service-v2', page: 3, pageSize: 4, refresh: false }],
    ['modify', { serviceId: 'alpha-service-v2', displayName: 'Updated' }],
    ['revoke', { serviceId: 'alpha-service-v2' }],
  ]);
});

test('default my-services handlers aggregate all local profiles and closed order details', async (t) => {
  const alphaHome = await createProfileHome('metabot-my-services-routes-', 'alpha-bot');
  t.after(async () => cleanupProfileHome(alphaHome));
  const systemHomeDir = deriveSystemHome(alphaHome);
  const betaHome = path.join(systemHomeDir, '.metabot', 'profiles', 'beta-bot');
  await mkdir(betaHome, { recursive: true });

  const alphaIdentity = createIdentity({ slug: 'alpha-bot', metabotId: 1, name: 'Alpha Bot', globalMetaId: 'idq1alphabot' });
  const betaIdentity = createIdentity({ slug: 'beta-bot', metabotId: 2, name: 'Beta Bot', globalMetaId: 'idq1betabot' });
  await upsertIdentityProfile({ systemHomeDir, name: alphaIdentity.name, homeDir: alphaHome, globalMetaId: alphaIdentity.globalMetaId, mvcAddress: alphaIdentity.mvcAddress });
  await upsertIdentityProfile({ systemHomeDir, name: betaIdentity.name, homeDir: betaHome, globalMetaId: betaIdentity.globalMetaId, mvcAddress: betaIdentity.mvcAddress });

  const alphaService = createService({ providerGlobalMetaId: alphaIdentity.globalMetaId });
  await createRuntimeStateStore(alphaHome).writeState({
    identity: alphaIdentity,
    services: [alphaService],
    traces: [],
    sellerOrders: [
      createClosedOrder({
        id: 'order-completed-1',
        paymentTxid: 'paid-alpha-1',
        deliveredAt: 1_775_000_060_000,
      }),
      createClosedOrder({
        id: 'order-refunded-1',
        state: 'refunded',
        paymentTxid: 'paid-alpha-refund',
        refundCompletedAt: 1_775_000_070_000,
      }),
      createClosedOrder({
        id: 'order-in-progress-hidden',
        state: 'in_progress',
        paymentTxid: 'paid-alpha-open',
      }),
    ],
  });
  await createRatingDetailStateStore(alphaHome).write({
    items: [{
      pinId: 'rating-pin-1',
      serviceId: 'alpha-service-v2',
      servicePaidTx: 'paid-alpha-1',
      rate: 5,
      comment: 'sharp result',
      raterGlobalMetaId: 'idq1buyer',
      raterMetaId: 'metaid-buyer',
      createdAt: 1_775_000_080_000,
    }],
    latestPinId: 'rating-pin-1',
    backfillCursor: null,
    lastSyncedAt: 1_775_000_080_000,
  });

  await createRuntimeStateStore(betaHome).writeState({
    identity: betaIdentity,
    services: [createService({
      sourceServicePinId: 'beta-service-v1',
      currentPinId: 'beta-service-v1',
      chainPinIds: ['beta-service-v1'],
      creatorMetabotId: 2,
      providerGlobalMetaId: betaIdentity.globalMetaId,
      serviceName: 'beta-code-review',
      displayName: 'Code Review',
      updatedAt: 1_775_000_090_000,
    })],
    traces: [],
    sellerOrders: [],
  });

  const app = await startServer(createDefaultMetabotDaemonHandlers({
    homeDir: alphaHome,
    systemHomeDir,
    chainApiBaseUrl: 'http://127.0.0.1:9',
    getDaemonRecord: () => null,
  }));
  t.after(async () => app.close());

  const list = await fetchJson(app.baseUrl, '/api/services/my?page=1&pageSize=10&refresh=false');
  assert.equal(list.status, 200);
  assert.equal(list.payload.ok, true);
  assert.equal(list.payload.data.items.length, 2);
  assert.equal(list.payload.data.items[0].currentPinId, 'beta-service-v1');
  const alpha = list.payload.data.items.find((item) => item.currentPinId === 'alpha-service-v2');
  assert.equal(alpha.creatorMetabotSlug, 'alpha-bot');
  assert.equal(alpha.successCount, 1);
  assert.equal(alpha.refundCount, 1);
  assert.equal(alpha.grossRevenue, '0.00006');
  assert.equal(alpha.netIncome, '0.00003');
  assert.equal(alpha.ratingAvg, 5);
  assert.equal(alpha.ratingCount, 1);

  const orders = await fetchJson(app.baseUrl, '/api/services/my/orders?serviceId=alpha-service-v2&page=1&pageSize=10&refresh=false');
  assert.equal(orders.payload.ok, true);
  assert.deepEqual(orders.payload.data.items.map((item) => item.id), ['order-refunded-1', 'order-completed-1']);
  assert.equal(orders.payload.data.items[1].rating.comment, 'sharp result');
  assert.equal(orders.payload.data.items[1].traceId, 'trace-completed');
});

test('default my-services modify writes a modify pin and updates local profile state', async (t) => {
  const homeDir = await createProfileHome('metabot-my-services-modify-', 'alpha-bot');
  t.after(async () => cleanupProfileHome(homeDir));
  const systemHomeDir = deriveSystemHome(homeDir);
  const identity = createIdentity({ slug: 'alpha-bot', metabotId: 1, name: 'Alpha Bot', globalMetaId: 'idq1alphabot' });
  await upsertIdentityProfile({ systemHomeDir, name: identity.name, homeDir, globalMetaId: identity.globalMetaId, mvcAddress: identity.mvcAddress });
  await createRuntimeStateStore(homeDir).writeState({
    identity,
    services: [createService({ providerGlobalMetaId: identity.globalMetaId })],
    traces: [],
    sellerOrders: [],
  });
  await prepareProviderRuntimeSkill(homeDir);

  const writes = [];
  const app = await startServer(createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: {
      async getIdentity() {
        return identity;
      },
      async writePin(input) {
        writes.push(input);
        return {
          txids: [`tx-${writes.length}`],
          pinId: `pin-${writes.length}`,
          totalCost: 10,
          network: input.network ?? 'mvc',
          operation: input.operation,
          path: input.path,
          contentType: input.contentType,
          encoding: input.encoding ?? 'utf-8',
          globalMetaId: identity.globalMetaId,
          mvcAddress: identity.mvcAddress,
        };
      },
    },
  }));
  t.after(async () => app.close());

  const response = await fetchJson(app.baseUrl, '/api/services/my/modify', {
    method: 'POST',
    body: {
      serviceId: 'alpha-service-v2',
      serviceName: 'weather-pro',
      displayName: 'Weather Pro',
      description: 'Updated forecast service.',
      providerSkill: 'metabot-weather-oracle',
      price: '0.00004',
      currency: 'BTC-OPCAT',
      outputType: 'image',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].operation, 'modify');
  assert.equal(writes[0].path, '@alpha-service-v2');
  const payload = JSON.parse(writes[0].payload);
  assert.equal(payload.currency, 'BTC-OPCAT');
  assert.equal(payload.providerSkill, 'metabot-weather-oracle');
  assert.equal(payload.paymentAddress, 'alpha-bot-opcat-address');

  const state = await createRuntimeStateStore(homeDir).readState();
  assert.equal(state.services[0].sourceServicePinId, 'alpha-service-v1');
  assert.equal(state.services[0].currentPinId, 'pin-1');
  assert.deepEqual(state.services[0].chainPinIds, ['alpha-service-v1', 'alpha-service-v2', 'pin-1']);
  assert.equal(state.services[0].displayName, 'Weather Pro');
  assert.equal(state.services[0].currency, 'BTC-OPCAT');
  assert.equal(state.services[0].available, 1);
});

test('default my-services revoke writes a revoke pin and hides the service from active list', async (t) => {
  const homeDir = await createProfileHome('metabot-my-services-revoke-', 'alpha-bot');
  t.after(async () => cleanupProfileHome(homeDir));
  const systemHomeDir = deriveSystemHome(homeDir);
  const identity = createIdentity({ slug: 'alpha-bot', metabotId: 1, name: 'Alpha Bot', globalMetaId: 'idq1alphabot' });
  await upsertIdentityProfile({ systemHomeDir, name: identity.name, homeDir, globalMetaId: identity.globalMetaId, mvcAddress: identity.mvcAddress });
  await createRuntimeStateStore(homeDir).writeState({
    identity,
    services: [createService({ providerGlobalMetaId: identity.globalMetaId })],
    traces: [],
    sellerOrders: [],
  });

  const writes = [];
  const app = await startServer(createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: {
      async getIdentity() {
        return identity;
      },
      async writePin(input) {
        writes.push(input);
        return {
          txids: [`revoke-tx-${writes.length}`],
          pinId: `revoke-pin-${writes.length}`,
          totalCost: 10,
          network: input.network ?? 'mvc',
          operation: input.operation,
          path: input.path,
          contentType: input.contentType,
          encoding: input.encoding ?? 'utf-8',
          globalMetaId: identity.globalMetaId,
          mvcAddress: identity.mvcAddress,
        };
      },
    },
  }));
  t.after(async () => app.close());

  const response = await fetchJson(app.baseUrl, '/api/services/my/revoke', {
    method: 'POST',
    body: { serviceId: 'alpha-service-v2' },
  });

  assert.equal(response.status, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].operation, 'revoke');
  assert.equal(writes[0].path, '@alpha-service-v2');

  const state = await createRuntimeStateStore(homeDir).readState();
  assert.equal(state.services[0].available, 0);
  assert.ok(state.services[0].revokedAt > 0);

  const list = await fetchJson(app.baseUrl, '/api/services/my?page=1&pageSize=10&refresh=false');
  assert.equal(list.payload.ok, true);
  assert.equal(list.payload.data.items.length, 0);
});
