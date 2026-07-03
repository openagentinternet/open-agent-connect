import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { mvc } = require('meta-contract');
const mvcChainAdapter = require('../../dist/core/chain/adapters/mvc.js').default;
const {
  uploadMvcSponsorDirectFile,
} = require('../../dist/core/files/mvcSponsorDirectUpload.js');

const FIXTURE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FIXTURE_PATH = "m/44'/10001'/0'/0/0";
const FIXTURE_ADDRESS = '15Lofqw6Kpa6P8WnTYXKvmPyw3UZvvQWrB';
const FIXTURE_GLOBAL_METAID = 'idzfixtureglobalmetaid';

const identity = {
  mnemonic: FIXTURE_MNEMONIC,
  path: FIXTURE_PATH,
  publicKey: 'fixture-public-key',
  chatPublicKey: '',
  addresses: { mvc: FIXTURE_ADDRESS },
  mvcAddress: FIXTURE_ADDRESS,
  metaId: '',
  globalMetaId: FIXTURE_GLOBAL_METAID,
};

const fixtureUtxo = {
  txId: 'a'.repeat(64),
  outputIndex: 0,
  satoshis: 100_000,
  address: FIXTURE_ADDRESS,
  height: 1,
};

async function tempFile(name, content) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-sponsor-direct-'));
  const filePath = path.join(tempDir, name);
  await writeFile(filePath, Buffer.from(content));
  return filePath;
}

function patchMvcUtxos(utxos = [fixtureUtxo]) {
  const originalFetchUtxos = mvcChainAdapter.fetchUtxos;
  mvcChainAdapter.fetchUtxos = async () => utxos;
  return () => {
    mvcChainAdapter.fetchUtxos = originalFetchUtxos;
  };
}

function fakeSigner({ writePin } = {}) {
  return {
    getIdentity: async () => identity,
    writePin: writePin ?? (async (input) => ({
      pinId: 'self-paid-pin',
      txids: ['self-paid-tx'],
      totalCost: 17,
      network: input.network,
      operation: 'create',
      path: input.path,
      contentType: input.contentType,
      encoding: input.encoding,
      globalMetaId: FIXTURE_GLOBAL_METAID,
      mvcAddress: FIXTURE_ADDRESS,
    })),
  };
}

function createSponsorClient(overrides = {}) {
  const calls = [];
  const client = {
    calls,
    async getAddressInfo(payload) {
      calls.push(['getAddressInfo', payload]);
      return overrides.addressInfo ?? {
        exists: true,
        balance: 0,
        grantedAmount: 5000,
        reservedAmount: 0,
        spentAmount: 0,
        availableAmount: 5000,
        status: 'active',
        raw: {},
      };
    },
    async getChallenge() {
      calls.push(['getChallenge']);
      return {
        challengeId: 'challenge-1',
        message: 'sign sponsor challenge',
        raw: {},
      };
    },
    async preSponsor(payload) {
      calls.push(['preSponsor', payload]);
      return {
        preparedTxHex: payload.txHex,
        orderId: 'order-1',
        minerFee: 900,
        userInputIndexes: [0],
        raw: {},
      };
    },
    async commitSponsor(payload) {
      calls.push(['commitSponsor', payload]);
      if (overrides.assertCommitPayload) {
        overrides.assertCommitPayload(payload);
      }
      return overrides.commitResult ?? {
        txId: 'b'.repeat(64),
        minerFee: 880,
        raw: {},
      };
    },
    ...overrides.methods,
  };
  return client;
}

test('uploadMvcSponsorDirectFile uses sponsor v2 when advisory quota is sufficient', async () => {
  const restore = patchMvcUtxos();
  try {
    const filePath = await tempFile('sponsored.txt', 'hello sponsor');
    const sponsorClient = createSponsorClient();
    const result = await uploadMvcSponsorDirectFile({
      filePath,
      fileName: 'sponsored.txt',
      contentType: 'text/plain',
      bytes: Buffer.byteLength('hello sponsor'),
      extension: '.txt',
      network: 'mvc',
      signer: fakeSigner({
        writePin: async () => {
          throw new Error('self-paid writePin should not be called');
        },
      }),
      mvcSponsorClient: sponsorClient,
    });

    assert.equal(result.pinId, `${'b'.repeat(64)}i0`);
    assert.deepEqual(result.txids, ['b'.repeat(64)]);
    assert.equal(result.totalCost, 0);
    assert.equal(result.network, 'mvc');
    assert.equal(result.metafileUri, `metafile://${'b'.repeat(64)}i0.txt`);
    assert.equal(result.globalMetaId, FIXTURE_GLOBAL_METAID);
    assert.equal(result.feeAssist.mode, 'mvc_sponsor_v2');
    assert.equal(result.feeAssist.used, true);
    assert.equal(result.feeAssist.orderId, 'order-1');
    assert.equal(result.feeAssist.sponsoredMinerFee, 880);
    assert.equal(result.feeAssist.savedMinerFee, 880);
    assert.equal(result.feeAssist.quotaBefore.availableAmount, 5000);

    const callNames = sponsorClient.calls.map(([name]) => name);
    assert.deepEqual(callNames, ['getAddressInfo', 'getChallenge', 'preSponsor', 'commitSponsor']);
    const commitPayload = sponsorClient.calls.find(([name]) => name === 'commitSponsor')[1];
    const signedHash = new mvc.Transaction(commitPayload.signedTxHex).id;
    assert.equal(commitPayload.message, `assist-sponsor-commit:order-1:${signedHash}`);
    assert.ok(commitPayload.signature);
    assert.equal(
      sponsorClient.calls.find(([name]) => name === 'preSponsor')[1].address,
      FIXTURE_ADDRESS,
    );
    assert.equal(typeof signedHash, 'string');
  } finally {
    restore();
  }
});

test('uploadMvcSponsorDirectFile falls back to self-paid when address info is unavailable before pre', async () => {
  const restore = patchMvcUtxos();
  try {
    const filePath = await tempFile('fallback.txt', 'fallback');
    const writes = [];
    const sponsorClient = createSponsorClient({
      methods: {
        async getAddressInfo() {
          throw Object.assign(new Error('sponsor offline'), {
            code: 'mvc_fee_assist_address_info_failed',
            stage: 'address_info',
            reason: 'service_unavailable',
          });
        },
      },
    });

    const result = await uploadMvcSponsorDirectFile({
      filePath,
      fileName: 'fallback.txt',
      contentType: 'text/plain',
      bytes: Buffer.byteLength('fallback'),
      extension: '.txt',
      network: 'mvc',
      signer: fakeSigner({
        writePin: async (input) => {
          writes.push(input);
          return {
            pinId: 'self-paid-pin',
            txids: ['self-paid-tx'],
            totalCost: 17,
            network: input.network,
            operation: 'create',
            path: input.path,
            contentType: input.contentType,
            encoding: input.encoding,
            globalMetaId: FIXTURE_GLOBAL_METAID,
            mvcAddress: FIXTURE_ADDRESS,
          };
        },
      }),
      mvcSponsorClient: sponsorClient,
    });

    assert.equal(writes.length, 1);
    assert.equal(result.pinId, 'self-paid-pin');
    assert.equal(result.feeAssist.mode, 'self_paid');
    assert.equal(result.feeAssist.used, false);
    assert.equal(result.feeAssist.reason, 'service_unavailable');
  } finally {
    restore();
  }
});

test('uploadMvcSponsorDirectFile falls back on insufficient quota before pre and skips sponsor writes', async () => {
  const restore = patchMvcUtxos();
  try {
    const filePath = await tempFile('quota.txt', 'quota');
    const writes = [];
    const sponsorClient = createSponsorClient({
      addressInfo: {
        exists: true,
        balance: 0,
        grantedAmount: 1,
        reservedAmount: 0,
        spentAmount: 0,
        availableAmount: 1,
        status: 'active',
        raw: {},
      },
    });

    const result = await uploadMvcSponsorDirectFile({
      filePath,
      fileName: 'quota.txt',
      contentType: 'text/plain',
      bytes: Buffer.byteLength('quota'),
      extension: '.txt',
      network: 'mvc',
      signer: fakeSigner({
        writePin: async (input) => {
          writes.push(input);
          return {
            pinId: 'quota-self-paid-pin',
            txids: ['quota-self-paid-tx'],
            totalCost: 22,
            network: input.network,
            operation: 'create',
            path: input.path,
            contentType: input.contentType,
            encoding: input.encoding,
            globalMetaId: FIXTURE_GLOBAL_METAID,
            mvcAddress: FIXTURE_ADDRESS,
          };
        },
      }),
      mvcSponsorClient: sponsorClient,
    });

    assert.equal(writes.length, 1);
    assert.equal(result.feeAssist.mode, 'self_paid');
    assert.equal(result.feeAssist.reason, 'insufficient_quota');
    assert.deepEqual(sponsorClient.calls.map(([name]) => name), ['getAddressInfo']);
  } finally {
    restore();
  }
});

test('uploadMvcSponsorDirectFile fails explicitly after pre and does not call self-paid writePin', async () => {
  const restore = patchMvcUtxos();
  try {
    const filePath = await tempFile('commit-fail.txt', 'commit fail');
    let writePinCalled = false;
    const sponsorClient = createSponsorClient({
      methods: {
        async commitSponsor() {
          throw Object.assign(new Error('commit rejected'), {
            code: 'mvc_fee_assist_commit_failed',
            stage: 'commit',
            reason: 'commit_failed',
          });
        },
      },
    });

    await assert.rejects(
      () => uploadMvcSponsorDirectFile({
        filePath,
        fileName: 'commit-fail.txt',
        contentType: 'text/plain',
        bytes: Buffer.byteLength('commit fail'),
        extension: '.txt',
        network: 'mvc',
        signer: fakeSigner({
          writePin: async () => {
            writePinCalled = true;
            throw new Error('self-paid writePin should not be called');
          },
        }),
        mvcSponsorClient: sponsorClient,
      }),
      (error) => {
        assert.equal(error.code, 'mvc_fee_assist_commit_failed');
        assert.equal(error.data.feeAssist.orderId, 'order-1');
        assert.equal(error.data.feeAssist.stage, 'commit');
        assert.equal(error.data.feeAssist.used, false);
        assert.equal(error.data.feeAssist.sponsoredMinerFee, 900);
        return true;
      },
    );
    assert.equal(writePinCalled, false);
  } finally {
    restore();
  }
});
