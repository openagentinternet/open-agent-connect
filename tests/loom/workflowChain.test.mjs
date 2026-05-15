import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  writeLoomProtocolRecord,
} = require('../../dist/core/loom/index.js');

const validTaskPinId = `${'a'.repeat(64)}i0`;
const validClaimPinId = `${'b'.repeat(64)}i0`;

function validStatusPayload(overrides = {}) {
  return {
    taskPinId: validTaskPinId,
    claimPinId: validClaimPinId,
    status: 'completed',
    progressSummary: 'Implemented the requested workflow helpers.',
    branchName: 'codex/metabot-loom-cli',
    commits: [
      {
        sha: 'abc1234',
        message: 'feat: add loom workflow helpers',
        files: ['src/core/loom/workflowChain.ts'],
      },
    ],
    ...overrides,
  };
}

test('validates payloads and passes stringified chain requests to injected writer', async () => {
  const calls = [];
  const payload = validStatusPayload();
  const result = await writeLoomProtocolRecord({
    protocol: 'status',
    payload,
    from: 'developer-slug',
    chain: 'btc',
    writeChain: async (request) => {
      calls.push(request);
      return {
        ok: true,
        state: 'success',
        data: {
          pinId: 'status-pin',
          txids: ['tx1'],
          network: 'btc',
          globalMetaId: 'global-meta-id',
          mvcAddress: 'mvc-address',
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    operation: 'create',
    path: '/protocols/loom-status',
    encryption: '0',
    version: '1.0.0',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    from: 'developer-slug',
    network: 'btc',
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.pinId, 'status-pin');
  assert.deepEqual(result.data.txids, ['tx1']);
  assert.equal(result.data.network, 'btc');
  assert.equal(result.data.globalMetaId, 'global-meta-id');
  assert.equal(result.data.mvcAddress, 'mvc-address');
  assert.equal(result.data.request.payload, JSON.stringify(payload));
});

test('returns invalid_payload and does not write invalid payloads', async () => {
  let called = false;
  const result = await writeLoomProtocolRecord({
    protocol: 'status',
    payload: validStatusPayload({ progressSummary: '' }),
    writeChain: async () => {
      called = true;
      throw new Error('should not be called');
    },
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'invalid_payload');
  assert.match(result.message, /progressSummary/);
});

test('maps thrown write errors to chain_write_failed', async () => {
  const result = await writeLoomProtocolRecord({
    protocol: 'status',
    payload: validStatusPayload(),
    writeChain: async () => {
      throw new Error('wallet unavailable');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'chain_write_failed');
  assert.match(result.message, /wallet unavailable/);
});

test('maps failed writer envelopes to chain_write_failed', async () => {
  const result = await writeLoomProtocolRecord({
    protocol: 'status',
    payload: validStatusPayload(),
    writeChain: async () => ({
      ok: false,
      state: 'failed',
      code: 'wallet_rejected',
      message: 'User rejected signing.',
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'chain_write_failed');
  assert.match(result.message, /wallet_rejected/);
  assert.match(result.message, /User rejected signing/);
});

test('preserves failed writer envelopes as chain write failure causes', async () => {
  const cause = {
    ok: false,
    state: 'manual_action_required',
    code: 'wallet_confirmation_required',
    message: 'Approve signing in the wallet.',
    localUiUrl: 'http://127.0.0.1:3000/confirm',
    data: {
      requestId: 'request-123',
    },
  };
  const result = await writeLoomProtocolRecord({
    protocol: 'status',
    payload: validStatusPayload(),
    writeChain: async () => cause,
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'chain_write_failed');
  assert.match(result.message, /wallet_confirmation_required/);
  assert.deepEqual(result.data.cause, cause);
});

test('requires a pinId in successful writer envelopes', async () => {
  const result = await writeLoomProtocolRecord({
    protocol: 'status',
    payload: validStatusPayload(),
    writeChain: async () => ({
      ok: true,
      state: 'success',
      data: {
        txids: ['tx1'],
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'chain_write_failed');
  assert.match(result.message, /pinId/);
});
