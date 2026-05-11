import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { access, mkdir } from 'node:fs/promises';
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
const { listIdentityProfiles, upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
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
    role: 'Writes careful code.',
  });
  const listed = await handlers.bot.listProfiles();
  const fetched = await handlers.bot.getProfile({ slug: created.data.profile.slug });

  assert.equal(created.ok, true);
  assert.equal(created.data.profile.slug, 'alice-bot');
  assert.equal(created.data.profile.role, 'Writes careful code.');
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.data.profiles.map((profile) => profile.slug), ['alice-bot']);
  assert.equal(fetched.ok, true);
  assert.equal(fetched.data.profile.name, 'Alice Bot');
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
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name', '/info/chatpubkey', '/info/avatar', '/info/bio']);
  assert.deepEqual(writeCalls.map((call) => call.operation), ['create', 'create', 'create', 'create']);
  assert.equal(writeCalls[0].contentType, 'text/plain');
  assert.equal(writeCalls[0].payload, 'Chain Bot');
  assert.equal(writeCalls[2].contentType, 'image/png;binary');
  assert.equal(writeCalls[2].payload, 'ZmFrZQ==');
  assert.equal(writeCalls[2].encoding, 'base64');
  assert.deepEqual(result.data.chainWrites.flatMap((write) => write.txids), ['tx-1', 'tx-2', 'tx-3', 'tx-4']);
  assert.equal(stored.role, 'Role after chain.');
  assert.equal(stored.avatarDataUrl, 'data:image/png;base64,ZmFrZQ==');
  assert.equal(stored.globalMetaId, result.data.profile.globalMetaId);
});

test('default bot createProfile writes requested profile fields to chain before local profile files', async (t) => {
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
      if (input.path === '/info/bio') {
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
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name', '/info/chatpubkey', '/info/avatar', '/info/bio']);
  assert.equal(stored.role, 'Chain first role.');
  assert.equal(stored.avatarDataUrl, 'data:image/png;base64,ZmFrZQ==');
});

test('default bot createProfile persists requested provider fields after chain bio write', async (t) => {
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
      runtime('claude-code', 'runtime-claude', 'degraded'),
    ],
  });
  const bioPayloads = [];
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
      if (input.path === '/info/bio') {
        bioPayloads.push(JSON.parse(input.payload));
      }
      return {
        txids: [`provider-create-tx-${bioPayloads.length + 1}`],
        pinId: `provider-create-pin-${bioPayloads.length + 1}`,
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
  assert.deepEqual(bioPayloads.at(-1), {
    role: 'I am a helpful AI assistant.',
    soul: 'Friendly and professional.',
    goal: 'Help users accomplish their tasks effectively.',
    primaryProvider: 'codex',
    fallbackProvider: 'claude-code',
  });
  assert.deepEqual(
    bindingState.bindings.map((binding) => [binding.role, binding.llmRuntimeId]).sort(),
    [
      ['fallback', 'runtime-claude'],
      ['primary', 'runtime-codex'],
    ],
  );
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
  const bioPayloads = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    ...makeChainedCreateOverrides(),
    createSignerForHome: () => makeSigner(async (input) => {
      if (input.path === '/info/bio') {
        bioPayloads.push(JSON.parse(input.payload));
      }
      return {
        txids: [`host-default-tx-${bioPayloads.length + 1}`],
        pinId: `host-default-pin-${bioPayloads.length + 1}`,
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
  assert.equal(bioPayloads.at(-1).primaryProvider, 'codex');
  assert.equal(bioPayloads.at(-1).fallbackProvider, 'claude-code');
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
  assert.equal(afterFailure.role, 'I am a helpful AI assistant.');
  assert.deepEqual(signerCalls, []);
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
    role: 'Updated on chain first.',
    avatarDataUrl: 'data:image/png;base64,VXBkYXRlZA==',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.name, 'Chained Save Updated');
  assert.equal(result.data.profile.role, 'Updated on chain first.');
  assert.equal(result.data.profile.avatarDataUrl, 'data:image/png;base64,VXBkYXRlZA==');
  assert.deepEqual(writeCalls.map((call) => call.path), ['/info/name', '/info/avatar', '/info/bio']);
  assert.equal(writeCalls[0].contentType, 'text/plain');
  assert.equal(writeCalls[0].payload, 'Chained Save Updated');
  assert.equal(writeCalls[1].contentType, 'image/png;binary');
  assert.equal(writeCalls[1].payload, 'VXBkYXRlZA==');
  assert.equal(writeCalls[1].encoding, 'base64');
  assert.deepEqual(result.data.chainWrites.flatMap((write) => write.txids), ['save-tx-1', 'save-tx-2', 'save-tx-3']);
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
