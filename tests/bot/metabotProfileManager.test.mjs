import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createMetabotProfile,
  deleteMetabotProfile,
  getMetabotProfile,
  getMetabotMnemonicBackup,
  getMetabotWalletInfo,
  listMetabotProfiles,
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
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

const FIXTURE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

async function createSystemHome() {
  return await mkdtemp(path.join(os.tmpdir(), 'oac-metabot-manager-'));
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

test('createMetabotProfile creates a profile workspace with editable persona defaults', async () => {
  const systemHomeDir = await createSystemHome();
  const created = await createMetabotProfile(systemHomeDir, { name: 'Alice Bot' });

  assert.equal(created.name, 'Alice Bot');
  assert.equal(created.slug, 'alice-bot');
  assert.equal(created.role, 'I am a helpful AI assistant.');
  assert.equal(created.soul, 'Friendly and professional.');
  assert.equal(created.goal, 'Help users accomplish their tasks effectively.');
  assert.equal(created.primaryProvider, null);
  assert.equal(created.fallbackProvider, null);

  for (const relativePath of ['ROLE.md', 'SOUL.md', 'GOAL.md', 'llmbindings.json']) {
    const target = path.join(created.homeDir, relativePath);
    const targetStat = await stat(target);
    assert.equal(targetStat.isFile(), true, `${relativePath} should be created`);
  }

  const profiles = await listMetabotProfiles(systemHomeDir);
  assert.deepEqual(profiles.map((profile) => profile.slug), ['alice-bot']);
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
  assert.equal(await readFile(paths.roleMdPath, 'utf8'), 'I am a helpful AI assistant.\n');
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

test('syncMetabotInfoToChain writes name, avatar, and bio pins in chain-first order', async () => {
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
    homeDir: '/tmp/alice',
    globalMetaId: 'gid',
    mvcAddress: 'addr',
    createdAt: 1,
    updatedAt: 2,
    role: 'Role',
    soul: 'Soul',
    goal: 'Goal',
    avatarDataUrl: 'data:image/png;base64,ZmFrZQ==',
    primaryProvider: 'claude-code',
    fallbackProvider: 'codex',
  }, ['name', 'avatar', 'role', 'primaryProvider'], { delayMs: 0 });

  assert.deepEqual(calls.map((call) => call.path), ['/info/name', '/info/avatar', '/info/bio']);
  assert.deepEqual(calls.map((call) => call.operation), ['modify', 'modify', 'modify']);
  assert.equal(calls[1].contentType, 'image/png');
  assert.equal(JSON.parse(calls[2].payload).primaryProvider, 'claude-code');
  assert.equal(results.length, 3);
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
    role: '',
    soul: '',
    goal: '',
    primaryProvider: null,
    fallbackProvider: null,
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
    mvcAddress: 'mvc-secret-address',
    btcAddress: 'btc-secret-address',
    globalMetaId: 'gm-wallet-bot',
  });

  const wallet = await getMetabotWalletInfo(systemHomeDir, created.slug);
  const backup = await getMetabotMnemonicBackup(systemHomeDir, created.slug);

  assert.equal(wallet.slug, created.slug);
  assert.equal(wallet.name, 'Wallet Bot');
  assert.deepEqual(wallet.addresses, {
    mvc: 'mvc-secret-address',
    btc: 'btc-secret-address',
  });
  assert.deepEqual(backup.words, FIXTURE_MNEMONIC.split(' '));
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
