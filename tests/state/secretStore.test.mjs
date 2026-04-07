import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createFileSecretStore } = require('../../dist/core/secrets/fileSecretStore.js');

test('createFileSecretStore round-trips local identity secrets in hot storage', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-secret-store-'));
  const store = createFileSecretStore(homeDir);

  const writtenPath = await store.writeIdentitySecrets({
    mnemonic: 'secret phrase',
    globalMetaId: 'id-secret-1',
  });

  assert.equal(writtenPath, store.paths.secretsPath);
  assert.deepEqual(await store.readIdentitySecrets(), {
    mnemonic: 'secret phrase',
    globalMetaId: 'id-secret-1',
  });
  assert.match(readFileSync(store.paths.secretsPath, 'utf8'), /id-secret-1/);
  assert.equal(store.paths.secretsPath.startsWith(store.paths.hotRoot), true);
  assert.equal(store.paths.secretsPath.startsWith(store.paths.exportRoot), false);
});

test('createFileSecretStore deleteIdentitySecrets removes the hot secret source of truth', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-secret-store-delete-'));
  const store = createFileSecretStore(homeDir);

  await store.writeIdentitySecrets({ mnemonic: 'secret phrase' });
  await store.deleteIdentitySecrets();

  assert.equal(await store.readIdentitySecrets(), null);
});
