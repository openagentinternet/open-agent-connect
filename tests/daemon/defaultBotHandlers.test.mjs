import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const {
  createMetabotProfile,
  getMetabotProfile,
  updateMetabotProfile,
} = require('../../dist/core/bot/metabotProfileManager.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
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

test('default bot updateProfile skips chain sync for local-only profiles and saves locally', async (t) => {
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

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.name, 'Local Bot Updated');
  assert.equal(result.data.profile.role, 'Local edits only.');
  assert.deepEqual(signerCalls, []);
});

test('default bot updateProfile allows full-form saves when unchanged providers are now unavailable', async (t) => {
  const homeDir = await createProfileHome('metabot-default-bot-handlers-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const profile = await createMetabotProfile(systemHomeDir, { name: 'Runtime Drift Bot' });
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
      sessionId: 'session-1',
      status: 'completed',
      runtimeId: 'runtime-codex',
      provider: 'codex',
      metaBotSlug: 'alice-bot',
      prompt: 'One',
      createdAt: '2026-05-06T00:00:00.000Z',
    },
    {
      sessionId: 'session-2',
      status: 'failed',
      runtimeId: 'runtime-codex',
      provider: 'codex',
      metaBotSlug: 'alice-bot',
      prompt: 'Two',
      createdAt: '2026-05-06T00:01:00.000Z',
    },
    {
      sessionId: 'session-3',
      status: 'completed',
      runtimeId: 'runtime-claude',
      provider: 'claude-code',
      metaBotSlug: 'bob-bot',
      prompt: 'Three',
      createdAt: '2026-05-06T00:02:00.000Z',
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
      listSessions: async (limit) => {
        listSessionCalls.push(limit);
        return sessions.slice(0, limit);
      },
      streamEvents: async function* () {},
    },
  });

  const stats = await handlers.bot.getStats();
  const aliceSessions = await handlers.bot.listSessions({ slug: 'alice-bot', limit: 50 });

  assert.equal(stats.ok, true);
  assert.deepEqual(stats.data, {
    botCount: 2,
    healthyRuntimes: 1,
    totalExecutions: 3,
    successRate: 67,
  });
  assert.equal(aliceSessions.ok, true);
  assert.deepEqual(
    aliceSessions.data.sessions.map((session) => session.sessionId),
    ['session-1', 'session-2'],
  );
  assert.deepEqual(listSessionCalls, [1000, 50]);
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
