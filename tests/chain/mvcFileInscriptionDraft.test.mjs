import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { TxComposer, mvc } = require('meta-contract');
const {
  buildMvcFileInscriptionDraft,
  extractOwnedOutputsFromPreparedMvcTx,
  signMvcPreparedUserInputs,
} = require('../../dist/core/chain/mvcFileInscriptionDraft.js');

const FIXTURE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FIXTURE_PATH = "m/44'/10001'/0'/0/0";
const FIXTURE_ADDRESS = '15Lofqw6Kpa6P8WnTYXKvmPyw3UZvvQWrB';
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

const fixtureUtxo = {
  txId: FIRST_TXID,
  outputIndex: 0,
  satoshis: 100_000,
  address: FIXTURE_ADDRESS,
  height: 1,
};

function buildPreparedTxHex() {
  const addressObject = new mvc.Address(FIXTURE_ADDRESS, mvc.Networks.livenet);
  const txComposer = new TxComposer();
  txComposer.appendP2PKHOutput({ address: addressObject, satoshis: 1 });
  txComposer.appendP2PKHOutput({ address: addressObject, satoshis: 777 });
  txComposer.appendP2PKHOutput({
    address: new mvc.Address('1ARLA5cQjYsc4qUd5QgZht2apiepHmKeDi', mvc.Networks.livenet),
    satoshis: 888,
  });
  txComposer.appendP2PKHInput({
    address: addressObject,
    txId: fixtureUtxo.txId,
    outputIndex: fixtureUtxo.outputIndex,
    satoshis: fixtureUtxo.satoshis,
  });
  txComposer.appendP2PKHInput({
    address: addressObject,
    txId: SECOND_TXID,
    outputIndex: 1,
    satoshis: 50_000,
  });
  return txComposer.getRawHex();
}

test('buildMvcFileInscriptionDraft preserves the current one-sat MVC direct upload shape', async () => {
  const draft = await buildMvcFileInscriptionDraft({
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
    utxos: [fixtureUtxo],
  });

  assert.equal(draft.selectedUtxos.length, 1);
  assert.equal(draft.userInputCount, 1);
  assert.match(draft.unsignedTxHex, /^[0-9a-f]+$/u);

  const tx = new mvc.Transaction(draft.unsignedTxHex);
  assert.equal(tx.outputs[0].satoshis, 1);
  assert.equal(tx.inputs.length, 1);
});

test('signMvcPreparedUserInputs only signs the indexes returned by sponsor pre', async () => {
  const signed = await signMvcPreparedUserInputs({
    identity,
    preparedTxHex: buildPreparedTxHex(),
    selectedUtxos: [fixtureUtxo],
    userInputIndexes: [0],
  });

  const tx = new mvc.Transaction(signed.txHex);
  assert.notEqual(tx.inputs[0].script.toString(), '');
  assert.equal(tx.inputs[1].script.toString(), '');
});

test('extractOwnedOutputsFromPreparedMvcTx returns only user-owned outputs', async () => {
  const created = extractOwnedOutputsFromPreparedMvcTx({
    txHex: buildPreparedTxHex(),
    txId: 'c'.repeat(64),
    address: FIXTURE_ADDRESS,
  });

  assert.equal(created.every((utxo) => utxo.address === FIXTURE_ADDRESS), true);
  assert.deepEqual(
    created.map((utxo) => ({ outputIndex: utxo.outputIndex, satoshis: utxo.satoshis })),
    [
      { outputIndex: 0, satoshis: 1 },
      { outputIndex: 1, satoshis: 777 },
    ],
  );
});
