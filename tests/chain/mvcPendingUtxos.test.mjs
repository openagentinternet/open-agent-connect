import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  getMvcUtxoOutpointKey,
  rememberPendingMvcTransaction,
  resolveSpendableMvcUtxos,
  __clearPendingMvcUtxosForTests,
} = require('../../dist/core/chain/mvcPendingUtxos.js');

const ADDRESS = 'mvc-address-1';
const NOW = 1_700_000_000_000;
const PENDING_TTL_MS = 10 * 60 * 1000;

function utxo(overrides = {}) {
  return {
    txId: 'tx-a',
    outputIndex: 0,
    satoshis: 1_000,
    address: ADDRESS,
    height: 1,
    ...overrides,
  };
}

test('resolveSpendableMvcUtxos filters locally spent outpoints', () => {
  __clearPendingMvcUtxosForTests();
  const spent = utxo({ txId: 'SPENT-TX', outputIndex: 2 });

  rememberPendingMvcTransaction({
    address: ADDRESS,
    spentUtxos: [spent],
    createdUtxos: [],
    now: NOW,
  });

  assert.deepEqual(resolveSpendableMvcUtxos({
    address: ADDRESS,
    utxos: [spent, utxo({ txId: 'fresh-tx', outputIndex: 0 })],
    now: NOW,
  }), [utxo({ txId: 'fresh-tx', outputIndex: 0 })]);
});

test('resolveSpendableMvcUtxos includes pending change for the same address', () => {
  __clearPendingMvcUtxosForTests();
  const change = utxo({
    txId: 'CHANGE-TX',
    outputIndex: 1,
    satoshis: 2_500,
    height: 0,
  });

  rememberPendingMvcTransaction({
    address: ADDRESS,
    spentUtxos: [utxo({ txId: 'spent-tx', outputIndex: 0 })],
    createdUtxos: [change],
    now: NOW,
  });

  assert.deepEqual(resolveSpendableMvcUtxos({
    address: ADDRESS,
    utxos: [],
    now: NOW,
  }), [change]);
});

test('pending MVC UTXO entries expire after TTL', () => {
  __clearPendingMvcUtxosForTests();
  const spent = utxo({ txId: 'expiring-spent-tx', outputIndex: 0 });
  const change = utxo({
    txId: 'expiring-change-tx',
    outputIndex: 1,
    satoshis: 1_500,
    height: 0,
  });

  rememberPendingMvcTransaction({
    address: ADDRESS,
    spentUtxos: [spent],
    createdUtxos: [change],
    now: NOW,
  });

  assert.deepEqual(resolveSpendableMvcUtxos({
    address: ADDRESS,
    utxos: [spent],
    now: NOW + PENDING_TTL_MS - 1,
  }), [change]);

  assert.deepEqual(resolveSpendableMvcUtxos({
    address: ADDRESS,
    utxos: [spent],
    now: NOW + PENDING_TTL_MS,
  }), [spent]);
});

test('rememberPendingMvcTransaction ignores tiny created outputs under 600 sats', () => {
  __clearPendingMvcUtxosForTests();

  rememberPendingMvcTransaction({
    address: ADDRESS,
    spentUtxos: [],
    createdUtxos: [utxo({
      txId: 'tiny-change-tx',
      outputIndex: 0,
      satoshis: 599,
      height: 0,
    })],
    now: NOW,
  });

  assert.deepEqual(resolveSpendableMvcUtxos({
    address: ADDRESS,
    utxos: [],
    now: NOW,
  }), []);
});

test('getMvcUtxoOutpointKey normalizes txid, index, and optional address', () => {
  assert.equal(getMvcUtxoOutpointKey({
    txId: ' ABCDEF1234 ',
    outputIndex: 2,
    address: ' mvc-address-1 ',
  }), 'mvc-address-1:abcdef1234:2');

  assert.equal(getMvcUtxoOutpointKey({
    txId: ' ABCDEF1234 ',
    outputIndex: 2,
  }), 'abcdef1234:2');
});
