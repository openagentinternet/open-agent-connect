import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  parseDeliveryMessage,
  parseNeedsRatingMessage,
} = require('../../dist/core/orders/serviceOrderProtocols.js');

test('parseNeedsRatingMessage extracts the remote T-stage invite body', () => {
  assert.equal(
    parseNeedsRatingMessage('[NeedsRating] 服务已完成，如果方便请给我一个评价吧。'),
    '服务已完成，如果方便请给我一个评价吧。'
  );
  assert.equal(parseNeedsRatingMessage('plain text'), null);
});

test('parseDeliveryMessage still parses the delivery envelope contract', () => {
  assert.deepEqual(
    parseDeliveryMessage('[DELIVERY] {"paymentTxid":"tx-1","servicePinId":"service-1","result":"done"}'),
    {
      paymentTxid: 'tx-1',
      servicePinId: 'service-1',
      result: 'done',
    }
  );
});
