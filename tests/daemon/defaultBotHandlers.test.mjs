import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const {
  createMetabotProfile,
  getMetabotProfile,
  updateMetabotProfile,
} = require('../../dist/core/bot/metabotProfileManager.js');
const { listIdentityProfiles, setActiveMetabotHome, upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createFileSecretStore } = require('../../dist/core/secrets/fileSecretStore.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

function runtime(provider, id, health = 'healthy') {
  const now = '2026-05-06T00:00:00.000Z';
  return {
    id,
    provider,
    displayName: provider,
    binaryPath: `/bin/${provider}`,
    version: '1.0.0',
    authState: 'authenticated',
    health,
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function makeSigner(writePin) {
  return {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin,
  };
}

function makeChainedCreateOverrides(writeCalls = []) {
  return {
    identitySyncStepDelayMs: 0,
    requestMvcGasSubsidy: async (input) => ({
      success: true,
      step1: { address: input.mvcAddress },
      step2: { txid: 'subsidy-tx-1' },
    }),
    createSignerForHome: () => makeSigner(async (input) => {
      writeCalls.push(input);
      return {
        txids: [`create-tx-${writeCalls.length}`],
        pinId: `create-pin-${writeCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-created',
        mvcAddress: 'mvc-created',
      };
    }),
  };
}

async function writeProfileSkill(profileHomeDir, skillName) {
  const skillDir = path.join(profileHomeDir, '.codex', 'skills', skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), `# ${skillName}\n`, 'utf8');
}

function fakeBalanceAdapter(chain, calls) {
  return {
    network: chain,
    explorerBaseUrl: `https://explorer.example/${chain}`,
    feeRateUnit: 'sat/byte',
    minTransferSatoshis: 1,
    deriveAddress: async () => `${chain}-derived`,
    fetchUtxos: async () => [],
    fetchBalance: async (address) => {
      calls.push({ chain, address });
      return {
        chain,
        address,
        totalSatoshis: 1000,
        confirmedSatoshis: 1000,
        unconfirmedSatoshis: 0,
        utxoCount: 1,
      };
    },
    fetchFeeRate: async () => 1,
    fetchRawTx: async () => 'raw-prev',
    broadcastTx: async () => `${chain}-txid`,
    buildTransfer: async () => ({ rawTx: `${chain}-raw`, fee: 100 }),
    buildInscription: async () => ({ signedRawTxs: [], revealIndices: [], totalCost: 0 }),
  };
}

test('default bot handlers create, list, and fetch MetaBot profiles', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
  });

  const created = await handlers.bot.createProfile({
    name: 'Alice Bot',
    bio: 'Builds small tools on the Agent Internet.',
    role: 'Writes careful code.',
  });

  assert.equal(created.ok, true);
  const activeHandlers = createDefaultMetabotDaemonHandlers({
    homeDir: created.data.profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
  });
  const listed = await activeHandlers.bot.listProfiles();
  const fetched = await activeHandlers.bot.getProfile({ slug: created.data.profile.slug });

  assert.equal(created.data.profile.slug, 'alice-bot');
  assert.equal(created.data.profile.bio, 'Builds small tools on the Agent Internet.');
  assert.equal(created.data.profile.role, 'Writes careful code.');
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.data.profiles.map((profile) => profile.slug), ['alice-bot']);
  assert.equal(listed.data.profiles[0].isActive, true);
  assert.equal(typeof listed.data.profiles[0].homeDir, 'string');
  assert.equal(fetched.ok, true);
  assert.equal(fetched.data.profile.name, 'Alice Bot');
  assert.equal(fetched.data.profile.bio, 'Builds small tools on the Agent Internet.');
});

test('default bot config handlers persist default write network per MetaBot profile', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const alice = await createMetabotProfile(systemHomeDir, { name: 'Alice Bot' });
  const eric = await createMetabotProfile(systemHomeDir, { name: 'Eric Bot' });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
  });

  const setAlice = await handlers.bot.setConfig({
    slug: alice.slug,
    chain: {
      defaultWriteNetwork: 'opcat',
    },
  });
  const aliceConfig = await handlers.bot.getConfig({ slug: alice.slug });
  const ericConfig = await handlers.bot.getConfig({ slug: eric.slug });
  const aliceConfigOnDisk = await createConfigStore(alice.homeDir).read();
  const ericConfigOnDisk = await createConfigStore(eric.homeDir).read();

  assert.equal(setAlice.ok, true);
  assert.equal(aliceConfig.data.chain.defaultWriteNetwork, 'opcat');
  assert.equal(ericConfig.data.chain.defaultWriteNetwork, 'mvc');
  assert.equal(aliceConfigOnDisk.chain.defaultWriteNetwork, 'opcat');
  assert.equal(ericConfigOnDisk.chain.defaultWriteNetwork, 'mvc');
});

test('default bot getWallet queries balances with displayed wallet addresses', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-wallet-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const bot = await createMetabotProfile(systemHomeDir, { name: 'Wallet Bot' });
  await upsertIdentityProfile({
    systemHomeDir,
    name: bot.name,
    homeDir: bot.homeDir,
    globalMetaId: 'gm-wallet-bot',
    mvcAddress: 'mvc-profile-address',
  });
  await createFileSecretStore(bot.homeDir).writeIdentitySecrets({
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    path: "m/44'/10001'/0'/0/0",
    addresses: {
      btc: 'btc-secret-address',
      mvc: 'mvc-secret-address',
      doge: 'doge-secret-address',
      opcat: 'opcat-secret-address',
    },
    globalMetaId: 'gm-wallet-bot',
  });
  await createRuntimeStateStore(bot.homeDir).writeState({
    identity: {
      metabotId: 1,
      name: bot.name,
      createdAt: 1776836000000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'public-key',
      chatPublicKey: 'chat-public-key',
      addresses: {
        btc: 'btc-runtime-stale-address',
        mvc: 'mvc-runtime-stale-address',
        doge: 'doge-runtime-stale-address',
        opcat: 'opcat-runtime-stale-address',
      },
      mvcAddress: 'mvc-runtime-stale-address',
      metaId: 'metaid-wallet-bot',
      globalMetaId: 'gm-wallet-bot',
    },
    services: [],
    traces: [],
    sellerOrders: [],
  });
  const balanceCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    adapters: new Map(['mvc', 'btc', 'doge', 'opcat'].map((chain) => [chain, fakeBalanceAdapter(chain, balanceCalls)])),
    ...makeChainedCreateOverrides(),
  });

  const result = await handlers.bot.getWallet({ slug: bot.slug });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.wallet.addresses, {
    btc: 'btc-secret-address',
    mvc: 'mvc-secret-address',
    doge: 'doge-secret-address',
    opcat: 'opcat-secret-address',
  });
  assert.deepEqual(
    balanceCalls.map((call) => [call.chain, call.address]),
    [
      ['mvc', 'mvc-secret-address'],
      ['btc', 'btc-secret-address'],
      ['doge', 'doge-secret-address'],
      ['opcat', 'opcat-secret-address'],
    ],
  );
});

test('default bot wallet transfers prepare balances with displayed wallet addresses', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-transfer-wallet-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const bot = await createMetabotProfile(systemHomeDir, { name: 'Transfer Wallet Bot' });
  await upsertIdentityProfile({
    systemHomeDir,
    name: bot.name,
    homeDir: bot.homeDir,
    globalMetaId: 'gm-transfer-wallet-bot',
    mvcAddress: 'mvc-profile-address',
  });
  await createFileSecretStore(bot.homeDir).writeIdentitySecrets({
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    path: "m/44'/10001'/0'/0/0",
    addresses: {
      btc: 'btc-secret-address',
      mvc: 'mvc-secret-address',
      doge: 'doge-secret-address',
      opcat: 'opcat-secret-address',
    },
    globalMetaId: 'gm-transfer-wallet-bot',
  });
  await createRuntimeStateStore(bot.homeDir).writeState({
    identity: {
      metabotId: 1,
      name: bot.name,
      createdAt: 1776836000000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'public-key',
      chatPublicKey: 'chat-public-key',
      addresses: {
        btc: 'btc-runtime-stale-address',
        mvc: 'mvc-runtime-stale-address',
        doge: 'doge-runtime-stale-address',
        opcat: 'opcat-runtime-stale-address',
      },
      mvcAddress: 'mvc-runtime-stale-address',
      metaId: 'metaid-transfer-wallet-bot',
      globalMetaId: 'gm-transfer-wallet-bot',
    },
    services: [],
    traces: [],
    sellerOrders: [],
  });
  const balanceCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    adapters: new Map(['mvc', 'btc', 'doge', 'opcat'].map((chain) => [chain, fakeBalanceAdapter(chain, balanceCalls)])),
    ...makeChainedCreateOverrides(),
  });

  const preview = await handlers.bot.previewWalletTransfer({
    slug: bot.slug,
    chain: 'doge',
    toAddress: 'D-recipient',
    amount: '0.000001',
  });
  const confirm = await handlers.bot.confirmWalletTransfer({
    slug: bot.slug,
    chain: 'doge',
    toAddress: 'D-recipient',
    amount: '0.000001',
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.data.fromAddress, 'doge-secret-address');
  assert.equal(confirm.ok, true);
  assert.deepEqual(
    balanceCalls.map((call) => [call.chain, call.address]),
    [
      ['doge', 'doge-secret-address'],
      ['doge', 'doge-secret-address'],
    ],
  );
});

test('default file.uploadLarge preserves unavailable uploader failure code', async (t) => {
  const homeDir = await createProfileHome('metabot-default-large-upload-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const filePath = path.join(homeDir, 'large-video.mp4');
  await writeFile(filePath, Buffer.alloc((2 * 1024 * 1024) + 1));
  await createRuntimeStateStore(homeDir).writeState({
    identity: {
      metabotId: 1,
      name: 'Large Upload Bot',
      createdAt: 1776836000000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'public-key',
      chatPublicKey: 'chat-public-key',
      addresses: {
        btc: 'btc-address',
        mvc: 'mvc-address',
        doge: 'doge-address',
        opcat: 'opcat-address',
      },
      mvcAddress: 'mvc-address',
      metaId: 'metaid-large-upload-bot',
      globalMetaId: 'gm-large-upload-bot',
    },
    services: [],
    traces: [],
    sellerOrders: [],
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    signer: makeSigner(async () => {
      throw new Error('direct signer should not be used for large uploads without a largeUploader');
    }),
    getDaemonRecord: () => null,
  });

  const result = await handlers.file.uploadLarge({
    filePath,
    contentType: 'video/mp4',
    network: 'mvc',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'large_file_upload_unavailable');
  assert.match(result.message, /Large file upload requires an injected largeUploader/);
});

test('default LLM handlers use the active profile when actor selectors are omitted', async (t) => {
  const homeDir = await createProfileHome('metabot-default-llm-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  await upsertIdentityProfile({
    systemHomeDir,
    name: 'Active Bot',
    homeDir,
    globalMetaId: 'gm-active',
    mvcAddress: 'mvc-active',
  });
  await setActiveMetabotHome({ systemHomeDir, homeDir });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
  });

  const upserted = await handlers.llm.upsertBindings({
    bindings: [
      {
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: true,
      },
    ],
  });
  const listed = await handlers.llm.listBindings({});
  const setPreferred = await handlers.llm.setPreferredRuntime({ runtimeId: 'runtime-codex' });
  const gotPreferred = await handlers.llm.getPreferredRuntime({});
  const bindingState = await createLlmBindingStore(homeDir).read();

  assert.equal(upserted.ok, true);
  assert.equal(listed.ok, true);
  assert.equal(setPreferred.ok, true);
  assert.equal(gotPreferred.ok, true);
  assert.equal(bindingState.bindings[0].metaBotSlug, 'active-bot');
  assert.equal(bindingState.bindings[0].id, 'lb_active-bot_runtime-codex_primary');
  assert.equal(gotPreferred.data.runtimeId, 'runtime-codex');
});

test('default bot testRuntime reports missing runtime ids', async (t) => {
  const homeDir = await createProfileHome('metabot-default-runtime-test-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
    testLlmRuntimeReadiness: async (entry) => entry,
  });

  const result = await handlers.bot.testRuntime({ runtimeId: 'missing-runtime' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'runtime_not_found');
  assert.match(result.message, /missing-runtime/);
});

test('default bot testRuntime updates a runtime to healthy', async (t) => {
  const homeDir = await createProfileHome('metabot-default-runtime-test-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const runtimeStore = createLlmRuntimeStore(homeDir);
  await runtimeStore.upsertRuntime(runtime('codex', 'runtime-codex', 'detected'));
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
    testLlmRuntimeReadiness: async (entry) => ({
      ...entry,
      version: '0.133.1',
      health: 'healthy',
      healthReason: undefined,
      healthCheckedAt: '2026-05-22T06:00:00.000Z',
      updatedAt: '2026-05-22T06:00:00.000Z',
    }),
  });

  const result = await handlers.bot.testRuntime({ runtimeId: 'runtime-codex' });
  const stored = await runtimeStore.read();

  assert.equal(result.ok, true);
  assert.equal(result.data.runtime.health, 'healthy');
  assert.equal(result.data.runtime.healthReason, undefined);
  assert.equal(stored.runtimes[0].health, 'healthy');
  assert.equal(stored.runtimes[0].version, '0.133.1');
  assert.equal(result.data.runtimes[0].health, 'healthy');
});

test('default bot testRuntime updates a runtime to detected on readiness failure', async (t) => {
  const homeDir = await createProfileHome('metabot-default-runtime-test-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const runtimeStore = createLlmRuntimeStore(homeDir);
  await runtimeStore.upsertRuntime(runtime('codex', 'runtime-codex', 'healthy'));
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
    testLlmRuntimeReadiness: async (entry) => ({
      ...entry,
      health: 'detected',
      healthReason: 'Readiness probe completed without returning output.',
      healthCheckedAt: '2026-05-22T06:05:00.000Z',
      updatedAt: '2026-05-22T06:05:00.000Z',
    }),
  });

  const result = await handlers.bot.testRuntime({ runtimeId: 'runtime-codex' });
  const stored = await runtimeStore.read();

  assert.equal(result.ok, true);
  assert.equal(result.data.runtime.health, 'detected');
  assert.equal(result.data.runtime.healthReason, 'Readiness probe completed without returning output.');
  assert.equal(stored.runtimes[0].health, 'detected');
  assert.equal(stored.runtimes[0].healthReason, 'Readiness probe completed without returning output.');
});

test('default bot testRuntime updates a runtime to unavailable on version failure', async (t) => {
  const homeDir = await createProfileHome('metabot-default-runtime-test-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const runtimeStore = createLlmRuntimeStore(homeDir);
  await runtimeStore.upsertRuntime(runtime('codex', 'runtime-codex', 'detected'));
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
    testLlmRuntimeReadiness: async (entry) => ({
      ...entry,
      health: 'unavailable',
      healthReason: 'Version probe failed.',
      healthCheckedAt: '2026-05-22T06:10:00.000Z',
      updatedAt: '2026-05-22T06:10:00.000Z',
    }),
  });

  const result = await handlers.bot.testRuntime({ runtimeId: 'runtime-codex' });
  const stored = await runtimeStore.read();

  assert.equal(result.ok, true);
  assert.equal(result.data.runtime.health, 'unavailable');
  assert.equal(stored.runtimes[0].health, 'unavailable');
  assert.equal(stored.runtimes[0].healthReason, 'Version probe failed.');
});

test('default bot createProfile rejects missing or duplicate names', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
  });

  const missing = await handlers.bot.createProfile({ name: '  ' });
  const first = await handlers.bot.createProfile({ name: 'Alice Bot' });
  const duplicate = await handlers.bot.createProfile({ name: 'Alice Bot' });

  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'missing_name');
  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'name_taken');
});

test('default bot createProfile bootstraps a chained identity before indexing the local profile', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    identitySyncStepDelayMs: 0,
    getDaemonRecord: () => null,
    requestMvcGasSubsidy: async (input) => ({
      success: true,
      step1: { address: input.mvcAddress },
      step2: { txid: 'subsidy-tx-1' },
    }),
    createSignerForHome: () => makeSigner(async (input) => {
      writeCalls.push(input);
      return {
        txids: [`tx-${writeCalls.length}`],
        pinId: `pin-${writeCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-chain-bot',
        mvcAddress: 'mvc-chain-bot',
      };
    }),
  });

  const result = await handlers.bot.createProfile({
    name: 'Chain Bot',
    role: 'Role after chain.',
    avatarDataUrl: 'data:image/png;base64,ZmFrZQ==',
  });
  const stored = await getMetabotProfile(systemHomeDir, 'chain-bot');

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.slug, 'chain-bot');
  assert.match(result.data.profile.globalMetaId, /^idq/);
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name', '/info/chatpubkey']);
  assert.deepEqual(writeCalls.map((call) => call.operation), ['create', 'create']);
  assert.equal(writeCalls[0].contentType, 'text/plain');
  assert.equal(writeCalls[0].payload, 'Chain Bot');
  assert.deepEqual(result.data.chainWrites.flatMap((write) => write.txids), ['tx-1', 'tx-2']);
  assert.equal(stored.role, 'Role after chain.');
  assert.equal(stored.avatarDataUrl, 'data:image/png;base64,ZmFrZQ==');
  assert.equal(stored.globalMetaId, result.data.profile.globalMetaId);
});

test('default bot createProfile keeps optional profile fields local during minimal chain creation', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'chain-first-draft-bot');
  const targetPaths = resolveMetabotPaths(targetHomeDir);
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    identitySyncStepDelayMs: 0,
    getDaemonRecord: () => null,
    requestMvcGasSubsidy: async (input) => ({
      success: true,
      step1: { address: input.mvcAddress },
      step2: { txid: 'subsidy-tx-1' },
    }),
    createSignerForHome: () => makeSigner(async (input) => {
      writeCalls.push(input);
      if (input.path === '/info/chatpubkey') {
        assert.deepEqual(await listIdentityProfiles(systemHomeDir), []);
        await assert.rejects(() => access(targetPaths.roleMdPath), /ENOENT/);
        await assert.rejects(() => access(path.join(targetHomeDir, 'avatar.txt')), /ENOENT/);
      }
      return {
        txids: [`chain-first-tx-${writeCalls.length}`],
        pinId: `chain-first-pin-${writeCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-chain-first-draft',
        mvcAddress: 'mvc-chain-first-draft',
      };
    }),
  });

  const result = await handlers.bot.createProfile({
    name: 'Chain First Draft Bot',
    role: 'Chain first role.',
    avatarDataUrl: 'data:image/png;base64,ZmFrZQ==',
  });
  const stored = await getMetabotProfile(systemHomeDir, 'chain-first-draft-bot');

  assert.equal(result.ok, true);
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name', '/info/chatpubkey']);
  assert.equal(stored.role, 'Chain first role.');
  assert.equal(stored.avatarDataUrl, 'data:image/png;base64,ZmFrZQ==');
});

test('default bot createProfile persists requested provider fields without chain LLM write', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'provider-create-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'healthy'),
      runtime('claude-code', 'runtime-claude', 'healthy'),
    ],
  });
  const llmPayloads = [];
  const writePaths = [];
  let signerCallCount = 0;
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    identitySyncStepDelayMs: 0,
    getDaemonRecord: () => null,
    requestMvcGasSubsidy: async (input) => ({
      success: true,
      step1: { address: input.mvcAddress },
      step2: { txid: 'subsidy-tx-1' },
    }),
    createSignerForHome: () => makeSigner(async (input) => {
      signerCallCount += 1;
      writePaths.push(input.path);
      if (input.path === '/info/LLM') {
        llmPayloads.push(JSON.parse(input.payload));
      }
      return {
        txids: [`provider-create-tx-${signerCallCount}`],
        pinId: `provider-create-pin-${signerCallCount}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-provider-create',
        mvcAddress: 'mvc-provider-create',
      };
    }),
  });

  const result = await handlers.bot.createProfile({
    name: 'Provider Create Bot',
    primaryProvider: 'codex',
    fallbackProvider: 'claude-code',
  });
  const bindingState = await createLlmBindingStore(result.data.profile.homeDir).read();

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.primaryProvider, 'codex');
  assert.equal(result.data.profile.fallbackProvider, 'claude-code');
  assert.deepEqual(writePaths, ['/info/name', '/info/chatpubkey']);
  assert.deepEqual(llmPayloads, []);
  assert.deepEqual(
    bindingState.bindings.map((binding) => [binding.role, binding.llmRuntimeId]).sort(),
    [
      ['fallback', 'runtime-claude'],
      ['primary', 'runtime-codex'],
    ],
  );
});

test('default bot createProfile rejects non-empty allowChatSkills before Bot detail setup', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const signerCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    identitySyncStepDelayMs: 0,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
    createSignerForHome: () => makeSigner(async (input) => {
      signerCalls.push(input);
      return {
        txids: [`create-allow-chat-skill-tx-${signerCalls.length}`],
        pinId: `create-allow-chat-skill-pin-${signerCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-create-allow-chat-skill',
        mvcAddress: 'mvc-create-allow-chat-skill',
      };
    }),
  });

  const result = await handlers.bot.createProfile({
    name: 'Create Allow Chat Skill Bot',
    allowChatSkills: ['metabot-help'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_metabot_profile_create');
  assert.match(result.message, /configured after MetaBot creation from the Bot detail page/i);
  assert.deepEqual(signerCalls, []);
});

test('default bot createProfile accepts empty allowChatSkills as a no-op', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    identitySyncStepDelayMs: 0,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
    createSignerForHome: () => makeSigner(async (input) => {
      writeCalls.push(input);
      return {
        txids: [`create-empty-allow-chat-skill-tx-${writeCalls.length}`],
        pinId: `create-empty-allow-chat-skill-pin-${writeCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-create-empty-allow-chat-skill',
        mvcAddress: 'mvc-create-empty-allow-chat-skill',
      };
    }),
  });

  const result = await handlers.bot.createProfile({
    name: 'Create Empty Allow Chat Skill Bot',
    role: 'Empty allow list is accepted.',
    allowChatSkills: [],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.profile.allowChatSkills, []);
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name', '/info/chatpubkey']);
});

test('default bot createProfile rejects requested degraded providers before chain writes', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'degraded-provider-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'degraded'),
    ],
  });
  const signerCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    identitySyncStepDelayMs: 0,
    getDaemonRecord: () => null,
    requestMvcGasSubsidy: async (input) => ({
      success: true,
      step1: { address: input.mvcAddress },
      step2: { txid: 'subsidy-tx-1' },
    }),
    createSignerForHome: () => makeSigner(async (input) => {
      signerCalls.push(input);
      return {
        txids: [`degraded-provider-tx-${signerCalls.length}`],
        pinId: `degraded-provider-pin-${signerCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-degraded-provider',
        mvcAddress: 'mvc-degraded-provider',
      };
    }),
  });

  const result = await handlers.bot.createProfile({
    name: 'Degraded Provider Bot',
    primaryProvider: 'codex',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_metabot_profile_create');
  assert.match(result.message, /No healthy runtime found for provider: codex/);
  assert.deepEqual(signerCalls, []);
});

test('default bot createProfile prefers the requested host provider and falls back to a different recent provider', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'host-default-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [
      {
        ...runtime('codex', 'runtime-codex', 'healthy'),
        lastSeenAt: '2026-05-06T00:01:00.000Z',
        updatedAt: '2026-05-06T00:01:00.000Z',
      },
      {
        ...runtime('claude-code', 'runtime-claude', 'healthy'),
        lastSeenAt: '2026-05-06T00:05:00.000Z',
        updatedAt: '2026-05-06T00:05:00.000Z',
      },
    ],
  });
  const llmPayloads = [];
  const writePaths = [];
  let signerCallCount = 0;
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
    createSignerForHome: () => makeSigner(async (input) => {
      signerCallCount += 1;
      writePaths.push(input.path);
      if (input.path === '/info/LLM') {
        llmPayloads.push(JSON.parse(input.payload));
      }
      return {
        txids: [`host-default-tx-${signerCallCount}`],
        pinId: `host-default-pin-${signerCallCount}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-host-default',
        mvcAddress: 'mvc-host-default',
      };
    }),
  });

  const result = await handlers.bot.createProfile({
    name: 'Host Default Bot',
    host: 'codex',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.primaryProvider, 'codex');
  assert.equal(result.data.profile.fallbackProvider, 'claude-code');
  assert.deepEqual(writePaths, ['/info/name', '/info/chatpubkey']);
  assert.deepEqual(llmPayloads, []);
});

test('default bot createProfile from UI defaults providers by recent runtime activity', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'ui-default-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [
      {
        ...runtime('codex', 'runtime-codex', 'healthy'),
        lastSeenAt: '2026-05-06T00:01:00.000Z',
        updatedAt: '2026-05-06T00:01:00.000Z',
      },
      {
        ...runtime('claude-code', 'runtime-claude', 'healthy'),
        lastSeenAt: '2026-05-06T00:05:00.000Z',
        updatedAt: '2026-05-06T00:05:00.000Z',
      },
    ],
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
  });

  const result = await handlers.bot.createProfile({
    name: 'UI Default Bot',
    creationSource: 'ui',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.primaryProvider, 'claude-code');
  assert.equal(result.data.profile.fallbackProvider, 'codex');
});

test('default bot createProfile from UI applies METABOT_HOST provider defaults', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const originalHost = process.env.METABOT_HOST;
  process.env.METABOT_HOST = 'codex';
  t.after(() => {
    if (originalHost === undefined) {
      delete process.env.METABOT_HOST;
    } else {
      process.env.METABOT_HOST = originalHost;
    }
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'ui-host-default-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [
      {
        ...runtime('codex', 'runtime-codex', 'healthy'),
        lastSeenAt: '2026-05-06T00:01:00.000Z',
        updatedAt: '2026-05-06T00:01:00.000Z',
      },
      {
        ...runtime('claude-code', 'runtime-claude', 'healthy'),
        lastSeenAt: '2026-05-06T00:05:00.000Z',
        updatedAt: '2026-05-06T00:05:00.000Z',
      },
    ],
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
  });

  const result = await handlers.bot.createProfile({
    name: 'UI Host Default Bot',
    creationSource: 'ui',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.primaryProvider, 'codex');
  assert.equal(result.data.profile.fallbackProvider, 'claude-code');
});

test('default identity create notifies the daemon after registering the profile', async (t) => {
  const homeDir = await createProfileHome('metabot-default-identity-create-', 'callback-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  let registrationCallbackCalls = 0;
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    identitySyncStepDelayMs: 0,
    getDaemonRecord: () => null,
    requestMvcGasSubsidy: async (input) => ({
      success: true,
      step1: { address: input.mvcAddress },
      step2: { txid: 'subsidy-tx-1' },
    }),
    signer: makeSigner(async (input) => ({
      txids: ['identity-callback-tx'],
      pinId: 'identity-callback-pin',
      totalCost: 1,
      network: 'mvc',
      operation: input.operation,
      path: input.path,
      contentType: input.contentType,
      encoding: input.encoding ?? 'utf-8',
      globalMetaId: 'gm-identity-callback',
      mvcAddress: 'mvc-identity-callback',
    })),
    onIdentityProfileRegistered: async () => {
      registrationCallbackCalls += 1;
    },
  });

  const result = await handlers.identity.create({
    name: 'Callback Bot',
  });

  assert.equal(result.ok, true);
  assert.equal(registrationCallbackCalls, 1);
});

test('default bot createProfile notifies the daemon after registering the profile', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-create-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  let registrationCallbackCalls = 0;
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
    onIdentityProfileRegistered: async () => {
      registrationCallbackCalls += 1;
    },
  });

  const result = await handlers.bot.createProfile({
    name: 'Fresh Socket Bot',
    creationSource: 'ui',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.name, 'Fresh Socket Bot');
  assert.equal(registrationCallbackCalls, 1);
});

test('default identity create prefers the requested Cursor host provider over newer CodeBuddy activity', async (t) => {
  const homeDir = await createProfileHome('metabot-default-identity-create-', 'cursor-default-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const binDir = path.join(systemHomeDir, 'bin');
  await mkdir(binDir, { recursive: true });
  const cursorPath = path.join(binDir, 'cursor-agent');
  const codebuddyPath = path.join(binDir, 'codebuddy');
  await writeFile(cursorPath, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "cursor-agent 1.0.0"; exit 0; fi',
    'echo \'{"type":"text","text":"OK"}\'',
  ].join('\n'), 'utf8');
  await writeFile(codebuddyPath, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "codebuddy 1.0.0"; exit 0; fi',
    'echo \'{"type":"text","text":"OK"}\'',
  ].join('\n'), 'utf8');
  await chmod(cursorPath, 0o755);
  await chmod(codebuddyPath, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = binDir;
  t.after(() => {
    process.env.PATH = originalPath;
  });

  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [
      {
        ...runtime('cursor', 'runtime-cursor', 'healthy'),
        lastSeenAt: '2026-05-06T00:01:00.000Z',
        updatedAt: '2026-05-06T00:01:00.000Z',
      },
      {
        ...runtime('codebuddy', 'runtime-codebuddy', 'healthy'),
        lastSeenAt: '2026-05-06T00:05:00.000Z',
        updatedAt: '2026-05-06T00:05:00.000Z',
      },
    ],
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    identitySyncStepDelayMs: 0,
    getDaemonRecord: () => null,
    requestMvcGasSubsidy: async (input) => ({
      success: true,
      step1: { address: input.mvcAddress },
      step2: { txid: 'subsidy-tx-1' },
    }),
    signer: makeSigner(async (input) => ({
      txids: ['identity-cursor-tx'],
      pinId: 'identity-cursor-pin',
      totalCost: 1,
      network: 'mvc',
      operation: input.operation,
      path: input.path,
      contentType: input.contentType,
      encoding: input.encoding ?? 'utf-8',
      globalMetaId: 'gm-identity-cursor',
      mvcAddress: 'mvc-identity-cursor',
    })),
  });

  const result = await handlers.identity.create({
    name: 'Cursor Default Bot',
    host: 'cursor',
  });
  const bindingState = await createLlmBindingStore(homeDir).read();
  const runtimeState = await createLlmRuntimeStore(homeDir).read();
  const providerByRuntimeId = new Map(runtimeState.runtimes.map((entry) => [entry.id, entry.provider]));

  assert.equal(result.ok, true);
  assert.deepEqual(
    bindingState.bindings.map((binding) => [binding.role, providerByRuntimeId.get(binding.llmRuntimeId)]).sort(),
    [
      ['fallback', 'codebuddy'],
      ['primary', 'cursor'],
    ],
  );
});

test('default bot createProfile removes pending local files when subsidy or chain bootstrap fails', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'failed-bot');
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    identitySyncStepDelayMs: 0,
    getDaemonRecord: () => null,
    requestMvcGasSubsidy: async () => ({
      success: false,
      error: 'subsidy unavailable',
    }),
    createSignerForHome: () => makeSigner(async () => {
      throw new Error('chain sync should not run after subsidy failure');
    }),
  });

  const result = await handlers.bot.createProfile({ name: 'Failed Bot' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'identity_bootstrap_failed');
  assert.deepEqual(await listIdentityProfiles(systemHomeDir), []);
  await assert.rejects(() => access(targetHomeDir), /ENOENT/);
});

test('default bot createProfile removes post-chain local files when manager indexing fails', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'index-fails-bot');
  await mkdir(path.join(systemHomeDir, '.metabot', 'manager', 'identity-profiles.json'), { recursive: true });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
  });

  const result = await handlers.bot.createProfile({ name: 'Index Fails Bot' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'metabot_profile_create_failed');
  await assert.rejects(() => access(targetHomeDir), /ENOENT/);
});

test('default bot updateProfile rejects local-only profiles before saving local fields', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, { name: 'Local Bot' });
  const signerCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      signerCalls.push(input);
      throw new Error('local-only profile should not sync');
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    name: 'Local Bot Updated',
    role: 'Local edits only.',
  });
  const afterFailure = await getMetabotProfile(systemHomeDir, profile.slug);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'chain_identity_missing');
  assert.equal(afterFailure.name, 'Local Bot');
  assert.equal(afterFailure.role, 'You are a helpful AI assistant.');
  assert.deepEqual(signerCalls, []);
});

test('default bot updateProfile allows Chinese names with ASCII suffixes that only fuzzy-match another profile', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const collisionProfile = await createMetabotProfile(systemHomeDir, { name: '老周去AI味' });
  const profile = await createMetabotProfile(systemHomeDir, { name: '马斯克' });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-musk-bot',
    mvcAddress: 'addr-musk-bot',
  });
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      return {
        txids: [`rename-tx-${writeCalls.length}`],
        pinId: `rename-pin-${writeCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-musk-bot',
        mvcAddress: 'addr-musk-bot',
      };
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    name: '马斯克_AI',
  });
  const afterUpdate = await getMetabotProfile(systemHomeDir, profile.slug);
  const afterCollision = await getMetabotProfile(systemHomeDir, collisionProfile.slug);

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.name, '马斯克_AI');
  assert.equal(result.data.profile.slug, profile.slug);
  assert.equal(afterUpdate.name, '马斯克_AI');
  assert.equal(afterCollision.name, '老周去AI味');
  assert.deepEqual(writeCalls.map((call) => [call.path, call.payload]), [
    ['/info/name', '马斯克_AI'],
  ]);
});

test('default bot updateProfile allows full-form saves when unchanged providers are now unavailable', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, { name: 'Runtime Drift Bot' });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-runtime-drift-bot',
    mvcAddress: 'mvc-runtime-drift-bot',
  });
  await createLlmRuntimeStore(profile.homeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'healthy'),
    ],
  });
  await updateMetabotProfile(systemHomeDir, profile.slug, {
    primaryProvider: 'codex',
  });
  await createLlmRuntimeStore(profile.homeDir).write({
    version: 2,
    runtimes: [
      runtime('codex', 'runtime-codex', 'unavailable'),
    ],
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    createSignerForHome: () => makeSigner(async (input) => ({
      txids: ['runtime-drift-save-tx'],
      pinId: 'runtime-drift-save-pin',
      totalCost: 1,
      network: 'mvc',
      operation: input.operation,
      path: input.path,
      contentType: input.contentType,
      encoding: input.encoding ?? 'utf-8',
      globalMetaId: 'gm-runtime-drift-bot',
      mvcAddress: 'mvc-runtime-drift-bot',
    })),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    role: 'Still editable while the runtime is unavailable.',
    primaryProvider: 'codex',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.role, 'Still editable while the runtime is unavailable.');
  assert.equal(result.data.profile.primaryProvider, 'codex');
});

test('default bot updateProfile returns chain_sync_failed before saving local fields', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Chained Bot',
    role: 'Original role.',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-chained-bot',
    mvcAddress: 'addr-chained-bot',
  });
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      throw new Error('chain refused the write');
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    name: 'Should Not Save',
    role: 'Should not persist.',
  });
  const afterFailure = await getMetabotProfile(systemHomeDir, profile.slug);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'chain_sync_failed');
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name']);
  assert.equal(afterFailure.name, 'Chained Bot');
  assert.equal(afterFailure.role, 'Original role.');
});

test('default bot updateProfile returns chain write txids after saving a chained profile', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Chained Save Bot',
    role: 'Original role.',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-chained-save-bot',
    mvcAddress: 'addr-chained-save-bot',
  });
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      return {
        txids: [`save-tx-${writeCalls.length}`],
        pinId: `save-pin-${writeCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-chained-save-bot',
        mvcAddress: 'addr-chained-save-bot',
      };
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    name: 'Chained Save Updated',
    bio: 'Now writes Bot Pages.',
    role: 'Updated on chain first.',
    avatarDataUrl: 'data:image/png;base64,VXBkYXRlZA==',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.name, 'Chained Save Updated');
  assert.equal(result.data.profile.bio, 'Now writes Bot Pages.');
  assert.equal(result.data.profile.role, 'Updated on chain first.');
  assert.equal(result.data.profile.avatarDataUrl, 'data:image/png;base64,VXBkYXRlZA==');
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name', '/info/avatar', '/info/bio', '/info/persona']);
  assert.equal(writeCalls[0].contentType, 'text/plain');
  assert.equal(writeCalls[0].payload, 'Chained Save Updated');
  assert.equal(writeCalls[1].contentType, 'image/png;binary');
  assert.equal(writeCalls[1].payload, 'VXBkYXRlZA==');
  assert.equal(writeCalls[1].encoding, 'base64');
  assert.equal(writeCalls[2].contentType, 'text/plain');
  assert.equal(writeCalls[2].payload, 'Now writes Bot Pages.');
  assert.equal(writeCalls[3].contentType, 'application/json');
  assert.deepEqual(JSON.parse(writeCalls[3].payload), {
    role: 'Updated on chain first.',
    soul: 'You are friendly and professional.',
    goal: 'Your goal is to help users accomplish their tasks effectively.',
  });
  assert.deepEqual(result.data.chainWrites.flatMap((write) => write.txids), ['save-tx-1', 'save-tx-2', 'save-tx-3', 'save-tx-4']);
});

test('default bot updateProfile validates allowChatSkills and writes chain chatSkills before local state', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Chat Skill Save Bot',
    role: 'Original role.',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-chat-skill-save-bot',
    mvcAddress: 'addr-chat-skill-save-bot',
  });
  await createLlmRuntimeStore(profile.homeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'healthy'),
    ],
  });
  await createLlmBindingStore(profile.homeDir).write({
    version: 1,
    bindings: [
      {
        id: 'binding-chat-skill-save-primary',
        metaBotSlug: profile.slug,
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
    ],
  });
  await writeProfileSkill(profile.homeDir, 'metabot-help');
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      if (input.path === '/info/chatSkills') {
        const beforeLocalSave = await getMetabotProfile(systemHomeDir, profile.slug);
        assert.deepEqual(beforeLocalSave.allowChatSkills, []);
        assert.deepEqual(JSON.parse(input.payload).allowChatSkills, ['metabot-help']);
      }
      return {
        txids: [`chat-skill-save-tx-${writeCalls.length}`],
        pinId: `chat-skill-save-pin-${writeCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-chat-skill-save-bot',
        mvcAddress: 'addr-chat-skill-save-bot',
      };
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    allowChatSkills: [' metabot-help ', '', 'metabot-help'],
  });
  const updated = await getMetabotProfile(systemHomeDir, profile.slug);

  assert.equal(result.ok, true);
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/chatSkills']);
  assert.deepEqual(result.data.profile.allowChatSkills, ['metabot-help']);
  assert.deepEqual(updated.allowChatSkills, ['metabot-help']);
});

test('default bot updateProfile writes homepage chain data before local state', async (t) => {
  const homeDir = await createProfileHome('metabot-default-homepage-update-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Homepage Save Bot',
    bio: 'Original bio.',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-homepage-save-bot',
    mvcAddress: 'addr-homepage-save-bot',
  });

  const homepage = {
    uri: 'metaapp://metaapp-pin-123',
    renderer: 'metaapp',
    contentType: 'application/vnd.metaapp',
  };
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      if (input.path === '/info/homepage') {
        const beforeLocalSave = await getMetabotProfile(systemHomeDir, profile.slug);
        assert.equal(beforeLocalSave.homepage, undefined);
      }
      return {
        txids: [`homepage-save-tx-${writeCalls.length}`],
        pinId: `homepage-save-pin-${writeCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-homepage-save-bot',
        mvcAddress: 'addr-homepage-save-bot',
      };
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    homepage,
  });
  const updated = await getMetabotProfile(systemHomeDir, profile.slug);

  assert.equal(result.ok, true);
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/homepage']);
  assert.equal(writeCalls[0].contentType, 'application/json');
  assert.deepEqual(JSON.parse(writeCalls[0].payload), homepage);
  assert.deepEqual(result.data.profile.homepage, homepage);
  assert.deepEqual(updated.homepage, homepage);
});

test('default bot updateProfile rejects invalid homepage input without calling signer', async (t) => {
  const homeDir = await createProfileHome('metabot-default-homepage-invalid-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Invalid Homepage Bot',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-invalid-homepage-bot',
    mvcAddress: 'addr-invalid-homepage-bot',
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async () => {
      throw new Error('signer should not be called for invalid homepage input');
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    homepage: {
      uri: 'https://example.com/not-supported',
      renderer: 'auto',
      contentType: 'text/html',
    },
  });
  const afterFailure = await getMetabotProfile(systemHomeDir, profile.slug);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_metabot_profile_update');
  assert.match(result.message, /metafile:\/\/ or metaapp:\/\//i);
  assert.equal(afterFailure.homepage, undefined);
});

test('default bot updateProfile rejects unavailable allowChatSkills without calling signer', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, { name: 'Missing Chat Skill Bot' });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-missing-chat-skill-bot',
    mvcAddress: 'addr-missing-chat-skill-bot',
  });
  await createLlmRuntimeStore(profile.homeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'healthy'),
    ],
  });
  await createLlmBindingStore(profile.homeDir).write({
    version: 1,
    bindings: [
      {
        id: 'binding-missing-chat-skill-primary',
        metaBotSlug: profile.slug,
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
    ],
  });
  const signerCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      signerCalls.push(input);
      throw new Error('signer should not be called for unavailable allowChatSkills');
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    allowChatSkills: ['missing-chat-skill'],
  });
  const afterFailure = await getMetabotProfile(systemHomeDir, profile.slug);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_metabot_profile_update');
  assert.match(result.message, /not installed in the selected MetaBot primary runtime skill roots/i);
  assert.deepEqual(afterFailure.allowChatSkills, []);
  assert.deepEqual(signerCalls, []);
});

test('default bot updateProfile rejects preserved allowChatSkills when primaryProvider changes to a runtime without them', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, { name: 'Chat Skill Provider Switch Bot' });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-chat-skill-provider-switch-bot',
    mvcAddress: 'addr-chat-skill-provider-switch-bot',
  });
  await createLlmRuntimeStore(profile.homeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'healthy'),
      runtime('claude-code', 'runtime-claude', 'healthy'),
    ],
  });
  await createLlmBindingStore(profile.homeDir).write({
    version: 1,
    bindings: [
      {
        id: 'binding-provider-switch-codex-primary',
        metaBotSlug: profile.slug,
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
      {
        id: 'binding-provider-switch-claude-primary',
        metaBotSlug: profile.slug,
        llmRuntimeId: 'runtime-claude',
        role: 'primary',
        priority: 1,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
    ],
  });
  await writeProfileSkill(profile.homeDir, 'metabot-help');
  await updateMetabotProfile(systemHomeDir, profile.slug, {
    primaryProvider: 'codex',
    allowChatSkills: ['metabot-help'],
  });
  const signerCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      signerCalls.push(input);
      throw new Error('signer should not be called for allowChatSkills unavailable on the new primary provider');
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    primaryProvider: 'claude-code',
  });
  const afterFailure = await getMetabotProfile(systemHomeDir, profile.slug);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_metabot_profile_update');
  assert.match(result.message, /not installed in the selected MetaBot primary runtime skill roots/i);
  assert.equal(afterFailure.primaryProvider, 'codex');
  assert.deepEqual(afterFailure.allowChatSkills, ['metabot-help']);
  assert.deepEqual(signerCalls, []);
});

test('default bot updateProfile validates new allowChatSkills against the requested primaryProvider', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, { name: 'Chat Skill Combined Update Bot' });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-chat-skill-combined-update-bot',
    mvcAddress: 'addr-chat-skill-combined-update-bot',
  });
  await createLlmRuntimeStore(profile.homeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'healthy'),
      runtime('claude-code', 'runtime-claude', 'healthy'),
    ],
  });
  await createLlmBindingStore(profile.homeDir).write({
    version: 1,
    bindings: [
      {
        id: 'binding-combined-update-codex-primary',
        metaBotSlug: profile.slug,
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
      {
        id: 'binding-combined-update-claude-primary',
        metaBotSlug: profile.slug,
        llmRuntimeId: 'runtime-claude',
        role: 'primary',
        priority: 1,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
    ],
  });
  await writeProfileSkill(profile.homeDir, 'metabot-help');
  await updateMetabotProfile(systemHomeDir, profile.slug, {
    primaryProvider: 'codex',
  });
  const signerCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      signerCalls.push(input);
      throw new Error('signer should not be called for allowChatSkills unavailable on the requested primary provider');
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    primaryProvider: 'claude-code',
    allowChatSkills: ['metabot-help'],
  });
  const afterFailure = await getMetabotProfile(systemHomeDir, profile.slug);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_metabot_profile_update');
  assert.match(result.message, /not installed in the selected MetaBot primary runtime skill roots/i);
  assert.equal(afterFailure.primaryProvider, 'codex');
  assert.deepEqual(afterFailure.allowChatSkills, []);
  assert.deepEqual(signerCalls, []);
});

test('default bot updateProfile writes an avatar clear to chain before removing the local avatar', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Avatar Clear Bot',
    avatarDataUrl: 'data:image/png;base64,ZmFrZQ==',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-avatar-clear-bot',
    mvcAddress: 'addr-avatar-clear-bot',
  });
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      return {
        txids: [`avatar-clear-tx-${writeCalls.length}`],
        pinId: `avatar-clear-pin-${writeCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-avatar-clear-bot',
        mvcAddress: 'addr-avatar-clear-bot',
      };
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    avatarDataUrl: '',
  });
  const updated = await getMetabotProfile(systemHomeDir, profile.slug);

  assert.equal(result.ok, true);
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/avatar']);
  assert.equal(writeCalls[0].payload, '');
  assert.deepEqual(result.data.chainWrites.flatMap((write) => write.txids), ['avatar-clear-tx-1']);
  assert.equal(updated.avatarDataUrl, undefined);
});

test('default bot updateProfile uses the selected profile signer for non-active chained profiles', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const activeProfile = await createMetabotProfile(systemHomeDir, { name: 'Active Bot' });
  const targetProfile = await createMetabotProfile(systemHomeDir, {
    name: 'Target Bot',
    role: 'Original role.',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: targetProfile.name,
    homeDir: targetProfile.homeDir,
    globalMetaId: 'gm-target-bot',
    mvcAddress: 'addr-target-bot',
  });

  const activeSecretStore = {
    paths: resolveMetabotPaths(activeProfile.homeDir),
    ensureLayout: async () => resolveMetabotPaths(activeProfile.homeDir),
    readIdentitySecrets: async () => {
      throw new Error('active signer should not be used for the target profile');
    },
    writeIdentitySecrets: async () => '',
    deleteIdentitySecrets: async () => undefined,
  };
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: activeProfile.homeDir,
    systemHomeDir,
    secretStore: activeSecretStore,
    signer: makeSigner(async () => {
      throw new Error('active signer should not be used for the target profile');
    }),
    getDaemonRecord: () => null,
  });

  const result = await handlers.bot.updateProfile({
    slug: targetProfile.slug,
    name: 'Target Updated',
  });
  const afterFailure = await getMetabotProfile(systemHomeDir, targetProfile.slug);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'chain_sync_failed');
  assert.match(result.message, /Local identity mnemonic is missing from the secret store/);
  assert.doesNotMatch(result.message, /active signer should not be used/);
  assert.equal(afterFailure.name, 'Target Bot');
});

test('default bot stats and sessions aggregate executor history by MetaBot slug', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  await createMetabotProfile(systemHomeDir, { name: 'Alice Bot' });
  await createMetabotProfile(systemHomeDir, { name: 'Bob Bot' });
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'healthy'),
      runtime('claude-code', 'runtime-claude', 'degraded'),
      runtime('gemini', 'runtime-gemini', 'unavailable'),
    ],
  });

  const listSessionCalls = [];
  const sessions = [
    {
      sessionId: 'session-bob-1',
      status: 'completed',
      runtimeId: 'runtime-codex',
      provider: 'codex',
      metaBotSlug: 'bob-bot',
      prompt: 'Bob one',
      createdAt: '2026-05-06T00:03:00.000Z',
    },
    {
      sessionId: 'session-bob-2',
      status: 'failed',
      runtimeId: 'runtime-codex',
      provider: 'codex',
      metaBotSlug: 'bob-bot',
      prompt: 'Bob two',
      createdAt: '2026-05-06T00:02:00.000Z',
    },
    {
      sessionId: 'session-alice-1',
      status: 'completed',
      runtimeId: 'runtime-claude',
      provider: 'codex',
      metaBotSlug: 'alice-bot',
      prompt: 'Alice one',
      createdAt: '2026-05-06T00:01:00.000Z',
    },
    {
      sessionId: 'session-alice-2',
      status: 'failed',
      runtimeId: 'runtime-claude',
      provider: 'claude-code',
      metaBotSlug: 'alice-bot',
      prompt: 'Alice two',
      createdAt: '2026-05-06T00:00:00.000Z',
    },
  ];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    llmExecutor: {
      execute: async () => 'unused',
      getSession: async () => null,
      cancel: async () => undefined,
      listSessions: async (limit, options) => {
        listSessionCalls.push({ limit, options });
        const scoped = options?.metaBotSlug
          ? sessions.filter((session) => session.metaBotSlug === options.metaBotSlug)
          : sessions;
        return scoped.slice(0, limit);
      },
      streamEvents: async function* () {},
    },
  });

  const stats = await handlers.bot.getStats();
  const aliceSessions = await handlers.bot.listSessions({ slug: 'alice-bot', limit: 2 });

  assert.equal(stats.ok, true);
  assert.deepEqual(stats.data, {
    botCount: 2,
    healthyRuntimes: 1,
    totalExecutions: 4,
    successRate: 50,
  });
  assert.equal(aliceSessions.ok, true);
  assert.deepEqual(
    aliceSessions.data.sessions.map((session) => session.sessionId),
    ['session-alice-1', 'session-alice-2'],
  );
  assert.deepEqual(listSessionCalls, [
    { limit: 1000, options: undefined },
    { limit: 2, options: { metaBotSlug: 'alice-bot' } },
  ]);
});

test('default bot runtime handlers expose the shared LLM runtime store', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'healthy'),
    ],
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir: deriveSystemHome(homeDir),
    getDaemonRecord: () => null,
  });

  const result = await handlers.bot.listRuntimes();

  assert.equal(result.ok, true);
  assert.equal(result.data.runtimes[0].id, 'runtime-codex');
});
