import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess, commandAwaitingConfirmation, commandFailed } = require('../../dist/core/contracts/commandResult.js');

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

// ─── wallet transfer tests ────────────────────────────────────────────────────

function makeTransferContext(overrides = {}) {
  const calls = [];
  const stdout = [];
  const context = {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      wallet: {
        transfer: async (input) => {
          calls.push(input);
          return overrides.handler ? overrides.handler(input) : commandSuccess({
            txid: 'abc123',
            explorerUrl: 'https://mempool.space/tx/abc123',
            amount: input.amountRaw,
            toAddress: input.toAddress,
          });
        },
      },
    },
  };
  return { calls, stdout, context };
}

test('runCli dispatches `metabot wallet transfer` without --confirm and calls handler with confirm=false', async () => {
  const { calls, stdout, context } = makeTransferContext({
    handler: (input) => commandAwaitingConfirmation({
      fromAddress: '1FROM...',
      currentBalance: '0.001 BTC',
      currentBalanceSatoshis: 100000,
      toAddress: input.toAddress,
      amount: '0.00001000 BTC',
      amountSatoshis: 1000,
      estimatedFee: '0.00000042 BTC',
      estimatedFeeSatoshis: 42,
      feeRateSatPerVb: 2,
      currency: 'BTC',
      chain: 'btc',
    }),
  });

  const exitCode = await runCli(
    ['wallet', 'transfer', '--to', '1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw', '--amount', '0.00001BTC'],
    context,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ toAddress: '1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw', amountRaw: '0.00001BTC', confirm: false }]);
  const result = JSON.parse(stdout.join('').trim());
  assert.equal(result.ok, true);
  assert.equal(result.state, 'awaiting_confirmation');
  assert.equal(result.data.currency, 'BTC');
  assert.equal(result.data.toAddress, '1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw');
});

test('runCli dispatches `metabot wallet transfer --confirm` with confirm=true and returns success', async () => {
  const { calls, stdout, context } = makeTransferContext();

  const exitCode = await runCli(
    ['wallet', 'transfer', '--to', '1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw', '--amount', '0.00001BTC', '--confirm'],
    context,
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ toAddress: '1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw', amountRaw: '0.00001BTC', confirm: true }]);
  const result = JSON.parse(stdout.join('').trim());
  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.equal(result.data.txid, 'abc123');
  assert.match(result.data.explorerUrl, /mempool\.space/);
});

test('runCli fails `metabot wallet transfer` when --to is missing', async () => {
  const { stdout, context } = makeTransferContext();
  const exitCode = await runCli(['wallet', 'transfer', '--amount', '0.00001BTC'], context);
  assert.equal(exitCode, 1);
  const result = JSON.parse(stdout.join('').trim());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_argument');
  assert.match(result.message, /--to/);
});

test('runCli fails `metabot wallet transfer` when --amount is missing', async () => {
  const { stdout, context } = makeTransferContext();
  const exitCode = await runCli(['wallet', 'transfer', '--to', '1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw'], context);
  assert.equal(exitCode, 1);
  const result = JSON.parse(stdout.join('').trim());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_argument');
  assert.match(result.message, /--amount/);
});

test('runCli fails `metabot wallet transfer` when currency unit is unsupported', async () => {
  const { calls, stdout, context } = makeTransferContext({
    handler: () => commandFailed('invalid_argument', 'Unsupported currency unit in "1ETH". Supported units: BTC, SPACE.'),
  });

  const exitCode = await runCli(
    ['wallet', 'transfer', '--to', '1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw', '--amount', '1ETH'],
    context,
  );
  assert.equal(exitCode, 1);
  assert.deepEqual(calls, [{ toAddress: '1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw', amountRaw: '1ETH', confirm: false }]);
  const result = JSON.parse(stdout.join('').trim());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_argument');
});

test('runCli fails `metabot wallet transfer` with insufficient_balance when handler returns it', async () => {
  const { stdout, context } = makeTransferContext({
    handler: () => ({ ok: false, state: 'failed', code: 'insufficient_balance', message: 'Balance is below required.' }),
  });

  const exitCode = await runCli(
    ['wallet', 'transfer', '--to', '1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw', '--amount', '100BTC'],
    context,
  );
  assert.equal(exitCode, 1);
  const result = JSON.parse(stdout.join('').trim());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'insufficient_balance');
});

// ─── wallet balance error tests (existing) ────────────────────────────────────

test('runCli dispatches `metabot wallet balance --chain doge` with the new dynamic chain support', async () => {
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

  // With the adapter-based architecture, chain validation happens in the handler
  // (which has the adapter registry). The CLI parser passes through any chain name.
  // doge is now a registered chain, so it's accepted at the CLI level.
  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ chain: 'doge' }]);
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
