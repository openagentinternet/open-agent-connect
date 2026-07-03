import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createMvcSponsorV2Client,
} = require('../../dist/core/subsidy/mvcSponsorV2Client.js');

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

test('mvcSponsorV2Client normalizes v2 quota snapshots into numeric fields', async () => {
  const calls = [];
  const client = createMvcSponsorV2Client({
    baseUrl: 'https://www.metaso.network/assist-open-api/',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        code: 0,
        data: {
          exists: true,
          balance: '98',
          grantedAmount: '100',
          reservedAmount: '1.5',
          spentAmount: 0.5,
          availableAmount: '98',
          status: 'active',
        },
      });
    },
  });

  const snapshot = await client.getAddressInfo({ address: ' mvc-address-1 ' });

  assert.deepEqual(calls, [{
    url: 'https://www.metaso.network/assist-open-api/v2/assist/gas/address/info?address=mvc-address-1&gasChain=mvc',
    init: {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    },
  }]);
  assert.deepEqual(snapshot, {
    exists: true,
    balance: 98,
    grantedAmount: 100,
    reservedAmount: 1.5,
    spentAmount: 0.5,
    availableAmount: 98,
    status: 'active',
    raw: {
      exists: true,
      balance: '98',
      grantedAmount: '100',
      reservedAmount: '1.5',
      spentAmount: 0.5,
      availableAmount: '98',
      status: 'active',
    },
  });
});

test('mvcSponsorV2Client posts challenge without forcing an address payload', async () => {
  const calls = [];
  const client = createMvcSponsorV2Client({
    baseUrl: 'https://www.metaso.network/assist-open-api',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        code: 0,
        data: {
          challengeId: 'challenge-1',
          message: 'assist-sponsor:challenge-1',
          expiresAt: '2026-07-03T10:00:00.000Z',
        },
      });
    },
  });

  const challenge = await client.getChallenge();

  assert.deepEqual(calls, [{
    url: 'https://www.metaso.network/assist-open-api/v2/assist/gas/mvc/challenge',
    init: {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  }]);
  assert.deepEqual(challenge, {
    challengeId: 'challenge-1',
    message: 'assist-sponsor:challenge-1',
    expiresAt: '2026-07-03T10:00:00.000Z',
    raw: {
      challengeId: 'challenge-1',
      message: 'assist-sponsor:challenge-1',
      expiresAt: '2026-07-03T10:00:00.000Z',
    },
  });
});

test('mvcSponsorV2Client strictly normalizes pre and commit success payloads', async () => {
  const calls = [];
  const responses = [
    jsonResponse({
      code: 0,
      data: {
        preparedTxHex: 'prepared-tx-hex',
        orderId: 'order-1',
        minerFee: '111',
        userInputIndexes: ['0', 2, '4'],
        expiresAt: '2026-07-03T10:01:00.000Z',
      },
    }),
    jsonResponse({
      code: 0,
      data: {
        txId: 'tx-1',
        txSize: '345',
        minerFee: 111,
      },
    }),
  ];
  const client = createMvcSponsorV2Client({
    baseUrl: 'https://www.metaso.network/assist-open-api',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return responses.shift();
    },
  });

  const pre = await client.preSponsor({
    address: 'mvc-address-1',
    txHex: 'unsigned-tx-hex',
    challengeId: 'challenge-1',
    publicKey: 'public-key-hex',
    signature: 'base64-signature',
  });
  const commit = await client.commitSponsor({
    orderId: pre.orderId,
    signedTxHex: 'signed-tx-hex',
    publicKey: 'public-key-hex',
    signature: 'commit-signature',
  });

  assert.deepEqual(calls, [
    {
      url: 'https://www.metaso.network/assist-open-api/v2/assist/gas/mvc/pre',
      init: {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          address: 'mvc-address-1',
          txHex: 'unsigned-tx-hex',
          challengeId: 'challenge-1',
          publicKey: 'public-key-hex',
          signature: 'base64-signature',
        }),
      },
    },
    {
      url: 'https://www.metaso.network/assist-open-api/v2/assist/gas/mvc/commit',
      init: {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          orderId: 'order-1',
          signedTxHex: 'signed-tx-hex',
          publicKey: 'public-key-hex',
          signature: 'commit-signature',
        }),
      },
    },
  ]);
  assert.deepEqual(pre, {
    preparedTxHex: 'prepared-tx-hex',
    orderId: 'order-1',
    minerFee: 111,
    userInputIndexes: [0, 2, 4],
    expiresAt: '2026-07-03T10:01:00.000Z',
    raw: {
      preparedTxHex: 'prepared-tx-hex',
      orderId: 'order-1',
      minerFee: '111',
      userInputIndexes: ['0', 2, '4'],
      expiresAt: '2026-07-03T10:01:00.000Z',
    },
  });
  assert.deepEqual(commit, {
    txId: 'tx-1',
    txSize: 345,
    minerFee: 111,
    raw: {
      txId: 'tx-1',
      txSize: '345',
      minerFee: 111,
    },
  });
});

test('mvcSponsorV2Client rejects malformed success payloads instead of defaulting required v2 fields', async () => {
  const missingPreFieldClient = createMvcSponsorV2Client({
    fetchImpl: async () => jsonResponse({
      code: 0,
      data: {
        preparedTxHex: 'prepared-tx-hex',
        orderId: 'order-1',
        expiresAt: '2026-07-03T10:01:00.000Z',
      },
    }),
  });

  await assert.rejects(
    () => missingPreFieldClient.preSponsor({
      address: 'mvc-address-1',
      txHex: 'unsigned-tx-hex',
      challengeId: 'challenge-1',
      publicKey: 'public-key-hex',
      signature: 'base64-signature',
    }),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_pre_failed');
      assert.equal(error.stage, 'pre');
      assert.equal(error.reason, 'pre_rejected');
      assert.match(error.serviceMessage, /missing required fields/i);
      return true;
    },
  );

  const missingCommitFieldClient = createMvcSponsorV2Client({
    fetchImpl: async () => jsonResponse({
      code: 0,
      data: {
        txSize: '345',
      },
    }),
  });

  await assert.rejects(
    () => missingCommitFieldClient.commitSponsor({
      orderId: 'order-1',
      signedTxHex: 'signed-tx-hex',
      publicKey: 'public-key-hex',
      signature: 'commit-signature',
    }),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_commit_failed');
      assert.equal(error.stage, 'commit');
      assert.equal(error.reason, 'commit_failed');
      assert.match(error.serviceMessage, /missing required fields/i);
      return true;
    },
  );
});

test('mvcSponsorV2Client rejects mixed invalid userInputIndexes instead of filtering them', async () => {
  const client = createMvcSponsorV2Client({
    fetchImpl: async () => jsonResponse({
      code: 0,
      data: {
        preparedTxHex: 'prepared-tx-hex',
        orderId: 'order-1',
        minerFee: '111',
        userInputIndexes: [0, 'bad', 2],
        expiresAt: '2026-07-03T10:01:00.000Z',
      },
    }),
  });

  await assert.rejects(
    () => client.preSponsor({
      address: 'mvc-address-1',
      txHex: 'unsigned-tx-hex',
      challengeId: 'challenge-1',
      publicKey: 'public-key-hex',
      signature: 'base64-signature',
    }),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_pre_failed');
      assert.equal(error.stage, 'pre');
      assert.equal(error.reason, 'pre_rejected');
      assert.match(error.serviceMessage, /missing required fields/i);
      return true;
    },
  );
});

test('mvcSponsorV2Client rejects blank numeric strings in required quota fields', async () => {
  const client = createMvcSponsorV2Client({
    fetchImpl: async () => jsonResponse({
      code: 0,
      data: {
        exists: true,
        balance: ' ',
        grantedAmount: '100',
        reservedAmount: '1.5',
        spentAmount: 0.5,
        availableAmount: '98',
        status: 'active',
      },
    }),
  });

  await assert.rejects(
    () => client.getAddressInfo({ address: 'mvc-address-1' }),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_address_info_failed');
      assert.equal(error.stage, 'address_info');
      assert.equal(error.reason, 'service_unavailable');
      assert.match(error.serviceMessage, /missing required fields/i);
      return true;
    },
  );
});

test('mvcSponsorV2Client maps business failures into stable quota and pre_rejected reasons', async () => {
  const quotaClient = createMvcSponsorV2Client({
    fetchImpl: async () => jsonResponse({
      code: 4001,
      message: 'sponsor available amount not enough',
    }, { ok: false, status: 400 }),
  });

  await assert.rejects(
    () => quotaClient.preSponsor({
      address: 'mvc-address-1',
      txHex: 'unsigned-tx-hex',
      challengeId: 'challenge-1',
      publicKey: 'public-key-hex',
      signature: 'base64-signature',
    }),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_pre_failed');
      assert.equal(error.stage, 'pre');
      assert.equal(error.reason, 'insufficient_quota');
      assert.match(error.serviceMessage, /available amount not enough/i);
      return true;
    },
  );

  const rejectedClient = createMvcSponsorV2Client({
    fetchImpl: async () => jsonResponse({
      code: 4003,
      message: 'address not match first input address',
    }, { ok: false, status: 400 }),
  });

  await assert.rejects(
    () => rejectedClient.preSponsor({
      address: 'mvc-address-1',
      txHex: 'unsigned-tx-hex',
      challengeId: 'challenge-1',
      publicKey: 'public-key-hex',
      signature: 'base64-signature',
    }),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_pre_failed');
      assert.equal(error.stage, 'pre');
      assert.equal(error.reason, 'pre_rejected');
      assert.match(error.serviceMessage, /address not match/i);
      return true;
    },
  );
});

test('mvcSponsorV2Client keeps service failures separate from validation failures', async () => {
  const transportClient = createMvcSponsorV2Client({
    fetchImpl: async () => {
      throw new Error('socket hang up');
    },
  });

  await assert.rejects(
    () => transportClient.getChallenge(),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_challenge_failed');
      assert.equal(error.stage, 'challenge');
      assert.equal(error.reason, 'service_unavailable');
      assert.match(error.serviceMessage, /socket hang up/i);
      return true;
    },
  );

  const client = createMvcSponsorV2Client();
  await assert.rejects(
    () => client.preSponsor({
      address: '',
      txHex: 'unsigned-tx-hex',
      challengeId: 'challenge-1',
      publicKey: 'public-key-hex',
      signature: 'base64-signature',
    }),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_pre_failed');
      assert.equal(error.stage, 'pre');
      assert.equal(error.reason, 'pre_rejected');
      assert.match(error.serviceMessage, /address is required/i);
      return true;
    },
  );
});
