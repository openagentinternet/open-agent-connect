import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { mvcChainAdapter, __clearPendingMvcSpentOutpointsForTests } = require('../../dist/core/chain/adapters/mvc.js');
const { mvc } = require('meta-contract');

const FIXTURE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FIXTURE_PATH = "m/44'/10001'/0'/0/0";
const FIXTURE_ADDRESS = '15Lofqw6Kpa6P8WnTYXKvmPyw3UZvvQWrB';

const identity = {
  mnemonic: FIXTURE_MNEMONIC,
  path: FIXTURE_PATH,
  publicKey: '',
  chatPublicKey: '',
  addresses: { mvc: FIXTURE_ADDRESS },
  mvcAddress: FIXTURE_ADDRESS,
  metaId: '',
  globalMetaId: '',
};

test('mvcChainAdapter buildInscription keeps totalCost positive from local UTXO data instead of reparsed input metadata', async () => {
  __clearPendingMvcSpentOutpointsForTests?.();

  const originalFetchUtxos = mvcChainAdapter.fetchUtxos;
  try {
    mvcChainAdapter.fetchUtxos = async () => [{
      txId: 'a'.repeat(64),
      outputIndex: 0,
      satoshis: 100_000,
      address: FIXTURE_ADDRESS,
      height: 1,
    }];

    const result = await mvcChainAdapter.buildInscription({
      identity,
      request: {
        operation: 'create',
        path: '/file',
        payload: Buffer.from('hello'),
        contentType: 'text/plain',
        encoding: 'binary',
        network: 'mvc',
        encryption: '0',
        version: '1.0',
      },
    });

    const tx = new mvc.Transaction(result.signedRawTxs[0]);
    const expectedCost = 100_000 - tx.outputs.reduce((sum, output) => sum + output.satoshis, 0);

    assert.equal(result.totalCost, expectedCost);
    assert.equal(result.totalCost > 0, true);
  } finally {
    mvcChainAdapter.fetchUtxos = originalFetchUtxos;
    __clearPendingMvcSpentOutpointsForTests?.();
  }
});

test('mvcChainAdapter fetchUtxos retries a transient fetch failed', async () => {
  __clearPendingMvcSpentOutpointsForTests?.();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      throw new TypeError('fetch failed');
    }
    return { json: async () => ({ data: { list: [] } }) };
  };
  try {
    const utxos = await mvcChainAdapter.fetchUtxos(FIXTURE_ADDRESS);
    assert.deepEqual(utxos, []);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    __clearPendingMvcSpentOutpointsForTests?.();
  }
});
