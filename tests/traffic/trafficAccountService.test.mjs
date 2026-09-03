// Port of IDBots tests/trafficAccountService.test.mjs onto the OAC file-based
// traffic module (src/core/traffic/). Real MVC keys (meta-contract) verify the
// canonical signature strings; the fetch layer is stubbed; state lives in
// mkdtempTempRoot-backed system homes so no daemon is needed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { mvc } = require('meta-contract');
const pkg = require('../../package.json');
const { importOwnerIdentity } = require('../../dist/core/owner/ownerIdentity.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { createFileSecretStore } = require('../../dist/core/secrets/fileSecretStore.js');
const {
  TrafficApiError,
  TRAFFIC_RECHARGE_STATUS,
  createTrafficAccountService,
} = require('../../dist/core/traffic/trafficAccountService.js');

const IDENTITY_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BOT1_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const BOT2_MNEMONIC =
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
const WALLET_PATH = "m/44'/10001'/0'/0/0";
const COMMIT_TXID = 'aa'.repeat(32);

function deriveAddress(mnemonic) {
  const network = mvc.Networks.livenet;
  const child = mvc.Mnemonic.fromString(mnemonic).toHDPrivateKey('', network).deriveChild(WALLET_PATH);
  return child.publicKey.toAddress(network).toString();
}

const IDENTITY_ADDRESS = deriveAddress(IDENTITY_MNEMONIC);
const BOT1_ADDRESS = deriveAddress(BOT1_MNEMONIC);
const BOT2_ADDRESS = deriveAddress(BOT2_MNEMONIC);
const SERVER_ACCOUNT_ID = 'idq1serverderived';

function verifyMessage(address, message, signature) {
  try {
    return mvc.Message(message).verify(address, signature);
  } catch {
    return false;
  }
}

function envelope(data) {
  return JSON.stringify({ code: 0, message: 'success', data });
}

function httpError(status, body = { code: 1, message: `HTTP ${status}` }) {
  return { __httpStatus: status, __body: body };
}

function createFetchStub(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const text = String(url);
    calls.push({ url: text, init });
    for (const [suffix, responder] of routes) {
      if (text.includes(suffix)) {
        const body = await (typeof responder === 'function' ? responder(init) : responder);
        if (body && typeof body === 'object' && typeof body.__httpStatus === 'number') {
          return { ok: false, status: body.__httpStatus, json: async () => body.__body };
        }
        const raw = typeof body === 'string'
          ? body
          : body && typeof body === 'object' && 'code' in body
            ? JSON.stringify(body)
            : envelope(body);
        return { ok: true, status: 200, json: async () => JSON.parse(raw) };
      }
    }
    return { ok: false, status: 404, json: async () => ({ code: 1, message: 'not found' }) };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function callsToPath(fetchImpl, pathName) {
  return fetchImpl.calls.filter((call) => new URL(call.url).pathname === pathName);
}

function accountPayload(overrides = {}) {
  return {
    accountId: SERVER_ACCOUNT_ID,
    identityAddress: IDENTITY_ADDRESS,
    balanceBytes: 1000,
    reservedBytes: 0,
    grantedBytesTotal: 1000,
    spentBytesTotal: 0,
    status: 1,
    ...overrides,
  };
}

async function readTrafficFile(systemHomeDir) {
  const raw = await fs.readFile(path.join(systemHomeDir, '.metabot', 'owner', 'traffic.json'), 'utf8');
  return JSON.parse(raw);
}

async function makeServiceFixture(options = {}) {
  const systemHomeDir = await mkdtempTempRoot('oac-traffic-test-');
  const owner = await importOwnerIdentity(systemHomeDir, { name: 'Owner', mnemonic: IDENTITY_MNEMONIC });
  assert.equal(owner.mvcAddress, IDENTITY_ADDRESS, 'owner derivation must match the meta-contract reference');

  const bots = options.bots ?? [
    { slug: 'bot-one', address: BOT1_ADDRESS, mnemonic: BOT1_MNEMONIC },
    { slug: 'bot-two', address: BOT2_ADDRESS, mnemonic: BOT2_MNEMONIC },
  ];
  for (const bot of bots) {
    const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', bot.slug);
    await upsertIdentityProfile({
      systemHomeDir,
      name: bot.slug,
      homeDir,
      mvcAddress: bot.address,
      globalMetaId: `idq1${bot.slug.replace(/-/g, '')}`,
    });
    await createFileSecretStore(homeDir).writeIdentitySecrets({
      mnemonic: bot.mnemonic,
      path: WALLET_PATH,
      addresses: { mvc: bot.address },
    });
  }

  const service = createTrafficAccountService({
    systemHomeDir,
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl === undefined ? 'https://traffic.test' : options.baseUrl,
    ...(options.clientVersion ? { clientVersion: options.clientVersion } : {}),
  });
  if (options.trafficMode) {
    await service.setTrafficSettingsSnapshot({ mode: options.trafficMode });
  }
  return { service, systemHomeDir, owner };
}

test('ensureTrafficAccount coalesces concurrent first-run creates into one POST', async () => {
  let createCount = 0;
  const fetchImpl = createFetchStub([
    ['/v1/traffic/accounts', async () => {
      createCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return accountPayload();
    }],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl });

  const [first, second] = await Promise.all([service.ensureTrafficAccount(), service.ensureTrafficAccount()]);
  assert.equal(first.accountId, SERVER_ACCOUNT_ID);
  assert.equal(second.accountId, SERVER_ACCOUNT_ID);
  assert.equal(createCount, 1);
  assert.equal(callsToPath(fetchImpl, '/v1/traffic/accounts').length, 1);
});

test('ensureTrafficAccount signs the canonical message and persists the server-returned accountId', async () => {
  let captured = null;
  const fetchImpl = createFetchStub([
    ['/v1/traffic/accounts', (init) => {
      captured = { headers: init.headers, body: JSON.parse(init.body) };
      return accountPayload();
    }],
  ]);
  const { service, systemHomeDir, owner } = await makeServiceFixture({ fetchImpl });

  const account = await service.ensureTrafficAccount();
  assert.equal(account.accountId, SERVER_ACCOUNT_ID);
  assert.equal((await service.getLocalTrafficAccount()).accountId, SERVER_ACCOUNT_ID);

  assert.ok(captured);
  assert.deepEqual(captured.body, { accountId: owner.globalMetaId });
  assert.equal(captured.headers['X-Identity-Address'], IDENTITY_ADDRESS);
  const timestamp = Number(captured.headers['X-Timestamp']);
  assert.ok(Number.isInteger(timestamp) && timestamp > 0);
  assert.ok(
    verifyMessage(
      IDENTITY_ADDRESS,
      `traffic-account:${owner.globalMetaId}:${timestamp}`,
      captured.headers['X-Signature'],
    ),
    'X-Signature must verify against traffic-account:<accountId>:<ts>',
  );

  // The account record is persisted into traffic.json (server id is authoritative).
  const file = await readTrafficFile(systemHomeDir);
  assert.equal(file.version, 1);
  assert.equal(file.mode, 'traffic');
  assert.equal(file.account.accountId, SERVER_ACCOUNT_ID);
});

test('bindAllLocalBots binds bots + identity, reports conflicts, and stays idempotent', async () => {
  const bindBodies = new Map();
  const fetchImpl = createFetchStub([
    ['/v1/traffic/accounts/bindings', (init) => {
      const body = JSON.parse(init.body);
      bindBodies.set(body.botAddress, { body, headers: init.headers });
      if (body.botAddress === BOT2_ADDRESS) {
        return { code: 1, message: 'traffic address already bound to another account' };
      }
      return { botAddress: body.botAddress, accountId: SERVER_ACCOUNT_ID, status: 1, createdAt: 1 };
    }],
    ['/v1/traffic/accounts', accountPayload()],
  ]);
  const { service, systemHomeDir } = await makeServiceFixture({ fetchImpl });

  const summary = await service.bindAllLocalBots();
  assert.equal(summary.accountId, SERVER_ACCOUNT_ID);
  assert.equal(summary.boundCount, 2);
  assert.equal(summary.conflictCount, 1);
  assert.equal(summary.failedCount, 0);
  assert.deepEqual(
    summary.results.find((item) => item.botAddress === BOT2_ADDRESS).status,
    'conflict',
  );

  const bot1Bind = bindBodies.get(BOT1_ADDRESS);
  assert.ok(bot1Bind);
  const parts = bot1Bind.body.bindMessage.split(':');
  assert.equal(parts[0], 'traffic-bind');
  assert.equal(parts[1], BOT1_ADDRESS);
  assert.equal(parts[2], SERVER_ACCOUNT_ID);
  const bindTs = Number(parts[3]);
  assert.equal(Number(bot1Bind.headers['X-Timestamp']), bindTs);
  assert.ok(verifyMessage(BOT1_ADDRESS, bot1Bind.body.bindMessage, bot1Bind.body.botSignature));
  assert.ok(verifyMessage(IDENTITY_ADDRESS, bot1Bind.body.bindMessage, bot1Bind.headers['X-Signature']));

  // Identity address is bound too, signed by the identity key on both sides.
  const identityBind = bindBodies.get(IDENTITY_ADDRESS);
  assert.ok(identityBind);
  assert.ok(verifyMessage(IDENTITY_ADDRESS, identityBind.body.bindMessage, identityBind.body.botSignature));

  // Successful binds are persisted into traffic.json.
  const file = await readTrafficFile(systemHomeDir);
  assert.equal(file.bindings[BOT1_ADDRESS].accountId, SERVER_ACCOUNT_ID);
  assert.equal(file.bindings[BOT2_ADDRESS], undefined);

  // Re-run: same-account rebinds succeed, the conflict stays a conflict; nothing throws.
  const again = await service.bindAllLocalBots();
  assert.equal(again.boundCount, 2);
  assert.equal(again.conflictCount, 1);
});

test('getTrafficBalance caches for the TTL window and local spends adjust the cache', async () => {
  const fetchImpl = createFetchStub([
    ['/v1/traffic/accounts/bindings', { botAddress: BOT1_ADDRESS, accountId: SERVER_ACCOUNT_ID, status: 1 }],
    ['/v1/traffic/accounts', (init) => {
      if (String(init.method) === 'GET') {
        return accountPayload({ balanceBytes: 650, spentBytesTotal: 350 });
      }
      return accountPayload();
    }],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl });

  await service.ensureTrafficAccount();
  const first = await service.getTrafficBalance();
  assert.equal(first.balanceBytes, 1000);
  assert.equal(callsToPath(fetchImpl, '/v1/traffic/accounts').length, 1);
  assert.equal(callsToPath(fetchImpl, `/v1/traffic/accounts/${SERVER_ACCOUNT_ID}/balance`).length, 0);

  await service.recordLocalTrafficSpend({
    txId: COMMIT_TXID,
    botAddress: BOT1_ADDRESS,
    orderId: 'order-1',
    txSize: 300,
    sponsoredMinerFee: 300,
    savedFee: 300,
    billedBy: 'traffic',
  });
  const afterSpend = await service.getTrafficBalance();
  assert.equal(afterSpend.balanceBytes, 700);
  assert.equal(afterSpend.spentBytesTotal, 300);
  assert.equal(callsToPath(fetchImpl, `/v1/traffic/accounts/${SERVER_ACCOUNT_ID}/balance`).length, 0);

  // Quota-billed spends never touch the traffic balance cache.
  await service.recordLocalTrafficSpend({ txId: 'bb'.repeat(32), botAddress: BOT1_ADDRESS, txSize: 100, billedBy: 'quota' });
  assert.equal((await service.getTrafficBalance()).balanceBytes, 700);

  const refreshed = await service.getTrafficBalance({ forceRefresh: true });
  assert.equal(refreshed.balanceBytes, 650);
  assert.equal(callsToPath(fetchImpl, `/v1/traffic/accounts/${SERVER_ACCOUNT_ID}/balance`).length, 1);
});

test('local spend journal writes and lists entries', async () => {
  const { service } = await makeServiceFixture({ fetchImpl: createFetchStub([]) });

  await service.recordLocalTrafficSpend({
    txId: COMMIT_TXID,
    botAddress: BOT1_ADDRESS,
    orderId: 'order-1',
    txSize: 300,
    sponsoredMinerFee: 100,
    savedFee: 100,
    billedBy: 'traffic',
  });
  await service.recordLocalTrafficSpend({
    txId: 'cc'.repeat(32),
    botAddress: BOT2_ADDRESS,
    orderId: 'order-2',
    txSize: 250,
    sponsoredMinerFee: 90,
    savedFee: 90,
    billedBy: 'quota',
  });

  const all = await service.listLocalTrafficJournal();
  assert.equal(all.length, 2);
  assert.equal(all[0].txId, 'cc'.repeat(32));
  assert.equal(all[0].billedBy, 'quota');
  assert.ok(all[0].id > all[1].id);
  assert.equal(all[1].txId, COMMIT_TXID);
  assert.equal(all[1].orderId, 'order-1');
  assert.equal(all[1].txSize, 300);
  assert.equal(all[1].billedBy, 'traffic');
  assert.ok(all[1].createdAt > 0);

  const filtered = await service.listLocalTrafficJournal({ botAddress: BOT2_ADDRESS });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].botAddress, BOT2_ADDRESS);
});

test('journal reads skip malformed lines and default missing kind to empty', async () => {
  const { service, systemHomeDir } = await makeServiceFixture({ fetchImpl: createFetchStub([]) });
  const journalPath = path.join(systemHomeDir, '.metabot', 'owner', 'traffic-journal.jsonl');
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  // A legacy row written before the kind field existed, then a torn line.
  await fs.writeFile(journalPath, [
    JSON.stringify({
      txId: 'ee'.repeat(32),
      botAddress: BOT1_ADDRESS,
      orderId: 'order-legacy',
      txSize: 200,
      sponsoredMinerFee: 80,
      savedFee: 80,
      billedBy: 'traffic',
      createdAt: 1700000000000,
    }),
    'not-json{',
    '',
  ].join('\n'), 'utf8');

  await service.recordLocalTrafficSpend({
    txId: COMMIT_TXID,
    botAddress: BOT1_ADDRESS,
    orderId: 'order-new',
    txSize: 300,
    billedBy: 'traffic',
    kind: '/protocols/simplemsg',
  });

  const all = await service.listLocalTrafficJournal();
  assert.equal(all.length, 2);
  const byOrder = new Map(all.map((entry) => [entry.orderId, entry]));
  assert.equal(byOrder.get('order-new').kind, '/protocols/simplemsg');
  assert.equal(byOrder.get('order-legacy').kind, '');
  assert.equal(byOrder.get('order-legacy').txSize, 200);
  assert.equal(byOrder.get('order-legacy').createdAt, 1700000000000);
});

test('resolveSponsorTrafficAccount stays undefined unless traffic mode is on', async () => {
  const fetchImpl = createFetchStub([['/v1/traffic/accounts', accountPayload()]]);
  const { service } = await makeServiceFixture({ fetchImpl, trafficMode: 'selfpay' });

  const result = await service.resolveSponsorTrafficAccount({
    botAddress: BOT1_ADDRESS,
    challengeId: 'challenge-1',
    botMnemonic: BOT1_MNEMONIC,
    botWalletPath: WALLET_PATH,
  });
  assert.equal(result, undefined);
  assert.equal(fetchImpl.calls.length, 0);
});

test('resolveSponsorTrafficAccount lazily ensures + binds and signs traffic-pre', async () => {
  const fetchImpl = createFetchStub([
    ['/v1/traffic/accounts/bindings', (init) => {
      const body = JSON.parse(init.body);
      return { botAddress: body.botAddress, accountId: SERVER_ACCOUNT_ID, status: 1, createdAt: 1 };
    }],
    ['/v1/traffic/accounts', accountPayload()],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl, trafficMode: 'traffic' });

  const first = await service.resolveSponsorTrafficAccount({
    botAddress: BOT1_ADDRESS,
    challengeId: 'challenge-1',
    botMnemonic: BOT1_MNEMONIC,
    botWalletPath: WALLET_PATH,
  });
  assert.ok(first);
  assert.equal(first.accountId, SERVER_ACCOUNT_ID);
  assert.ok(Number.isInteger(first.timestamp) && first.timestamp > 0);
  assert.ok(
    verifyMessage(IDENTITY_ADDRESS, `traffic-pre:${SERVER_ACCOUNT_ID}:challenge-1`, first.authSignature),
    'authSignature must verify against traffic-pre:<accountId>:<challengeId>',
  );
  assert.equal(callsToPath(fetchImpl, '/v1/traffic/accounts').length, 1);
  assert.equal(callsToPath(fetchImpl, '/v1/traffic/accounts/bindings').length, 1);

  // Second call: account + binding are cached locally, no more HTTP.
  const second = await service.resolveSponsorTrafficAccount({
    botAddress: BOT1_ADDRESS,
    challengeId: 'challenge-2',
    botMnemonic: BOT1_MNEMONIC,
    botWalletPath: WALLET_PATH,
  });
  assert.ok(second);
  assert.ok(verifyMessage(IDENTITY_ADDRESS, `traffic-pre:${SERVER_ACCOUNT_ID}:challenge-2`, second.authSignature));
  assert.equal(callsToPath(fetchImpl, '/v1/traffic/accounts').length, 1);
  assert.equal(callsToPath(fetchImpl, '/v1/traffic/accounts/bindings').length, 1);
});

test('resolveSponsorTrafficAccount degrades to undefined on backend 404 (feature off)', async () => {
  const fetchImpl = createFetchStub([
    ['/v1/traffic/accounts', httpError(404, { code: 1, message: 'traffic disabled' })],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl, trafficMode: 'traffic' });

  const result = await service.resolveSponsorTrafficAccount({
    botAddress: BOT1_ADDRESS,
    challengeId: 'challenge-1',
    botMnemonic: BOT1_MNEMONIC,
    botWalletPath: WALLET_PATH,
  });
  assert.equal(result, undefined);

  await assert.rejects(service.ensureTrafficAccount(), (error) => {
    assert.ok(error instanceof TrafficApiError);
    assert.equal(error.featureUnavailable, true);
    return true;
  });
});

test('resolveSponsorTrafficAccount returns undefined when the bot cannot be bound', async () => {
  const fetchImpl = createFetchStub([
    ['/v1/traffic/accounts/bindings', { code: 1, message: 'traffic address already bound to another account' }],
    ['/v1/traffic/accounts', accountPayload()],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl, trafficMode: 'traffic' });

  // Bind conflict on the backend -> degrade to the legacy quota path.
  const conflict = await service.resolveSponsorTrafficAccount({
    botAddress: BOT1_ADDRESS,
    challengeId: 'challenge-1',
    botMnemonic: BOT1_MNEMONIC,
    botWalletPath: WALLET_PATH,
  });
  assert.equal(conflict, undefined);
  assert.equal(callsToPath(fetchImpl, '/v1/traffic/accounts/bindings').length, 1);

  // No bot mnemonic supplied for an unbound bot -> no bind attempt at all.
  const missingKey = await service.resolveSponsorTrafficAccount({
    botAddress: BOT2_ADDRESS,
    challengeId: 'challenge-2',
  });
  assert.equal(missingKey, undefined);
  assert.equal(callsToPath(fetchImpl, '/v1/traffic/accounts/bindings').length, 1);
});

test('getTrafficPricing normalizes the public rate table', async () => {
  const fetchImpl = createFetchStub([
    ['/v1/traffic/pricing', [
      { planId: 'cny_10_100mb', chain: 'mvc', payCurrency: 'CNY', payAmount: 10, trafficBytes: 100000000, status: 1, remark: 'seed' },
      { plan_id: 'cny_20_250mb', chain: 'mvc', pay_currency: 'CNY', pay_amount: 20, traffic_bytes: 250000000 },
    ]],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl });

  const plans = await service.getTrafficPricing();
  assert.equal(plans.length, 2);
  assert.deepEqual(plans[0], {
    planId: 'cny_10_100mb',
    chain: 'mvc',
    payCurrency: 'CNY',
    payAmount: 10,
    trafficBytes: 100000000,
    status: 1,
    remark: 'seed',
  });
  assert.equal(plans[1].planId, 'cny_20_250mb');
  assert.equal(plans[1].trafficBytes, 250000000);
});

test('createRechargeOrder signs traffic-recharge and parses the order', async () => {
  let captured = null;
  const fetchImpl = createFetchStub([
    ['/v1/traffic/recharge/orders', (init) => {
      captured = { headers: init.headers, body: JSON.parse(init.body) };
      return {
        orderId: 'recharge-order-1',
        payAmount: 10,
        payCurrency: 'CNY',
        trafficBytes: 100000000,
        gatewayParams: { mockToken: 'recharge-order-1' },
      };
    }],
    ['/v1/traffic/accounts', accountPayload()],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl });

  const order = await service.createRechargeOrder('cny_10_100mb');
  assert.equal(order.orderId, 'recharge-order-1');
  assert.equal(order.trafficBytes, 100000000);
  assert.deepEqual(order.gatewayParams, { mockToken: 'recharge-order-1' });

  assert.ok(captured);
  assert.deepEqual(captured.body, { planId: 'cny_10_100mb', gateway: 'mock' });
  const timestamp = Number(captured.headers['X-Timestamp']);
  assert.ok(
    verifyMessage(
      IDENTITY_ADDRESS,
      `traffic-recharge:${SERVER_ACCOUNT_ID}:cny_10_100mb:${timestamp}`,
      captured.headers['X-Signature'],
    ),
  );
});

test('mockConfirmRechargeOrder signs traffic-recharge-confirm and invalidates the balance cache', async () => {
  const confirmCalls = [];
  const fetchImpl = createFetchStub([
    ['/v1/traffic/recharge/orders/', (init) => {
      if (String(init.method) === 'POST' && init.body) {
        confirmCalls.push({ headers: init.headers, body: JSON.parse(init.body) });
        return { orderId: 'recharge-order-1', status: TRAFFIC_RECHARGE_STATUS.CREDITED, paidAt: 1, creditedAt: 2 };
      }
      return { orderId: 'recharge-order-1', status: TRAFFIC_RECHARGE_STATUS.CREATED };
    }],
    ['/v1/traffic/accounts', (init) => (
      String(init.method) === 'GET' ? accountPayload({ balanceBytes: 101000000 }) : accountPayload()
    )],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl });

  // Prime the cache via ensure (balance 1000), then credit and confirm the next
  // balance read refetches from the backend.
  await service.ensureTrafficAccount();
  const status = await service.mockConfirmRechargeOrder('recharge-order-1');
  assert.equal(status.status, TRAFFIC_RECHARGE_STATUS.CREDITED);
  assert.equal(status.creditedAt, 2);

  assert.equal(confirmCalls.length, 1);
  const confirmBody = confirmCalls[0].body;
  assert.deepEqual(confirmBody, { gatewayTxnId: 'mock-recharge-order-1' });
  const confirmTs = Number(confirmCalls[0].headers['X-Timestamp']);
  assert.ok(
    verifyMessage(
      IDENTITY_ADDRESS,
      `traffic-recharge-confirm:recharge-order-1:mock-recharge-order-1:${confirmTs}`,
      confirmCalls[0].headers['X-Signature'],
    ),
  );

  const balance = await service.getTrafficBalance();
  assert.equal(balance.balanceBytes, 101000000);

  const polled = await service.getRechargeOrder('recharge-order-1');
  assert.equal(polled.orderId, 'recharge-order-1');
  assert.equal(polled.status, TRAFFIC_RECHARGE_STATUS.CREATED);
});

test('getFreeGrantCampaignStatus signs the canonical message and parses the campaign state', async () => {
  let captured = null;
  const fetchImpl = createFetchStub([
    ['/v1/traffic/campaign/free-grant/status', (init) => {
      captured = { headers: init.headers };
      return { enabled: true, grantBytes: 10000000, claimed: false, claimable: true };
    }],
    ['/v1/traffic/accounts', accountPayload()],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl });

  const status = await service.getFreeGrantCampaignStatus();
  assert.deepEqual(status, { enabled: true, grantBytes: 10000000, claimed: false, claimable: true });

  assert.ok(captured);
  assert.equal(captured.headers['X-Identity-Address'], IDENTITY_ADDRESS);
  const timestamp = Number(captured.headers['X-Timestamp']);
  assert.ok(
    verifyMessage(
      IDENTITY_ADDRESS,
      `traffic-free-grant-status:${SERVER_ACCOUNT_ID}:${timestamp}`,
      captured.headers['X-Signature'],
    ),
    'X-Signature must verify against traffic-free-grant-status:<accountId>:<ts>',
  );
});

test('claimFreeGrant signs traffic-free-grant-claim, sends the oac client, and invalidates the balance cache', async () => {
  let captured = null;
  const fetchImpl = createFetchStub([
    ['/v1/traffic/campaign/free-grant/claim', (init) => {
      captured = { headers: init.headers, body: JSON.parse(init.body) };
      return { grantId: 1, grantBytes: 10000000, balanceAfter: 10001000 };
    }],
    ['/v1/traffic/accounts', (init) => (
      String(init.method) === 'GET' ? accountPayload({ balanceBytes: 10001000 }) : accountPayload()
    )],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl });

  // Prime the cache via ensure (balance 1000), then claim and confirm the next
  // balance read refetches from the backend.
  await service.ensureTrafficAccount();
  const claim = await service.claimFreeGrant();
  assert.deepEqual(claim, { grantId: 1, grantBytes: 10000000, balanceAfter: 10001000 });

  assert.ok(captured);
  assert.equal(captured.body.clientApp, 'oac');
  assert.equal(captured.body.clientVersion, pkg.version);
  const timestamp = Number(captured.headers['X-Timestamp']);
  assert.ok(
    verifyMessage(
      IDENTITY_ADDRESS,
      `traffic-free-grant-claim:${SERVER_ACCOUNT_ID}:${timestamp}`,
      captured.headers['X-Signature'],
    ),
    'X-Signature must verify against traffic-free-grant-claim:<accountId>:<ts>',
  );

  const balance = await service.getTrafficBalance();
  assert.equal(balance.balanceBytes, 10001000);
  assert.equal(callsToPath(fetchImpl, `/v1/traffic/accounts/${SERVER_ACCOUNT_ID}/balance`).length, 1);
});

test('claimFreeGrant honors a clientVersion override', async () => {
  let captured = null;
  const fetchImpl = createFetchStub([
    ['/v1/traffic/campaign/free-grant/claim', (init) => {
      captured = JSON.parse(init.body);
      return { grantId: 1, grantBytes: 10000000, balanceAfter: 10001000 };
    }],
    ['/v1/traffic/accounts', accountPayload()],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl, clientVersion: '9.9.9-test' });

  await service.claimFreeGrant();
  assert.deepEqual(captured, { clientApp: 'oac', clientVersion: '9.9.9-test' });
});

test('claimFreeGrant surfaces the backend data.errorCode (campaign failures)', async () => {
  for (const errorCode of ['CAMPAIGN_DISABLED', 'ALREADY_CLAIMED', 'CLIENT_NOT_ALLOWED']) {
    const fetchImpl = createFetchStub([
      ['/v1/traffic/campaign/free-grant/claim', { code: 1, message: 'claim rejected', data: { errorCode } }],
      ['/v1/traffic/accounts', accountPayload()],
    ]);
    const { service } = await makeServiceFixture({ fetchImpl });

    await assert.rejects(service.claimFreeGrant(), (error) => {
      assert.ok(error instanceof TrafficApiError);
      assert.equal(error.errorCode, errorCode);
      assert.equal(error.stage, 'campaign');
      return true;
    });
  }
});

test('redeemTrafficCode normalizes the code, signs traffic-redeem-code, and invalidates the balance cache', async () => {
  let captured = null;
  const fetchImpl = createFetchStub([
    ['/v1/traffic/redeem-code', (init) => {
      captured = { headers: init.headers, body: JSON.parse(init.body) };
      return { codeId: 7, trafficBytes: 100000000, balanceAfter: 101000000 };
    }],
    ['/v1/traffic/accounts', (init) => (
      String(init.method) === 'GET' ? accountPayload({ balanceBytes: 101000000 }) : accountPayload()
    )],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl });

  await service.ensureTrafficAccount();
  const result = await service.redeemTrafficCode('idb-abcd-efgh-jklm');
  assert.deepEqual(result, { codeId: 7, trafficBytes: 100000000, balanceAfter: 101000000 });

  assert.ok(captured);
  assert.deepEqual(captured.body, { code: 'IDB-ABCD-EFGH-JKLM' });
  const timestamp = Number(captured.headers['X-Timestamp']);
  assert.ok(
    verifyMessage(
      IDENTITY_ADDRESS,
      `traffic-redeem-code:${SERVER_ACCOUNT_ID}:${timestamp}`,
      captured.headers['X-Signature'],
    ),
    'X-Signature must verify against traffic-redeem-code:<accountId>:<ts>',
  );

  const balance = await service.getTrafficBalance();
  assert.equal(balance.balanceBytes, 101000000);
  assert.equal(callsToPath(fetchImpl, `/v1/traffic/accounts/${SERVER_ACCOUNT_ID}/balance`).length, 1);
});

test('redeemTrafficCode surfaces the backend data.errorCode (CODE_*) and rejects empty codes', async () => {
  for (const errorCode of ['CODE_NOT_FOUND', 'CODE_USED', 'CODE_DISABLED', 'CODE_EXPIRED']) {
    const fetchImpl = createFetchStub([
      ['/v1/traffic/redeem-code', { code: 1, message: 'code rejected', data: { errorCode } }],
      ['/v1/traffic/accounts', accountPayload()],
    ]);
    const { service } = await makeServiceFixture({ fetchImpl });

    await assert.rejects(service.redeemTrafficCode('IDB-XXXX-YYYY-ZZZZ'), (error) => {
      assert.ok(error instanceof TrafficApiError);
      assert.equal(error.errorCode, errorCode);
      assert.equal(error.stage, 'redeem');
      return true;
    });
  }

  const { service } = await makeServiceFixture({ fetchImpl: createFetchStub([]) });
  await assert.rejects(service.redeemTrafficCode('   '), (error) => {
    assert.ok(error instanceof TrafficApiError);
    assert.equal(error.stage, 'redeem');
    return true;
  });
});

test('traffic settings snapshot round-trips through traffic.json', async () => {
  const { service, systemHomeDir } = await makeServiceFixture({ fetchImpl: createFetchStub([]) });

  assert.deepEqual(await service.getTrafficSettingsSnapshot(), { mode: 'traffic', fallbackPolicy: 'selfpay', apiBase: '' });
  await service.setTrafficSettingsSnapshot({ mode: 'selfpay' });
  assert.deepEqual(await service.getTrafficSettingsSnapshot(), { mode: 'selfpay', fallbackPolicy: 'selfpay', apiBase: '' });
  assert.equal(await service.getTrafficPinMode(), 'selfpay');
  await service.setTrafficSettingsSnapshot({ mode: 'traffic' });
  assert.deepEqual(await service.getTrafficSettingsSnapshot(), { mode: 'traffic', fallbackPolicy: 'selfpay', apiBase: '' });
  assert.equal((await readTrafficFile(systemHomeDir)).mode, 'traffic');
  // Garbage input normalizes back to the account-quota default.
  await service.setTrafficSettingsSnapshot({ mode: 'garbage' });
  assert.deepEqual(await service.getTrafficSettingsSnapshot(), { mode: 'traffic', fallbackPolicy: 'selfpay', apiBase: '' });
});

test('traffic apiBase setting: set/get/validate/clear', async () => {
  const { service, systemHomeDir } = await makeServiceFixture({ fetchImpl: createFetchStub([]) });

  // Unset -> undefined (clients fall back to the production default).
  assert.equal(await service.getConfiguredTrafficApiBase(), undefined);
  assert.equal((await service.getTrafficSettingsSnapshot()).apiBase, '');

  // Valid URL is normalized (trailing slashes stripped) and persisted.
  await service.setTrafficSettingsSnapshot({ apiBase: 'http://47.76.58.120:7882/' });
  assert.equal((await service.getTrafficSettingsSnapshot()).apiBase, 'http://47.76.58.120:7882');
  assert.equal(await service.getConfiguredTrafficApiBase(), 'http://47.76.58.120:7882');
  assert.equal((await readTrafficFile(systemHomeDir)).apiBase, 'http://47.76.58.120:7882');

  // Invalid values throw and are never persisted.
  await assert.rejects(service.setTrafficSettingsSnapshot({ apiBase: 'not-a-url' }), /valid URL/);
  await assert.rejects(service.setTrafficSettingsSnapshot({ apiBase: 'ftp://example.com' }), /http or https/);
  assert.equal((await service.getTrafficSettingsSnapshot()).apiBase, 'http://47.76.58.120:7882');

  // Empty string clears the override.
  await service.setTrafficSettingsSnapshot({ apiBase: '' });
  assert.equal((await service.getTrafficSettingsSnapshot()).apiBase, '');
  assert.equal(await service.getConfiguredTrafficApiBase(), undefined);
});

test('traffic service HTTP honors the stored apiBase when no explicit baseUrl is injected', async () => {
  const kvHost = 'https://kv-configured.test';
  const fetchImpl = createFetchStub([
    ['/v1/traffic/pricing', [{ planId: 'p1', chain: 'mvc', payCurrency: 'CNY', payAmount: 1, trafficBytes: 1048576 }]],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl, baseUrl: '' });
  await service.setTrafficSettingsSnapshot({ apiBase: kvHost });

  const plans = await service.getTrafficPricing();
  assert.equal(plans.length, 1);
  assert.ok(fetchImpl.calls[0].url.startsWith(kvHost));

  // Clear the override -> requests fall back to the production default host.
  await service.setTrafficSettingsSnapshot({ apiBase: '' });
  await service.getTrafficPricing();
  assert.ok(fetchImpl.calls[1].url.startsWith('https://www.metaso.network/assist-open-api'));
});

test('getTrafficLedger enriches sponsor entries from the local spend journal', async () => {
  const LEDGER_TS = 1780000000000;
  const fetchImpl = createFetchStub([
    // Route matching is substring-based, so the ledger route must precede the
    // accounts route that prefixes it.
    ['/ledger', {
      entries: [
        { id: 4, direction: 2, amountBytes: 300, balanceAfter: 200, sourceType: 'sponsor_order', sourceId: 'order-1', remark: 'sponsor commit', timestamp: LEDGER_TS },
        { id: 3, direction: 3, amountBytes: 500, balanceAfter: 500, sourceType: 'sponsor_order', sourceId: 'order-1', remark: 'sponsor reserve', timestamp: LEDGER_TS - 1000 },
        { id: 2, direction: 4, amountBytes: 500, balanceAfter: 1000, sourceType: 'sponsor_order', sourceId: 'order-expired', remark: 'reservation expired', timestamp: LEDGER_TS - 2000 },
        { id: 1, direction: 1, amountBytes: 1000, balanceAfter: 1000, sourceType: 'recharge_order', sourceId: 'recharge-1', remark: 'recharge credited', timestamp: LEDGER_TS - 3000 },
      ],
      nextCursor: 0,
    }],
    ['/v1/traffic/accounts', accountPayload()],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl });
  await service.ensureTrafficAccount();

  await service.recordLocalTrafficSpend({
    txId: COMMIT_TXID,
    botAddress: BOT1_ADDRESS,
    orderId: 'order-1',
    txSize: 300,
    billedBy: 'traffic',
    kind: '/protocols/simplemsg',
  });

  const { entries, nextCursor } = await service.getTrafficLedger({});
  assert.equal(entries.length, 4);
  assert.equal(nextCursor, 0);

  const spend = entries.find((entry) => entry.direction === 2);
  assert.equal(spend.txId, COMMIT_TXID);
  assert.equal(spend.botAddress, BOT1_ADDRESS);
  assert.equal(spend.kind, '/protocols/simplemsg');

  // Same orderId: the matching reserve row is enriched too (it became this tx).
  const reserve = entries.find((entry) => entry.direction === 3);
  assert.equal(reserve.txId, COMMIT_TXID);
  assert.equal(reserve.kind, '/protocols/simplemsg');

  // Expired reservation (never committed locally) and the recharge credit
  // have no local journal match: enrichment fields stay absent.
  const release = entries.find((entry) => entry.direction === 4);
  assert.equal(release.txId, undefined);
  assert.equal(release.botAddress, undefined);
  assert.equal(release.kind, undefined);
  const credit = entries.find((entry) => entry.direction === 1);
  assert.equal(credit.txId, undefined);
  assert.equal(credit.botAddress, undefined);
  assert.equal(credit.kind, undefined);
});

test('daily usage falls back to the local journal when the usage API fails', async () => {
  const DAY_ONE = Date.UTC(2026, 7, 30, 12, 0, 0);
  const DAY_TWO = Date.UTC(2026, 7, 31, 12, 0, 0);
  const fetchImpl = createFetchStub([
    ['/usage/daily', httpError(500, { code: 1, message: 'usage backend down' })],
    ['/v1/traffic/accounts', accountPayload()],
  ]);
  const { service } = await makeServiceFixture({ fetchImpl });
  await service.ensureTrafficAccount();

  await service.store.appendJournal({ txId: COMMIT_TXID, botAddress: BOT1_ADDRESS, orderId: 'o1', txSize: 300, billedBy: 'traffic', createdAt: DAY_ONE });
  await service.store.appendJournal({ txId: 'bb'.repeat(32), botAddress: BOT1_ADDRESS, orderId: 'o2', txSize: 200, billedBy: 'traffic', createdAt: DAY_ONE + 1000 });
  await service.store.appendJournal({ txId: 'cc'.repeat(32), botAddress: BOT2_ADDRESS, orderId: 'o3', txSize: 100, billedBy: 'quota', createdAt: DAY_TWO });

  const fallback = await service.getTrafficDailyUsageWithFallback({});
  assert.equal(fallback.source, 'local');
  assert.match(fallback.error, /usage backend down/);
  assert.equal(fallback.rows.length, 2);
  const dayOne = fallback.rows.find((row) => row.botAddress === BOT1_ADDRESS);
  assert.deepEqual(dayOne, { date: '2026-08-30', botAddress: BOT1_ADDRESS, bytes: 500, txCount: 2 });
  const dayTwo = fallback.rows.find((row) => row.botAddress === BOT2_ADDRESS);
  assert.deepEqual(dayTwo, { date: '2026-08-31', botAddress: BOT2_ADDRESS, bytes: 100, txCount: 1 });

  // The bot filter applies to the fallback aggregation too.
  const filtered = await service.getTrafficDailyUsageWithFallback({ botAddress: BOT2_ADDRESS });
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].botAddress, BOT2_ADDRESS);

  // A healthy backend wins over the journal.
  const healthyFetch = createFetchStub([
    ['/usage/daily', [{ date: '2026-08-30', botAddress: BOT1_ADDRESS, bytes: 4096, txCount: 9 }]],
    ['/v1/traffic/accounts', accountPayload()],
  ]);
  const healthy = await makeServiceFixture({ fetchImpl: healthyFetch });
  const remote = await healthy.service.getTrafficDailyUsageWithFallback({});
  assert.equal(remote.source, 'remote');
  assert.equal(remote.error, '');
  assert.deepEqual(remote.rows, [{ date: '2026-08-30', botAddress: BOT1_ADDRESS, bytes: 4096, txCount: 9 }]);
});
