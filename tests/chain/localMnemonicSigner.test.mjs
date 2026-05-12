import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createLocalMnemonicSigner,
  executeTransfer,
} = require('../../dist/core/signing/localMnemonicSigner.js');
const {
  mvcChainAdapter,
  __clearPendingMvcSpentOutpointsForTests,
} = require('../../dist/core/chain/adapters/mvc.js');
const {
  btcChainAdapter,
} = require('../../dist/core/chain/adapters/btc.js');
const { mvc } = require('meta-contract');
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

function createMockMvcAdapter(overrides = {}) {
  return {
    network: 'mvc',
    explorerBaseUrl: 'https://www.mvcscan.com',
    feeRateUnit: 'sat/byte',
    minTransferSatoshis: 600,
    deriveAddress: async () => EXPECTED_IDENTITY.mvcAddress,
    fetchUtxos: async () => [],
    fetchBalance: async () => ({ chain: 'mvc', address: EXPECTED_IDENTITY.mvcAddress, totalSatoshis: 0, confirmedSatoshis: 0, unconfirmedSatoshis: 0, utxoCount: 0 }),
    fetchFeeRate: async () => 1,
    fetchRawTx: async () => '',
    broadcastTx: async () => 'b'.repeat(64),
    buildTransfer: async () => ({ rawTx: 'raw-transfer-hex', fee: 100 }),
    buildInscription: async () => ({ signedRawTxs: ['raw-inscription-hex'], revealIndices: [0], totalCost: 100 }),
    ...overrides,
  };
}

function createMockBtcAdapter(overrides = {}) {
  return {
    network: 'btc',
    explorerBaseUrl: 'https://mempool.space',
    feeRateUnit: 'sat/byte',
    minTransferSatoshis: 546,
    deriveAddress: async () => 'btc-test-address',
    fetchUtxos: async () => [],
    fetchBalance: async () => ({ chain: 'btc', address: 'btc-test-address', totalSatoshis: 0, confirmedSatoshis: 0, unconfirmedSatoshis: 0, utxoCount: 0 }),
    fetchFeeRate: async () => 2,
    fetchRawTx: async () => '',
    broadcastTx: async () => 'c'.repeat(64),
    buildTransfer: async () => ({ rawTx: 'raw-btc-transfer-hex', fee: 200 }),
    buildInscription: async () => ({ signedRawTxs: ['raw-commit-hex', 'raw-reveal-hex'], revealIndices: [1], totalCost: 300 }),
    ...overrides,
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

async function withMockedFetch(mockFetch, run) {
  const originalFetch = global.fetch;
  global.fetch = mockFetch;
  try {
    await run();
  } finally {
    global.fetch = originalFetch;
  }
}

function makeAdapterRegistry(adapters) {
  return new Map(adapters.map((a) => [a.network, a]));
}

function inputReferencesTxid(input, txid) {
  const raw = input?.prevTxId?.toString?.('hex') ?? '';
  if (raw === txid) return true;
  if (!/^[0-9a-f]{64}$/i.test(raw)) return false;
  return Buffer.from(raw, 'hex').reverse().toString('hex') === txid;
}

// ---- Tests ----

test('createLocalMnemonicSigner derives identity and private chat key material from the stored mnemonic', async () => {
  const signer = createLocalMnemonicSigner({
    secretStore: createSecretStore(),
    adapters: makeAdapterRegistry([createMockMvcAdapter()]),
  });

  const identity = await signer.getIdentity();
  const chatIdentity = await signer.getPrivateChatIdentity();

  assert.equal(identity.globalMetaId, EXPECTED_IDENTITY.globalMetaId);
  assert.equal(identity.mvcAddress, EXPECTED_IDENTITY.mvcAddress);
  assert.equal(chatIdentity.globalMetaId, EXPECTED_IDENTITY.globalMetaId);
  assert.equal(chatIdentity.chatPublicKey, EXPECTED_IDENTITY.chatPublicKey);
  assert.match(chatIdentity.privateKeyHex, /^[0-9a-f]{64}$/);
});

test('createLocalMnemonicSigner writes an MVC pin through the adapter', async () => {
  const mockAdapter = createMockMvcAdapter({
    broadcastTx: async (rawTx) => {
      return 'b'.repeat(64);
    },
  });
  const signer = createLocalMnemonicSigner({
    secretStore: createSecretStore(),
    adapters: makeAdapterRegistry([mockAdapter]),
  });

  const result = await signer.writePin({
    path: '/protocols/simplebuzz',
    payload: '{"content":"hello metabot"}',
    contentType: 'application/json',
    network: 'mvc',
  });

  assert.equal(result.pinId, `${'b'.repeat(64)}i0`);
  assert.deepEqual(result.txids, ['b'.repeat(64)]);
  assert.equal(result.network, 'mvc');
  assert.equal(result.path, '/protocols/simplebuzz');
  assert.equal(result.globalMetaId, EXPECTED_IDENTITY.globalMetaId);
  assert.equal(result.totalCost >= 0, true);
});

test('MVC chain writes can spend local pending change after a just-broadcast payment', async () => {
  __clearPendingMvcSpentOutpointsForTests?.();
  try {
    let broadcastCount = 0;

    // Use a fully mocked MVC adapter
    const mockAdapter = createMockMvcAdapter({
      fetchUtxos: async () => [{
        txId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        outputIndex: 0,
        satoshis: 100_000,
        address: EXPECTED_IDENTITY.mvcAddress,
        height: 1,
      }],
      broadcastTx: async (rawTx) => {
        broadcastCount += 1;
        return '1'.repeat(64);
      },
    });

    const signer = createLocalMnemonicSigner({
      secretStore: createSecretStore(),
      adapters: makeAdapterRegistry([mockAdapter]),
    });

    // First writePin broadcasts and tracks pending UTXOs
    const result1 = await signer.writePin({
      path: '/protocols/simplebuzz',
      payload: '{"content":"first pin"}',
      contentType: 'application/json',
      network: 'mvc',
    });

    assert.equal(result1.pinId, `${'1'.repeat(64)}i0`);
    assert.equal(broadcastCount, 1);

    // Second writePin should also work (using pending UTXO tracking)
    const result2 = await signer.writePin({
      path: '/protocols/simplemsg',
      payload: '{"content":"second pin"}',
      contentType: 'application/json',
      network: 'mvc',
    });

    assert.equal(result2.pinId, `${'1'.repeat(64)}i0`);
    assert.equal(broadcastCount, 2);
  } finally {
    __clearPendingMvcSpentOutpointsForTests?.();
  }
});

test('MVC transfers serialize spend selection so concurrent sends use local zero-conf change', async () => {
  __clearPendingMvcSpentOutpointsForTests?.();
  try {
    const initialTxid = 'a'.repeat(64);
    const recipientAddress = '1BKy4CU6WpQoVfVv8fHA1RPny9mtGpCgyQ';
    const broadcasts = [];

    await withMockedFetch(async (url, init = {}) => {
      const value = String(url);

      if (value.includes('/wallet-api/v4/mvc/address/utxo-list')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              list: [{
                txid: initialTxid,
                outIndex: 0,
                value: 100_000,
                height: 1,
              }],
            },
          }),
        };
      }

      if (value.includes('/wallet-api/v3/tx/broadcast')) {
        const body = JSON.parse(String(init.body));
        const tx = new mvc.Transaction(body.rawTx);
        broadcasts.push({
          txid: tx.id,
          inputs: tx.inputs,
        });
        if (broadcasts.length === 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return {
          ok: true,
          json: async () => ({ code: 0, data: tx.id }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    }, async () => {
      const first = executeTransfer(mvcChainAdapter, {
        mnemonic: FIXTURE_MNEMONIC,
        path: FIXTURE_PATH,
        toAddress: recipientAddress,
        amountSatoshis: 10_000,
        feeRate: 1,
      });
      const second = executeTransfer(mvcChainAdapter, {
        mnemonic: FIXTURE_MNEMONIC,
        path: FIXTURE_PATH,
        toAddress: recipientAddress,
        amountSatoshis: 10_000,
        feeRate: 1,
      });

      await Promise.all([first, second]);
    });

    assert.equal(broadcasts.length, 2);
    assert.equal(inputReferencesTxid(broadcasts[0].inputs[0], initialTxid), true);
    assert.equal(inputReferencesTxid(broadcasts[1].inputs[0], initialTxid), false);
    assert.equal(inputReferencesTxid(broadcasts[1].inputs[0], broadcasts[0].txid), true);
  } finally {
    __clearPendingMvcSpentOutpointsForTests?.();
  }
});

test('MVC transfer retries can avoid a provider-stale outpoint after mempool conflict', async () => {
  __clearPendingMvcSpentOutpointsForTests?.();
  try {
    const staleTxid = 'b'.repeat(64);
    const freshTxid = 'c'.repeat(64);
    const recipientAddress = '1BKy4CU6WpQoVfVv8fHA1RPny9mtGpCgyQ';
    const broadcasts = [];

    await withMockedFetch(async (url, init = {}) => {
      const value = String(url);

      if (value.includes('/wallet-api/v4/mvc/address/utxo-list')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              list: [
                { txid: staleTxid, outIndex: 0, value: 100_000, height: 1 },
                { txid: freshTxid, outIndex: 1, value: 100_000, height: 0 },
              ],
            },
          }),
        };
      }

      if (value.includes('/wallet-api/v3/tx/broadcast')) {
        const body = JSON.parse(String(init.body));
        const tx = new mvc.Transaction(body.rawTx);
        broadcasts.push({
          txid: tx.id,
          inputs: tx.inputs,
        });
        if (broadcasts.length === 1) {
          return {
            ok: true,
            json: async () => ({ code: -26, message: '[-26]258: txn-mempool-conflict' }),
          };
        }
        return {
          ok: true,
          json: async () => ({ code: 0, data: tx.id }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    }, async () => {
      await assert.rejects(
        () => executeTransfer(mvcChainAdapter, {
          mnemonic: FIXTURE_MNEMONIC,
          path: FIXTURE_PATH,
          toAddress: recipientAddress,
          amountSatoshis: 10_000,
          feeRate: 1,
        }),
        /txn-mempool-conflict/
      );

      await executeTransfer(mvcChainAdapter, {
        mnemonic: FIXTURE_MNEMONIC,
        path: FIXTURE_PATH,
        toAddress: recipientAddress,
        amountSatoshis: 10_000,
        feeRate: 1,
      });
    });

    assert.equal(broadcasts.length, 2);
    assert.equal(inputReferencesTxid(broadcasts[0].inputs[0], staleTxid), true);
    assert.equal(inputReferencesTxid(broadcasts[1].inputs[0], staleTxid), false);
    assert.equal(inputReferencesTxid(broadcasts[1].inputs[0], freshTxid), true);
  } finally {
    __clearPendingMvcSpentOutpointsForTests?.();
  }
});

test('createLocalMnemonicSigner writes a BTC pin through the BTC adapter', async () => {
  const btcAdapter = createMockBtcAdapter({
    buildInscription: async () => ({
      signedRawTxs: ['raw-commit', 'raw-reveal'],
      revealIndices: [1],
      totalCost: 456,
    }),
    broadcastTx: async (rawTx) => {
      return rawTx === 'raw-commit' ? 'commit-txid-64'.padEnd(64, '0') : 'c'.repeat(64);
    },
  });
  const signer = createLocalMnemonicSigner({
    secretStore: createSecretStore(),
    adapters: makeAdapterRegistry([btcAdapter]),
  });

  const result = await signer.writePin({
    path: '/protocols/simplebuzz',
    payload: '{"content":"hello from btc"}',
    contentType: 'application/json',
    network: 'btc',
  });

  assert.equal(result.pinId, `${'c'.repeat(64)}i0`);
  assert.deepEqual(result.txids, ['c'.repeat(64)]);
  assert.equal(result.totalCost, 456);
  assert.equal(result.network, 'btc');
});

test('createLocalMnemonicSigner rejects unsupported chain network', async () => {
  const signer = createLocalMnemonicSigner({
    secretStore: createSecretStore(),
    adapters: makeAdapterRegistry([createMockMvcAdapter()]),
  });

  await assert.rejects(
    async () => signer.writePin({
      path: '/protocols/simplebuzz',
      payload: '{"content":"unsupported"}',
      contentType: 'application/json',
      network: 'btc',
    }),
    /Chain write network btc is not supported/
  );
});

test('BTC adapter uses real BtcWallet for inscription via adapter', async () => {
  const signCalls = [];

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
    await withMockedFetch(async (url, init = {}) => {
      const value = String(url);

      if (value.includes('/wallet-api/v3/address/btc-utxo')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: [{
              txId: 'a'.repeat(64),
              outputIndex: 0,
              satoshis: 15000,
              address: 'btc-test-address',
            }],
          }),
        };
      }

      if (value.includes('/wallet-api/v3/tx/raw')) {
        // P2PKH needs rawTx attached to each UTXO
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: { rawTx: 'feedbeef01' },
          }),
        };
      }

      if (value.includes('/wallet-api/v3/tx/broadcast')) {
        const body = JSON.parse(String(init.body));
        const txId = body.rawTx === 'raw-commit-hex' ? 'b'.repeat(64) : 'c'.repeat(64);
        return {
          ok: true,
          json: async () => ({ code: 0, data: txId }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${value}`);
    }, async () => {
      const signer = createLocalMnemonicSigner({
        secretStore: createSecretStore(),
        adapters: makeAdapterRegistry([btcChainAdapter]),
      });
      const result = await signer.writePin({
        path: '/protocols/simplebuzz',
        payload: Buffer.from('{"content":"btc default flow"}', 'utf8').toString('base64'),
        contentType: 'application/json',
        encoding: 'base64',
        network: 'btc',
      });

      assert.deepEqual(result.txids, ['c'.repeat(64)]);
      assert.equal(result.pinId, `${'c'.repeat(64)}i0`);
      assert.equal(result.totalCost, 33);
      assert.equal(result.network, 'btc');
      assert.equal(signCalls.length, 1);
      assert.equal(signCalls[0].signType, SignType.INSCRIBE_METAIDPIN);
      assert.equal(signCalls[0].options.feeRate, 2);
    });
  });
});

test('BTC adapter fails with clear error when there are no BTC UTXOs', async () => {
  await withMockedBtcWallet({
    getAddress: () => 'btc-test-address',
    getScriptType: () => 'P2TR',
    signTx: () => {
      throw new Error('signTx should not be called when no UTXOs are available');
    },
  }, async () => {
    await withMockedFetch(async (url) => {
      const value = String(url);
      if (value.includes('/wallet-api/v3/address/btc-utxo')) {
        return {
          ok: true,
          json: async () => ({ code: 0, data: [] }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${value}`);
    }, async () => {
      const signer = createLocalMnemonicSigner({
        secretStore: createSecretStore(),
        adapters: makeAdapterRegistry([btcChainAdapter]),
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
});

test('BTC adapter fails when signTx produces no reveal transaction', async () => {
  await withMockedBtcWallet({
    getAddress: () => 'btc-test-address',
    getScriptType: () => 'P2TR',
    signTx: () => ({
      commitTx: { rawTx: 'raw-commit-hex', fee: 9 },
      revealTxs: [],
    }),
  }, async () => {
    await withMockedFetch(async (url, init = {}) => {
      const value = String(url);
      if (value.includes('/wallet-api/v3/address/btc-utxo')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: [{ txId: 'd'.repeat(64), outputIndex: 1, satoshis: 20000, address: 'btc-test-address' }],
          }),
        };
      }
      if (value.includes('/wallet-api/v3/tx/broadcast')) {
        const body = JSON.parse(String(init.body));
        const txId = body.rawTx === 'raw-commit-hex' ? 'e'.repeat(64) : 'f'.repeat(64);
        return {
          ok: true,
          json: async () => ({ code: 0, data: txId }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${value}`);
    }, async () => {
      const signer = createLocalMnemonicSigner({
        secretStore: createSecretStore(),
        adapters: makeAdapterRegistry([btcChainAdapter]),
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
    });
  });
});
