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

test('executeServiceOrderPayment uses order reference only for free services', async () => {
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
  assert.match(payment.orderReference, /^free-order-/);
  assert.equal(payment.paymentAmount, '0');
  assert.equal(payment.paymentCurrency, 'SPACE');
  assert.equal(payment.settlementKind, 'free');
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
