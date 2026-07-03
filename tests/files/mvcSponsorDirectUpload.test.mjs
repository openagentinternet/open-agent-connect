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
const {
  signMvcAddressMessage,
} = require('../../dist/core/subsidy/mvcMessageSigning.js');

const FIXTURE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FIXTURE_PATH = "m/44'/10001'/0'/0/0";
const FIXTURE_ADDRESS = '15Lofqw6Kpa6P8WnTYXKvmPyw3UZvvQWrB';
const FIXTURE_GLOBAL_METAID = 'idzfixtureglobalmetaid';

const identity = {
  mnemonic: FIXTURE_MNEMONIC,
  path: FIXTURE_PATH,
  publicKey: 'this-fixture-value-must-not-be-used-for-sponsor-signing',
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
  const addressInfoResponses = overrides.addressInfoResponses ?? [
    overrides.addressInfo ?? {
      exists: true,
      balance: 0,
      grantedAmount: 5000,
      reservedAmount: 0,
      spentAmount: 0,
      availableAmount: 5000,
      status: 'active',
      raw: {},
    },
    overrides.addressInfoAfter ?? {
      exists: true,
      balance: 0,
      grantedAmount: 5000,
      reservedAmount: 880,
      spentAmount: 0,
      availableAmount: 4120,
      status: 'active',
      raw: {},
    },
  ];
  let addressInfoIndex = 0;
  const client = {
    calls,
    async getAddressInfo(payload) {
      calls.push(['getAddressInfo', payload]);
      const response = addressInfoResponses[Math.min(addressInfoIndex, addressInfoResponses.length - 1)];
      addressInfoIndex += 1;
      return response;
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

function sponsorError(message, { code, stage, reason }) {
  return Object.assign(new Error(message), { code, stage, reason });
}

test('uploadMvcSponsorDirectFile uses sponsor v2 when advisory quota is sufficient', async () => {
  const restore = patchMvcUtxos();
  try {
    const filePath = await tempFile('sponsored.txt', 'hello sponsor');
    const sponsorClient = createSponsorClient();
    const helperSignature = await signMvcAddressMessage({
      mnemonic: FIXTURE_MNEMONIC,
      path: FIXTURE_PATH,
      message: 'sign sponsor challenge',
    });
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
    assert.equal(result.totalCost, 880);
    assert.equal(result.network, 'mvc');
    assert.equal(result.metafileUri, `metafile://${'b'.repeat(64)}i0.txt`);
    assert.equal(result.globalMetaId, FIXTURE_GLOBAL_METAID);
    assert.equal(result.feeAssist.mode, 'mvc_sponsor_v2');
    assert.equal(result.feeAssist.sponsor, 'mvc_sponsor_v2');
    assert.equal(result.feeAssist.used, true);
    assert.equal(result.feeAssist.stage, 'done');
    assert.equal(result.feeAssist.orderId, 'order-1');
    assert.equal(result.feeAssist.sponsoredMinerFee, 880);
    assert.equal(result.feeAssist.savedFee, 880);
    assert.equal('savedMinerFee' in result.feeAssist, false);
    assert.equal(result.feeAssist.quotaBefore.availableAmount, 5000);
    assert.equal(result.feeAssist.quotaAfter.availableAmount, 4120);
    assert.equal(typeof result.feeAssist.advisoryFeeEstimate, 'number');
    assert.equal(result.feeAssist.advisoryFeeEstimate > 0, true);

    const callNames = sponsorClient.calls.map(([name]) => name);
    assert.deepEqual(callNames, ['getAddressInfo', 'getChallenge', 'preSponsor', 'commitSponsor', 'getAddressInfo']);
    const prePayload = sponsorClient.calls.find(([name]) => name === 'preSponsor')[1];
    const commitPayload = sponsorClient.calls.find(([name]) => name === 'commitSponsor')[1];
    const signedHash = new mvc.Transaction(commitPayload.signedTxHex).id;
    assert.equal(commitPayload.message, `assist-sponsor-commit:order-1:${signedHash}`);
    assert.ok(commitPayload.signature);
    assert.equal(prePayload.address, FIXTURE_ADDRESS);
    assert.equal(prePayload.publicKey, helperSignature.publicKey);
    assert.notEqual(prePayload.publicKey, identity.publicKey);
    assert.equal(commitPayload.publicKey, helperSignature.publicKey);
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
          throw sponsorError('sponsor offline', {
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
    assert.equal(result.feeAssist.sponsor, 'mvc_sponsor_v2');
    assert.equal(result.feeAssist.used, false);
    assert.equal(result.feeAssist.reason, 'service_unavailable');
    assert.equal(result.feeAssist.stage, 'address_info');
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
    assert.equal(result.feeAssist.sponsor, 'mvc_sponsor_v2');
    assert.equal(result.feeAssist.reason, 'insufficient_quota');
    assert.equal(result.feeAssist.stage, 'address_info');
    assert.equal(typeof result.feeAssist.advisoryFeeEstimate, 'number');
    assert.deepEqual(sponsorClient.calls.map(([name]) => name), ['getAddressInfo']);
  } finally {
    restore();
  }
});

test('uploadMvcSponsorDirectFile falls back to self-paid when challenge is service-unavailable before pre', async () => {
  const restore = patchMvcUtxos();
  try {
    const filePath = await tempFile('challenge-fallback.txt', 'challenge fallback');
    const writes = [];
    const sponsorClient = createSponsorClient({
      methods: {
        async getChallenge() {
          this.calls.push(['getChallenge']);
          throw sponsorError('challenge offline', {
            code: 'mvc_fee_assist_challenge_failed',
            stage: 'challenge',
            reason: 'service_unavailable',
          });
        },
      },
    });

    const result = await uploadMvcSponsorDirectFile({
      filePath,
      fileName: 'challenge-fallback.txt',
      contentType: 'text/plain',
      bytes: Buffer.byteLength('challenge fallback'),
      extension: '.txt',
      network: 'mvc',
      signer: fakeSigner({
        writePin: async (input) => {
          writes.push(input);
          return {
            pinId: 'challenge-self-paid-pin',
            txids: ['challenge-self-paid-tx'],
            totalCost: 31,
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
    assert.equal(result.feeAssist.reason, 'service_unavailable');
    assert.equal(result.feeAssist.stage, 'challenge');
    assert.deepEqual(sponsorClient.calls.map(([name]) => name), ['getAddressInfo', 'getChallenge']);
  } finally {
    restore();
  }
});

test('uploadMvcSponsorDirectFile falls back to self-paid when pre is service-unavailable before a pre result exists', async () => {
  const restore = patchMvcUtxos();
  try {
    const filePath = await tempFile('pre-service-fallback.txt', 'pre service fallback');
    const writes = [];
    const sponsorClient = createSponsorClient({
      methods: {
        async preSponsor(payload) {
          this.calls.push(['preSponsor', payload]);
          throw sponsorError('pre service offline', {
            code: 'mvc_fee_assist_pre_failed',
            stage: 'pre',
            reason: 'service_unavailable',
          });
        },
      },
    });

    const result = await uploadMvcSponsorDirectFile({
      filePath,
      fileName: 'pre-service-fallback.txt',
      contentType: 'text/plain',
      bytes: Buffer.byteLength('pre service fallback'),
      extension: '.txt',
      network: 'mvc',
      signer: fakeSigner({
        writePin: async (input) => {
          writes.push(input);
          return {
            pinId: 'pre-service-self-paid-pin',
            txids: ['pre-service-self-paid-tx'],
            totalCost: 41,
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
    assert.equal(result.feeAssist.reason, 'service_unavailable');
    assert.equal(result.feeAssist.stage, 'pre');
    assert.deepEqual(sponsorClient.calls.map(([name]) => name), ['getAddressInfo', 'getChallenge', 'preSponsor']);
  } finally {
    restore();
  }
});

test('uploadMvcSponsorDirectFile hard-fails when pre rejects the prepared transaction', async () => {
  const restore = patchMvcUtxos();
  try {
    const filePath = await tempFile('pre-rejected.txt', 'pre rejected');
    let writePinCalled = false;
    const sponsorClient = createSponsorClient({
      methods: {
        async preSponsor(payload) {
          this.calls.push(['preSponsor', payload]);
          throw sponsorError('pre rejected', {
            code: 'mvc_fee_assist_pre_failed',
            stage: 'pre',
            reason: 'pre_rejected',
          });
        },
      },
    });

    await assert.rejects(
      () => uploadMvcSponsorDirectFile({
        filePath,
        fileName: 'pre-rejected.txt',
        contentType: 'text/plain',
        bytes: Buffer.byteLength('pre rejected'),
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
        assert.equal(error.code, 'mvc_fee_assist_pre_failed');
        assert.equal(error.data.feeAssist.reason, 'pre_rejected');
        assert.equal(error.data.feeAssist.stage, 'pre');
        assert.equal(error.data.feeAssist.used, false);
        assert.equal(error.data.feeAssist.sponsor, 'mvc_sponsor_v2');
        assert.equal(typeof error.data.feeAssist.advisoryFeeEstimate, 'number');
        return true;
      },
    );
    assert.equal(writePinCalled, false);
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
          throw sponsorError('commit rejected', {
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
        assert.equal(error.data.feeAssist.savedFee, 900);
        assert.equal(typeof error.data.feeAssist.advisoryFeeEstimate, 'number');
        assert.equal('savedMinerFee' in error.data.feeAssist, false);
        return true;
      },
    );
    assert.equal(writePinCalled, false);
  } finally {
    restore();
  }
});
