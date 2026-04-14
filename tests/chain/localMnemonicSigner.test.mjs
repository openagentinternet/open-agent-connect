import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createLocalMnemonicSigner } = require('../../dist/core/signing/localMnemonicSigner.js');

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
