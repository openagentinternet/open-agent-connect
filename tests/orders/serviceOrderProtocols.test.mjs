import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildOrderPayload,
} = require('../../dist/core/orders/orderMessage.js');
const {
  buildDelegationOrderPayload,
} = require('../../dist/core/orders/delegationOrderMessage.js');
const {
  cleanServiceResultText,
  parseDeliveryMessage,
  parseNeedsRatingMessage,
} = require('../../dist/core/orders/serviceOrderProtocols.js');
const {
  resolveServiceOrderPaymentMetadata,
} = require('../../dist/daemon/defaultHandlers.js');

test('buildOrderPayload includes IDBots-compatible service payment metadata', () => {
  const paymentTxid = 'b'.repeat(64);
  const payload = buildOrderPayload({
    rawRequest: 'generate a release note',
    price: '0.01',
    currency: 'SPACE',
    paymentTxid,
    paymentChain: 'mvc',
    settlementKind: 'native',
    serviceId: 'service-pin',
    skillName: 'release-note',
    outputType: 'text',
  });

  assert.match(payload, /^\[ORDER\] generate a release note/m);
  assert.match(payload, /<raw_request>\ngenerate a release note\n<\/raw_request>/);
  assert.match(payload, /支付金额 0\.01 SPACE/);
  assert.match(payload, new RegExp(`txid: ${paymentTxid}`));
  assert.match(payload, /payment chain: mvc/);
  assert.match(payload, /settlement kind: native/);
  assert.match(payload, /service id: service-pin/);
  assert.match(payload, /skill name: release-note/);
  assert.match(payload, /output type: text/);
});

test('buildDelegationOrderPayload includes optional MRC20 payment metadata when provided', () => {
  const paymentTxid = 'b'.repeat(64);
  const paymentCommitTxid = 'c'.repeat(64);
  const payload = buildDelegationOrderPayload({
    rawRequest: 'generate a release note',
    price: '12',
    currency: 'MRC20',
    paymentTxid,
    paymentCommitTxid,
    paymentChain: 'mvc',
    settlementKind: 'mrc20',
    mrc20Ticker: 'SPACE',
    mrc20Id: 'mrc20-space-id',
    servicePinId: 'service-pin',
    providerSkill: 'release-note',
    outputType: 'markdown',
  });

  assert.match(payload, /commit txid: c{64}/);
  assert.match(payload, /payment chain: mvc/);
  assert.match(payload, /settlement kind: mrc20/);
  assert.match(payload, /mrc20 ticker: SPACE/);
  assert.match(payload, /mrc20 id: mrc20-space-id/);
  assert.match(payload, /output type: markdown/);
});

test('resolveServiceOrderPaymentMetadata derives native payment metadata without mislabeling unsupported currencies', () => {
  assert.deepEqual(resolveServiceOrderPaymentMetadata('SPACE'), {
    paymentChain: 'mvc',
    settlementKind: 'native',
  });
  assert.deepEqual(resolveServiceOrderPaymentMetadata('MVC'), {
    paymentChain: 'mvc',
    settlementKind: 'native',
  });
  assert.deepEqual(resolveServiceOrderPaymentMetadata('BTC'), {
    paymentChain: 'btc',
    settlementKind: 'native',
  });
  assert.deepEqual(resolveServiceOrderPaymentMetadata('DOGE'), {});
  assert.deepEqual(resolveServiceOrderPaymentMetadata(''), {});
});

test('daemon payment metadata wiring does not mislabel BTC or unsupported DOGE order payloads', () => {
  const btcPayload = buildDelegationOrderPayload({
    rawRequest: 'generate a release note',
    price: '0.00001',
    currency: 'BTC',
    paymentTxid: 'b'.repeat(64),
    ...resolveServiceOrderPaymentMetadata('BTC'),
    servicePinId: 'service-pin',
    providerSkill: 'release-note',
    outputType: 'text',
  });
  assert.match(btcPayload, /支付金额 0\.00001 BTC/);
  assert.match(btcPayload, /payment chain: btc/);
  assert.doesNotMatch(btcPayload, /payment chain: mvc/);

  const dogePayload = buildDelegationOrderPayload({
    rawRequest: 'generate a release note',
    price: '1',
    currency: 'DOGE',
    paymentTxid: 'b'.repeat(64),
    ...resolveServiceOrderPaymentMetadata('DOGE'),
    servicePinId: 'service-pin',
    providerSkill: 'release-note',
    outputType: 'text',
  });
  assert.match(dogePayload, /支付金额 1 DOGE/);
  assert.doesNotMatch(dogePayload, /payment chain:/);
  assert.doesNotMatch(dogePayload, /settlement kind:/);
});

test('buildDelegationOrderPayload preserves user task prose that starts with metadata-like words', () => {
  const payload = buildDelegationOrderPayload({
    userTask: 'output type markdown keeps formatting for this release note',
    price: '0.01',
    currency: 'SPACE',
    paymentTxid: 'b'.repeat(64),
    serviceName: 'Release Service',
    servicePinId: 'service-pin',
    providerSkill: 'release-note',
    outputType: 'text',
  });

  assert.match(payload, /^\[ORDER\] output type markdown keeps formatting for this release note/m);
  assert.match(
    payload,
    /<raw_request>\noutput type markdown keeps formatting for this release note\n<\/raw_request>/
  );
});

test('buildDelegationOrderPayload strips colon-form Chinese amount metadata from generated request text', () => {
  const payload = buildDelegationOrderPayload({
    userTask: '支付金额: 0.01 SPACE',
    price: '0.01',
    currency: 'SPACE',
    paymentTxid: 'b'.repeat(64),
    serviceName: 'Release Service',
    servicePinId: 'service-pin',
    providerSkill: 'release-note',
    outputType: 'text',
  });

  assert.match(payload, /^\[ORDER\] Release Service/m);
  assert.doesNotMatch(payload, /^\[ORDER\] 支付金额:/m);
  assert.doesNotMatch(payload, /<raw_request>\n支付金额: 0\.01 SPACE\n<\/raw_request>/);
});

test('buildDelegationOrderPayload preserves Chinese prose that starts with payment amount words', () => {
  const payload = buildDelegationOrderPayload({
    userTask: '支付金额 不能超过预算。',
    price: '0.01',
    currency: 'SPACE',
    paymentTxid: 'b'.repeat(64),
    serviceName: 'Release Service',
    servicePinId: 'service-pin',
    providerSkill: 'release-note',
    outputType: 'text',
  });

  assert.match(payload, /^\[ORDER\] 支付金额 不能超过预算/m);
  assert.match(payload, /<raw_request>\n支付金额 不能超过预算\n<\/raw_request>/);
});

test('cleanServiceResultText strips echoed extended order metadata from delivery text', () => {
  const cleaned = cleanServiceResultText(`
你好，收到你的服务订单。
支付金额 0.01 SPACE
支付金额: 0.02 SPACE
支付金额：0.03 SPACE
txid: ${'b'.repeat(64)}
commit txid: ${'c'.repeat(64)}
payment chain: mvc
settlement kind: native
mrc20 ticker: SPACE
mrc20 id: mrc20-space-id
service id: service-pin
skill name: release-note
output type: markdown

The generated release note is ready.
`);

  assert.equal(cleaned, 'The generated release note is ready.');
});

test('cleanServiceResultText preserves prose that only starts with metadata-like words', () => {
  assert.equal(
    cleanServiceResultText('payment chain btc keeps the transfer on Bitcoin.\nAnother valid line.'),
    'payment chain btc keeps the transfer on Bitcoin.\nAnother valid line.'
  );
  assert.equal(
    cleanServiceResultText('output type markdown keeps formatting.\nAnother valid line.'),
    'output type markdown keeps formatting.\nAnother valid line.'
  );
  assert.equal(
    cleanServiceResultText('支付金额 不能超过预算。\nAnother valid line.'),
    '支付金额 不能超过预算。\nAnother valid line.'
  );
});

test('parseNeedsRatingMessage extracts the remote T-stage invite body', () => {
  const orderTxid = 'a'.repeat(64);
  assert.equal(
    parseNeedsRatingMessage('[NeedsRating] 服务已完成，如果方便请给我一个评价吧。'),
    '服务已完成，如果方便请给我一个评价吧。'
  );
  assert.equal(parseNeedsRatingMessage('[NEEDSRATING] rate me'), 'rate me');
  assert.equal(parseNeedsRatingMessage(`[NeedsRating:${orderTxid}] rate me`), 'rate me');
  assert.equal(parseNeedsRatingMessage('plain text'), null);
});

test('parseDeliveryMessage still parses the delivery envelope contract', () => {
  const orderTxid = 'a'.repeat(64);
  assert.deepEqual(
    parseDeliveryMessage('[DELIVERY] {"paymentTxid":"tx-1","servicePinId":"service-1","result":"done"}'),
    {
      paymentTxid: 'tx-1',
      servicePinId: 'service-1',
      result: 'done',
    }
  );
  assert.deepEqual(
    parseDeliveryMessage(`[DELIVERY:${orderTxid}] {"paymentTxid":"tx-1","servicePinId":"service-1","result":"done"}`),
    {
      paymentTxid: 'tx-1',
      servicePinId: 'service-1',
      result: 'done',
      orderTxid,
    }
  );
});
