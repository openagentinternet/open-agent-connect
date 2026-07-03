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

test('mvcSponsorV2Client normalizes address info snapshots', async () => {
  const calls = [];
  const client = createMvcSponsorV2Client({
    baseUrl: 'https://www.metaso.network/assist-open-api/',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        code: 0,
        data: {
          address: 'mvc-address-1',
          gas_chain: 'mvc',
          balance: '12.34',
          rewardAmount: '5.6',
          used_amount: '1.2',
        },
      });
    },
  });

  const result = await client.getAddressInfo({ address: ' mvc-address-1 ' });

  assert.deepEqual(calls, [{
    url: 'https://www.metaso.network/assist-open-api/v2/assist/gas/address/info?address=mvc-address-1&gasChain=mvc',
    init: {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    },
  }]);
  assert.deepEqual(result, {
    address: 'mvc-address-1',
    gasChain: 'mvc',
    balance: '12.34',
    rewardAmount: '5.6',
    usedAmount: '1.2',
    raw: {
      address: 'mvc-address-1',
      gas_chain: 'mvc',
      balance: '12.34',
      rewardAmount: '5.6',
      used_amount: '1.2',
    },
  });
});

test('mvcSponsorV2Client normalizes challenge pre and commit requests', async () => {
  const calls = [];
  const responses = [
    jsonResponse({
      code: 0,
      data: {
        challengeId: 'challenge-1',
        message: 'assist-sponsor:challenge-1',
        expiresAt: '2026-07-03T10:00:00.000Z',
      },
    }),
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
        txHex: 'fully-signed-tx-hex',
        txId: 'tx-1',
        orderId: 'order-1',
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

  const challenge = await client.getChallenge({ address: 'mvc-address-1' });
  const pre = await client.preSponsor({
    address: 'mvc-address-1',
    txHex: 'unsigned-tx-hex',
    challengeId: challenge.challengeId,
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
      url: 'https://www.metaso.network/assist-open-api/v2/assist/gas/mvc/challenge',
      init: {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          address: 'mvc-address-1',
        }),
      },
    },
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
  assert.deepEqual(pre, {
    preparedTxHex: 'prepared-tx-hex',
    orderId: 'order-1',
    minerFee: '111',
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
    txHex: 'fully-signed-tx-hex',
    txId: 'tx-1',
    orderId: 'order-1',
    raw: {
      txHex: 'fully-signed-tx-hex',
      txId: 'tx-1',
      orderId: 'order-1',
    },
  });
});

test('mvcSponsorV2Client maps business failures into stable error reasons', async () => {
  const client = createMvcSponsorV2Client({
    fetchImpl: async () => jsonResponse({
      code: 4001,
      message: 'available amount not enough for current address',
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
      assert.equal(error.reason, 'insufficient_quota');
      assert.match(error.serviceMessage, /available amount not enough/i);
      assert.equal(error.message, error.serviceMessage);
      return true;
    },
  );
});

test('mvcSponsorV2Client maps transport and commit failures into stable errors with service context', async () => {
  const transportClient = createMvcSponsorV2Client({
    fetchImpl: async () => {
      throw new Error('socket hang up');
    },
  });

  await assert.rejects(
    () => transportClient.getChallenge({ address: 'mvc-address-1' }),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_challenge_failed');
      assert.equal(error.stage, 'challenge');
      assert.equal(error.reason, 'service_unavailable');
      assert.match(error.serviceMessage, /socket hang up/i);
      return true;
    },
  );

  const commitClient = createMvcSponsorV2Client({
    fetchImpl: async () => jsonResponse({
      code: 5002,
      message: 'commit failed: duplicate order state',
      data: {
        feeAssist: {
          orderId: 'order-1',
        },
      },
    }),
  });

  await assert.rejects(
    () => commitClient.commitSponsor({
      orderId: 'order-1',
      signedTxHex: 'signed-tx-hex',
      publicKey: 'public-key-hex',
      signature: 'commit-signature',
    }),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_commit_failed');
      assert.equal(error.stage, 'commit');
      assert.equal(error.reason, 'commit_failed');
      assert.match(error.serviceMessage, /commit failed/i);
      assert.deepEqual(error.data, {
        feeAssist: {
          orderId: 'order-1',
        },
      });
      return true;
    },
  );
});
