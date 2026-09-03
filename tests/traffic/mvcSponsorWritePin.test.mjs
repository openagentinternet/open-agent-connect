// Sponsored (traffic-mode) MVC pin-write flow tests — port of IDBots
// tests/createPinSponsor.test.mjs coverage onto OAC's
// src/core/subsidy/mvcSponsorWritePin.ts. The sponsor client is mocked per
// case (except the order-recovery test, which runs the real client over a
// stubbed fetch); UTXOs come from the injected fetchUtxos seam; one
// integration test drives the daemon-facing resolver factory with a real
// traffic account service over a temp system home.

import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { mvc } = require('meta-contract');
const {
  writeMvcSponsorPin,
  createTrafficSponsorWritePinResolver,
} = require('../../dist/core/subsidy/mvcSponsorWritePin.js');
const { createMvcSponsorV2Client } = require('../../dist/core/subsidy/mvcSponsorV2Client.js');
const { normalizeChainWriteRequest } = require('../../dist/core/chain/writePin.js');
const {
  __clearPendingMvcUtxosForTests,
  resolveSpendableMvcUtxos,
} = require('../../dist/core/chain/mvcPendingUtxos.js');
const { default: mvcChainAdapter } = require('../../dist/core/chain/adapters/mvc.js');
const { importOwnerIdentity } = require('../../dist/core/owner/ownerIdentity.js');
const { createTrafficAccountService } = require('../../dist/core/traffic/trafficAccountService.js');

const FIXTURE_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OWNER_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const WALLET_PATH = "m/44'/10001'/0'/0/0";
const FIXTURE_ADDRESS = '15Lofqw6Kpa6P8WnTYXKvmPyw3UZvvQWrB';
const FIXTURE_GLOBAL_METAID = 'idzfixtureglobalmetaid';
const COMMIT_TXID = 'b'.repeat(64);

function deriveAddress(mnemonic) {
  const network = mvc.Networks.livenet;
  const child = mvc.Mnemonic.fromString(mnemonic).toHDPrivateKey('', network).deriveChild(WALLET_PATH);
  return child.publicKey.toAddress(network).toString();
}

const OWNER_ADDRESS = deriveAddress(OWNER_MNEMONIC);

function makeIdentity(mnemonic = FIXTURE_MNEMONIC, address = FIXTURE_ADDRESS) {
  return {
    mnemonic,
    path: WALLET_PATH,
    publicKey: '',
    chatPublicKey: '',
    addresses: { mvc: address },
    mvcAddress: address,
    metaId: '',
    globalMetaId: FIXTURE_GLOBAL_METAID,
  };
}

function makeUtxo(address = FIXTURE_ADDRESS) {
  return {
    txId: 'a'.repeat(64),
    outputIndex: 0,
    satoshis: 100_000,
    address,
    height: 1,
  };
}

function makeRequest() {
  return normalizeChainWriteRequest({
    path: '/protocols/simplebuzz',
    payload: '{"content":"hello sponsor"}',
    contentType: 'application/json',
    network: 'mvc',
  });
}

function sponsorError(message, { code, stage, reason } = {}) {
  return Object.assign(new Error(message), { code, stage, reason });
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
  ];
  let addressInfoIndex = 0;
  return {
    calls,
    async getAddressInfo(payload) {
      calls.push(['getAddressInfo', payload]);
      if (overrides.addressInfoError) throw overrides.addressInfoError;
      const response = addressInfoResponses[Math.min(addressInfoIndex, addressInfoResponses.length - 1)];
      addressInfoIndex += 1;
      return response;
    },
    async getChallenge() {
      calls.push(['getChallenge']);
      if (overrides.challengeError) throw overrides.challengeError;
      return { challengeId: 'challenge-1', message: 'sign sponsor challenge', raw: {} };
    },
    async preSponsor(payload) {
      calls.push(['preSponsor', payload]);
      if (overrides.preError) throw overrides.preError;
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
      if (overrides.commitError) throw overrides.commitError;
      return overrides.commitResult ?? { txId: COMMIT_TXID, txSize: 300, minerFee: 880, raw: {} };
    },
  };
}

function createTrafficDeps(overrides = {}) {
  const trafficAccount = 'trafficAccount' in overrides
    ? overrides.trafficAccount
    : { accountId: 'gmid-account', authSignature: 'YXV0aA==', timestamp: 1730000000 };
  const deps = {
    resolveCalls: [],
    spendRecords: [],
    async resolveTrafficAccount(input) {
      deps.resolveCalls.push(input);
      return trafficAccount;
    },
    async recordSpend(entry) {
      deps.spendRecords.push(entry);
    },
  };
  return deps;
}

function createSelfPaidWorker() {
  const state = { calls: 0 };
  const runSelfPaid = async () => {
    state.calls += 1;
    return {
      txids: ['f'.repeat(64)],
      pinId: `${'f'.repeat(64)}i0`,
      totalCost: 901,
      network: 'mvc',
      operation: 'create',
      path: '/protocols/simplebuzz',
      contentType: 'application/json',
      encoding: 'utf-8',
      globalMetaId: FIXTURE_GLOBAL_METAID,
      mvcAddress: FIXTURE_ADDRESS,
    };
  };
  return { runSelfPaid, state };
}

beforeEach(() => {
  __clearPendingMvcUtxosForTests();
});

afterEach(() => {
  __clearPendingMvcUtxosForTests();
});

test('writeMvcSponsorPin completes the traffic-billed sponsor flow and journals the spend', async () => {
  const sponsorClient = createSponsorClient();
  const traffic = createTrafficDeps();
  const { runSelfPaid, state: selfPaidState } = createSelfPaidWorker();
  const utxo = makeUtxo();

  const result = await writeMvcSponsorPin({
    request: makeRequest(),
    identity: makeIdentity(),
    sponsorClient,
    traffic,
    runSelfPaid,
    fetchUtxos: async () => [utxo],
  });

  assert.equal(selfPaidState.calls, 0);
  assert.deepEqual(result.txids, [COMMIT_TXID]);
  assert.equal(result.pinId, `${COMMIT_TXID}i0`);
  assert.equal(result.totalCost, 880);
  assert.equal(result.network, 'mvc');
  assert.equal(result.path, '/protocols/simplebuzz');
  assert.equal(result.globalMetaId, FIXTURE_GLOBAL_METAID);
  assert.equal(result.mvcAddress, FIXTURE_ADDRESS);

  assert.equal(result.feeAssist.attempted, true);
  assert.equal(result.feeAssist.used, true);
  assert.equal(result.feeAssist.mode, 'mvc_sponsor_v2');
  assert.equal(result.feeAssist.stage, 'done');
  assert.equal(result.feeAssist.orderId, 'order-1');
  assert.equal(result.feeAssist.sponsoredMinerFee, 880);
  assert.equal(result.feeAssist.savedFee, 880);
  assert.equal(result.feeAssist.billedBy, 'traffic');
  assert.equal(result.feeAssist.txSize, 300);
  assert.equal(result.feeAssist.quotaBefore.availableAmount, 5000);

  // The traffic account was resolved against the sponsor challenge and sent in pre.
  assert.deepEqual(traffic.resolveCalls, [{ botAddress: FIXTURE_ADDRESS, challengeId: 'challenge-1' }]);
  const prePayload = sponsorClient.calls.find(([name]) => name === 'preSponsor')[1];
  assert.deepEqual(prePayload.trafficAccount, { accountId: 'gmid-account', authSignature: 'YXV0aA==', timestamp: 1730000000 });

  // The commit carries the bot-signed user input and the commit proof message.
  const commitPayload = sponsorClient.calls.find(([name]) => name === 'commitSponsor')[1];
  const committedTx = new mvc.Transaction(commitPayload.signedTxHex);
  assert.ok(committedTx.inputs[0].script.toHex().length > 0);
  assert.equal(commitPayload.message, `assist-sponsor-commit:order-1:${committedTx.id}`);

  // The spend journal row mirrors the IDBots traffic ledger fields.
  assert.equal(traffic.spendRecords.length, 1);
  assert.deepEqual(traffic.spendRecords[0], {
    txId: COMMIT_TXID,
    botAddress: FIXTURE_ADDRESS,
    orderId: 'order-1',
    txSize: 300,
    sponsoredMinerFee: 880,
    savedFee: 880,
    billedBy: 'traffic',
    kind: '/protocols/simplebuzz',
  });

  // Pending UTXO tracking mirrors the broadcast path: draft input spent, the
  // owned change output of the committed tx is spendable next.
  const spendable = resolveSpendableMvcUtxos({ address: FIXTURE_ADDRESS, utxos: [utxo] });
  assert.deepEqual(spendable, [{
    txId: COMMIT_TXID,
    outputIndex: 2,
    satoshis: 99_999,
    address: FIXTURE_ADDRESS,
    height: 0,
  }]);
});

test('writeMvcSponsorPin keeps the legacy quota billing when no traffic account resolves', async () => {
  const sponsorClient = createSponsorClient();
  const traffic = createTrafficDeps({ trafficAccount: undefined });
  const { runSelfPaid, state: selfPaidState } = createSelfPaidWorker();

  const result = await writeMvcSponsorPin({
    request: makeRequest(),
    identity: makeIdentity(),
    sponsorClient,
    traffic,
    runSelfPaid,
    fetchUtxos: async () => [makeUtxo()],
  });

  assert.equal(selfPaidState.calls, 0);
  const prePayload = sponsorClient.calls.find(([name]) => name === 'preSponsor')[1];
  assert.equal('trafficAccount' in prePayload, false);
  assert.equal(result.feeAssist.billedBy, 'quota');
  assert.equal(traffic.spendRecords[0].billedBy, 'quota');
});

test('writeMvcSponsorPin falls back to self-paid on sponsor fallback reasons', async () => {
  const cases = [
    {
      name: 'service unavailable at address_info',
      overrides: { addressInfoError: sponsorError('service down', { code: 'mvc_fee_assist_address_info_failed', stage: 'address_info', reason: 'service_unavailable' }) },
      reason: 'service_unavailable',
      stage: 'address_info',
    },
    {
      name: 'service unavailable at challenge',
      overrides: { challengeError: sponsorError('challenge down', { code: 'mvc_fee_assist_challenge_failed', stage: 'challenge', reason: 'service_unavailable' }) },
      reason: 'service_unavailable',
      stage: 'challenge',
    },
    {
      name: 'service unavailable at pre',
      overrides: { preError: sponsorError('pre down', { code: 'mvc_fee_assist_pre_failed', stage: 'pre', reason: 'service_unavailable' }) },
      reason: 'service_unavailable',
      stage: 'pre',
    },
    {
      name: 'insufficient quota at pre',
      overrides: { preError: sponsorError('available amount not enough', { code: 'mvc_fee_assist_pre_failed', stage: 'pre', reason: 'insufficient_quota' }) },
      reason: 'insufficient_quota',
      stage: 'pre',
    },
    {
      name: 'insufficient traffic at pre',
      overrides: { preError: sponsorError('traffic balance not enough', { code: 'mvc_fee_assist_pre_failed', stage: 'pre', reason: 'insufficient_traffic' }) },
      reason: 'insufficient_traffic',
      stage: 'pre',
    },
  ];
  for (const testCase of cases) {
    const sponsorClient = createSponsorClient(testCase.overrides);
    const traffic = createTrafficDeps();
    const { runSelfPaid, state: selfPaidState } = createSelfPaidWorker();

    const result = await writeMvcSponsorPin({
      request: makeRequest(),
      identity: makeIdentity(),
      sponsorClient,
      traffic,
      runSelfPaid,
      fetchUtxos: async () => [makeUtxo()],
    });

    assert.equal(selfPaidState.calls, 1, testCase.name);
    assert.equal(result.pinId, `${'f'.repeat(64)}i0`, testCase.name);
    assert.equal(result.feeAssist.attempted, true, testCase.name);
    assert.equal(result.feeAssist.used, false, testCase.name);
    assert.equal(result.feeAssist.mode, 'self_paid', testCase.name);
    assert.equal(result.feeAssist.reason, testCase.reason, testCase.name);
    assert.equal(result.feeAssist.stage, testCase.stage, testCase.name);
    assert.equal(traffic.spendRecords.length, 0, testCase.name);
  }
});

test('writeMvcSponsorPin classifies draft balance failures as no_user_utxo fallback', async () => {
  const sponsorClient = createSponsorClient();
  const traffic = createTrafficDeps();
  const { runSelfPaid, state: selfPaidState } = createSelfPaidWorker();

  const result = await writeMvcSponsorPin({
    request: makeRequest(),
    identity: makeIdentity(),
    sponsorClient,
    traffic,
    runSelfPaid,
    fetchUtxos: async () => [],
  });

  assert.equal(selfPaidState.calls, 1);
  assert.equal(result.feeAssist.used, false);
  assert.equal(result.feeAssist.mode, 'self_paid');
  assert.equal(result.feeAssist.reason, 'no_user_utxo');
  assert.equal(result.feeAssist.stage, 'address_info');
  assert.deepEqual(sponsorClient.calls.map(([name]) => name), ['getAddressInfo']);
});

test('writeMvcSponsorPin hard-fails non-balance draft errors instead of falling back', async () => {
  const sponsorClient = createSponsorClient();
  const traffic = createTrafficDeps();
  const { runSelfPaid, state: selfPaidState } = createSelfPaidWorker();

  await assert.rejects(
    writeMvcSponsorPin({
      request: makeRequest(),
      identity: makeIdentity(),
      sponsorClient,
      traffic,
      runSelfPaid,
      fetchUtxos: async () => {
        throw new Error('utxo provider exploded');
      },
    }),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_address_info_failed');
      assert.equal(error.data.feeAssist.used, false);
      assert.equal(error.data.feeAssist.reason, 'service_unavailable');
      assert.equal(error.data.feeAssist.stage, 'address_info');
      return true;
    },
  );
  assert.equal(selfPaidState.calls, 0);
});

test('writeMvcSponsorPin hard-fails on pre_rejected with feeAssist diagnostics', async () => {
  const sponsorClient = createSponsorClient({
    preError: sponsorError('address not match first input address', {
      code: 'mvc_fee_assist_pre_failed',
      stage: 'pre',
      reason: 'pre_rejected',
    }),
  });
  const traffic = createTrafficDeps();
  const { runSelfPaid, state: selfPaidState } = createSelfPaidWorker();

  await assert.rejects(
    writeMvcSponsorPin({
      request: makeRequest(),
      identity: makeIdentity(),
      sponsorClient,
      traffic,
      runSelfPaid,
      fetchUtxos: async () => [makeUtxo()],
    }),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_pre_failed');
      assert.equal(error.data.feeAssist.used, false);
      assert.equal(error.data.feeAssist.mode, 'mvc_sponsor_v2');
      assert.equal(error.data.feeAssist.reason, 'pre_rejected');
      assert.equal(error.data.feeAssist.stage, 'pre');
      return true;
    },
  );
  assert.equal(selfPaidState.calls, 0);
  assert.equal(traffic.spendRecords.length, 0);
});

test('writeMvcSponsorPin hard-fails on commit_failed with the order id attached', async () => {
  const sponsorClient = createSponsorClient({
    commitError: sponsorError('broadcast rejected', {
      code: 'mvc_fee_assist_commit_failed',
      stage: 'commit',
      reason: 'commit_failed',
    }),
  });
  const traffic = createTrafficDeps();
  const { runSelfPaid, state: selfPaidState } = createSelfPaidWorker();

  await assert.rejects(
    writeMvcSponsorPin({
      request: makeRequest(),
      identity: makeIdentity(),
      sponsorClient,
      traffic,
      runSelfPaid,
      fetchUtxos: async () => [makeUtxo()],
    }),
    (error) => {
      assert.equal(error.code, 'mvc_fee_assist_commit_failed');
      assert.equal(error.data.feeAssist.used, false);
      assert.equal(error.data.feeAssist.reason, 'commit_failed');
      assert.equal(error.data.feeAssist.stage, 'commit');
      assert.equal(error.data.feeAssist.orderId, 'order-1');
      assert.equal(error.data.feeAssist.sponsoredMinerFee, 900);
      return true;
    },
  );
  assert.equal(selfPaidState.calls, 0);
  assert.equal(traffic.spendRecords.length, 0);
});

test('writeMvcSponsorPin recovers a lost commit response via the real client order recovery', async () => {
  const fetchCalls = [];
  const sponsorClient = createMvcSponsorV2Client({
    baseUrl: 'https://sponsor.test',
    retryDelaysMs: [0, 0],
    fetchImpl: async (url, init = {}) => {
      const text = String(url);
      fetchCalls.push(text);
      const json = (body) => ({ ok: true, status: 200, json: async () => body });
      if (text.includes('/v2/assist/gas/address/info')) {
        return json({
          code: 0,
          data: {
            exists: true,
            balance: 5000,
            grantedAmount: 5000,
            reservedAmount: 0,
            spentAmount: 0,
            availableAmount: 5000,
            status: 'active',
          },
        });
      }
      if (text.includes('/v2/assist/gas/mvc/challenge')) {
        return json({ code: 0, data: { challengeId: 'challenge-1', message: 'sign sponsor challenge' } });
      }
      if (text.includes('/v2/assist/gas/mvc/pre')) {
        return json({
          code: 0,
          data: {
            preparedTxHex: JSON.parse(init.body).txHex,
            orderId: 'order-1',
            minerFee: 100,
            userInputIndexes: [0],
          },
        });
      }
      if (text.includes('/v2/assist/gas/mvc/commit')) {
        throw new TypeError('fetch failed');
      }
      if (text.includes('/v2/assist/gas/mvc/order/order-1')) {
        return json({
          code: 0,
          data: {
            orderId: 'order-1',
            status: 'broadcasted',
            txId: 'c'.repeat(64),
            txSize: 345,
            minerFee: 100,
            pending: false,
            final: true,
          },
        });
      }
      throw new Error(`unexpected URL: ${text}`);
    },
  });
  const traffic = createTrafficDeps();
  const { runSelfPaid, state: selfPaidState } = createSelfPaidWorker();

  const result = await writeMvcSponsorPin({
    request: makeRequest(),
    identity: makeIdentity(),
    sponsorClient,
    traffic,
    runSelfPaid,
    fetchUtxos: async () => [makeUtxo()],
  });

  assert.equal(selfPaidState.calls, 0);
  assert.deepEqual(result.txids, ['c'.repeat(64)]);
  assert.equal(result.pinId, `${'c'.repeat(64)}i0`);
  assert.equal(result.feeAssist.used, true);
  assert.equal(result.feeAssist.txSize, 345);
  assert.equal(traffic.spendRecords[0].txId, 'c'.repeat(64));
  assert.ok(fetchCalls.some((url) => url.includes('/v2/assist/gas/mvc/order/order-1')));
});

test('createTrafficSponsorWritePinResolver runs the full traffic flow over a real account service', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-sponsor-writepin-');
  const owner = await importOwnerIdentity(systemHomeDir, { name: 'Owner', mnemonic: OWNER_MNEMONIC });
  assert.equal(owner.mvcAddress, OWNER_ADDRESS);

  const botIdentity = makeIdentity(FIXTURE_MNEMONIC, FIXTURE_ADDRESS);
  let preBody = null;
  const trafficFetch = async (url, init = {}) => {
    const text = String(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (text.includes('/v1/traffic/accounts/bindings')) {
      return json({ code: 0, data: { bound: true } });
    }
    if (text.includes('/v1/traffic/accounts')) {
      return json({
        code: 0,
        data: {
          accountId: 'idq1serverderived',
          identityAddress: OWNER_ADDRESS,
          balanceBytes: 1_000_000,
          reservedBytes: 0,
          grantedBytesTotal: 1_000_000,
          spentBytesTotal: 0,
          status: 1,
        },
      });
    }
    throw new Error(`unexpected traffic URL: ${text}`);
  };
  const sponsorFetch = async (url, init = {}) => {
    const text = String(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (text.includes('/v2/assist/gas/address/info')) {
      return json({
        code: 0,
        data: {
          exists: true,
          balance: 5000,
          grantedAmount: 5000,
          reservedAmount: 0,
          spentAmount: 0,
          availableAmount: 5000,
          status: 'active',
        },
      });
    }
    if (text.includes('/v2/assist/gas/mvc/challenge')) {
      return json({ code: 0, data: { challengeId: 'challenge-1', message: 'sign sponsor challenge' } });
    }
    if (text.includes('/v2/assist/gas/mvc/pre')) {
      preBody = JSON.parse(init.body);
      return json({
        code: 0,
        data: {
          preparedTxHex: preBody.txHex,
          orderId: 'order-1',
          minerFee: 100,
          userInputIndexes: [0],
        },
      });
    }
    if (text.includes('/v2/assist/gas/mvc/commit')) {
      return json({ code: 0, data: { txId: COMMIT_TXID, txSize: 300, minerFee: 100 } });
    }
    throw new Error(`unexpected sponsor URL: ${text}`);
  };

  const trafficAccountService = createTrafficAccountService({ systemHomeDir, fetchImpl: trafficFetch });
  const resolveSponsorWritePin = createTrafficSponsorWritePinResolver({ trafficAccountService });
  const originalFetchUtxos = mvcChainAdapter.fetchUtxos;
  const originalFetch = global.fetch;
  mvcChainAdapter.fetchUtxos = async () => [makeUtxo(FIXTURE_ADDRESS)];
  global.fetch = sponsorFetch;
  const { runSelfPaid, state: selfPaidState } = createSelfPaidWorker();
  try {
    const result = await resolveSponsorWritePin({
      request: makeRequest(),
      identity: botIdentity,
      runSelfPaid,
    });

    assert.equal(selfPaidState.calls, 0);
    assert.equal(result.pinId, `${COMMIT_TXID}i0`);
    assert.equal(result.feeAssist.used, true);
    assert.equal(result.feeAssist.billedBy, 'traffic');

    // The pre body carries a trafficAccount signed by the OWNER key over
    // traffic-pre:<accountId>:<challengeId>.
    assert.ok(preBody.trafficAccount);
    assert.equal(preBody.trafficAccount.accountId, 'idq1serverderived');
    assert.equal(typeof preBody.trafficAccount.timestamp, 'number');
    const message = `traffic-pre:idq1serverderived:challenge-1`;
    assert.equal(
      mvc.Message(message).verify(OWNER_ADDRESS, preBody.trafficAccount.authSignature),
      true,
    );

    // The local journal recorded the traffic-billed spend.
    const journal = await trafficAccountService.listLocalTrafficJournal();
    assert.equal(journal.length, 1);
    assert.equal(journal[0].txId, COMMIT_TXID);
    assert.equal(journal[0].botAddress, FIXTURE_ADDRESS);
    assert.equal(journal[0].orderId, 'order-1');
    assert.equal(journal[0].txSize, 300);
    assert.equal(journal[0].billedBy, 'traffic');
    assert.equal(journal[0].kind, '/protocols/simplebuzz');

    // The bot got bound to the account on first use.
    const bindings = await trafficAccountService.store.readBindings();
    assert.equal(bindings[FIXTURE_ADDRESS]?.accountId, 'idq1serverderived');
  } finally {
    mvcChainAdapter.fetchUtxos = originalFetchUtxos;
    global.fetch = originalFetch;
  }
});

test('createTrafficSponsorWritePinResolver returns null in self-pay mode', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-sponsor-writepin-');
  await importOwnerIdentity(systemHomeDir, { name: 'Owner', mnemonic: OWNER_MNEMONIC });
  const trafficAccountService = createTrafficAccountService({
    systemHomeDir,
    fetchImpl: async () => {
      throw new Error('no network expected in self-pay mode');
    },
  });
  await trafficAccountService.setTrafficSettingsSnapshot({ mode: 'selfpay' });
  const resolveSponsorWritePin = createTrafficSponsorWritePinResolver({ trafficAccountService });

  const result = await resolveSponsorWritePin({
    request: makeRequest(),
    identity: makeIdentity(),
    runSelfPaid: async () => {
      throw new Error('runSelfPaid must not run when the resolver returns null');
    },
  });

  assert.equal(result, null);
});
