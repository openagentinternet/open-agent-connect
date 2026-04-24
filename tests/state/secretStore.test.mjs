import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createFileSecretStore } = require('../../dist/core/secrets/fileSecretStore.js');

function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = mkdtempSync(path.join(tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  mkdirSync(homeDir, { recursive: true });
  return homeDir;
}

test('createFileSecretStore eagerly materializes identity-secrets.json under .runtime', async () => {
  const homeDir = createProfileHome('metabot-secret-store-layout-');
  const store = createFileSecretStore(homeDir);

  await store.ensureLayout();

  assert.equal(store.paths.identitySecretsPath.startsWith(store.paths.runtimeRoot), true);
  assert.equal(store.paths.identitySecretsPath.startsWith(store.paths.exportsRoot), false);
  assert.deepEqual(JSON.parse(readFileSync(store.paths.identitySecretsPath, 'utf8')), {});
  if (process.platform !== 'win32') {
    assert.equal(statSync(store.paths.identitySecretsPath).mode & 0o777, 0o600);
  }
});

test('createFileSecretStore round-trips local identity secrets in profile runtime storage', async () => {
  const homeDir = createProfileHome('metabot-secret-store-');
  const store = createFileSecretStore(homeDir);

  const writtenPath = await store.writeIdentitySecrets({
    mnemonic: 'secret phrase',
    globalMetaId: 'id-secret-1',
  });

  assert.equal(writtenPath, store.paths.identitySecretsPath);
  assert.deepEqual(await store.readIdentitySecrets(), {
    mnemonic: 'secret phrase',
    globalMetaId: 'id-secret-1',
  });
  assert.match(readFileSync(store.paths.identitySecretsPath, 'utf8'), /id-secret-1/);
  assert.equal(store.paths.identitySecretsPath.startsWith(store.paths.runtimeRoot), true);
  assert.equal(store.paths.identitySecretsPath.startsWith(store.paths.exportsRoot), false);
  if (process.platform !== 'win32') {
    assert.equal(statSync(store.paths.identitySecretsPath).mode & 0o777, 0o600);
  }
});

test('createFileSecretStore deleteIdentitySecrets clears the materialized identity secret file', async () => {
  const homeDir = createProfileHome('metabot-secret-store-delete-');
  const store = createFileSecretStore(homeDir);

  await store.writeIdentitySecrets({ mnemonic: 'secret phrase' });
  await store.deleteIdentitySecrets();

  assert.equal(await store.readIdentitySecrets(), null);
  assert.deepEqual(JSON.parse(readFileSync(store.paths.identitySecretsPath, 'utf8')), {});
});
