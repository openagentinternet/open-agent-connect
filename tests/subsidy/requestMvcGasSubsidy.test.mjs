import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  requestMvcGasSubsidy,
} = require('../../dist/core/subsidy/requestMvcGasSubsidy.js');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    async json() {
      return body;
    },
  };
}

function createRequest(responses, calls = []) {
  return requestMvcGasSubsidy({
    mvcAddress: '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA',
    mnemonic: MNEMONIC,
    path: "m/44'/10001'/0'/0/0",
  }, {
    addressInitUrl: 'https://assist.example/address-init',
    addressRewardUrl: 'https://assist.example/address-reward',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return responses.shift();
    },
    wait: async () => {},
  });
}

test('requestMvcGasSubsidy accepts successful business responses', async () => {
  const calls = [];
  const result = await createRequest([
    jsonResponse({ code: 0, message: 'success', data: { txid: 'init-tx' } }),
    jsonResponse({ code: 0, message: 'success', data: { txid: 'reward-tx' } }),
  ], calls);

  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(result.step2, {
    code: 0,
    message: 'success',
    data: { txid: 'reward-tx' },
  });
});

test('requestMvcGasSubsidy permits idempotent duplicate responses', async () => {
  const result = await createRequest([
    jsonResponse({ code: 1, message: 'address already init', data: null }),
    jsonResponse({ code: 1, message: 'address already rewarded', data: null }),
  ]);

  assert.equal(result.success, true);
});

test('requestMvcGasSubsidy rejects an address-init business failure before reward', async () => {
  const calls = [];
  const result = await createRequest([
    jsonResponse({ code: 1, message: 'init funding unavailable', data: null }),
  ], calls);

  assert.equal(result.success, false);
  assert.equal(result.error, 'address-init failed: init funding unavailable');
  assert.equal(calls.length, 1);
});

test('requestMvcGasSubsidy rejects an address-reward business failure returned with HTTP 200', async () => {
  const result = await createRequest([
    jsonResponse({ code: 0, message: 'success', data: { txid: 'init-tx' } }),
    jsonResponse({ code: 1, message: 'asset utxo list is empty', data: null }),
  ]);

  assert.equal(result.success, false);
  assert.equal(result.error, 'address-reward failed: asset utxo list is empty');
  assert.deepEqual(result.step2, {
    code: 1,
    message: 'asset utxo list is empty',
    data: null,
  });
});

test('requestMvcGasSubsidy preserves service context for HTTP failures', async () => {
  const result = await createRequest([
    jsonResponse(
      { code: 2, message: 'Auth verified signature err', data: null },
      { ok: false, status: 401, statusText: 'Unauthorized' },
    ),
  ]);

  assert.equal(result.success, false);
  assert.equal(
    result.error,
    'address-init failed: Auth verified signature err (HTTP 401 Unauthorized)',
  );
});
