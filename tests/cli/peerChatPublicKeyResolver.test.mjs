import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createFileSecretStore } = require('../../dist/core/secrets/fileSecretStore.js');
const { resolvePeerChatPublicKeyFromLocalProfiles } = require('../../dist/cli/runtime.js');

async function createProfile(systemHomeDir, slug, globalMetaId) {
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', slug);
  await mkdir(homeDir, { recursive: true });
  await upsertIdentityProfile({
    systemHomeDir,
    name: slug,
    homeDir,
    globalMetaId,
    mvcAddress: `${slug}-mvc-address`,
    now: () => 1_779_000_000_000,
  });
  return homeDir;
}

test('local profile chat public key resolver reads runtime identity before secrets', async () => {
  const systemHomeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-peer-key-resolver-'));
  const homeDir = await createProfile(systemHomeDir, 'alice', 'idq-alice');

  await createRuntimeStateStore(homeDir).writeState({
    identity: {
      metabotId: 1,
      name: 'alice',
      createdAt: 1_779_000_000_000,
      path: "m/44'/10001'/0'/0/0",
      publicKey: 'alice-public-key',
      chatPublicKey: 'runtime-chat-public-key',
      addresses: { mvc: 'alice-mvc-address' },
      mvcAddress: 'alice-mvc-address',
      metaId: 'alice-meta-id',
      globalMetaId: 'idq-alice',
    },
    services: [],
    traces: [],
    sellerOrders: [],
  });
  await createFileSecretStore(homeDir).writeIdentitySecrets({
    globalMetaId: 'idq-alice',
    chatPublicKey: 'secret-chat-public-key',
  });

  assert.equal(
    await resolvePeerChatPublicKeyFromLocalProfiles(systemHomeDir, 'idq-alice'),
    'runtime-chat-public-key',
  );
});

test('local profile chat public key resolver falls back to identity secrets', async () => {
  const systemHomeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-peer-key-secret-'));
  const homeDir = await createProfile(systemHomeDir, 'bob', 'idq-bob');
  await createFileSecretStore(homeDir).writeIdentitySecrets({
    globalMetaId: 'idq-bob',
    chatPublicKey: 'secret-chat-public-key',
  });

  assert.equal(
    await resolvePeerChatPublicKeyFromLocalProfiles(systemHomeDir, 'idq-bob'),
    'secret-chat-public-key',
  );
  assert.equal(await resolvePeerChatPublicKeyFromLocalProfiles(systemHomeDir, 'idq-missing'), null);
});
