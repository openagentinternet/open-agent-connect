import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

const success = (data) => ({ ok: true, state: 'success', data });

async function runTrafficCli(args, traffic) {
  const stdout = [];
  const exitCode = await runCli(['traffic', ...args], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: { traffic },
  });
  return {
    exitCode,
    payload: JSON.parse(stdout.join('').trim()),
  };
}

test('runCli dispatches `metabot traffic status` and read verbs', async () => {
  const calls = [];
  const traffic = {
    status: async () => { calls.push(['status']); return success({ mode: 'traffic', account: null }); },
    balance: async () => { calls.push(['balance']); return success({ account: null, featureUnavailable: false }); },
    usage: async () => { calls.push(['usage']); return success({ summary: null, daily: [], source: 'unavailable' }); },
    claim: async () => { calls.push(['claim']); return success({ grantId: '7', grantBytes: 10, balanceAfter: 10 }); },
  };

  for (const verb of ['status', 'balance', 'usage', 'claim']) {
    const result = await runTrafficCli([verb], traffic);
    assert.equal(result.exitCode, 0, verb);
    assert.equal(result.payload.ok, true, verb);
  }
  assert.deepEqual(calls, [['status'], ['balance'], ['usage'], ['claim']]);
});

test('runCli dispatches `metabot traffic mode` get and set', async () => {
  const calls = [];
  const traffic = {
    getMode: async () => { calls.push(['getMode']); return success({ mode: 'traffic' }); },
    setMode: async (input) => {
      calls.push(['setMode', input]);
      return success(input.mode === 'traffic'
        ? { mode: 'traffic', bindSummary: { accountId: 'a', boundCount: 1, conflictCount: 0, failedCount: 0, results: [] } }
        : { mode: 'selfpay' });
    },
  };

  const getResult = await runTrafficCli(['mode'], traffic);
  assert.equal(getResult.exitCode, 0);
  assert.deepEqual(getResult.payload.data, { mode: 'traffic' });

  const setTraffic = await runTrafficCli(['mode', 'traffic'], traffic);
  assert.equal(setTraffic.exitCode, 0);
  assert.equal(setTraffic.payload.data.bindSummary.boundCount, 1);

  const setSelfpay = await runTrafficCli(['mode', 'selfpay'], traffic);
  assert.equal(setSelfpay.exitCode, 0);
  assert.deepEqual(setSelfpay.payload.data, { mode: 'selfpay' });

  assert.deepEqual(calls, [
    ['getMode'],
    ['setMode', { mode: 'traffic' }],
    ['setMode', { mode: 'selfpay' }],
  ]);
});

test('runCli rejects `metabot traffic mode <other>` as a usage error without a daemon call', async () => {
  const calls = [];
  const traffic = {
    setMode: async (input) => { calls.push(input); return success({ mode: input.mode }); },
  };

  const result = await runTrafficCli(['mode', 'bogus'], traffic);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'invalid_argument');
  assert.deepEqual(calls, []);
});

test('runCli dispatches `metabot traffic ledger` with default and explicit pagination', async () => {
  const calls = [];
  const traffic = {
    ledger: async (input) => { calls.push(input); return success({ entries: [], nextCursor: null }); },
  };

  const defaults = await runTrafficCli(['ledger'], traffic);
  assert.equal(defaults.exitCode, 0);
  assert.deepEqual(calls[0], { limit: 20 });

  const paged = await runTrafficCli(['ledger', '--cursor', '42', '--limit', '10'], traffic);
  assert.equal(paged.exitCode, 0);
  assert.deepEqual(calls[1], { cursor: '42', limit: 10 });
});

test('runCli rejects malformed `metabot traffic ledger` flags as usage errors', async () => {
  const calls = [];
  const traffic = {
    ledger: async (input) => { calls.push(input); return success({ entries: [], nextCursor: null }); },
  };

  const badCursor = await runTrafficCli(['ledger', '--cursor', 'abc'], traffic);
  assert.equal(badCursor.exitCode, 1);
  assert.equal(badCursor.payload.code, 'invalid_argument');

  const badLimit = await runTrafficCli(['ledger', '--limit', '0'], traffic);
  assert.equal(badLimit.exitCode, 1);
  assert.equal(badLimit.payload.code, 'invalid_argument');

  assert.deepEqual(calls, []);
});

test('runCli dispatches `metabot traffic redeem <code>` and requires the code', async () => {
  const calls = [];
  const traffic = {
    redeem: async (input) => { calls.push(input); return success({ codeId: 3, trafficBytes: 100, balanceAfter: 100 }); },
  };

  const okResult = await runTrafficCli(['redeem', 'IDB-AAAA-BBBB-CCCC'], traffic);
  assert.equal(okResult.exitCode, 0);
  assert.deepEqual(calls, [{ code: 'IDB-AAAA-BBBB-CCCC' }]);
  assert.deepEqual(okResult.payload.data, { codeId: 3, trafficBytes: 100, balanceAfter: 100 });

  const missing = await runTrafficCli(['redeem'], traffic);
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.payload.code, 'missing_argument');
  assert.deepEqual(calls, [{ code: 'IDB-AAAA-BBBB-CCCC' }]);
});

test('runCli dispatches `metabot traffic api-base` get/set/reset', async () => {
  const calls = [];
  const traffic = {
    getApiBase: async () => {
      calls.push(['get']);
      return success({ apiBase: '', effectiveApiBase: 'https://www.metaso.network/assist-open-api' });
    },
    setApiBase: async (input) => { calls.push(['set', input]); return success({ apiBase: input.apiBase, effectiveApiBase: input.apiBase }); },
    resetApiBase: async () => {
      calls.push(['reset']);
      return success({ apiBase: '', effectiveApiBase: 'https://www.metaso.network/assist-open-api' });
    },
  };

  const bareGet = await runTrafficCli(['api-base'], traffic);
  assert.equal(bareGet.exitCode, 0);
  assert.equal(bareGet.payload.data.effectiveApiBase, 'https://www.metaso.network/assist-open-api');

  const explicitGet = await runTrafficCli(['api-base', 'get'], traffic);
  assert.equal(explicitGet.exitCode, 0);

  const setResult = await runTrafficCli(['api-base', 'set', 'https://traffic.test'], traffic);
  assert.equal(setResult.exitCode, 0);
  assert.equal(setResult.payload.data.apiBase, 'https://traffic.test');

  const resetResult = await runTrafficCli(['api-base', 'reset'], traffic);
  assert.equal(resetResult.exitCode, 0);
  assert.equal(resetResult.payload.data.apiBase, '');

  assert.deepEqual(calls, [
    ['get'],
    ['get'],
    ['set', { apiBase: 'https://traffic.test' }],
    ['reset'],
  ]);
});

test('runCli rejects `metabot traffic api-base set` without a URL and unknown actions', async () => {
  const calls = [];
  const traffic = {
    setApiBase: async (input) => { calls.push(input); return success({}); },
  };

  const missing = await runTrafficCli(['api-base', 'set'], traffic);
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.payload.code, 'missing_argument');

  const unknown = await runTrafficCli(['api-base', 'bogus'], traffic);
  assert.equal(unknown.exitCode, 1);
  assert.equal(unknown.payload.code, 'invalid_argument');

  assert.deepEqual(calls, []);
});

test('runCli carries traffic failure envelopes (code + data.errorCode) through unchanged', async () => {
  const traffic = {
    claim: async () => ({
      ok: false,
      state: 'failed',
      code: 'traffic_campaign_failed',
      message: 'Already claimed.',
      data: { errorCode: 'ALREADY_CLAIMED', featureUnavailable: false, retryable: true },
    }),
  };

  const result = await runTrafficCli(['claim'], traffic);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'traffic_campaign_failed');
  assert.equal(result.payload.data.errorCode, 'ALREADY_CLAIMED');
  assert.equal(result.payload.data.featureUnavailable, false);
  assert.equal(result.payload.data.retryable, true);
});

test('runCli reports unknown traffic subcommands', async () => {
  const result = await runTrafficCli(['nope'], {});

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'unknown_command');
  assert.match(result.payload.message, /traffic nope/);
});

test('runTrafficCommand reports missing traffic handlers as not_implemented', async () => {
  // Called directly with a bare context: runCli always merges the default
  // (daemon-backed) dependencies, so the not_implemented guard is only
  // reachable when a host injects an incomplete dependency block.
  const { runTrafficCommand } = require('../../dist/cli/commands/traffic.js');
  const result = await runTrafficCommand(['status'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    env: {},
    cwd: process.cwd(),
    readTextFile: async () => '',
    dependencies: { traffic: {} },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_implemented');
});
