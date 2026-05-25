import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

function listingPayload(overrides = {}) {
  return {
    name: 'digital-guide',
    title: 'Digital Guide',
    productType: 'virtual',
    coverImage: 'metafile://cover-image',
    descriptionContentType: 'text/markdown',
    description: 'A practical guide.',
    fulfillment: {
      fulfillmentType: 'digital_delivery',
      deliveryEndpoint: 'simplemsg',
      fulfillmentSkills: ['fulfill-guide', 'follow-up-guide'],
    },
    skus: [
      {
        skuId: 'guide-basic',
        name: 'Basic Guide',
        image: 'metafile://sku-basic',
        descriptionContentType: 'text/markdown',
        description: 'The basic guide.',
        price: { amount: '1', currency: 'SPACE' },
        initialStock: 5,
      },
      {
        skuId: 'guide-pro',
        name: 'Pro Guide',
        image: 'metafile://sku-pro',
        descriptionContentType: 'text/markdown',
        description: 'The pro guide.',
        price: { amount: '2', currency: 'SPACE' },
        initialStock: 3,
      },
    ],
    ...overrides,
  };
}

test('runCli dispatches `metabot products skills --from` to product publish skill lister', async () => {
  const calls = [];

  const exitCode = await runCli(['products', 'skills', '--from', 'alice'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      products: {
        listPublishSkills: async (input) => {
          calls.push(input);
          return commandSuccess({ skills: [] });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ from: 'alice' }]);
});

test('runCli dispatches `metabot products publish --from --payload-file --chain` with product payload', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-products-publish-'));
  const payloadFile = path.join(tempDir, 'listing.json');
  await writeFile(payloadFile, JSON.stringify(listingPayload()), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli([
    'products',
    'publish',
    '--from',
    'alice',
    '--payload-file',
    payloadFile,
    '--chain',
    'mvc',
  ], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      products: {
        publish: async (input) => {
          calls.push(input);
          return commandSuccess({
            listingPinId: 'listing-pin-1',
            fulfillmentSkills: input.fulfillment.fulfillmentSkills,
            network: input.network,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    ...listingPayload(),
    from: 'alice',
    network: 'mvc',
  }]);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.listingPinId, 'listing-pin-1');
});

test('runCli dispatches `metabot products buy --from --request-file` with purchase request JSON', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-products-buy-'));
  const requestFile = path.join(tempDir, 'request.json');
  const request = {
    query: 'buy Alice 0.00005 SPACE mobile top-up card',
    listingPinId: '',
    skuId: 'space-00005',
    comment: '',
    spendCap: {
      amount: '0.00005',
      currency: 'SPACE',
    },
    policyMode: 'confirm_paid_only',
    confirmed: false,
  };
  await writeFile(requestFile, JSON.stringify(request), 'utf8');

  const calls = [];
  const exitCode = await runCli([
    'products',
    'buy',
    '--from',
    'bob',
    '--request-file',
    requestFile,
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      products: {
        buy: async (input) => {
          calls.push(input);
          return commandSuccess({ accepted: true });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ from: 'bob', ...request }]);
});

test('runCli prints confirmed product buy execution fields from the handler envelope', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-products-buy-confirmed-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    listingPinId: 'listing-space-card',
    skuId: 'space-00005',
    confirmed: true,
  }), 'utf8');

  const stdout = [];
  const exitCode = await runCli([
    'products',
    'buy',
    '--request-file',
    requestFile,
  ], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      products: {
        buy: async () => commandSuccess({
          traceId: 'trace-product-order-1',
          productOrderPinId: 'product-order-pin-1',
          paymentTxid: 'payment-txid-1',
          orderTxid: 'simplemsg-order-txid-1',
          localUiUrl: 'http://127.0.0.1:25200/ui/trace?traceId=trace-product-order-1',
        }),
      },
    },
  });

  assert.equal(exitCode, 0);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.productOrderPinId, 'product-order-pin-1');
  assert.equal(envelope.data.paymentTxid, 'payment-txid-1');
  assert.equal(envelope.data.orderTxid, 'simplemsg-order-txid-1');
  assert.equal(envelope.data.localUiUrl, 'http://127.0.0.1:25200/ui/trace?traceId=trace-product-order-1');
});

test('runCli fails `metabot products publish` when --payload-file is missing', async () => {
  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['products', 'publish', '--from', 'alice'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      products: {
        publish: async (input) => {
          calls.push(input);
          return commandSuccess({ listingPinId: 'should-not-happen' });
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, 'missing_flag');
});

test('runCli fails `metabot products publish` before handler when --chain is unsupported', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-products-chain-'));
  const payloadFile = path.join(tempDir, 'listing.json');
  await writeFile(payloadFile, JSON.stringify(listingPayload()), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['products', 'publish', '--payload-file', payloadFile, '--chain', 'eth'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      products: {
        publish: async (input) => {
          calls.push(input);
          return commandSuccess({ listingPinId: 'should-not-happen' });
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /Unsupported --chain value/);
});

test('runCli dispatches `metabot products owned list` with owner filters and paging', async () => {
  const calls = [];
  const exitCode = await runCli([
    'products',
    'owned',
    'list',
    '--from',
    'alice',
    '--page',
    '2',
    '--page-size',
    '10',
    '--refresh',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      products: {
        listOwned: async (input) => {
          calls.push(input);
          return commandSuccess({ items: [] });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    all: false,
    page: 2,
    pageSize: 10,
    refresh: true,
  }]);
});

test('runCli dispatches `metabot products owned list --all` for aggregate owner view', async () => {
  const calls = [];
  const exitCode = await runCli(['products', 'owned', 'list', '--all'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      products: {
        listOwned: async (input) => {
          calls.push(input);
          return commandSuccess({ items: [] });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    all: true,
    page: 1,
    pageSize: 20,
    refresh: false,
  }]);
});
