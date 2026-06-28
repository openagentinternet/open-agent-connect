import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  withWalletSpendQueue,
  resolveWalletSpendQueueKey,
  __clearWalletSpendQueuesForTests,
} = require('../../dist/core/wallet/spendQueue.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test('withWalletSpendQueue serializes same-key work', async () => {
  __clearWalletSpendQueuesForTests();
  const events = [];
  const firstRelease = deferred();
  let secondStarted = false;

  const first = withWalletSpendQueue('mvc:address-a', async () => {
    events.push('first:start');
    await firstRelease.promise;
    events.push('first:end');
    return 'first';
  });

  await flushMicrotasks();
  assert.deepEqual(events, ['first:start']);

  const second = withWalletSpendQueue('mvc:address-a', async () => {
    secondStarted = true;
    events.push('second:start');
    return 'second';
  });

  await flushMicrotasks();
  assert.equal(secondStarted, false);

  firstRelease.resolve();
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
});

test('withWalletSpendQueue releases same-key work after failures', async () => {
  __clearWalletSpendQueuesForTests();
  const events = [];

  await assert.rejects(
    () => withWalletSpendQueue('btc:address-a', async () => {
      events.push('first:start');
      throw new Error('spend failed');
    }),
    /spend failed/u,
  );

  const result = await withWalletSpendQueue('btc:address-a', async () => {
    events.push('second:start');
    return 'second';
  });

  assert.equal(result, 'second');
  assert.deepEqual(events, ['first:start', 'second:start']);
});

test('withWalletSpendQueue allows distinct keys to run concurrently', async () => {
  __clearWalletSpendQueuesForTests();
  const events = [];
  const firstRelease = deferred();

  const first = withWalletSpendQueue('mvc:address-a', async () => {
    events.push('first:start');
    await firstRelease.promise;
    events.push('first:end');
  });

  await flushMicrotasks();

  const second = withWalletSpendQueue('mvc:address-b', async () => {
    events.push('second:start');
  });

  await flushMicrotasks();
  assert.deepEqual(events, ['first:start', 'second:start']);

  firstRelease.resolve();
  await Promise.all([first, second]);
});

test('resolveWalletSpendQueueKey prefers derived address', async () => {
  const key = await resolveWalletSpendQueueKey({
    adapter: {
      network: 'opcat',
      deriveAddress: async () => ' derived-opcat-address ',
    },
    mnemonic: 'test mnemonic',
    path: "m/44'/10001'/0'/0/0",
    fallbackAddress: 'fallback-address',
  });

  assert.equal(key, 'opcat:derived-opcat-address');
});

test('resolveWalletSpendQueueKey falls back to fallback address when derivation fails', async () => {
  const key = await resolveWalletSpendQueueKey({
    adapter: {
      network: 'btc',
      deriveAddress: async () => {
        throw new Error('derive failed');
      },
    },
    mnemonic: 'test mnemonic',
    path: "m/44'/10001'/0'/0/0",
    fallbackAddress: ' fallback-btc-address ',
  });

  assert.equal(key, 'btc:fallback-btc-address');
});
