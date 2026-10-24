import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  publishCommentPin,
  formatCommentPinResult,
  CommentPublishError,
  PAYCOMMENT_PATH,
} = require('../../dist/core/comment/publishCommentPin.js');

function fakeSigner() {
  const calls = [];
  const signer = {
    writePin: async (input) => {
      calls.push(input);
      return {
        pinId: 'comment-pin-1',
        txids: ['tx-1', 'tx-2'],
        totalCost: 333,
        network: input.network,
        operation: 'create',
        path: input.path,
        contentType: input.contentType,
        encoding: 'utf-8',
        globalMetaId: 'gm-local-alice',
        mvcAddress: '1alice',
      };
    },
  };
  return { calls, signer };
}

test('publishCommentPin writes one paycomment pin with the commentTo payload', async () => {
  const { calls, signer } = fakeSigner();
  const result = await publishCommentPin(signer, {
    pinId: 'target-pin-9',
    content: 'a real answer',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'create');
  assert.equal(calls[0].path, PAYCOMMENT_PATH);
  assert.equal(calls[0].path, '/protocols/paycomment');
  assert.equal(calls[0].encryption, '0');
  assert.equal(calls[0].version, '1.0.0');
  assert.equal(calls[0].contentType, 'application/json');
  assert.equal(calls[0].network, 'mvc', 'network defaults to mvc');

  const payload = JSON.parse(calls[0].payload);
  assert.deepEqual(payload, {
    commentTo: 'target-pin-9',
    content: 'a real answer',
    contentType: 'text/markdown',
  });

  assert.deepEqual(result, {
    pinId: 'comment-pin-1',
    txids: ['tx-1', 'tx-2'],
    totalCost: 333,
    network: 'mvc',
    targetPinId: 'target-pin-9',
    content: 'a real answer',
  });
});

test('publishCommentPin forwards an explicit network', async () => {
  const { calls, signer } = fakeSigner();
  await publishCommentPin(signer, { pinId: 'p1', content: 'hi', network: 'doge' });
  assert.equal(calls[0].network, 'doge');
});

test('publishCommentPin rejects empty pinId / content before any chain write', async () => {
  const { calls, signer } = fakeSigner();
  await assert.rejects(
    () => publishCommentPin(signer, { pinId: '   ', content: 'hi' }),
    (error) => error instanceof CommentPublishError && error.code === 'missing_field',
  );
  await assert.rejects(
    () => publishCommentPin(signer, { pinId: 'p1', content: '' }),
    (error) => error instanceof CommentPublishError && error.code === 'missing_field',
  );
  assert.equal(calls.length, 0, 'no writePin call may happen on validation failure');
});

test('formatCommentPinResult renders the IDBots-shaped sheet', () => {
  const sheet = formatCommentPinResult({
    commentPinId: 'c1',
    txids: ['t1'],
    totalCost: 90,
    targetPinId: 'target-1',
  });
  assert.match(sheet, /^Commented on pin target-1 — comment published on-chain\./);
  assert.match(sheet, /- comment pinId: c1/);
  assert.match(sheet, /- txids: t1/);
  assert.match(sheet, /- target pinId: target-1/);
  assert.match(sheet, /- cost: 90 sats/);
  assert.match(sheet, /- view link: \[pin:\/\/c1\]\(pin:\/\/c1\)/);
});
