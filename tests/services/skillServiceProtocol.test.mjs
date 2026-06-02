import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildSkillServiceOrderPayload,
  getPrimaryProviderSkill,
  isExecutableSkillServicePaymentTerm,
  normalizeProviderSkillList,
  normalizeSkillServiceCurrency,
  normalizeSkillServicePaymentTiming,
  normalizeSkillServiceSettlementKind,
  resolveSkillServicePaymentTerms,
} = require('../../dist/core/services/skillServiceProtocol.js');

test('normalizes legacy and v1.1 provider skill payloads into a safe allow-list', () => {
  assert.deepEqual(normalizeProviderSkillList(' metabot-post-buzz '), ['metabot-post-buzz']);
  assert.deepEqual(
    normalizeProviderSkillList([
      ' weather-query ',
      'metabot-post-buzz',
      'weather-query',
      '',
      null,
      '../unsafe',
      'skills/metabot-post-buzz',
      'metabot-..-buzz',
    ]),
    ['weather-query', 'metabot-post-buzz'],
  );
  assert.equal(getPrimaryProviderSkill(['weather-query', 'metabot-post-buzz']), 'weather-query');
  assert.equal(getPrimaryProviderSkill([]), null);
});

test('normalizes payment timing from explicit v1.1 values and legacy price fallback', () => {
  assert.equal(normalizeSkillServicePaymentTiming(null, '0'), 'free');
  assert.equal(normalizeSkillServicePaymentTiming(undefined, '0.0001'), 'prepaid');
  assert.equal(normalizeSkillServicePaymentTiming('FREE', '0.0001'), 'free');
  assert.equal(normalizeSkillServicePaymentTiming('prepaid', '0'), 'prepaid');
  assert.equal(normalizeSkillServicePaymentTiming('postpaid', '0.0001'), 'postpaid');
  assert.equal(normalizeSkillServicePaymentTiming('unknown', '0'), 'free');
});

test('resolves payment terms while preserving unsupported future protocol values', () => {
  assert.deepEqual(resolveSkillServicePaymentTerms({
    price: '0.00025',
    currency: 'mvc',
    paymentTiming: '',
    settlementKind: '',
  }), {
    paymentTiming: 'prepaid',
    effectivePrice: '0.00025',
    currency: 'SPACE',
    settlementKind: 'native',
    isFree: false,
    isExecutable: true,
  });

  assert.deepEqual(resolveSkillServicePaymentTerms({
    price: '5',
    currency: 'usd',
    paymentTiming: 'postpaid',
    settlementKind: 'fiat',
  }), {
    paymentTiming: 'postpaid',
    effectivePrice: '5',
    currency: 'USD',
    settlementKind: 'fiat',
    isFree: false,
    isExecutable: false,
  });

  assert.equal(isExecutableSkillServicePaymentTerm({
    paymentTiming: 'prepaid',
    effectivePrice: '1',
    currency: 'USD',
    settlementKind: 'fiat',
  }), false);
});

test('normalizes currency and settlement kind aliases', () => {
  assert.equal(normalizeSkillServiceCurrency('mvc'), 'SPACE');
  assert.equal(normalizeSkillServiceCurrency('microvisionchain'), 'SPACE');
  assert.equal(normalizeSkillServiceCurrency('bitcoin'), 'BTC');
  assert.equal(normalizeSkillServiceCurrency('dogecoin'), 'DOGE');
  assert.equal(normalizeSkillServiceCurrency('opcat'), 'BTC-OPCAT');
  assert.equal(normalizeSkillServiceSettlementKind('FIAT'), 'fiat');
  assert.equal(normalizeSkillServiceSettlementKind('mrc20'), 'native');
});

test('builds skill-service-order payloads without inventing an order id', () => {
  const payload = buildSkillServiceOrderPayload({
    servicePinId: ' service-pin-1 ',
    paymentTxid: ' payment-tx-1 ',
    price: '0.0005',
    currency: 'space',
    settlementKind: 'native',
    metadata: 'buyer note',
  });

  assert.deepEqual(payload, {
    servicePinId: 'service-pin-1',
    paymentTxid: 'payment-tx-1',
    price: '0.0005',
    currency: 'SPACE',
    settlementKind: 'native',
    metadata: 'buyer note',
  });
  assert.equal(Object.hasOwn(payload, 'orderId'), false);

  assert.deepEqual(buildSkillServiceOrderPayload({
    servicePinId: 'free-service-pin',
    paymentTiming: 'free',
    paymentTxid: 'synthetic-free-txid',
    price: '10',
    currency: 'DOGE',
  }), {
    servicePinId: 'free-service-pin',
    paymentTxid: '',
    price: '0',
    currency: 'DOGE',
    settlementKind: 'native',
    metadata: '',
  });
});
