import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
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
const { createMetaAppLocalCacheStore } = require('../../dist/core/metaapp/localCache.js');

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

const KNOWN_LARGE_UPLOAD_ERROR_CODES = [
  'large_file_upload_unavailable',
  'large_file_upload_too_large',
  'large_file_upload_chain_unsupported',
  'large_file_upload_funding_failed',
  'large_file_upload_metafs_failed',
];

function makeLargeUploadResult(input, overrides = {}) {
  const pinId = overrides.pinId ?? 'large-file-pin-1';
  return {
    pinId,
    txids: overrides.txids ?? ['large-file-tx-1'],
    totalCost: overrides.totalCost ?? 11,
    network: input.network,
    fileName: input.fileName,
    contentType: input.contentType,
    bytes: input.bytes,
    extension: input.extension,
    metafileUri: overrides.metafileUri ?? `metafile://${pinId}${input.extension}`,
    globalMetaId: overrides.globalMetaId ?? 'gm-large-upload-bot',
    uploadMode: 'chunked',
    previewUrl: 'https://example.invalid/preview',
    downloadUrl: 'https://example.invalid/download',
  };
}

function makeDirectUploadResult(input, overrides = {}) {
  const pinId = overrides.pinId ?? 'direct-file-pin-1';
  const fileName = overrides.fileName ?? path.basename(input.filePath);
  const extension = overrides.extension ?? path.extname(fileName).toLowerCase();
  return {
    pinId,
    txids: overrides.txids ?? ['direct-file-tx-1'],
    totalCost: overrides.totalCost ?? 7,
    network: input.network,
    filePath: input.filePath,
    fileName,
    contentType: input.contentType,
    bytes: overrides.bytes ?? 128,
    extension,
    metafileUri: overrides.metafileUri ?? `metafile://${pinId}${extension}`,
    previewUrl: 'https://example.invalid/direct-preview',
    downloadUrl: 'https://example.invalid/direct-download',
    globalMetaId: overrides.globalMetaId ?? 'gm-direct-upload-bot',
    uploadMode: 'direct',
    ...(overrides.feeAssist ? { feeAssist: overrides.feeAssist } : {}),
  };
}

function makeThrowingLargeUploader(code, message = `${code} detail`) {
  return {
    upload: async () => {
      const error = new Error(message);
      error.code = code;
      throw error;
    },
  };
}

function makeThrowingLargeUploaderWithData(code, message, data) {
  return {
    upload: async () => {
      const error = new Error(message);
      error.code = code;
      error.data = data;
      throw error;
    },
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

async function writeProjectSkill(profileHomeDir, platformDir, skillName) {
  const skillDir = path.join(profileHomeDir, platformDir, 'skills', skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), `# ${skillName}\n`, 'utf8');
}

async function writeRuntimeIdentity(homeDir, name = 'Runtime Bot') {
  await createRuntimeStateStore(homeDir).writeState({
    identity: {
      metabotId: 1,
      name,
      createdAt: 1776836000000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'public-key',
      chatPublicKey: 'chat-public-key',
      addresses: {
        mvc: 'mvc-runtime-address',
      },
      mvcAddress: 'mvc-runtime-address',
      metaId: 'metaid-runtime-bot',
      globalMetaId: 'gm-runtime-bot',
    },
    services: [],
    traces: [],
    sellerOrders: [],
  });
}

async function writeLargeMetaAppProject(rootDir, slug, manifest = {}) {
  const projectDir = path.join(rootDir, slug);
  await mkdir(path.join(projectDir, 'dist', 'assets'), { recursive: true });
  await writeFile(path.join(projectDir, 'dist', 'index.html'), '<h1>Large MetaApp</h1>', 'utf8');
  await writeFile(path.join(projectDir, 'dist', 'assets', 'large.bin'), Buffer.alloc((2 * 1024 * 1024) + 128, 7));
  await writeFile(path.join(projectDir, '.metaapp.json'), JSON.stringify({
    title: 'Large MetaApp',
    appName: slug,
    ...manifest,
  }), 'utf8');
  return projectDir;
}

async function writePreviousMetaAppRecord(homeDir, record = {}) {
  const pinId = record.pinId ?? `${'b'.repeat(64)}i0`;
  await createMetaAppLocalCacheStore(homeDir).upsertLocal({
    pinId,
    firstPinId: record.firstPinId ?? pinId,
    operation: record.operation ?? 'create',
    title: record.title ?? 'Previous MetaApp',
    appName: record.appName ?? 'previous-metaapp',
    intro: record.intro ?? '',
    icon: record.icon ?? '',
    coverImg: record.coverImg ?? '',
    tags: record.tags ?? [],
    runtime: record.runtime ?? 'browser',
    indexFile: record.indexFile ?? 'index.html',
    version: record.version ?? '1.0.0',
    code: record.code ?? 'metafile://previous-code',
    content: record.content ?? 'metafile://previous-content',
    contentType: record.contentType ?? 'application/zip',
    codeType: record.codeType ?? 'application/zip',
    ownerGlobalMetaId: record.ownerGlobalMetaId ?? 'gm-previous-metaapp-owner',
    ownerAddress: record.ownerAddress ?? 'mvc-previous-metaapp-owner',
    network: record.network ?? 'mvc',
    metawebUrl: record.metawebUrl ?? `https://metaweb.world/metaapp/${pinId}`,
    updatedAt: record.updatedAt ?? 1_700_000_000_000,
    source: 'local',
  });
  return pinId;
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

test('default bot config handlers persist chain config per MetaBot profile', async (t) => {
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
      mvcSponsorUploadEnabled: false,
    },
  });
  const aliceConfig = await handlers.bot.getConfig({ slug: alice.slug });
  const ericConfig = await handlers.bot.getConfig({ slug: eric.slug });
  const aliceConfigOnDisk = await createConfigStore(alice.homeDir).read();
  const ericConfigOnDisk = await createConfigStore(eric.homeDir).read();

  assert.equal(setAlice.ok, true);
  assert.equal(aliceConfig.data.chain.defaultWriteNetwork, 'opcat');
  assert.equal(aliceConfig.data.chain.mvcSponsorUploadEnabled, false);
  assert.equal(ericConfig.data.chain.defaultWriteNetwork, 'mvc');
  assert.equal(ericConfig.data.chain.mvcSponsorUploadEnabled, true);
  assert.equal(aliceConfigOnDisk.chain.defaultWriteNetwork, 'opcat');
  assert.equal(aliceConfigOnDisk.chain.mvcSponsorUploadEnabled, false);
  assert.equal(ericConfigOnDisk.chain.defaultWriteNetwork, 'mvc');
  assert.equal(ericConfigOnDisk.chain.mvcSponsorUploadEnabled, true);
});

test('default bot config handlers reject non-boolean mvc sponsor upload flags', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-config-invalid-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const alice = await createMetabotProfile(systemHomeDir, { name: 'Alice Bot' });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
  });

  const before = await createConfigStore(alice.homeDir).read();
  const result = await handlers.bot.setConfig({
    slug: alice.slug,
    chain: {
      mvcSponsorUploadEnabled: 'false',
    },
  });
  const after = await createConfigStore(alice.homeDir).read();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_argument');
  assert.match(result.message, /chain\.mvcSponsorUploadEnabled must be a boolean/i);
  assert.deepEqual(after, before);
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
      throw new Error('direct signer should not be used for injected unavailable large uploads');
    }),
    providerLargeFileUploader: makeThrowingLargeUploader(
      'large_file_upload_unavailable',
      'Large file uploader temporarily unavailable.',
    ),
    getDaemonRecord: () => null,
  });

  const result = await handlers.file.uploadLarge({
    filePath,
    contentType: 'video/mp4',
    network: 'mvc',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'large_file_upload_unavailable');
  assert.match(result.message, /temporarily unavailable/);
});

test('default file.uploadLarge returns sponsor feeAssist metadata on direct MVC success when enabled', async (t) => {
  const homeDir = await createProfileHome('metabot-default-large-upload-sponsor-enabled-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const filePath = path.join(homeDir, 'small-upload.txt');
  await writeFile(filePath, 'small direct upload', 'utf8');
  await writeRuntimeIdentity(homeDir, 'Sponsor Upload Bot');

  const uploadCalls = [];
  let sponsorFactoryCalls = 0;
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    uploadLargeFile: async (input) => {
      uploadCalls.push(input);
      return makeDirectUploadResult(input, {
        feeAssist: {
          attempted: true,
          used: true,
          mode: 'mvc_sponsor_v2',
          sponsor: 'mvc_sponsor_v2',
          stage: 'done',
        },
      });
    },
    createMvcSponsorClient: () => {
      sponsorFactoryCalls += 1;
      return {};
    },
  });

  const result = await handlers.file.uploadLarge({
    filePath,
    contentType: 'text/plain',
    network: 'mvc',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.uploadMode, 'direct');
  assert.equal(result.data.feeAssist.used, true);
  assert.equal(result.data.feeAssist.mode, 'mvc_sponsor_v2');
  assert.equal(uploadCalls.length, 1);
  assert.equal(Boolean(uploadCalls[0].mvcSponsorClient), true);
  assert.equal(sponsorFactoryCalls, 1);
});

test('default file.uploadLarge bypasses sponsor entirely when chain.mvcSponsorUploadEnabled is false', async (t) => {
  const homeDir = await createProfileHome('metabot-default-large-upload-sponsor-disabled-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const filePath = path.join(homeDir, 'small-upload.txt');
  await writeFile(filePath, 'small direct upload', 'utf8');
  await writeRuntimeIdentity(homeDir, 'Self Paid Upload Bot');
  const configStore = createConfigStore(homeDir);
  const currentConfig = await configStore.read();
  await configStore.set({
    ...currentConfig,
    chain: {
      ...currentConfig.chain,
      mvcSponsorUploadEnabled: false,
    },
  });

  const uploadCalls = [];
  let sponsorFactoryCalls = 0;
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    uploadLargeFile: async (input) => {
      uploadCalls.push(input);
      return makeDirectUploadResult(input);
    },
    createMvcSponsorClient: () => {
      sponsorFactoryCalls += 1;
      return {};
    },
  });

  const result = await handlers.file.uploadLarge({
    filePath,
    contentType: 'text/plain',
    network: 'mvc',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.uploadMode, 'direct');
  assert.equal('feeAssist' in result.data, false);
  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].mvcSponsorClient, undefined);
  assert.equal(sponsorFactoryCalls, 0);
});

test('default file.uploadLarge preserves sponsor feeAssist data on commit failure', async (t) => {
  const homeDir = await createProfileHome('metabot-default-large-upload-sponsor-failure-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const filePath = path.join(homeDir, 'small-upload.txt');
  await writeFile(filePath, 'small direct upload', 'utf8');
  await writeRuntimeIdentity(homeDir, 'Failed Sponsor Upload Bot');

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    uploadLargeFile: async () => {
      const error = new Error('sponsor commit rejected');
      error.code = 'mvc_fee_assist_commit_failed';
      error.data = {
        feeAssist: {
          attempted: true,
          used: false,
          mode: 'mvc_sponsor_v2',
          sponsor: 'mvc_sponsor_v2',
          reason: 'commit_failed',
          stage: 'commit',
          orderId: 'order-1',
        },
      };
      throw error;
    },
    createMvcSponsorClient: () => ({}),
  });

  const result = await handlers.file.uploadLarge({
    filePath,
    contentType: 'text/plain',
    network: 'mvc',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'mvc_fee_assist_commit_failed');
  assert.equal(result.data.feeAssist.orderId, 'order-1');
  assert.equal(result.data.feeAssist.reason, 'commit_failed');
  assert.equal(result.data.feeAssist.stage, 'commit');
});

test('default file.uploadLarge passes the injected production large uploader', async (t) => {
  const homeDir = await createProfileHome('metabot-default-large-upload-injected-');
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
  const largeUploadCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    signer: makeSigner(async () => {
      throw new Error('direct signer should not be used for injected large uploads');
    }),
    providerLargeFileUploader: {
      upload: async (input) => {
        largeUploadCalls.push(input);
        return {
          pinId: 'large-file-pin-1',
          txids: ['large-file-tx-1'],
          totalCost: 11,
          network: input.network,
          fileName: input.fileName,
          contentType: input.contentType,
          bytes: input.bytes,
          extension: input.extension,
          metafileUri: `metafile://large-file-pin-1${input.extension}`,
          globalMetaId: 'gm-large-upload-bot',
          uploadMode: 'chunked',
          previewUrl: 'https://example.invalid/preview',
          downloadUrl: 'https://example.invalid/download',
        };
      },
    },
    getDaemonRecord: () => null,
  });

  const result = await handlers.file.uploadLarge({
    filePath,
    contentType: 'video/mp4',
    network: 'mvc',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.pinId, 'large-file-pin-1');
  assert.equal(result.data.uploadMode, 'chunked');
  assert.equal(largeUploadCalls.length, 1);
  assert.equal(largeUploadCalls[0].filePath, filePath);
  assert.equal(largeUploadCalls[0].contentType, 'video/mp4');
});

test('default file.uploadLarge uses the factory production large uploader when explicit uploader is omitted', async (t) => {
  const homeDir = await createProfileHome('metabot-default-large-upload-factory-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const filePath = path.join(homeDir, 'large-video.mp4');
  await writeFile(filePath, Buffer.alloc((2 * 1024 * 1024) + 1));
  await createRuntimeStateStore(homeDir).writeState({
    identity: {
      metabotId: 1,
      name: 'Large Upload Factory Bot',
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
      metaId: 'metaid-large-upload-factory-bot',
      globalMetaId: 'gm-large-upload-factory-bot',
    },
    services: [],
    traces: [],
    sellerOrders: [],
  });
  const largeUploadCalls = [];
  let factoryCalls = 0;
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    signer: makeSigner(async () => {
      throw new Error('direct signer should not be used for factory large uploads');
    }),
    createProviderLargeFileUploader: () => {
      factoryCalls += 1;
      return {
        upload: async (input) => {
          largeUploadCalls.push(input);
          return makeLargeUploadResult(input, {
            pinId: 'factory-large-file-pin-1',
            txids: ['factory-large-file-tx-1'],
          });
        },
      };
    },
    getDaemonRecord: () => null,
  });

  const result = await handlers.file.uploadLarge({
    filePath,
    contentType: 'video/mp4',
    network: 'mvc',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.pinId, 'factory-large-file-pin-1');
  assert.equal(result.data.uploadMode, 'chunked');
  assert.equal(factoryCalls, 1);
  assert.equal(largeUploadCalls.length, 1);
  assert.equal(largeUploadCalls[0].filePath, filePath);
  assert.equal(largeUploadCalls[0].contentType, 'video/mp4');
});

test('default file.uploadLarge preserves known large uploader failure codes', async (t) => {
  const homeDir = await createProfileHome('metabot-default-large-upload-errors-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const filePath = path.join(homeDir, 'large-video.mp4');
  await writeFile(filePath, Buffer.alloc((2 * 1024 * 1024) + 1));
  await createRuntimeStateStore(homeDir).writeState({
    identity: {
      metabotId: 1,
      name: 'Large Upload Error Bot',
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
      metaId: 'metaid-large-upload-error-bot',
      globalMetaId: 'gm-large-upload-error-bot',
    },
    services: [],
    traces: [],
    sellerOrders: [],
  });

  for (const code of KNOWN_LARGE_UPLOAD_ERROR_CODES) {
    const handlers = createDefaultMetabotDaemonHandlers({
      homeDir,
      systemHomeDir,
      signer: makeSigner(async () => {
        throw new Error(`direct signer should not be used for ${code}`);
      }),
      providerLargeFileUploader: makeThrowingLargeUploader(code, `${code} mapped message`),
      getDaemonRecord: () => null,
    });

    const result = await handlers.file.uploadLarge({
      filePath,
      contentType: 'video/mp4',
      network: 'mvc',
    });

    assert.equal(result.ok, false, code);
    assert.equal(result.code, code);
    assert.match(result.message, new RegExp(`${code} mapped message`));
  }
});

test('default metaapp.publish uploads large runtime archive through the large upload boundary', async (t) => {
  const homeDir = await createProfileHome('metabot-default-metaapp-large-publish-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  await writeRuntimeIdentity(homeDir, 'MetaApp Large Publish Bot');
  const projectDir = await writeLargeMetaAppProject(homeDir, 'large-publish-app', {
    title: 'Large Publish App',
  });
  const publishPinId = `${'a'.repeat(64)}i0`;
  const writeCalls = [];
  const largeUploadCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      if (input.path === '/file') {
        return {
          pinId: 'direct-metaapp-file-pin',
          txids: ['direct-metaapp-file-tx'],
          totalCost: 1,
          network: input.network,
          globalMetaId: 'gm-runtime-bot',
        };
      }
      return {
        pinId: publishPinId,
        firstPinId: publishPinId,
        txids: ['metaapp-publish-tx'],
        totalCost: 2,
        network: input.network,
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        globalMetaId: 'gm-runtime-bot',
        mvcAddress: 'mvc-runtime-address',
      };
    }),
    providerLargeFileUploader: {
      upload: async (input) => {
        largeUploadCalls.push(input);
        return makeLargeUploadResult(input, {
          pinId: 'chunked-metaapp-publish-pin',
          txids: ['chunked-metaapp-publish-tx'],
          metafileUri: 'metafile://chunked-metaapp-publish-pin.zip',
          globalMetaId: 'gm-runtime-bot',
        });
      },
    },
    getDaemonRecord: () => null,
  });

  const result = await handlers.metaapp.publishProject({
    projectDir,
    confirm: true,
    network: 'mvc',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.upload.uploadMode, 'chunked');
  assert.equal(largeUploadCalls.length, 1);
  assert.equal(largeUploadCalls[0].contentType, 'application/zip');
  assert.equal(largeUploadCalls[0].network, 'mvc');
  assert.equal(largeUploadCalls[0].fileName, 'metaapp.zip');
  assert.equal(largeUploadCalls[0].extension, '.zip');
  assert.ok(largeUploadCalls[0].bytes > (2 * 1024 * 1024));
  assert.equal(writeCalls.length, 1);
  assert.equal(writeCalls[0].path, '/protocols/metaapp');
  assert.equal(writeCalls[0].operation, 'create');
  assert.equal(writeCalls[0].network, 'mvc');
  const payload = JSON.parse(writeCalls[0].payload);
  assert.equal(payload.content, 'metafile://chunked-metaapp-publish-pin.zip');
});

test('default metaapp.update uploads large runtime archive through the large upload boundary', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ code: 404, message: 'not found' }),
  });
  const homeDir = await createProfileHome('metabot-default-metaapp-large-update-');
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  await writeRuntimeIdentity(homeDir, 'MetaApp Large Update Bot');
  const targetPinId = await writePreviousMetaAppRecord(homeDir);
  const projectDir = await writeLargeMetaAppProject(homeDir, 'large-update-app', {
    title: 'Large Update App',
  });
  const updatePinId = `${'c'.repeat(64)}i0`;
  const writeCalls = [];
  const largeUploadCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      if (input.path === '/file') {
        return {
          pinId: 'direct-metaapp-update-file-pin',
          txids: ['direct-metaapp-update-file-tx'],
          totalCost: 1,
          network: input.network,
          globalMetaId: 'gm-runtime-bot',
        };
      }
      return {
        pinId: updatePinId,
        firstPinId: targetPinId,
        txids: ['metaapp-update-tx'],
        totalCost: 2,
        network: input.network,
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        globalMetaId: 'gm-runtime-bot',
        mvcAddress: 'mvc-runtime-address',
      };
    }),
    providerLargeFileUploader: {
      upload: async (input) => {
        largeUploadCalls.push(input);
        return makeLargeUploadResult(input, {
          pinId: 'chunked-metaapp-update-pin',
          txids: ['chunked-metaapp-update-tx'],
          metafileUri: 'metafile://chunked-metaapp-update-pin.zip',
          globalMetaId: 'gm-runtime-bot',
        });
      },
    },
    getDaemonRecord: () => null,
  });

  const result = await handlers.metaapp.updateProject({
    projectDir,
    targetPinId,
    confirm: true,
    network: 'mvc',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.upload.uploadMode, 'chunked');
  assert.equal(largeUploadCalls.length, 1);
  assert.equal(largeUploadCalls[0].contentType, 'application/zip');
  assert.equal(largeUploadCalls[0].network, 'mvc');
  assert.equal(largeUploadCalls[0].fileName, 'metaapp.zip');
  assert.equal(largeUploadCalls[0].extension, '.zip');
  assert.ok(largeUploadCalls[0].bytes > (2 * 1024 * 1024));
  assert.equal(writeCalls.length, 1);
  assert.equal(writeCalls[0].path, `@${targetPinId}`);
  assert.equal(writeCalls[0].operation, 'modify');
  assert.equal(writeCalls[0].network, 'mvc');
  const payload = JSON.parse(writeCalls[0].payload);
  assert.equal(payload.content, 'metafile://chunked-metaapp-update-pin.zip');
});

test('default metaapp.publishProject preserves whitelisted feeAssist data on upload failure', async (t) => {
  const homeDir = await createProfileHome('metabot-default-metaapp-upload-failure-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  await writeRuntimeIdentity(homeDir, 'MetaApp Upload Failure Bot');
  const projectDir = await writeLargeMetaAppProject(homeDir, 'publish-failure-app', {
    title: 'Publish Failure App',
  });
  const feeAssist = {
    attempted: true,
    used: false,
    mode: 'mvc_sponsor_v2',
    stage: 'commit',
    reason: 'commit_failed',
  };
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    signer: makeSigner(async () => {
      throw new Error('chain write should not run after upload failure');
    }),
    providerLargeFileUploader: makeThrowingLargeUploaderWithData(
      'mvc_fee_assist_commit_failed',
      'metaapp upload failed',
      {
        feeAssist,
        ignored: 'do-not-leak',
      },
    ),
    getDaemonRecord: () => null,
  });

  const result = await handlers.metaapp.publishProject({
    projectDir,
    confirm: true,
    network: 'mvc',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'metaapp_upload_failed');
  assert.deepEqual(result.data.feeAssist, feeAssist);
  assert.equal('ignored' in result.data, false);
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
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name', '/info/chatpubkey', '/info/avatar', '/info/persona']);
  assert.deepEqual(writeCalls.map((call) => call.operation), ['create', 'create', 'create', 'create']);
  assert.equal(writeCalls[0].contentType, 'text/plain');
  assert.equal(writeCalls[0].payload, 'Chain Bot');
  assert.equal(writeCalls[2].contentType, 'image/png;binary');
  assert.equal(Buffer.isBuffer(writeCalls[2].payload), true);
  assert.equal(writeCalls[2].payload.toString('utf8'), 'fake');
  assert.equal(writeCalls[2].encoding, 'binary');
  assert.equal(writeCalls[3].contentType, 'application/json');
  assert.deepEqual(JSON.parse(writeCalls[3].payload), {
    role: 'Role after chain.',
    soul: '',
    goal: '',
  });
  assert.deepEqual(result.data.chainWrites.flatMap((write) => write.txids), ['tx-1', 'tx-2', 'tx-3', 'tx-4']);
  assert.equal(stored.role, 'Role after chain.');
  assert.equal(stored.avatarDataUrl, 'data:image/png;base64,ZmFrZQ==');
  assert.equal(stored.globalMetaId, result.data.profile.globalMetaId);
});

test('default bot createProfile writes explicit optional profile fields before local persistence', async (t) => {
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
      if (input.path === '/info/avatar' || input.path === '/info/persona') {
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
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name', '/info/chatpubkey', '/info/avatar', '/info/persona']);
  assert.deepEqual(writeCalls.map((call) => call.operation), ['create', 'create', 'create', 'create']);
  assert.equal(stored.role, 'Chain first role.');
  assert.equal(stored.avatarDataUrl, 'data:image/png;base64,ZmFrZQ==');
});

test('default bot createProfile writes explicitly requested providers to chain LLM info', async (t) => {
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
      if (input.path === '/info/llm') {
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
  assert.deepEqual(writePaths, ['/info/name', '/info/chatpubkey', '/info/llm']);
  assert.deepEqual(llmPayloads, [{
    primaryProvider: 'codex',
    fallbackProvider: 'claude-code',
  }]);
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

test('default bot createProfile writes explicitly empty allowChatSkills to chain chatSkills info', async (t) => {
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
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name', '/info/chatpubkey', '/info/persona', '/info/chatSkills']);
  assert.equal(writeCalls[3].contentType, 'application/json');
  assert.deepEqual(JSON.parse(writeCalls[3].payload), {
    allowPrivateChatSkills: [],
    allowGroupChatSkills: [],
  });
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
      if (input.path === '/info/llm') {
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
  assert.deepEqual(writePaths, ['/info/name', '/info/chatpubkey', '/info/llm']);
  assert.deepEqual(llmPayloads, [{
    primaryProvider: 'codex',
    fallbackProvider: 'claude-code',
  }]);
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

test('default bot createProfile does not write fallback persona defaults to chain', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(writeCalls),
  });

  const result = await handlers.bot.createProfile({
    name: 'No Default Persona Bot',
    creationSource: 'ui',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.role, '');
  assert.equal(result.data.profile.soul, '');
  assert.equal(result.data.profile.goal, '');
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name', '/info/chatpubkey']);
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

test('default identity create leaves local persona user values empty', async (t) => {
  const homeDir = await createProfileHome('metabot-default-identity-create-', 'empty-persona-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
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
      txids: [`identity-empty-persona-${input.path}`],
      pinId: `identity-empty-persona-${input.path}`,
      totalCost: 1,
      network: 'mvc',
      operation: input.operation,
      path: input.path,
      contentType: input.contentType,
      encoding: input.encoding ?? 'utf-8',
      globalMetaId: 'gm-empty-persona',
      mvcAddress: 'mvc-empty-persona',
    })),
  });

  const result = await handlers.identity.create({
    name: 'Empty Persona Bot',
  });
  const paths = resolveMetabotPaths(homeDir);

  assert.equal(result.ok, true);
  assert.equal((await readFile(paths.roleMdPath, 'utf8')).trim(), '');
  assert.equal((await readFile(paths.soulMdPath, 'utf8')).trim(), '');
  assert.equal((await readFile(paths.goalMdPath, 'utf8')).trim(), '');
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
  assert.equal(afterFailure.role, '');
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
  assert.equal(Buffer.isBuffer(writeCalls[1].payload), true);
  assert.equal(writeCalls[1].payload.toString('utf8'), 'Updated');
  assert.equal(writeCalls[1].encoding, 'binary');
  assert.equal(writeCalls[2].contentType, 'text/plain');
  assert.equal(writeCalls[2].payload, 'Now writes Bot Pages.');
  assert.equal(writeCalls[3].contentType, 'application/json');
  assert.deepEqual(JSON.parse(writeCalls[3].payload), {
    role: 'Updated on chain first.',
    soul: '',
    goal: '',
  });
  assert.deepEqual(result.data.chainWrites.flatMap((write) => write.txids), ['save-tx-1', 'save-tx-2', 'save-tx-3', 'save-tx-4']);
});

test('default bot updateProfile backfills missing LLM info when saving only bio', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'bio-llm-backfill-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'healthy'),
    ],
  });
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Bio LLM Backfill Bot',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-bio-llm-backfill',
    mvcAddress: 'addr-bio-llm-backfill',
  });
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      return {
        txids: [`bio-llm-backfill-tx-${writeCalls.length}`],
        pinId: `bio-llm-backfill-pin-${writeCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-bio-llm-backfill',
        mvcAddress: 'addr-bio-llm-backfill',
      };
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    bio: 'Only the public bio changed.',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.bio, 'Only the public bio changed.');
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/bio', '/info/llm']);
  assert.deepEqual(JSON.parse(writeCalls[1].payload), {
    primaryProvider: 'codex',
    fallbackProvider: null,
  });
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
        assert.deepEqual(JSON.parse(input.payload), {
          allowPrivateChatSkills: ['metabot-help'],
          allowGroupChatSkills: [],
        });
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

test('default bot updateProfile writes an empty homepage create before clearing local state', async (t) => {
  const homeDir = await createProfileHome('metabot-default-homepage-revoke-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Homepage Revoke Bot',
    bio: 'Original bio.',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-homepage-revoke-bot',
    mvcAddress: 'addr-homepage-revoke-bot',
  });
  const homepage = {
    uri: 'metaapp://metaapp-pin-123',
    renderer: 'metaapp',
    contentType: 'application/vnd.metaapp',
  };
  await updateMetabotProfile(systemHomeDir, profile.slug, { homepage });
  const paths = resolveMetabotPaths(profile.homeDir);
  await access(paths.homepageStatePath);

  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      if (input.path === '/info/homepage') {
        const beforeLocalSave = await getMetabotProfile(systemHomeDir, profile.slug);
        assert.deepEqual(beforeLocalSave.homepage, homepage);
      }
      return {
        txids: [`homepage-clear-tx-${writeCalls.length}`],
        pinId: `homepage-clear-pin-${writeCalls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gm-homepage-revoke-bot',
        mvcAddress: 'addr-homepage-revoke-bot',
      };
    }),
  });

  const result = await handlers.bot.updateProfile({
    slug: profile.slug,
    homepage: null,
  });
  const updated = await getMetabotProfile(systemHomeDir, profile.slug);

  assert.equal(result.ok, true);
  assert.equal(writeCalls[0].operation, 'create');
  assert.equal(writeCalls[0].path, '/info/homepage');
  assert.equal(writeCalls[0].payload, '');
  assert.equal(writeCalls[0].contentType, 'application/json');
  assert.equal(result.data.profile.homepage, undefined);
  assert.equal(updated.homepage, undefined);
  await assert.rejects(access(paths.homepageStatePath), { code: 'ENOENT' });
});

test('default bot uploadHomepageFile writes selected browser file bytes through profile signer', async (t) => {
  const homeDir = await createProfileHome('metabot-default-homepage-upload-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Homepage Upload Bot',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-homepage-upload-bot',
    mvcAddress: 'addr-homepage-upload-bot',
  });

  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      return {
        txids: ['homepage-upload-tx-1'],
        pinId: 'homepage-upload-pin-1',
        totalCost: 1,
        network: input.network,
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding,
        globalMetaId: 'gm-homepage-upload-bot',
        mvcAddress: 'addr-homepage-upload-bot',
      };
    }),
  });
  const filePath = path.join(profile.homeDir, 'cover.png');
  await writeFile(filePath, Buffer.from('pngdata'));

  const result = await handlers.bot.uploadHomepageFile({
    slug: profile.slug,
    filePath,
    contentType: 'image/png',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.pinId, 'homepage-upload-pin-1');
  assert.equal(result.data.metafileUri, 'metafile://homepage-upload-pin-1.png');
  assert.equal(result.data.bytes, 7);
  assert.deepEqual(writeCalls.map((call) => call.path), ['/file']);
  assert.equal(Buffer.isBuffer(writeCalls[0].payload), true);
  assert.equal(writeCalls[0].payload.toString('utf8'), 'pngdata');
  assert.equal(writeCalls[0].contentType, 'image/png');
  assert.equal(writeCalls[0].encoding, 'binary');
});

test('default bot uploadHomepageFile uses the selected profile signer for non-active chained profiles', async (t) => {
  const homeDir = await createProfileHome('metabot-default-homepage-upload-target-', 'active-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const activeProfile = await createMetabotProfile(systemHomeDir, {
    name: 'Active Upload Bot',
  });
  const targetProfile = await createMetabotProfile(systemHomeDir, {
    name: 'Target Upload Bot',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: targetProfile.name,
    homeDir: targetProfile.homeDir,
    globalMetaId: 'gm-target-homepage-upload-bot',
    mvcAddress: 'addr-target-homepage-upload-bot',
  });

  const createSignerHomes = [];
  const writeCalls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: activeProfile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async () => {
      throw new Error('active signer should not be used for target homepage upload');
    }),
    createSignerForHome: (profileHomeDir) => {
      createSignerHomes.push(profileHomeDir);
      assert.equal(profileHomeDir, targetProfile.homeDir);
      return makeSigner(async (input) => {
        writeCalls.push(input);
        return {
          txids: ['target-homepage-upload-tx-1'],
          pinId: 'target-homepage-upload-pin-1',
          totalCost: 1,
          network: input.network,
          operation: input.operation,
          path: input.path,
          contentType: input.contentType,
          encoding: input.encoding,
          globalMetaId: 'gm-target-homepage-upload-bot',
          mvcAddress: 'addr-target-homepage-upload-bot',
        };
      });
    },
  });
  const filePath = path.join(targetProfile.homeDir, 'cover.png');
  await writeFile(filePath, Buffer.from('pngdata'));

  const result = await handlers.bot.uploadHomepageFile({
    slug: targetProfile.slug,
    filePath,
    contentType: 'image/png',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.pinId, 'target-homepage-upload-pin-1');
  assert.equal(result.data.metafileUri, 'metafile://target-homepage-upload-pin-1.png');
  assert.deepEqual(writeCalls.map((call) => call.path), ['/file']);
  assert.equal(Buffer.isBuffer(writeCalls[0].payload), true);
  assert.equal(writeCalls[0].payload.toString('utf8'), 'pngdata');
  assert.deepEqual(createSignerHomes, [targetProfile.homeDir]);
});

test('default bot uploadHomepageFile uses the factory large uploader above the direct threshold', async (t) => {
  const homeDir = await createProfileHome('metabot-default-homepage-large-upload-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Homepage Large Upload Bot',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-homepage-large-upload-bot',
    mvcAddress: 'addr-homepage-large-upload-bot',
  });
  const filePath = path.join(profile.homeDir, 'homepage-video.mp4');
  await writeFile(filePath, Buffer.alloc((2 * 1024 * 1024) + 1));
  const writeCalls = [];
  const largeUploadCalls = [];
  let factoryCalls = 0;
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async (input) => {
      writeCalls.push(input);
      throw new Error('direct signer should not be used for chunked homepage uploads');
    }),
    createProviderLargeFileUploader: () => {
      factoryCalls += 1;
      return {
        upload: async (input) => {
          largeUploadCalls.push(input);
          return makeLargeUploadResult(input, {
            pinId: 'homepage-large-pin-1',
            txids: ['homepage-large-tx-1'],
            totalCost: 42,
            globalMetaId: 'gm-homepage-large-upload-bot',
          });
        },
      };
    },
  });

  const result = await handlers.bot.uploadHomepageFile({
    slug: profile.slug,
    filePath,
    contentType: 'video/mp4',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.pinId, 'homepage-large-pin-1');
  assert.equal(result.data.uploadMode, 'chunked');
  assert.equal(result.data.bytes, (2 * 1024 * 1024) + 1);
  assert.equal(result.data.metafileUri, 'metafile://homepage-large-pin-1.mp4');
  assert.deepEqual(writeCalls, []);
  assert.equal(factoryCalls, 1);
  assert.equal(largeUploadCalls.length, 1);
  assert.equal(largeUploadCalls[0].filePath, filePath);
  assert.equal(largeUploadCalls[0].contentType, 'video/mp4');
});

test('default bot uploadHomepageFile preserves known large uploader failure codes', async (t) => {
  const homeDir = await createProfileHome('metabot-default-homepage-large-upload-errors-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Homepage Large Upload Error Bot',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-homepage-large-upload-error-bot',
    mvcAddress: 'addr-homepage-large-upload-error-bot',
  });
  const filePath = path.join(profile.homeDir, 'homepage-video.mp4');
  await writeFile(filePath, Buffer.alloc((2 * 1024 * 1024) + 1));

  for (const code of KNOWN_LARGE_UPLOAD_ERROR_CODES) {
    const handlers = createDefaultMetabotDaemonHandlers({
      homeDir: profile.homeDir,
      systemHomeDir,
      getDaemonRecord: () => null,
      signer: makeSigner(async () => {
        throw new Error(`direct signer should not be used for ${code}`);
      }),
      providerLargeFileUploader: makeThrowingLargeUploader(code, `${code} homepage mapped message`),
    });

    const result = await handlers.bot.uploadHomepageFile({
      slug: profile.slug,
      filePath,
      contentType: 'video/mp4',
    });

    assert.equal(result.ok, false, code);
    assert.equal(result.code, code);
    assert.match(result.message, new RegExp(`${code} homepage mapped message`));
  }
});

test('default bot uploadHomepageFile preserves whitelisted feeAssist data on upload failure', async (t) => {
  const homeDir = await createProfileHome('metabot-default-homepage-fee-assist-failure-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, {
    name: 'Homepage FeeAssist Failure Bot',
  });
  await upsertIdentityProfile({
    systemHomeDir,
    name: profile.name,
    homeDir: profile.homeDir,
    globalMetaId: 'gm-homepage-fee-assist-failure-bot',
    mvcAddress: 'addr-homepage-fee-assist-failure-bot',
  });
  const filePath = path.join(profile.homeDir, 'homepage-video.mp4');
  await writeFile(filePath, Buffer.alloc((2 * 1024 * 1024) + 1));
  const feeAssist = {
    attempted: true,
    used: false,
    mode: 'mvc_sponsor_v2',
    stage: 'commit',
    reason: 'commit_failed',
  };
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: profile.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    signer: makeSigner(async () => {
      throw new Error('direct signer should not run after upload failure');
    }),
    providerLargeFileUploader: makeThrowingLargeUploaderWithData(
      'mvc_fee_assist_commit_failed',
      'homepage upload failed',
      {
        feeAssist,
        ignored: 'do-not-leak',
      },
    ),
  });

  const result = await handlers.bot.uploadHomepageFile({
    slug: profile.slug,
    filePath,
    contentType: 'video/mp4',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'mvc_fee_assist_commit_failed');
  assert.deepEqual(result.data.feeAssist, feeAssist);
  assert.equal('ignored' in result.data, false);
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

test('default services listPublishSkills does not list fallback runtime skills when primary is unavailable', async (t) => {
  const homeDir = await createProfileHome('metabot-default-services-', 'publish-primary-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  await writeRuntimeIdentity(homeDir, 'Publish Primary Bot');
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'unavailable'),
      runtime('claude-code', 'runtime-claude', 'healthy'),
    ],
  });
  await createLlmBindingStore(homeDir).write({
    version: 1,
    bindings: [
      {
        id: 'binding-publish-codex-primary',
        metaBotSlug: 'publish-primary-bot',
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
      {
        id: 'binding-publish-claude-fallback',
        metaBotSlug: 'publish-primary-bot',
        llmRuntimeId: 'runtime-claude',
        role: 'fallback',
        priority: 0,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
    ],
  });
  await writeProjectSkill(homeDir, '.claude', 'metabot-claude-only');
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
  });

  const result = await handlers.services.listPublishSkills();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'primary_runtime_unavailable');
});

test('default services listPublishSkills lists fallback runtime skills when explicitly allowed', async (t) => {
  const homeDir = await createProfileHome('metabot-default-services-', 'chat-skills-bot');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  await writeRuntimeIdentity(homeDir, 'Chat Skills Bot');
  await createLlmRuntimeStore(homeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex', 'unavailable'),
      runtime('claude-code', 'runtime-claude', 'healthy'),
    ],
  });
  await createLlmBindingStore(homeDir).write({
    version: 1,
    bindings: [
      {
        id: 'binding-chat-codex-primary',
        metaBotSlug: 'chat-skills-bot',
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
      {
        id: 'binding-chat-claude-fallback',
        metaBotSlug: 'chat-skills-bot',
        llmRuntimeId: 'runtime-claude',
        role: 'fallback',
        priority: 0,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
    ],
  });
  await writeProjectSkill(homeDir, '.claude', 'metabot-claude-only');
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
  });

  const result = await handlers.services.listPublishSkills({ allowFallbackRuntime: true });

  assert.equal(result.ok, true);
  assert.equal(result.data.runtime.id, 'runtime-claude');
  assert.deepEqual(result.data.skills.map((skill) => skill.skillName), ['metabot-claude-only']);
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
