import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  classifySimplemsgContent,
} = require('../../dist/core/a2a/simplemsgClassifier.js');

const ORDER_TXID = 'a'.repeat(64);

test('simplemsg classifier treats ordinary plaintext as private chat', () => {
  assert.deepEqual(classifySimplemsgContent('hello remote bot'), {
    kind: 'private_chat',
  });
});

test('simplemsg classifier recognizes the ORDER start tag', () => {
  assert.deepEqual(classifySimplemsgContent('[ORDER] please run the weather service'), {
    kind: 'order_protocol',
    tag: 'ORDER',
    orderTxid: null,
    reason: null,
  });
});

test('simplemsg classifier recognizes scoped IDBots order protocol tags', () => {
  assert.deepEqual(classifySimplemsgContent(`[ORDER_STATUS:${ORDER_TXID}] accepted`), {
    kind: 'order_protocol',
    tag: 'ORDER_STATUS',
    orderTxid: ORDER_TXID,
    reason: null,
  });
  assert.deepEqual(classifySimplemsgContent(`[DELIVERY:${ORDER_TXID}] {"result":"ok"}`), {
    kind: 'order_protocol',
    tag: 'DELIVERY',
    orderTxid: ORDER_TXID,
    reason: null,
  });
  assert.deepEqual(classifySimplemsgContent(`[NeedsRating:${ORDER_TXID}] please rate`), {
    kind: 'order_protocol',
    tag: 'NeedsRating',
    orderTxid: ORDER_TXID,
    reason: null,
  });
  assert.deepEqual(classifySimplemsgContent(`[ORDER_END:${ORDER_TXID} rated] done`), {
    kind: 'order_protocol',
    tag: 'ORDER_END',
    orderTxid: ORDER_TXID,
    reason: 'rated',
  });
});

test('simplemsg classifier keeps legacy delivery and needs-rating compatible', () => {
  assert.deepEqual(classifySimplemsgContent('[DELIVERY] {"result":"ok"}'), {
    kind: 'order_protocol',
    tag: 'DELIVERY',
    orderTxid: null,
    reason: null,
  });
  assert.deepEqual(classifySimplemsgContent('[NEEDSRATING] please rate'), {
    kind: 'order_protocol',
    tag: 'NeedsRating',
    orderTxid: null,
    reason: null,
  });
});

test('simplemsg classifier treats unknown bracketed text as private chat', () => {
  assert.deepEqual(classifySimplemsgContent('[HELLO] not a known A2A protocol tag'), {
    kind: 'private_chat',
  });
});
