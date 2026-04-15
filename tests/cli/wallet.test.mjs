import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

test('runCli dispatches `metabot wallet balance` with default chain=all', async () => {
  const calls = [];
  const stdout = [];
  const exitCode = await runCli(['wallet', 'balance'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      wallet: {
        balance: async (input) => {
          calls.push(input);
          return commandSuccess({
            chain: input.chain,
            balances: {
              mvc: { totalMvc: 0.1 },
              btc: { totalBtc: 0.01 },
            },
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ chain: 'all' }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      chain: 'all',
      balances: {
        mvc: { totalMvc: 0.1 },
        btc: { totalBtc: 0.01 },
      },
    },
  });
});

test('runCli dispatches `metabot wallet balance --chain btc`', async () => {
  const calls = [];
  const exitCode = await runCli(['wallet', 'balance', '--chain', 'btc'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      wallet: {
        balance: async (input) => {
          calls.push(input);
          return commandSuccess({ chain: input.chain });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ chain: 'btc' }]);
});

test('runCli fails `metabot wallet balance` when --chain value is missing', async () => {
  const calls = [];
  const stdout = [];
  const exitCode = await runCli(['wallet', 'balance', '--chain'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      wallet: {
        balance: async (input) => {
          calls.push(input);
          return commandSuccess({ chain: input.chain });
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /Missing value for --chain/);
});

test('runCli fails `metabot wallet balance` when --chain value is unsupported', async () => {
  const calls = [];
  const stdout = [];
  const exitCode = await runCli(['wallet', 'balance', '--chain', 'doge'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      wallet: {
        balance: async (input) => {
          calls.push(input);
          return commandSuccess({ chain: input.chain });
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /Unsupported --chain value/);
});
