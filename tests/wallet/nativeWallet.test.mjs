import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  decimalAmountToSatoshis,
  parseWalletTransferAmount,
  queryWalletBalances,
  previewWalletTransfer,
  confirmWalletTransfer,
} = require('../../dist/core/wallet/nativeWallet.js');

function fakeAdapter(chain, calls, overrides = {}) {
  return {
    network: chain,
    explorerBaseUrl: `https://explorer.example/${chain}`,
    feeRateUnit: overrides.feeRateUnit ?? 'sat/byte',
    minTransferSatoshis: overrides.minTransferSatoshis ?? 1,
    deriveAddress: async () => `${chain}-derived`,
    fetchUtxos: async () => [],
    fetchBalance: async (address) => {
      calls.push({ chain, address });
      return {
        chain,
        address,
        totalSatoshis: overrides.totalSatoshis ?? 1_000_000,
        confirmedSatoshis: overrides.totalSatoshis ?? 1_000_000,
        unconfirmedSatoshis: 0,
        utxoCount: 1,
      };
    },
    fetchFeeRate: async () => overrides.feeRate ?? 2,
    fetchRawTx: async () => 'raw-prev',
    broadcastTx: async (rawTx) => {
      calls.push({ chain, rawTx });
      return overrides.txid ?? `${chain}-txid`;
    },
    buildTransfer: overrides.buildTransfer ?? (async (input) => {
      calls.push({ chain, buildTransfer: input });
      return { rawTx: `${chain}-signed-raw`, fee: 100 };
    }),
    buildInscription: async () => ({ signedRawTxs: [], revealIndices: [], totalCost: 0 }),
  };
}

test('decimalAmountToSatoshis converts decimal strings without floating-point rounding', () => {
  assert.equal(decimalAmountToSatoshis('0.00000001'), 1);
  assert.equal(decimalAmountToSatoshis('1.23456789'), 123_456_789);
  assert.throws(() => decimalAmountToSatoshis('0.000000001'), /at most 8 decimal/);
});

test('parseWalletTransferAmount supports BTC, SPACE, DOGE, and OPCAT units', () => {
  const adapters = new Map(['mvc', 'btc', 'doge', 'opcat'].map((chain) => [chain, fakeAdapter(chain, [])]));

  assert.deepEqual(
    ['0.000001BTC', '1SPACE', '0.01DOGE', '0.000001OPCAT'].map((amount) => {
      const parsed = parseWalletTransferAmount(amount, adapters);
      return { chain: parsed.chain, currency: parsed.currency, satoshis: parsed.satoshis };
    }),
    [
      { chain: 'btc', currency: 'BTC', satoshis: 100 },
      { chain: 'mvc', currency: 'SPACE', satoshis: 100_000_000 },
      { chain: 'doge', currency: 'DOGE', satoshis: 1_000_000 },
      { chain: 'opcat', currency: 'OPCAT', satoshis: 100 },
    ],
  );
});

test('queryWalletBalances queries every registered native chain with its chain-specific address', async () => {
  const calls = [];
  const adapters = new Map(['mvc', 'btc', 'doge', 'opcat'].map((chain) => [chain, fakeAdapter(chain, calls)]));
  const identity = {
    globalMetaId: 'gm',
    mvcAddress: 'mvc-address',
    addresses: { mvc: 'mvc-address', btc: 'btc-address', doge: 'doge-address', opcat: 'opcat-address' },
  };

  const result = await queryWalletBalances({ identity, adapters, chain: 'all' });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.address), ['mvc-address', 'btc-address', 'doge-address', 'opcat-address']);
});

test('queryWalletBalances does not fall back to mvcAddress for missing DOGE address', async () => {
  const adapters = new Map([['doge', fakeAdapter('doge', [])]]);
  const result = await queryWalletBalances({
    identity: { globalMetaId: 'gm', mvcAddress: 'mvc-address', addresses: { mvc: 'mvc-address' } },
    adapters,
    chain: 'doge',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'identity_address_missing');
});

test('previewWalletTransfer returns awaiting_confirmation without broadcasting', async () => {
  const calls = [];
  const adapters = new Map([['opcat', fakeAdapter('opcat', calls, { totalSatoshis: 100_000 })]]);
  const result = await previewWalletTransfer({
    identity: {
      globalMetaId: 'gm',
      mvcAddress: 'mvc-address',
      addresses: { opcat: 'opcat-address' },
      path: "m/44'/10001'/0'/0/0",
    },
    adapters,
    toAddress: 'opcat-recipient',
    amountRaw: '0.000001OPCAT',
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'awaiting_confirmation');
  assert.equal(result.data.chain, 'opcat');
  assert.equal(result.data.currency, 'OPCAT');
  assert.deepEqual(calls.filter((call) => call.rawTx), []);
});

test('confirmWalletTransfer broadcasts a signed transfer and returns tx metadata', async () => {
  const calls = [];
  const adapters = new Map([['doge', fakeAdapter('doge', calls, { totalSatoshis: 100_000, txid: 'doge-final-txid' })]]);
  const secretStore = {
    readIdentitySecrets: async () => ({
      mnemonic: 'selected profile mnemonic',
      path: "m/44'/10001'/0'/0/2",
    }),
  };

  const result = await confirmWalletTransfer({
    identity: {
      globalMetaId: 'gm',
      mvcAddress: 'mvc-address',
      addresses: { doge: 'doge-address' },
      path: "m/44'/10001'/0'/0/0",
    },
    secretStore,
    adapters,
    toAddress: 'doge-recipient',
    amountRaw: '0.000001DOGE',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.txid, 'doge-final-txid');
  assert.equal(result.data.explorerUrl, 'https://explorer.example/doge/tx/doge-final-txid');
  assert.equal(result.data.amount, '0.00000100 DOGE');
  assert.equal(calls.some((call) => call.rawTx === 'doge-signed-raw'), true);
});

test('confirmWalletTransfer signs with the selected profile secret store and secret path', async () => {
  const calls = [];
  const buildInputs = [];
  const adapters = new Map([['btc', fakeAdapter('btc', calls, {
    totalSatoshis: 100_000,
    buildTransfer: async (input) => {
      buildInputs.push(input);
      return { rawTx: 'signed-raw', fee: 100 };
    },
  })]]);
  const secretStore = {
    readIdentitySecrets: async () => ({
      mnemonic: 'selected profile mnemonic',
      path: "m/44'/10001'/0'/0/7",
    }),
  };

  const result = await confirmWalletTransfer({
    identity: {
      globalMetaId: 'gm-selected',
      mvcAddress: 'mvc-selected',
      addresses: { btc: 'btc-selected' },
      path: "m/44'/10001'/0'/0/0",
    },
    secretStore,
    adapters,
    toAddress: 'btc-recipient',
    amountRaw: '0.000001BTC',
  });

  assert.equal(result.ok, true);
  assert.equal(buildInputs[0].mnemonic, 'selected profile mnemonic');
  assert.equal(buildInputs[0].path, "m/44'/10001'/0'/0/7");
});
