import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createLocalMnemonicSigner } = require('../../dist/core/signing/localMnemonicSigner.js');
const { BtcWallet, SignType } = require('@metalet/utxo-wallet-service');

const FIXTURE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FIXTURE_PATH = "m/44'/10001'/0'/0/0";

const EXPECTED_IDENTITY = {
  globalMetaId: 'idq1970463ym8fqmgawe4lylktne97ahhw4kqehkch',
  chatPublicKey: '04f6b1d713f8e4a00515996cd2e0fd1f00460c08aa17793bd39d53c15ef6b10531c2485f34c37189e85e7723c90598111a845f31871f3b1bf6d080e60f3e929773',
  mvcAddress: '15Lofqw6Kpa6P8WnTYXKvmPyw3UZvvQWrB',
};

function createSecretStore() {
  return {
    readIdentitySecrets: async () => ({
      mnemonic: FIXTURE_MNEMONIC,
      path: FIXTURE_PATH,
    }),
  };
}

async function withMockedBtcWallet(overrides, run) {
  const originalGetAddress = BtcWallet.prototype.getAddress;
  const originalGetScriptType = BtcWallet.prototype.getScriptType;
  const originalSignTx = BtcWallet.prototype.signTx;

  BtcWallet.prototype.getAddress = overrides.getAddress;
  BtcWallet.prototype.getScriptType = overrides.getScriptType;
  BtcWallet.prototype.signTx = overrides.signTx;

  try {
    await run();
  } finally {
    BtcWallet.prototype.getAddress = originalGetAddress;
    BtcWallet.prototype.getScriptType = originalGetScriptType;
    BtcWallet.prototype.signTx = originalSignTx;
  }
}

test('createLocalMnemonicSigner derives identity and private chat key material from the stored mnemonic', async () => {
  const signer = createLocalMnemonicSigner({
    secretStore: createSecretStore(),
  });

  const identity = await signer.getIdentity();
  const chatIdentity = await signer.getPrivateChatIdentity();

  assert.equal(identity.globalMetaId, EXPECTED_IDENTITY.globalMetaId);
  assert.equal(identity.mvcAddress, EXPECTED_IDENTITY.mvcAddress);
  assert.equal(chatIdentity.globalMetaId, EXPECTED_IDENTITY.globalMetaId);
  assert.equal(chatIdentity.chatPublicKey, EXPECTED_IDENTITY.chatPublicKey);
  assert.match(chatIdentity.privateKeyHex, /^[0-9a-f]{64}$/);
});

test('createLocalMnemonicSigner writes an MVC pin through the injected transport', async () => {
  const calls = {
    address: '',
    rawTxs: [],
  };

  const signer = createLocalMnemonicSigner({
    secretStore: createSecretStore(),
    mvcTransport: {
      fetchUtxos: async (address) => {
        calls.address = address;
        return [
          {
            txid: 'a'.repeat(64),
            outIndex: 0,
            value: 10_000,
            height: 1,
          },
        ];
      },
      broadcastTx: async (rawTx) => {
        calls.rawTxs.push(rawTx);
        return 'b'.repeat(64);
      },
    },
  });

  const result = await signer.writePin({
    path: '/protocols/simplebuzz',
    payload: '{"content":"hello metabot"}',
    contentType: 'application/json',
    network: 'mvc',
  });

  assert.equal(calls.address, EXPECTED_IDENTITY.mvcAddress);
  assert.equal(calls.rawTxs.length, 1);
  assert.equal(result.pinId, `${'b'.repeat(64)}i0`);
  assert.deepEqual(result.txids, ['b'.repeat(64)]);
  assert.equal(result.network, 'mvc');
  assert.equal(result.path, '/protocols/simplebuzz');
  assert.equal(result.globalMetaId, EXPECTED_IDENTITY.globalMetaId);
  assert.equal(result.totalCost > 0, true);
});

test('createLocalMnemonicSigner writes a BTC pin through the injected btcCreatePin adapter', async () => {
  const calls = [];
  const signer = createLocalMnemonicSigner({
    secretStore: createSecretStore(),
    btcCreatePin: async (input) => {
      calls.push(input);
      return {
        txids: ['c'.repeat(64)],
        pinId: `${'c'.repeat(64)}i0`,
        totalCost: 456,
      };
    },
  });

  const result = await signer.writePin({
    path: '/protocols/simplebuzz',
    payload: '{"content":"hello from btc"}',
    contentType: 'application/json',
    network: 'btc',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.network, 'btc');
  assert.equal(calls[0].request.path, '/protocols/simplebuzz');
  assert.equal(calls[0].identity.globalMetaId, EXPECTED_IDENTITY.globalMetaId);
  assert.equal(result.pinId, `${'c'.repeat(64)}i0`);
  assert.deepEqual(result.txids, ['c'.repeat(64)]);
  assert.equal(result.totalCost, 456);
  assert.equal(result.network, 'btc');
});

test('createLocalMnemonicSigner default BTC flow signs INSCRIBE_METAIDPIN and keeps optional confirmed as-is', async () => {
  const signCalls = [];
  const transportCalls = {
    fetchUtxos: [],
    broadcastTx: [],
  };

  await withMockedBtcWallet({
    getAddress: () => 'btc-test-address',
    getScriptType: () => 'P2PKH',
    signTx: (signType, options) => {
      signCalls.push({ signType, options });
      return {
        commitTx: { rawTx: 'raw-commit-hex', fee: 11 },
        revealTxs: [{ rawTx: 'raw-reveal-hex', fee: 22 }],
      };
    },
  }, async () => {
    const signer = createLocalMnemonicSigner({
      secretStore: createSecretStore(),
      btcTransport: {
        fetchUtxos: async (address, needRawTx) => {
          transportCalls.fetchUtxos.push({ address, needRawTx });
          return [{
            txId: 'a'.repeat(64),
            outputIndex: 0,
            satoshis: 15_000,
            address,
            rawTx: 'ff',
          }];
        },
        broadcastTx: async (rawTx) => {
          transportCalls.broadcastTx.push(rawTx);
          return transportCalls.broadcastTx.length === 1 ? 'b'.repeat(64) : 'c'.repeat(64);
        },
      },
    });

    const result = await signer.writePin({
      path: '/protocols/simplebuzz',
      payload: Buffer.from('{"content":"btc default flow"}', 'utf8').toString('base64'),
      contentType: 'application/json',
      encoding: 'base64',
      network: 'btc',
    });

    assert.deepEqual(transportCalls.fetchUtxos, [{
      address: 'btc-test-address',
      needRawTx: true,
    }]);
    assert.deepEqual(transportCalls.broadcastTx, ['raw-commit-hex', 'raw-reveal-hex']);
    assert.equal(signCalls.length, 1);
    assert.equal(signCalls[0].signType, SignType.INSCRIBE_METAIDPIN);
    assert.equal(signCalls[0].options.feeRate, 2);
    assert.equal(signCalls[0].options.utxos[0].confirmed, undefined);
    assert.equal(signCalls[0].options.metaidDataList[0].body, '{"content":"btc default flow"}');
    assert.equal(signCalls[0].options.metaidDataList[0].revealAddr, 'btc-test-address');
    assert.deepEqual(result.txids, ['c'.repeat(64)]);
    assert.equal(result.pinId, `${'c'.repeat(64)}i0`);
    assert.equal(result.totalCost, 33);
    assert.equal(result.network, 'btc');
  });
});

test('createLocalMnemonicSigner default BTC flow fails with clear error when there are no btc utxos', async () => {
  await withMockedBtcWallet({
    getAddress: () => 'btc-test-address',
    getScriptType: () => 'P2TR',
    signTx: () => {
      throw new Error('signTx should not be called when no utxos are available');
    },
  }, async () => {
    const signer = createLocalMnemonicSigner({
      secretStore: createSecretStore(),
      btcTransport: {
        fetchUtxos: async () => [],
        broadcastTx: async () => {
          throw new Error('broadcast should not be called when no utxos are available');
        },
      },
    });

    await assert.rejects(
      async () => signer.writePin({
        path: '/protocols/simplebuzz',
        payload: '{"content":"need btc utxo"}',
        contentType: 'application/json',
        network: 'btc',
      }),
      /MetaBot BTC balance is insufficient for this chain write\./
    );
  });
});

test('createLocalMnemonicSigner default BTC flow fails when signTx produces no reveal transaction', async () => {
  await withMockedBtcWallet({
    getAddress: () => 'btc-test-address',
    getScriptType: () => 'P2TR',
    signTx: () => ({
      commitTx: { rawTx: 'raw-commit-hex', fee: 9 },
      revealTxs: [],
    }),
  }, async () => {
    const broadcasts = [];
    const signer = createLocalMnemonicSigner({
      secretStore: createSecretStore(),
      btcTransport: {
        fetchUtxos: async (address) => [{
          txId: 'd'.repeat(64),
          outputIndex: 1,
          satoshis: 20_000,
          address,
        }],
        broadcastTx: async (rawTx) => {
          broadcasts.push(rawTx);
          return 'e'.repeat(64);
        },
      },
    });

    await assert.rejects(
      async () => signer.writePin({
        path: '/protocols/simplebuzz',
        payload: '{"content":"missing reveal"}',
        contentType: 'application/json',
        network: 'btc',
      }),
      /BTC inscription produced no reveal transaction\./
    );
    assert.deepEqual(broadcasts, ['raw-commit-hex']);
  });
});
