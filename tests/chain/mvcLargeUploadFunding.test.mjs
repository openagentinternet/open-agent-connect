import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { mvc } = require('meta-contract');
const {
  buildMvcLargeUploadFunding,
} = require('../../dist/core/chain/mvcLargeUploadFunding.js');

const FIXTURE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FIXTURE_PATH = "m/44'/10001'/0'/0/0";
const FIXTURE_ADDRESS = '15Lofqw6Kpa6P8WnTYXKvmPyw3UZvvQWrB';
const OTHER_ADDRESS = '1ARLA5cQjYsc4qUd5QgZht2apiepHmKeDi';
const FIRST_TXID = 'a'.repeat(64);
const SECOND_TXID = 'b'.repeat(64);

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

function utxo(overrides = {}) {
  return {
    txId: FIRST_TXID,
    outputIndex: 0,
    satoshis: 100_000,
    address: FIXTURE_ADDRESS,
    height: 1,
    ...overrides,
  };
}

async function buildFixtureFunding(overrides = {}) {
  return buildMvcLargeUploadFunding({
    identity,
    feeRate: 2,
    chunkPreTxFee: 1_111,
    indexPreTxFee: 2_222,
    utxos: [utxo()],
    ...overrides,
  });
}

test('buildMvcLargeUploadFunding builds signed merge and pre-transactions from deterministic inputs', async () => {
  const result = await buildFixtureFunding();

  assert.match(result.mergeTxHex, /^[0-9a-f]+$/u);
  assert.match(result.chunkPreTxHex, /^[0-9a-f]+$/u);
  assert.match(result.indexPreTxHex, /^[0-9a-f]+$/u);

  const mergeTx = new mvc.Transaction(result.mergeTxHex);
  assert.equal(result.mergeTxId, mergeTx.id);
  assert.equal(mergeTx.inputs.length, 1);
  assert.equal(mergeTx.outputs[0].satoshis, result.chunkPreTxOutputAmount);
  assert.equal(mergeTx.outputs[1].satoshis, result.indexPreTxOutputAmount);
  assert.deepEqual(result.spentUtxos, [utxo()]);
  assert.deepEqual(result.spentOutpoints, [`${FIRST_TXID}:0`]);
  assert.equal(result.changeUtxo?.txId, result.mergeTxId);
  assert.equal(result.changeUtxo?.outputIndex, mergeTx.outputs.length - 1);
  assert.equal(result.changeUtxo?.address, FIXTURE_ADDRESS);
});

test('buildMvcLargeUploadFunding output amounts include MetaFS estimate fees and build fees', async () => {
  const result = await buildFixtureFunding({
    feeRate: 3,
    chunkPreTxFee: 100,
    indexPreTxFee: 200,
  });

  assert.equal(result.chunkPreTxOutputAmount, 100 + Math.ceil((200 + 150) * 3));
  assert.equal(result.indexPreTxOutputAmount, 200 + Math.ceil((200 + 150) * 3));
});

test('buildMvcLargeUploadFunding rejects explicit address that differs from derived identity address', async () => {
  await assert.rejects(
    () => buildFixtureFunding({ address: OTHER_ADDRESS }),
    /funding address.*derived MVC address/i,
  );
});

test('buildMvcLargeUploadFunding skips excluded outpoints and returns normalized spent outpoints', async () => {
  const result = await buildFixtureFunding({
    utxos: [
      utxo({ txId: FIRST_TXID.toUpperCase(), outputIndex: 0, satoshis: 100_000 }),
      utxo({ txId: 'c'.repeat(64), outputIndex: 0, satoshis: 599 }),
      utxo({ txId: SECOND_TXID, outputIndex: 2, satoshis: 100_000 }),
    ],
    excludedOutpoints: new Set([`${FIRST_TXID}:0`]),
  });

  assert.deepEqual(result.spentOutpoints, [`${SECOND_TXID}:2`]);
  assert.deepEqual(result.spentUtxos, [utxo({ txId: SECOND_TXID, outputIndex: 2, satoshis: 100_000 })]);
});

test('buildMvcLargeUploadFunding honors uppercase excluded outpoints', async () => {
  const result = await buildFixtureFunding({
    utxos: [
      utxo({ txId: FIRST_TXID, outputIndex: 0, satoshis: 100_000 }),
      utxo({ txId: SECOND_TXID, outputIndex: 1, satoshis: 100_000 }),
    ],
    excludedOutpoints: new Set([`${FIRST_TXID.toUpperCase()}:0`]),
  });

  assert.deepEqual(result.spentOutpoints, [`${SECOND_TXID}:1`]);
  assert.deepEqual(result.spentUtxos, [utxo({ txId: SECOND_TXID, outputIndex: 1, satoshis: 100_000 })]);
});

test('buildMvcLargeUploadFunding ignores UTXOs that do not belong to the funding address', async () => {
  const result = await buildFixtureFunding({
    utxos: [
      utxo({ txId: FIRST_TXID, outputIndex: 0, satoshis: 100_000, address: OTHER_ADDRESS }),
      utxo({ txId: SECOND_TXID, outputIndex: 1, satoshis: 100_000, address: FIXTURE_ADDRESS }),
    ],
  });

  assert.deepEqual(result.spentOutpoints, [`${SECOND_TXID}:1`]);
  assert.deepEqual(result.spentUtxos, [utxo({ txId: SECOND_TXID, outputIndex: 1, satoshis: 100_000 })]);
});

test('buildMvcLargeUploadFunding throws a clear error for insufficient balance', async () => {
  await assert.rejects(
    () => buildFixtureFunding({
      utxos: [utxo({ satoshis: 1_000 })],
      chunkPreTxFee: 20_000,
      indexPreTxFee: 20_000,
    }),
    /Insufficient MVC balance/i,
  );
});

test('buildMvcLargeUploadFunding preTx hex parses as one-input zero-output transactions', async () => {
  const result = await buildFixtureFunding();
  const chunkPreTx = new mvc.Transaction(result.chunkPreTxHex);
  const indexPreTx = new mvc.Transaction(result.indexPreTxHex);

  assert.equal(chunkPreTx.inputs.length, 1);
  assert.equal(chunkPreTx.outputs.length, 0);
  assert.equal(indexPreTx.inputs.length, 1);
  assert.equal(indexPreTx.outputs.length, 0);
});
