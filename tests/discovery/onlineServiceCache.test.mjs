import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const {
  ONLINE_SERVICE_CACHE_LIMIT,
  buildOnlineServiceCacheState,
  createOnlineServiceCacheStore,
  searchOnlineServiceCacheServices,
} = require('../../dist/core/discovery/onlineServiceCache.js');

function createService(overrides = {}) {
  return {
    servicePinId: 'tarot-service-v2',
    sourceServicePinId: 'tarot-service-v1',
    chainPinIds: ['tarot-service-v1', 'tarot-service-v2'],
    providerGlobalMetaId: 'idq1tarotprovider',
    providerMetaId: 'metaid-tarot-provider',
    providerAddress: 'mvc-tarot-provider',
    providerName: 'TarotBot',
    providerSkill: 'metabot-tarot-reader',
    providerDaemonBaseUrl: 'http://127.0.0.1:4827',
    providerChatPublicKey: 'provider-chat-public-key',
    serviceName: 'tarot-reading',
    displayName: '塔罗牌占卜',
    description: '为明天运程、事业和情感提供塔罗牌占卜。',
    price: '0',
    currency: 'SPACE',
    serviceIcon: null,
    skillDocument: '# Tarot reader',
    inputType: 'text',
    outputType: 'markdown',
    endpoint: 'simplemsg',
    paymentAddress: 'mvc-tarot-payment',
    available: true,
    online: true,
    lastSeenSec: 1_775_000_030,
    lastSeenAt: 1_775_000_030_000,
    lastSeenAgoSeconds: 12,
    updatedAt: 1_775_000_000_000,
    ...overrides,
  };
}

test('online service cache persists global service rows with rating aggregates and search ranking', async () => {
  const homeDir = await createProfileHome('oac-online-service-cache-');
  const systemHome = deriveSystemHome(homeDir);
  const store = createOnlineServiceCacheStore(homeDir);

  assert.equal(
    store.paths.servicesRoot,
    path.join(systemHome, '.metabot', 'services'),
  );
  assert.equal(
    store.paths.servicesPath,
    path.join(systemHome, '.metabot', 'services', 'services.json'),
  );

  const state = buildOnlineServiceCacheState({
    services: [
      createService(),
      createService({
        servicePinId: 'weather-service',
        sourceServicePinId: 'weather-service',
        chainPinIds: ['weather-service'],
        serviceName: 'weather-oracle',
        displayName: 'Weather Oracle',
        description: 'Returns tomorrow weather.',
        providerGlobalMetaId: 'idq1weather',
        providerSkill: 'metabot-weather-oracle',
        price: '0.00001',
        ratingAvg: 4.9,
        ratingCount: 20,
      }),
    ],
    ratingDetails: [
      { pinId: 'rate-1', serviceId: 'tarot-service-v1', servicePaidTx: null, rate: 5, comment: null, raterGlobalMetaId: null, raterMetaId: null, createdAt: 1_775_000_100_000 },
      { pinId: 'rate-2', serviceId: 'tarot-service-v2', servicePaidTx: null, rate: 3, comment: null, raterGlobalMetaId: null, raterMetaId: null, createdAt: 1_775_000_200_000 },
      { pinId: 'rate-3', serviceId: 'unrelated-service', servicePaidTx: null, rate: 1, comment: null, raterGlobalMetaId: null, raterMetaId: null, createdAt: 1_775_000_300_000 },
    ],
    discoverySource: 'chain',
    fallbackUsed: false,
    now: () => 1_775_000_400_000,
  });

  const tarot = state.services.find((service) => service.servicePinId === 'tarot-service-v2');
  assert.equal(tarot.ratingAvg, 4);
  assert.equal(tarot.ratingCount, 2);
  assert.equal(tarot.updatedAt, 1_775_000_000_000);
  assert.equal(tarot.lastSeenAgoSeconds, 12);
  assert.equal(tarot.providerDaemonBaseUrl, 'http://127.0.0.1:4827');
  assert.equal(tarot.providerChatPublicKey, 'provider-chat-public-key');

  await store.write(state);
  const persisted = await store.read();
  assert.equal(persisted.services.length, 2);
  assert.equal(persisted.lastSyncedAt, 1_775_000_400_000);
  assert.equal(JSON.parse(await readFile(store.paths.servicesPath, 'utf8')).services[0].cachedAt, 1_775_000_400_000);

  const results = searchOnlineServiceCacheServices(persisted.services, {
    query: '我想用塔罗牌占卜一下明天运程',
    onlineOnly: true,
    limit: 1,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].servicePinId, 'tarot-service-v2');
});

test('online service cache enforces a hard local service limit', () => {
  const services = Array.from({ length: ONLINE_SERVICE_CACHE_LIMIT + 10 }, (_, index) => createService({
    servicePinId: `service-${index}`,
    sourceServicePinId: `service-${index}`,
    chainPinIds: [`service-${index}`],
    displayName: `Service ${index}`,
    updatedAt: 1_775_000_000_000 + index,
  }));

  const state = buildOnlineServiceCacheState({
    services,
    ratingDetails: [],
    discoverySource: 'chain',
    fallbackUsed: false,
    now: () => 1_775_000_500_000,
  });

  assert.equal(state.services.length, ONLINE_SERVICE_CACHE_LIMIT);
  assert.equal(state.services[0].servicePinId, `service-${ONLINE_SERVICE_CACHE_LIMIT + 9}`);
});
