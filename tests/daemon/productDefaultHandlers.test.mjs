import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { createProductStateStore } = require('../../dist/core/products/productStateStore.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');

function createIdentity(slug = 'seller-bot') {
  return {
    metabotId: 11,
    name: 'Seller Bot',
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
    globalMetaId: `idq1${slug.replace(/-/gu, '')}`,
  };
}

function createRuntime() {
  const now = '2026-05-24T00:00:00.000Z';
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

function productListing(overrides = {}) {
  return {
    name: 'digital-guide',
    title: 'Digital Guide',
    productType: 'virtual',
    coverImage: 'metafile://cover',
    galleryImages: ['metafile://gallery-1'],
    descriptionContentType: 'text/markdown',
    description: 'A practical digital guide.',
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: ['S1', 'S2'],
      estimatedDeliverySeconds: 60,
      deliverableDescription: 'Delivered through private chat.',
    },
    skus: [
      {
        skuId: 'basic',
        name: 'Basic',
        image: 'metafile://sku-basic',
        descriptionContentType: 'text/markdown',
        description: 'Basic package.',
        price: { amount: '1', currency: 'SPACE' },
        initialStock: 5,
      },
      {
        skuId: 'pro',
        name: 'Pro',
        image: 'metafile://sku-pro',
        descriptionContentType: 'text/markdown',
        description: 'Pro package.',
        price: { amount: '2', currency: 'SPACE' },
        initialStock: 2,
      },
    ],
    ...overrides,
  };
}

function makeSigner(writePin) {
  return {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin,
  };
}

async function installRuntimeSkills(homeDir, skillNames) {
  const slug = path.basename(homeDir);
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [createRuntime()],
  });
  await createLlmBindingStore(homeDir).write({
    version: 1,
    bindings: [{
      id: 'binding-codex-primary',
      metaBotSlug: slug,
      llmRuntimeId: 'runtime-codex',
      role: 'primary',
      priority: 0,
      enabled: true,
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:00.000Z',
    }],
  });

  for (const skillName of skillNames) {
    const skillDir = path.join(homeDir, '.codex', 'skills', skillName);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), `# ${skillName}\n`, 'utf8');
  }
}

async function prepareProductProfile(t, { skills, writePin }) {
  const homeDir = await createProfileHome('metabot-product-default-handlers-', 'seller-bot');
  t.after(async () => cleanupProfileHome(homeDir));
  const systemHomeDir = deriveSystemHome(homeDir);
  const identity = createIdentity();

  await upsertIdentityProfile({
    systemHomeDir,
    name: identity.name,
    homeDir,
    globalMetaId: identity.globalMetaId,
    mvcAddress: identity.mvcAddress,
  });
  await createRuntimeStateStore(homeDir).writeState({
    identity,
    services: [],
    traces: [],
    sellerOrders: [],
  });
  await installRuntimeSkills(homeDir, skills);

  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writes.push(input);
      return writePin(input, writes);
    }),
  });

  return {
    homeDir,
    handlers,
    writes,
    productStore: createProductStateStore(homeDir),
  };
}

function assertNoLocalOrSellerFields(value) {
  for (const field of [
    'from',
    'network',
    'sellerGlobalMetaId',
    'sellerMetaId',
    'sellerIdentity',
    'paymentAddress',
    'createdAt',
    'updatedAt',
    'localUpdatedAt',
    'shippingPolicy',
    'reviewPolicy',
    'mrc20',
    'mrc20Tick',
    'mrc20Payment',
  ]) {
    assert.equal(Object.hasOwn(value, field), false, `${field} should not be present`);
  }
}

test('default products publish validates every fulfillment skill before writing or persisting', async (t) => {
  const { handlers, writes, productStore } = await prepareProductProfile(t, {
    skills: ['S1'],
    writePin: async () => {
      throw new Error('writePin should not be called');
    },
  });

  const result = await handlers.products.publish({
    ...productListing(),
    from: 'seller-bot',
    network: 'mvc',
  });
  const state = await productStore.readState();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'provider_skill_missing');
  assert.match(result.message, /S2/);
  assert.deepEqual(writes, []);
  assert.deepEqual(state.ownedListings, []);
});

test('default products publish does not persist owned listing when chain write fails', async (t) => {
  const { handlers, writes, productStore } = await prepareProductProfile(t, {
    skills: ['S1', 'S2'],
    writePin: async () => {
      throw new Error('chain write rejected');
    },
  });

  const result = await handlers.products.publish({
    ...productListing(),
    from: 'seller-bot',
    network: 'mvc',
  });
  const state = await productStore.readState();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_publish_failed');
  assert.match(result.message, /chain write rejected/);
  assert.equal(writes.length, 1);
  assert.deepEqual(state.ownedListings, []);
});

test('default products publish writes product-listing payload and persists sanitized owned listing', async (t) => {
  const { handlers, writes, productStore } = await prepareProductProfile(t, {
    skills: ['S1', 'S2'],
    writePin: async (input) => ({
      txids: ['listing-txid-1'],
      pinId: 'listing-pin-id-1',
      totalCost: 123,
      network: input.network,
      operation: input.operation,
      path: input.path,
      contentType: input.contentType,
    }),
  });

  const result = await handlers.products.publish({
    ...productListing(),
    from: 'seller-bot',
    network: 'mvc',
    sellerGlobalMetaId: 'must-not-write',
    paymentAddress: 'must-not-write',
    createdAt: 'must-not-write',
    updatedAt: 'must-not-write',
    shippingPolicy: { carrier: 'must-not-write' },
    reviewPolicy: { window: 'must-not-write' },
    mrc20: { tick: 'must-not-write' },
    mrc20Tick: 'must-not-write',
    mrc20Payment: { tick: 'must-not-write' },
  });
  const state = await productStore.readState();

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    listingPinId: 'listing-pin-id-1',
    txids: ['listing-txid-1'],
    title: 'Digital Guide',
    productType: 'virtual',
    skuCount: 2,
    fulfillmentSkills: ['S1', 'S2'],
    network: 'mvc',
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].operation, 'create');
  assert.equal(writes[0].path, '/protocols/product-listing');
  assert.equal(writes[0].contentType, 'application/json');
  assert.equal(writes[0].network, 'mvc');

  const writtenPayload = JSON.parse(writes[0].payload);
  assert.deepEqual(writtenPayload.fulfillment.fulfillmentSkills, ['S1', 'S2']);
  assertNoLocalOrSellerFields(writtenPayload);

  assert.equal(state.ownedListings.length, 1);
  assert.equal(state.ownedListings[0].listingPinId, 'listing-pin-id-1');
  assert.equal(state.ownedListings[0].localMetabotSlug, 'seller-bot');
  assert.equal(state.ownedListings[0].localUpdatedAt > 0, true);
  assert.deepEqual(state.ownedListings[0].payload, writtenPayload);
  assertNoLocalOrSellerFields(state.ownedListings[0].payload);
});
