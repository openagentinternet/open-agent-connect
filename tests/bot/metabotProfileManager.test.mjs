import assert from 'node:assert/strict';
import { access, chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createProfilePublishStateStore,
  hashProfilePublishPayload,
} = require('../../dist/core/bot/profilePublishState.js');
const {
  createMetabotProfile,
  createMetabotProfileFromIdentity,
  deleteMetabotProfile,
  getMetabotProfile,
  getMetabotMnemonicBackup,
  getMetabotWalletInfo,
  listMetabotProfiles,
  runtimeAvailabilityTier,
  selectBestRuntimeForProvider,
  selectDefaultMetabotProviders,
  syncMetabotInfoToChain,
  updateMetabotProfile,
  validateAvatarDataUrl,
} = require('../../dist/core/bot/metabotProfileManager.js');
const {
  readActiveMetabotHome,
  resolveIdentityManagerPaths,
  setActiveMetabotHome,
  upsertIdentityProfile,
} = require('../../dist/core/identity/identityProfiles.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { createFileSecretStore } = require('../../dist/core/secrets/fileSecretStore.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

const FIXTURE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

async function createSystemHome() {
  return await mkdtempTempRoot('oac-metabot-manager-');
}

function runtime(provider, id, health = 'healthy') {
  return {
    id,
    provider,
    displayName: provider,
    binaryPath: `/bin/${provider}`,
    version: '1.0.0',
    authState: 'authenticated',
    health,
    capabilities: ['tool-use'],
    lastSeenAt: '2026-05-06T00:00:00.000Z',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
  };
}

test('createMetabotProfile creates a profile workspace with empty editable persona values', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Alice Bot' });

  assert.equal(created.name, 'Alice Bot');
  assert.equal(created.slug, 'alice-bot');
  assert.equal(created.role, '');
  assert.equal(created.soul, '');
  assert.equal(created.goal, '');
  assert.equal(created.primaryProvider, null);
  assert.equal(created.fallbackProvider, null);
  assert.equal(created.dshLlmProvider, null);
  assert.equal(created.dshLlmModel, null);
  assert.equal(created.dshLlmFallbackProvider, null);
  assert.equal(created.dshLlmFallbackModel, null);
  assert.deepEqual(created.allowChatSkills, []);

  for (const relativePath of ['ROLE.md', 'SOUL.md', 'GOAL.md', 'llmbindings.json']) {
    const target = path.join(created.homeDir, relativePath);
    const targetStat = await stat(target);
    assert.equal(targetStat.isFile(), true, `${relativePath} should be created`);
  }
  assert.equal(await readFile(resolveMetabotPaths(created.homeDir).roleMdPath, 'utf8'), '\n');
  assert.equal(await readFile(resolveMetabotPaths(created.homeDir).soulMdPath, 'utf8'), '\n');
  assert.equal(await readFile(resolveMetabotPaths(created.homeDir).goalMdPath, 'utf8'), '\n');

  const profiles = await listMetabotProfiles(systemHomeDir);
  assert.deepEqual(profiles.map((profile) => profile.slug), ['alice-bot']);
});

test('createMetabotProfile and updateMetabotProfile persist DSH LLM fields locally', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, {
    name: 'DSH Bot',
    dshLlmProvider: 'deepseek',
    dshLlmModel: 'deepseek-chat',
    dshLlmFallbackProvider: 'openai',
    dshLlmFallbackModel: 'gpt-4.1',
  });
  const paths = resolveMetabotPaths(created.homeDir);

  assert.equal(created.dshLlmProvider, 'deepseek');
  assert.equal(created.dshLlmModel, 'deepseek-chat');
  assert.equal(created.dshLlmFallbackProvider, 'openai');
  assert.equal(created.dshLlmFallbackModel, 'gpt-4.1');
  assert.equal(created.primaryProvider, null);

  const persisted = JSON.parse(await readFile(paths.dshLlmPath, 'utf8'));
  assert.equal(persisted.dshLlmProvider, 'deepseek');
  assert.equal(persisted.dshLlmModel, 'deepseek-chat');

  const updated = await updateMetabotProfile(systemHomeDir, created.slug, {
    dshLlmProvider: 'openai',
    dshLlmModel: 'gpt-4.1',
    dshLlmFallbackProvider: null,
    dshLlmFallbackModel: null,
  });
  assert.equal(updated.dshLlmProvider, 'openai');
  assert.equal(updated.dshLlmModel, 'gpt-4.1');
  assert.equal(updated.dshLlmFallbackProvider, null);
  assert.equal(updated.dshLlmFallbackModel, null);

  const shown = await getMetabotProfile(systemHomeDir, created.slug);
  assert.equal(shown.dshLlmProvider, 'openai');
  assert.equal(shown.dshLlmModel, 'gpt-4.1');
  assert.equal(shown.dshLlmFallbackProvider, null);
  assert.equal(shown.dshLlmFallbackModel, null);
});

test('createMetabotProfileFromIdentity and updateMetabotProfile persist public bio locally', async () => {
  const systemHomeDir = await createSystemHome();
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'alice');

  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Alice',
    bio: 'Builds small tools on the Agent Internet.',
    homeDir,
    globalMetaId: 'idq1alice',
    mvcAddress: 'mvc-address',
  });

  const profile = await getMetabotProfile(systemHomeDir, 'alice');
  assert.equal(profile.bio, 'Builds small tools on the Agent Internet.');

  await updateMetabotProfile(systemHomeDir, 'alice', { bio: 'Now writes Bot Pages.' });
  const updated = await getMetabotProfile(systemHomeDir, 'alice');
  assert.equal(updated.bio, 'Now writes Bot Pages.');
});

test('createMetabotProfile defaults primary and fallback providers from recently active runtimes', async () => {
  const systemHomeDir = await createSystemHome();
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'default-llm-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [
      {
        ...runtime('codex', 'runtime-codex'),
        lastSeenAt: '2026-05-06T00:01:00.000Z',
        updatedAt: '2026-05-06T00:01:00.000Z',
      },
      {
        ...runtime('claude-code', 'runtime-claude'),
        lastSeenAt: '2026-05-06T00:03:00.000Z',
        updatedAt: '2026-05-06T00:03:00.000Z',
      },
      {
        ...runtime('gemini', 'runtime-gemini', 'unavailable'),
        lastSeenAt: '2026-05-06T00:05:00.000Z',
        updatedAt: '2026-05-06T00:05:00.000Z',
      },
    ],
  });

  const created = await createMetabotProfile(systemHomeDir, { name: 'Default LLM Bot' });
  const bindings = JSON.parse(await readFile(resolveMetabotPaths(created.homeDir).llmBindingsPath, 'utf8')).bindings;

  assert.equal(created.primaryProvider, 'claude-code');
  assert.equal(created.fallbackProvider, 'codex');
  assert.deepEqual(
    bindings.map((binding) => [binding.role, binding.llmRuntimeId]).sort(),
    [
      ['fallback', 'runtime-codex'],
      ['primary', 'runtime-claude'],
    ],
  );
});

test('selectDefaultMetabotProviders ranks availability tiers ahead of activity', () => {
  const older = '2026-05-01T00:00:00.000Z';
  const newer = '2026-05-06T00:00:00.000Z';
  // tier 1 (detected+authenticated) beats tier 2 (detected other auth) despite age.
  const tier1 = { ...runtime('codex', 'runtime-codex', 'detected'), authState: 'authenticated', lastSeenAt: older, updatedAt: older };
  const tier2 = { ...runtime('workbuddy', 'runtime-workbuddy', 'detected'), authState: 'unknown', lastSeenAt: newer, updatedAt: newer };
  const selection = selectDefaultMetabotProviders({ runtimes: [tier2, tier1] });
  assert.equal(selection.primaryProvider, 'codex');
  assert.equal(selection.fallbackProvider, 'workbuddy');
});

test('selectDefaultMetabotProviders prefers detected over degraded and degraded over unavailable', () => {
  const detected = runtime('codex', 'runtime-codex', 'detected');
  const degraded = runtime('claude-code', 'runtime-claude', 'degraded');
  const unavailable = runtime('gemini', 'runtime-gemini', 'unavailable');
  const selection = selectDefaultMetabotProviders({ runtimes: [unavailable, degraded, detected] });
  assert.equal(selection.primaryProvider, 'codex');
  assert.equal(selection.fallbackProvider, 'claude-code');
  const noDetected = selectDefaultMetabotProviders({ runtimes: [unavailable, degraded] });
  assert.equal(noDetected.primaryProvider, 'claude-code');
});

test('selectDefaultMetabotProviders binds the single runtime of a one-runtime machine at any tier', () => {
  const only = runtime('workbuddy', 'runtime-workbuddy', 'unavailable');
  const selection = selectDefaultMetabotProviders({ runtimes: [only] });
  assert.equal(selection.primaryProvider, 'workbuddy');
  assert.equal(selection.fallbackProvider, undefined);
});

test('selectDefaultMetabotProviders keeps the preferred provider when it has a candidate at any tier', () => {
  const healthy = runtime('claude-code', 'runtime-claude', 'healthy');
  const degradedPreferred = runtime('codex', 'runtime-codex', 'degraded');
  const selection = selectDefaultMetabotProviders({
    runtimes: [healthy, degradedPreferred],
    preferredProvider: 'codex',
  });
  assert.equal(selection.primaryProvider, 'codex');
  assert.equal(selection.fallbackProvider, 'claude-code');
});

test('selectDefaultMetabotProviders prefers the most recently active unavailable runtime within tier 4', () => {
  const older = { ...runtime('codex', 'runtime-codex', 'unavailable'), lastSeenAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z', createdAt: '2026-05-01T00:00:00.000Z' };
  const newer = { ...runtime('workbuddy', 'runtime-workbuddy', 'unavailable'), lastSeenAt: '2026-05-06T00:00:00.000Z', updatedAt: '2026-05-06T00:00:00.000Z' };
  const selection = selectDefaultMetabotProviders({ runtimes: [older, newer] });
  assert.equal(selection.primaryProvider, 'workbuddy');
});

test('selectBestRuntimeForProvider returns the best-tier runtime or null', () => {
  const healthy = runtime('codex', 'runtime-codex-healthy', 'healthy');
  const detected = { ...runtime('codex', 'runtime-codex-detected', 'detected'), lastSeenAt: '2026-05-06T00:00:00.000Z', updatedAt: '2026-05-06T00:00:00.000Z' };
  assert.equal(selectBestRuntimeForProvider([detected, healthy], 'codex').id, 'runtime-codex-healthy');
  assert.equal(selectBestRuntimeForProvider([detected], 'codex').id, 'runtime-codex-detected');
  assert.equal(selectBestRuntimeForProvider([], 'codex'), null);
  assert.equal(selectBestRuntimeForProvider([detected], 'custom'), null);
});

test('createMetabotProfile binds a detected runtime when nothing is healthy', async () => {
  const systemHomeDir = await createSystemHome();
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'detected-default-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [runtime('workbuddy', 'runtime-workbuddy', 'detected')],
  });
  const created = await createMetabotProfile(systemHomeDir, { name: 'Detected Default Bot' });
  assert.equal(created.primaryProvider, 'workbuddy');
  const bindings = JSON.parse(await readFile(resolveMetabotPaths(created.homeDir).llmBindingsPath, 'utf8')).bindings;
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].role, 'primary');
  assert.equal(bindings[0].llmRuntimeId, 'runtime-workbuddy');
});

test('createMetabotProfile still rejects an explicitly requested provider without a healthy runtime', async () => {
  const systemHomeDir = await createSystemHome();
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'explicit-detected-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [runtime('workbuddy', 'runtime-workbuddy', 'detected')],
  });
  await assert.rejects(
    () => createMetabotProfile(systemHomeDir, { name: 'Explicit Detected Bot', primaryProvider: 'workbuddy' }),
    /No available runtime found for provider: workbuddy/,
  );
});

test('createMetabotProfile leaves fallback empty when only one provider is available', async () => {
  const systemHomeDir = await createSystemHome();
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'single-llm-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [
      runtime('codex', 'runtime-codex'),
    ],
  });

  const created = await createMetabotProfile(systemHomeDir, { name: 'Single LLM Bot' });

  assert.equal(created.primaryProvider, 'codex');
  assert.equal(created.fallbackProvider, null);
});

test('createMetabotProfile defaults only from healthy runtimes and skips newer degraded runtimes', async () => {
  const systemHomeDir = await createSystemHome();
  const targetHomeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'recent-degraded-bot');
  await createLlmRuntimeStore(targetHomeDir).write({
    version: 1,
    runtimes: [
      {
        ...runtime('codex', 'runtime-codex', 'healthy'),
        lastSeenAt: '2026-05-06T00:01:00.000Z',
        updatedAt: '2026-05-06T00:01:00.000Z',
      },
      {
        ...runtime('claude-code', 'runtime-claude', 'degraded'),
        lastSeenAt: '2026-05-06T00:05:00.000Z',
        updatedAt: '2026-05-06T00:05:00.000Z',
      },
      {
        ...runtime('openclaw', 'runtime-openclaw', 'healthy'),
        lastSeenAt: '2026-05-06T00:03:00.000Z',
        updatedAt: '2026-05-06T00:03:00.000Z',
      },
    ],
  });

  const created = await createMetabotProfile(systemHomeDir, { name: 'Recent Degraded Bot' });

  assert.equal(created.primaryProvider, 'openclaw');
  assert.equal(created.fallbackProvider, 'codex');
});

test('createMetabotProfile validates avatars before creating a profile workspace', async () => {
  const systemHomeDir = await createSystemHome();

  await assert.rejects(
    () => createMetabotProfile(systemHomeDir, {
      name: 'Bad Avatar',
      avatarDataUrl: 'data:text/plain;base64,SGVsbG8=',
    }),
    /Avatar must be a PNG, JPEG, WebP, or GIF data URL/,
  );

  assert.deepEqual(await listMetabotProfiles(systemHomeDir), []);
  await assert.rejects(
    () => access(path.join(systemHomeDir, '.metabot', 'profiles', 'bad-avatar')),
    /ENOENT/,
  );
});

test('updateMetabotProfile persists persona, avatar, and primary/fallback provider bindings', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Alice Bot' });
  const paths = resolveMetabotPaths(created.homeDir);
  const runtimeStore = createLlmRuntimeStore(paths);
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime('claude-code', 'runtime-claude'),
      runtime('codex', 'runtime-codex'),
      runtime('gemini', 'runtime-gemini', 'unavailable'),
    ],
  });

  const avatarDataUrl = 'data:image/png;base64,ZmFrZS1hdmF0YXI=';
  const updated = await updateMetabotProfile(systemHomeDir, created.slug, {
    name: 'Alice Updated',
    role: 'Writes careful code.',
    soul: 'Direct and practical.',
    goal: 'Ship useful changes.',
    avatarDataUrl,
    primaryProvider: 'claude-code',
    fallbackProvider: 'codex',
  });

  assert.equal(updated.name, 'Alice Updated');
  assert.equal(updated.role, 'Writes careful code.');
  assert.equal(updated.soul, 'Direct and practical.');
  assert.equal(updated.goal, 'Ship useful changes.');
  assert.equal(updated.avatarDataUrl, avatarDataUrl);
  assert.equal(updated.primaryProvider, 'claude-code');
  assert.equal(updated.fallbackProvider, 'codex');

  const bindings = JSON.parse(await readFile(paths.llmBindingsPath, 'utf8')).bindings;
  assert.deepEqual(
    bindings.map((binding) => [binding.role, binding.llmRuntimeId, binding.priority, binding.enabled]),
    [
      ['primary', 'runtime-claude', 0, true],
      ['fallback', 'runtime-codex', 0, true],
    ],
  );

  const refreshed = await getMetabotProfile(systemHomeDir, created.slug);
  assert.equal(refreshed.name, 'Alice Updated');
  assert.equal(refreshed.primaryProvider, 'claude-code');

  const cleared = await updateMetabotProfile(systemHomeDir, created.slug, {
    avatarDataUrl: '',
    fallbackProvider: null,
  });
  assert.equal(cleared.avatarDataUrl, undefined);
  assert.equal(cleared.fallbackProvider, null);
});

test('updateMetabotProfile persists allowChatSkills under runtime state after update', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Policy Bot' });
  const paths = resolveMetabotPaths(created.homeDir);

  const updated = await updateMetabotProfile(systemHomeDir, created.slug, {
    allowChatSkills: [' metabot-help ', '', 'metabot-help', 'metabot-wallet-manage'],
  });

  assert.deepEqual(updated.allowChatSkills, ['metabot-help', 'metabot-wallet-manage']);
  const persisted = JSON.parse(await readFile(paths.chatSkillPolicyPath, 'utf8'));
  assert.deepEqual(persisted.allowChatSkills, ['metabot-help', 'metabot-wallet-manage']);
  assert.equal(typeof persisted.updatedAt, 'string');
});

test('updateMetabotProfile persists homepage JSON under runtime state', async (t) => {
  const homeDir = await createProfileHome('metabot-homepage-profile-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const created = await createMetabotProfile(systemHomeDir, {
    name: 'Homepage Bot',
    bio: 'Original bio.',
  });

  const homepage = {
    uri: 'metaapp://metaapp-pin-123',
    renderer: 'metaapp',
    contentType: 'application/vnd.metaapp',
  };
  const updated = await updateMetabotProfile(systemHomeDir, created.slug, { homepage });
  const loaded = await getMetabotProfile(systemHomeDir, created.slug);
  const paths = resolveMetabotPaths(created.homeDir);
  const persisted = JSON.parse(await readFile(paths.homepageStatePath, 'utf8'));

  assert.deepEqual(updated.homepage, homepage);
  assert.deepEqual(loaded.homepage, homepage);
  assert.deepEqual(persisted, homepage);
});

test('updateMetabotProfile appends known metafile extension for homepage payloads', async (t) => {
  const homeDir = await createProfileHome('metabot-homepage-profile-ext-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const created = await createMetabotProfile(systemHomeDir, {
    name: 'Homepage File Bot',
    bio: 'Original bio.',
  });

  const homepage = {
    uri: 'metafile://homepage-pin-123',
    renderer: 'auto',
    contentType: 'image/png',
  };
  const expected = {
    ...homepage,
    uri: 'metafile://homepage-pin-123.png',
  };
  const updated = await updateMetabotProfile(systemHomeDir, created.slug, { homepage });
  const loaded = await getMetabotProfile(systemHomeDir, created.slug);
  const paths = resolveMetabotPaths(created.homeDir);
  const persisted = JSON.parse(await readFile(paths.homepageStatePath, 'utf8'));

  assert.deepEqual(updated.homepage, expected);
  assert.deepEqual(loaded.homepage, expected);
  assert.deepEqual(persisted, expected);
});

test('updateMetabotProfile clears homepage when explicitly set to null', async (t) => {
  const homeDir = await createProfileHome('metabot-homepage-clear-profile-');
  t.after(async () => {
    await cleanupProfileHome(homeDir);
  });
  const systemHomeDir = deriveSystemHome(homeDir);
  const created = await createMetabotProfile(systemHomeDir, {
    name: 'Homepage Clear Bot',
    bio: 'Original bio.',
  });
  const paths = resolveMetabotPaths(created.homeDir);

  await updateMetabotProfile(systemHomeDir, created.slug, {
    homepage: {
      uri: 'metaapp://metaapp-pin-123',
      renderer: 'metaapp',
      contentType: 'application/vnd.metaapp',
    },
  });
  await access(paths.homepageStatePath);

  const cleared = await updateMetabotProfile(systemHomeDir, created.slug, { homepage: null });
  const loaded = await getMetabotProfile(systemHomeDir, created.slug);

  assert.equal(cleared.homepage, undefined);
  assert.equal(loaded.homepage, undefined);
  await assert.rejects(access(paths.homepageStatePath), { code: 'ENOENT' });
});

test('updateMetabotProfile preserves allowChatSkills when omitted and clears when explicitly empty', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Policy Preserve Bot' });

  await updateMetabotProfile(systemHomeDir, created.slug, {
    allowChatSkills: ['metabot-help'],
  });
  const renamed = await updateMetabotProfile(systemHomeDir, created.slug, {
    name: 'Policy Preserve Bot Renamed',
  });
  assert.deepEqual(renamed.allowChatSkills, ['metabot-help']);

  const cleared = await updateMetabotProfile(systemHomeDir, created.slug, {
    allowChatSkills: [],
  });
  assert.deepEqual(cleared.allowChatSkills, []);
});

test('getMetabotProfile ignores invalid persisted allowChatSkills policy', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Invalid Policy Bot' });
  const paths = resolveMetabotPaths(created.homeDir);
  await mkdir(path.dirname(paths.chatSkillPolicyPath), { recursive: true });
  await writeFile(paths.chatSkillPolicyPath, JSON.stringify({
    allowChatSkills: '../unsafe',
  }), 'utf8');

  const loaded = await getMetabotProfile(systemHomeDir, created.slug);
  assert.deepEqual(loaded.allowChatSkills, []);
});

test('updateMetabotProfile validates allowChatSkills before writing local profile fields', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Atomic Policy Bot' });
  const paths = resolveMetabotPaths(created.homeDir);

  await assert.rejects(
    () => updateMetabotProfile(systemHomeDir, created.slug, {
      role: 'Should not persist.',
      allowChatSkills: ['../unsafe'],
    }),
    /safe skill directory names/,
  );

  const afterFailure = await getMetabotProfile(systemHomeDir, created.slug);
  assert.equal(await readFile(paths.roleMdPath, 'utf8'), '\n');
  assert.deepEqual(afterFailure.allowChatSkills, []);
  await assert.rejects(
    () => readFile(paths.chatSkillPolicyPath, 'utf8'),
    { code: 'ENOENT' },
  );
});

test('updateMetabotProfile validates provider changes before writing local profile fields', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Atomic Bot' });
  const paths = resolveMetabotPaths(created.homeDir);

  await assert.rejects(
    () => updateMetabotProfile(systemHomeDir, created.slug, {
      name: 'Should Not Persist',
      role: 'Should not persist.',
      primaryProvider: 'gemini',
    }),
    /No available runtime found for provider: gemini/,
  );

  const afterFailure = await getMetabotProfile(systemHomeDir, created.slug);
  assert.equal(afterFailure.name, 'Atomic Bot');
  assert.equal(await readFile(paths.roleMdPath, 'utf8'), '\n');
  assert.equal(afterFailure.primaryProvider, null);
});

test('updateMetabotProfile preserves unrelated same-role bindings when changing the selected provider', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Binding Bot' });
  const paths = resolveMetabotPaths(created.homeDir);
  await createLlmRuntimeStore(paths).write({
    version: 1,
    runtimes: [
      runtime('claude-code', 'runtime-claude'),
      runtime('codex', 'runtime-codex'),
      runtime('gemini', 'runtime-gemini'),
    ],
  });
  await writeFile(path.join(created.homeDir, 'llmbindings.json'), JSON.stringify({
    version: 1,
    bindings: [
      {
        id: 'managed-primary',
        metaBotSlug: created.slug,
        llmRuntimeId: 'runtime-claude',
        role: 'primary',
        priority: 0,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
      {
        id: 'backup-primary',
        metaBotSlug: created.slug,
        llmRuntimeId: 'runtime-gemini',
        role: 'primary',
        priority: 5,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
    ],
  }, null, 2) + '\n', 'utf8');

  await updateMetabotProfile(systemHomeDir, created.slug, {
    primaryProvider: 'codex',
  });

  const bindings = JSON.parse(await readFile(paths.llmBindingsPath, 'utf8')).bindings;
  assert.equal(bindings.length, 2);
  assert.equal(bindings.find((binding) => binding.id === 'managed-primary').llmRuntimeId, 'runtime-codex');
  assert.equal(bindings.find((binding) => binding.id === 'backup-primary').llmRuntimeId, 'runtime-gemini');
});

test('updateMetabotProfile clears the active provider binding instead of disabled same-role bindings', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Clear Bot' });
  const paths = resolveMetabotPaths(created.homeDir);
  await createLlmRuntimeStore(paths).write({
    version: 1,
    runtimes: [
      runtime('claude-code', 'runtime-claude'),
      runtime('codex', 'runtime-codex'),
    ],
  });
  await writeFile(path.join(created.homeDir, 'llmbindings.json'), JSON.stringify({
    version: 1,
    bindings: [
      {
        id: 'disabled-primary',
        metaBotSlug: created.slug,
        llmRuntimeId: 'runtime-codex',
        role: 'primary',
        priority: 0,
        enabled: false,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:02.000Z',
      },
      {
        id: 'active-primary',
        metaBotSlug: created.slug,
        llmRuntimeId: 'runtime-claude',
        role: 'primary',
        priority: 1,
        enabled: true,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:01.000Z',
      },
    ],
  }, null, 2) + '\n', 'utf8');

  const cleared = await updateMetabotProfile(systemHomeDir, created.slug, {
    primaryProvider: null,
  });

  const bindings = JSON.parse(await readFile(paths.llmBindingsPath, 'utf8')).bindings;
  assert.equal(cleared.primaryProvider, null);
  assert.equal(bindings.some((binding) => binding.id === 'active-primary'), false);
  assert.equal(bindings.some((binding) => binding.id === 'disabled-primary'), true);
});

test('validateAvatarDataUrl rejects non-images and oversized payloads', () => {
  assert.deepEqual(validateAvatarDataUrl('data:text/plain;base64,SGVsbG8=', 200_000), {
    valid: false,
    error: 'Avatar must be a PNG, JPEG, WebP, or GIF data URL.',
  });
  assert.equal(validateAvatarDataUrl('data:image/png;base64,ZmFrZQ==', 200_000).valid, true);
  assert.equal(validateAvatarDataUrl(`data:image/png;base64,${'A'.repeat(300_000)}`, 200_000).valid, false);
});

test('syncMetabotInfoToChain writes persona fields to one JSON path', async () => {
  const homeDir = await createProfileHome('metabot-sync-info-', 'alice');
  const calls = [];
  const signer = {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async (input) => {
      calls.push(input);
      return {
        txids: [`tx-${calls.length}`],
        pinId: `pin-${calls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding,
        globalMetaId: 'gid',
        mvcAddress: 'addr',
      };
    },
  };

  const results = await syncMetabotInfoToChain(signer, {
    name: 'Alice',
    slug: 'alice',
    aliases: [],
    homeDir,
    globalMetaId: 'gid',
    mvcAddress: 'addr',
    createdAt: 1,
    updatedAt: 2,
    bio: 'Builds small tools on the Agent Internet.',
    role: 'Role',
    soul: 'Soul',
    goal: 'Goal',
    avatarDataUrl: 'data:image/png;base64,ZmFrZQ==',
    primaryProvider: 'claude-code',
    fallbackProvider: 'codex',
    allowChatSkills: ['metabot-help', 'metabot-wallet-manage'],
  }, ['bio', 'role', 'soul', 'goal', 'allowChatSkills', 'primaryProvider', 'fallbackProvider'], { delayMs: 0 });

  assert.deepEqual(calls.map((call) => call.path), [
    '/info/bio',
    '/info/persona',
    '/info/chatSkills',
    '/info/llm',
  ]);
  assert.deepEqual(calls.map((call) => call.operation), ['create', 'create', 'create', 'create']);
  assert.deepEqual(calls.map((call) => call.contentType), [
    'text/plain',
    'application/json',
    'application/json',
    'application/json',
  ]);
  assert.equal(calls[0].payload, 'Builds small tools on the Agent Internet.');
  assert.deepEqual(JSON.parse(calls[1].payload), {
    role: 'Role',
    soul: 'Soul',
    goal: 'Goal',
  });
  assert.deepEqual(JSON.parse(calls[2].payload), {
    allowChatSkills: ['metabot-help', 'metabot-wallet-manage'],
    allowPrivateChatSkills: ['metabot-help', 'metabot-wallet-manage'],
    allowGroupChatSkills: [],
  });
  assert.deepEqual(JSON.parse(calls[3].payload), {
    primaryProvider: 'claude-code',
    fallbackProvider: 'codex',
  });
  assert.equal(results.length, 4);
});

test('syncMetabotInfoToChain skips duplicate LLM info when publish-state hash matches', async () => {
  const homeDir = await createProfileHome('metabot-publish-state-', 'ledger-bot');
  const calls = [];
  const signer = {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async (input) => {
      calls.push(input);
      return {
        txids: [`ledger-tx-${calls.length}`],
        pinId: `ledger-pin-${calls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gid',
        mvcAddress: 'addr',
      };
    },
  };
  const profile = {
    name: 'Ledger Bot',
    slug: 'ledger-bot',
    aliases: [],
    homeDir,
    globalMetaId: 'gid',
    mvcAddress: 'addr',
    createdAt: 1,
    updatedAt: 2,
    bio: '',
    role: '',
    soul: '',
    goal: '',
    primaryProvider: 'codex',
    fallbackProvider: 'claude-code',
    allowChatSkills: [],
  };

  const first = await syncMetabotInfoToChain(signer, profile, ['primaryProvider', 'fallbackProvider'], { delayMs: 0 });
  const second = await syncMetabotInfoToChain(signer, profile, ['primaryProvider', 'fallbackProvider'], { delayMs: 0 });
  const state = await createProfilePublishStateStore(homeDir).read();
  const expectedHash = hashProfilePublishPayload({
    path: '/info/llm',
    contentType: 'application/json',
    encoding: 'utf-8',
    payload: JSON.stringify({
      primaryProvider: 'codex',
      fallbackProvider: 'claude-code',
    }),
  });

  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.deepEqual(calls.map((call) => call.path), ['/info/llm']);
  assert.equal(state.records['/info/llm'].payloadHash, expectedHash);
  assert.equal(state.records['/info/llm'].pinId, 'ledger-pin-1');
});

test('syncMetabotInfoToChain writes LLM info when publish-state is missing even if providers are baseline targets', async () => {
  const homeDir = await createProfileHome('metabot-publish-state-', 'missing-ledger-bot');
  const calls = [];
  const signer = {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async (input) => {
      calls.push(input);
      return {
        txids: [`missing-ledger-tx-${calls.length}`],
        pinId: `missing-ledger-pin-${calls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gid',
        mvcAddress: 'addr',
      };
    },
  };

  const results = await syncMetabotInfoToChain(signer, {
    name: 'Missing Ledger Bot',
    slug: 'missing-ledger-bot',
    aliases: [],
    homeDir,
    globalMetaId: 'gid',
    mvcAddress: 'addr',
    createdAt: 1,
    updatedAt: 2,
    bio: 'A changed public bio.',
    role: '',
    soul: '',
    goal: '',
    primaryProvider: 'codex',
    fallbackProvider: null,
    allowChatSkills: [],
  }, ['bio', 'primaryProvider'], { delayMs: 0 });

  assert.deepEqual(calls.map((call) => call.path), ['/info/bio', '/info/llm']);
  assert.equal(results.length, 2);
  assert.deepEqual(JSON.parse(calls[1].payload), {
    primaryProvider: 'codex',
    fallbackProvider: null,
  });
});

test('syncMetabotInfoToChain only writes empty bio and persona clearing payloads when publish-state has prior records', async () => {
  const homeDir = await createProfileHome('metabot-publish-state-', 'clear-ledger-bot');
  const calls = [];
  const signer = {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async (input) => {
      calls.push(input);
      return {
        txids: [`clear-ledger-tx-${calls.length}`],
        pinId: `clear-ledger-pin-${calls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding ?? 'utf-8',
        globalMetaId: 'gid',
        mvcAddress: 'addr',
      };
    },
  };
  const profile = {
    name: 'Clear Ledger Bot',
    slug: 'clear-ledger-bot',
    aliases: [],
    homeDir,
    globalMetaId: 'gid',
    mvcAddress: 'addr',
    createdAt: 1,
    updatedAt: 2,
    bio: '',
    role: '',
    soul: '',
    goal: '',
    primaryProvider: null,
    fallbackProvider: null,
    allowChatSkills: [],
  };

  const skipped = await syncMetabotInfoToChain(signer, profile, ['bio', 'role', 'soul', 'goal'], { delayMs: 0 });
  assert.deepEqual(skipped, []);
  assert.deepEqual(calls, []);

  await createProfilePublishStateStore(homeDir).write({
    version: 1,
    records: {
      '/info/bio': {
        payloadHash: 'old-bio-hash',
        contentType: 'text/plain',
        encoding: 'utf-8',
        network: 'mvc',
        pinId: 'old-bio-pin',
        txids: ['old-bio-tx'],
        publishedAt: '2026-05-06T00:00:00.000Z',
      },
      '/info/persona': {
        payloadHash: 'old-persona-hash',
        contentType: 'application/json',
        encoding: 'utf-8',
        network: 'mvc',
        pinId: 'old-persona-pin',
        txids: ['old-persona-tx'],
        publishedAt: '2026-05-06T00:00:00.000Z',
      },
    },
  });

  const cleared = await syncMetabotInfoToChain(signer, profile, ['bio', 'role', 'soul', 'goal'], { delayMs: 0 });

  assert.equal(cleared.length, 2);
  assert.deepEqual(calls.map((call) => call.path), ['/info/bio', '/info/persona']);
  assert.deepEqual(calls.map((call) => call.payload), ['', '']);
});

test('syncMetabotInfoToChain writes homepage JSON to /info/homepage on MVC', async () => {
  const homeDir = await createProfileHome('metabot-sync-info-', 'alice-homepage');
  const calls = [];
  const signer = {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async (input) => {
      calls.push(input);
      return {
        txids: [`tx-${calls.length}`],
        pinId: `pin-${calls.length}`,
        totalCost: 1,
        network: input.network,
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding,
        globalMetaId: 'gid',
        mvcAddress: 'addr',
      };
    },
  };
  const homepage = {
    uri: 'metafile://file-pin-123',
    renderer: 'auto',
    contentType: 'image/png',
  };

  const results = await syncMetabotInfoToChain(signer, {
    name: 'Alice',
    slug: 'alice',
    aliases: [],
    homeDir,
    globalMetaId: 'gid',
    mvcAddress: 'addr',
    createdAt: 1,
    updatedAt: 2,
    bio: 'Public bio',
    role: 'Role',
    soul: 'Soul',
    goal: 'Goal',
    primaryProvider: 'codex',
    fallbackProvider: null,
    allowChatSkills: [],
    homepage,
  }, ['homepage'], { delayMs: 0 });

  assert.equal(results.length, 1);
  assert.deepEqual(calls.map((call) => call.path), ['/info/homepage']);
  assert.equal(calls[0].operation, 'create');
  assert.equal(calls[0].network, 'mvc');
  assert.equal(calls[0].contentType, 'application/json');
  assert.equal(calls[0].encoding, 'utf-8');
  assert.deepEqual(JSON.parse(calls[0].payload), {
    ...homepage,
    uri: 'metafile://file-pin-123.png',
  });
});

test('syncMetabotInfoToChain writes empty create to /info/homepage when homepage is cleared', async () => {
  const homeDir = await createProfileHome('metabot-sync-info-', 'alice-homepage-clear');
  const calls = [];
  const signer = {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async (input) => {
      calls.push(input);
      return {
        txids: [`tx-${calls.length}`],
        pinId: `pin-${calls.length}`,
        totalCost: 1,
        network: input.network,
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding,
        globalMetaId: 'gid',
        mvcAddress: 'addr',
      };
    },
  };

  const results = await syncMetabotInfoToChain(signer, {
    name: 'Alice',
    slug: 'alice',
    aliases: [],
    homeDir,
    globalMetaId: 'gid',
    mvcAddress: 'addr',
    createdAt: 1,
    updatedAt: 2,
    bio: 'Public bio',
    role: 'Role',
    soul: 'Soul',
    goal: 'Goal',
    primaryProvider: 'codex',
    fallbackProvider: null,
    allowChatSkills: [],
  }, ['homepage'], { delayMs: 0 });

  assert.equal(results.length, 1);
  assert.equal(calls[0].operation, 'create');
  assert.equal(calls[0].path, '/info/homepage');
  assert.equal(calls[0].payload, '');
  assert.equal(calls[0].network, 'mvc');
  assert.equal(calls[0].contentType, 'application/json');
});

test('syncMetabotInfoToChain keeps /info writes as create even when caller requests modify', async () => {
  const homeDir = await createProfileHome('metabot-sync-info-', 'alice-create-operation');
  const calls = [];
  const signer = {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async (input) => {
      calls.push(input);
      return {
        txids: [`tx-${calls.length}`],
        pinId: `pin-${calls.length}`,
        totalCost: 1,
        network: 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding,
        globalMetaId: 'gid',
        mvcAddress: 'addr',
      };
    },
  };

  const results = await syncMetabotInfoToChain(signer, {
    name: 'Alice',
    slug: 'alice',
    aliases: [],
    homeDir,
    globalMetaId: 'gid',
    mvcAddress: 'addr',
    createdAt: 1,
    updatedAt: 2,
    bio: 'Public bio',
    role: 'Role',
    soul: 'Soul',
    goal: 'Goal',
    avatarDataUrl: 'data:image/png;base64,ZmFrZQ==',
    primaryProvider: 'claude-code',
    fallbackProvider: 'codex',
    allowChatSkills: ['metabot-help'],
  }, ['name', 'avatar', 'role', 'primaryProvider'], { delayMs: 0, operation: 'modify' });

  assert.deepEqual(calls.map((call) => call.path), ['/info/name', '/info/avatar', '/info/persona', '/info/llm']);
  assert.deepEqual(calls.map((call) => call.operation), ['create', 'create', 'create', 'create']);
  assert.equal(calls[0].contentType, 'text/plain');
  assert.equal(calls[0].payload, 'Alice');
  assert.equal(calls[0].encoding, 'utf-8');
  assert.equal(calls[1].contentType, 'image/png;binary');
  assert.equal(Buffer.isBuffer(calls[1].payload), true);
  assert.equal(calls[1].payload.toString('utf8'), 'fake');
  assert.equal(calls[1].encoding, 'binary');
  assert.equal(calls[2].contentType, 'application/json');
  assert.deepEqual(JSON.parse(calls[2].payload), {
    role: 'Role',
    soul: 'Soul',
    goal: 'Goal',
  });
  assert.deepEqual(JSON.parse(calls[3].payload), {
    primaryProvider: 'claude-code',
    fallbackProvider: 'codex',
  });
  assert.equal(results.length, 4);
});

test('syncMetabotInfoToChain skips local-only profiles without a globalMetaId', async () => {
  const results = await syncMetabotInfoToChain({
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async () => {
      throw new Error('should not write');
    },
  }, {
    name: 'Draft',
    slug: 'draft',
    aliases: [],
    homeDir: '/tmp/draft',
    globalMetaId: '',
    mvcAddress: '',
    createdAt: 1,
    updatedAt: 2,
    bio: '',
    role: '',
    soul: '',
    goal: '',
    primaryProvider: null,
    fallbackProvider: null,
    allowChatSkills: [],
  }, ['name']);

  assert.deepEqual(results, []);
});

test('getMetabotWalletInfo and getMetabotMnemonicBackup expose selected profile wallet data', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Wallet Bot' });
  await upsertIdentityProfile({
    systemHomeDir,
    name: created.name,
    homeDir: created.homeDir,
    globalMetaId: 'gm-wallet-bot',
    mvcAddress: 'mvc-profile-address',
  });
  await createFileSecretStore(created.homeDir).writeIdentitySecrets({
    mnemonic: FIXTURE_MNEMONIC,
    path: "m/44'/10001'/0'/0/0",
    addresses: {
      mvc: 'mvc-secret-address',
      btc: 'btc-secret-address',
      doge: 'doge-secret-address',
      opcat: 'opcat-secret-address',
    },
    globalMetaId: 'gm-wallet-bot',
  });

  const wallet = await getMetabotWalletInfo(systemHomeDir, created.slug);
  const backup = await getMetabotMnemonicBackup(systemHomeDir, created.slug);

  assert.equal(wallet.slug, created.slug);
  assert.equal(wallet.name, 'Wallet Bot');
  assert.deepEqual(wallet.addresses, {
    btc: 'btc-secret-address',
    mvc: 'mvc-secret-address',
    doge: 'doge-secret-address',
    opcat: 'opcat-secret-address',
  });
  assert.deepEqual(backup.words, FIXTURE_MNEMONIC.split(' '));
});

test('getMetabotWalletInfo prefers runtime MVC address map over legacy secret mvcAddress', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Runtime MVC Bot' });
  await upsertIdentityProfile({
    systemHomeDir,
    name: created.name,
    homeDir: created.homeDir,
    globalMetaId: 'gm-runtime-mvc-bot',
    mvcAddress: 'mvc-profile-address',
  });
  await createFileSecretStore(created.homeDir).writeIdentitySecrets({
    mnemonic: FIXTURE_MNEMONIC,
    path: "m/44'/10001'/0'/0/0",
    mvcAddress: 'mvc-legacy-secret-address',
    addresses: {
      btc: 'btc-secret-address',
    },
    globalMetaId: 'gm-runtime-mvc-bot',
  });
  await createRuntimeStateStore(created.homeDir).writeState({
    identity: {
      metabotId: 1,
      name: created.name,
      createdAt: 1776836000000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'public-key',
      chatPublicKey: 'chat-public-key',
      addresses: {
        mvc: 'mvc-runtime-address',
      },
      mvcAddress: 'mvc-runtime-legacy-address',
      metaId: 'metaid-runtime-mvc-bot',
      globalMetaId: 'gm-runtime-mvc-bot',
    },
    services: [],
    traces: [],
    sellerOrders: [],
  });

  const wallet = await getMetabotWalletInfo(systemHomeDir, created.slug);

  assert.equal(wallet.addresses.mvc, 'mvc-runtime-address');
});

test('deleteMetabotProfile removes manager records, active profile pointer, profile files, and executor sessions for the slug', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Delete Bot' });
  await setActiveMetabotHome({
    systemHomeDir,
    homeDir: created.homeDir,
  });
  const paths = resolveMetabotPaths(created.homeDir);
  const sessionPath = path.join(paths.llmExecutorSessionsRoot, 'session-delete-bot.json');
  const transcriptPath = path.join(paths.llmExecutorTranscriptsRoot, 'session-delete-bot.log');
  await mkdir(paths.llmExecutorSessionsRoot, { recursive: true });
  await mkdir(paths.llmExecutorTranscriptsRoot, { recursive: true });
  await writeFile(sessionPath, `${JSON.stringify({
    sessionId: 'session-delete-bot',
    metaBotSlug: created.slug,
  }, null, 2)}\n`, 'utf8');
  await writeFile(transcriptPath, 'delete bot transcript\n', 'utf8');

  const deleted = await deleteMetabotProfile(systemHomeDir, created.slug);

  assert.equal(deleted.profile.slug, created.slug);
  assert.deepEqual(await listMetabotProfiles(systemHomeDir), []);
  assert.equal(await readActiveMetabotHome(systemHomeDir), null);
  await assert.rejects(() => access(created.homeDir), /ENOENT/);
  await assert.rejects(() => access(sessionPath), /ENOENT/);
  await assert.rejects(() => access(transcriptPath), /ENOENT/);
});

test('deleteMetabotProfile does not let unsafe session ids delete transcripts outside the transcript directory', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Unsafe Delete Bot' });
  const paths = resolveMetabotPaths(created.homeDir);
  const outsideTranscriptPath = path.join(systemHomeDir, 'outside-delete-target.log');
  const unsafeSessionId = path.relative(paths.llmExecutorTranscriptsRoot, outsideTranscriptPath).replace(/\.log$/, '');
  const sessionPath = path.join(paths.llmExecutorSessionsRoot, 'unsafe-delete-bot.json');
  await mkdir(paths.llmExecutorSessionsRoot, { recursive: true });
  await mkdir(paths.llmExecutorTranscriptsRoot, { recursive: true });
  await writeFile(sessionPath, `${JSON.stringify({
    sessionId: unsafeSessionId,
    metaBotSlug: created.slug,
  }, null, 2)}\n`, 'utf8');
  await writeFile(outsideTranscriptPath, 'must stay\n', 'utf8');

  const deleted = await deleteMetabotProfile(systemHomeDir, created.slug);

  assert.equal(deleted.profile.slug, created.slug);
  assert.deepEqual(deleted.removedExecutorSessions, ['unsafe-delete-bot']);
  assert.equal(await readFile(outsideTranscriptPath, 'utf8'), 'must stay\n');
});

test('deleteMetabotProfile keeps the manager record retryable when profile directory removal fails', { skip: process.platform === 'win32' }, async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Retry Delete Bot' });
  const profilesRoot = path.dirname(created.homeDir);
  await chmod(profilesRoot, 0o500);

  try {
    await assert.rejects(() => deleteMetabotProfile(systemHomeDir, created.slug));
  } finally {
    await chmod(profilesRoot, 0o700);
  }

  const stillIndexed = await getMetabotProfile(systemHomeDir, created.slug);
  assert.equal(stillIndexed.slug, created.slug);
  await access(created.homeDir);
});

test('deleteMetabotProfile remains retryable when manager index deletion fails after local data removal', { skip: process.platform === 'win32' }, async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Index Retry Bot' });
  const managerPaths = resolveIdentityManagerPaths(systemHomeDir);
  await chmod(managerPaths.managerRoot, 0o500);

  try {
    await assert.rejects(() => deleteMetabotProfile(systemHomeDir, created.slug));
  } finally {
    await chmod(managerPaths.managerRoot, 0o700);
  }

  const stillIndexed = await getMetabotProfile(systemHomeDir, created.slug);
  assert.equal(stillIndexed.slug, created.slug);
  await assert.rejects(() => access(created.homeDir), /ENOENT/);

  const retry = await deleteMetabotProfile(systemHomeDir, created.slug);
  assert.equal(retry.profile.slug, created.slug);
  assert.deepEqual(await listMetabotProfiles(systemHomeDir), []);
});
