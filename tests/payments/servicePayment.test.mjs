import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('executeServiceOrderPayment returns wallet transfer txid for paid native orders', async () => {
  const {
    executeServiceOrderPayment,
  } = require('../../dist/core/payments/servicePayment.js');

  const calls = [];
  const payment = await executeServiceOrderPayment({
    servicePinId: 'service-pin',
    providerGlobalMetaId: 'seller-gmid',
    paymentAddress: 'mvc-payment-address',
    amount: '0.01',
    currency: 'SPACE',
    executor: {
      execute: async (input) => {
        calls.push(input);
        return {
          paymentTxid: 'c'.repeat(64),
          paymentChain: 'mvc',
          paymentAmount: '0.01',
          paymentCurrency: 'SPACE',
          settlementKind: 'native',
          totalCost: 123,
          network: 'mvc',
        };
      },
    },
  });

  assert.equal(payment.paymentTxid, 'c'.repeat(64));
  assert.equal(payment.paymentChain, 'mvc');
  assert.equal(payment.settlementKind, 'native');
  assert.equal(payment.paymentAmount, '0.01');
  assert.equal(payment.paymentCurrency, 'SPACE');
  assert.equal(payment.totalCost, 123);
  assert.equal(payment.network, 'mvc');
  assert.deepEqual(calls, [{
    servicePinId: 'service-pin',
    providerGlobalMetaId: 'seller-gmid',
    paymentAddress: 'mvc-payment-address',
    amount: '0.01',
    currency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
  }]);
});

test('createTestServicePaymentExecutor returns deterministic wallet-like txid for daemon tests', async () => {
  const {
    createTestServicePaymentExecutor,
  } = require('../../dist/core/payments/servicePayment.js');

  const payment = await createTestServicePaymentExecutor().execute({
    servicePinId: 'service-pin',
    providerGlobalMetaId: 'seller-gmid',
    paymentAddress: 'mvc-payment-address',
    amount: '0.01',
    currency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
  });

  assert.match(payment.paymentTxid, /^[0-9a-f]{64}$/);
  assert.equal(payment.paymentChain, 'mvc');
  assert.equal(payment.paymentAmount, '0.01');
  assert.equal(payment.paymentCurrency, 'SPACE');
  assert.equal(payment.settlementKind, 'native');
  assert.equal(payment.network, 'mvc');
});

test('executeServiceOrderPayment does not synthesize txids for paid orders', async () => {
  const {
    executeServiceOrderPayment,
  } = require('../../dist/core/payments/servicePayment.js');

  await assert.rejects(
    executeServiceOrderPayment({
      servicePinId: 'service-pin',
      providerGlobalMetaId: 'seller-gmid',
      paymentAddress: 'mvc-payment-address',
      amount: '0.01',
      currency: 'SPACE',
      executor: {
        execute: async () => ({
          paymentTxid: '',
          paymentChain: 'mvc',
          paymentAmount: '0.01',
          paymentCurrency: 'SPACE',
          settlementKind: 'native',
        }),
      },
    }),
    /payment_txid_missing/,
  );
});

test('executeServiceOrderPayment leaves free service order id to skill-service-order publish', async () => {
  const {
    executeServiceOrderPayment,
  } = require('../../dist/core/payments/servicePayment.js');

  let called = false;
  const payment = await executeServiceOrderPayment({
    servicePinId: 'free-service-pin',
    providerGlobalMetaId: 'seller-gmid',
    paymentAddress: '',
    amount: '0',
    currency: 'SPACE',
    traceId: 'trace-free-1',
    executor: {
      execute: async () => {
        called = true;
        throw new Error('must not be called for free services');
      },
    },
  });

  assert.equal(called, false);
  assert.equal(payment.paymentTxid, null);
  assert.equal(payment.orderReference, null);
  assert.equal(payment.paymentAmount, '0');
  assert.equal(payment.paymentCurrency, 'SPACE');
  assert.equal(payment.settlementKind, 'native');
});

test('executeServiceOrderPayment lets free unsupported-currency services reach order publishing', async () => {
  const {
    executeServiceOrderPayment,
  } = require('../../dist/core/payments/servicePayment.js');

  for (const currency of ['DOGE', 'BTC-OPCAT']) {
    let called = false;
    const payment = await executeServiceOrderPayment({
      servicePinId: `free-${currency.toLowerCase()}-service-pin`,
      providerGlobalMetaId: 'seller-gmid',
      paymentAddress: '',
      amount: '0',
      currency,
      traceId: `trace-free-${currency.toLowerCase()}-1`,
      executor: {
        execute: async () => {
          called = true;
          throw new Error('must not be called for free services');
        },
      },
    });

    assert.equal(called, false);
    assert.equal(payment.paymentTxid, null);
    assert.equal(payment.orderReference, null);
    assert.equal(payment.paymentAmount, '0');
    assert.equal(payment.paymentCurrency, currency);
    assert.equal(payment.settlementKind, 'native');
    assert.equal(payment.paymentChain, null);
    assert.equal(payment.network, null);
  }
});

test('executeServiceOrderPayment rejects unsupported settlement before order send', async () => {
  const {
    executeServiceOrderPayment,
  } = require('../../dist/core/payments/servicePayment.js');

  await assert.rejects(
    executeServiceOrderPayment({
      servicePinId: 'doge-service-pin',
      providerGlobalMetaId: 'seller-gmid',
      paymentAddress: 'doge-payment-address',
      amount: '1',
      currency: 'DOGE',
      executor: {
        execute: async () => {
          throw new Error('must not execute unsupported settlement');
        },
      },
    }),
    /service_payment_unsupported_settlement/,
  );
});

test('verifyServiceOrderPayment reports verified outcome for a matching MVC payment output', async () => {
  const {
    verifyServiceOrderPayment,
  } = require('../../dist/core/payments/servicePaymentVerification.js');
  const { TxComposer, mvc } = require('meta-contract');

  const txComposer = new TxComposer();
  txComposer.appendP2PKHOutput({
    address: new mvc.Address('1BoatSLRHtKNngkdXEeobR76b53LETtpyT', mvc.Networks.livenet),
    satoshis: 1000,
  });
  const adapters = new Map([
    ['mvc', {
      async fetchRawTx() { return txComposer.getRawHex(); },
      async fetchUtxos() { return []; },
    }],
  ]);

  const result = await verifyServiceOrderPayment({
    adapters,
    paymentTxid: 'b'.repeat(64),
    paymentChain: 'mvc',
    settlementKind: 'native',
    paymentAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
    amount: '0.00001',
    currency: 'SPACE',
  });

  assert.equal(result.verified, true);
  assert.equal(result.outcome, 'verified');
  assert.equal(result.failureKind, null);
});

test('verifyServiceOrderPayment reports mismatch outcome when the raw tx pays a different address', async () => {
  const {
    verifyServiceOrderPayment,
  } = require('../../dist/core/payments/servicePaymentVerification.js');
  const { TxComposer, mvc } = require('meta-contract');

  const txComposer = new TxComposer();
  txComposer.appendP2PKHOutput({
    address: new mvc.Address('1dice8EMZmqKvrGE4Qc9bUFf9PX3xaYDp', mvc.Networks.livenet),
    satoshis: 1000,
  });
  const adapters = new Map([
    ['mvc', {
      async fetchRawTx() { return txComposer.getRawHex(); },
      async fetchUtxos() { return []; },
    }],
  ]);

  const result = await verifyServiceOrderPayment({
    adapters,
    paymentTxid: 'b'.repeat(64),
    paymentChain: 'mvc',
    settlementKind: 'native',
    paymentAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
    amount: '0.00001',
    currency: 'SPACE',
  });

  assert.equal(result.verified, false);
  assert.equal(result.outcome, 'mismatch');
  assert.equal(result.failureKind, 'output_mismatch');
});

test('verifyServiceOrderPayment reports mismatch outcome when an answered UTXO fallback finds no payment', async () => {
  const {
    verifyServiceOrderPayment,
  } = require('../../dist/core/payments/servicePaymentVerification.js');

  const adapters = new Map([
    ['mvc', {
      async fetchRawTx() { throw new Error('indexer 404'); },
      async fetchUtxos() { return []; },
    }],
  ]);

  const result = await verifyServiceOrderPayment({
    adapters,
    paymentTxid: 'b'.repeat(64),
    paymentChain: 'mvc',
    settlementKind: 'native',
    paymentAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
    amount: '0.00001',
    currency: 'SPACE',
  });

  assert.equal(result.verified, false);
  assert.equal(result.outcome, 'mismatch');
  assert.equal(result.failureKind, 'payment_not_found');
});

test('verifyServiceOrderPayment reports a transient error outcome when every MVC chain lookup fails', async () => {
  const {
    verifyServiceOrderPayment,
  } = require('../../dist/core/payments/servicePaymentVerification.js');

  const adapters = new Map([
    ['mvc', {
      async fetchRawTx() { throw new Error('connection refused'); },
      async fetchUtxos() { throw new Error('connection refused'); },
    }],
  ]);

  const result = await verifyServiceOrderPayment({
    adapters,
    paymentTxid: 'b'.repeat(64),
    paymentChain: 'mvc',
    settlementKind: 'native',
    paymentAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
    amount: '0.00001',
    currency: 'SPACE',
  });

  assert.equal(result.verified, false);
  assert.equal(result.outcome, 'error');
  assert.equal(result.failureKind, 'chain_unavailable');
});

test('verifyServiceOrderPayment maps a BTC raw-tx transport failure to a transient error outcome instead of throwing', async () => {
  const {
    verifyServiceOrderPayment,
  } = require('../../dist/core/payments/servicePaymentVerification.js');

  const adapters = new Map([
    ['btc', {
      async fetchRawTx() { throw new Error('mempool space unreachable'); },
      async fetchUtxos() { throw new Error('mempool space unreachable'); },
    }],
  ]);

  const result = await verifyServiceOrderPayment({
    adapters,
    paymentTxid: 'b'.repeat(64),
    paymentChain: 'btc',
    settlementKind: 'native',
    paymentAddress: 'bc1qexampleaddress0000000000000000000000000',
    amount: '0.00001',
    currency: 'BTC',
  });

  assert.equal(result.verified, false);
  assert.equal(result.outcome, 'error');
  assert.equal(result.failureKind, 'chain_unavailable');
});
