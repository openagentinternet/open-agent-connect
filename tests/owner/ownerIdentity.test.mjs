import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createOwnerIdentity,
  deleteOwnerIdentity,
  ensureOwnerIdentity,
  importOwnerIdentity,
  OwnerIdentityError,
  readOwnerIdentity,
  renameOwnerIdentity,
  resolveOwnerIdfilePath,
  revealOwnerMnemonic,
  toOwnerIdentityPublic,
} = require('../../dist/core/owner/ownerIdentity.js');

async function tempSystemHome() {
  return mkdtempTempRoot('metabot-owner-');
}

test('create writes a 0600 owner identity and read returns it', async () => {
  const systemHomeDir = await tempSystemHome();
  const record = await createOwnerIdentity(systemHomeDir, { name: 'Alice' });
  assert.equal(record.name, 'Alice');
  assert.ok(record.mnemonic.split(/\s+/).length >= 12);
  assert.ok(record.globalMetaId.startsWith('id'));
  assert.ok(record.mvcAddress.length > 0);

  const readBack = await readOwnerIdentity(systemHomeDir);
  assert.equal(readBack.globalMetaId, record.globalMetaId);

  const stat = await fs.stat(resolveOwnerIdfilePath(systemHomeDir));
  if (process.platform !== 'win32') {
    assert.equal(stat.mode & 0o777, 0o600);
  }

  const publicRecord = toOwnerIdentityPublic(record);
  assert.equal(publicRecord.mnemonic, undefined);
  assert.equal(publicRecord.globalMetaId, record.globalMetaId);
});

test('create fails when an owner identity already exists', async () => {
  const systemHomeDir = await tempSystemHome();
  await createOwnerIdentity(systemHomeDir, { name: 'Alice' });
  await assert.rejects(
    () => createOwnerIdentity(systemHomeDir, { name: 'Bob' }),
    (error) => error instanceof OwnerIdentityError && error.code === 'owner_exists',
  );
});

test('import rejects an invalid mnemonic', async () => {
  const systemHomeDir = await tempSystemHome();
  await assert.rejects(
    () => importOwnerIdentity(systemHomeDir, { name: 'Bob', mnemonic: 'not a real mnemonic phrase here' }),
    (error) => error instanceof OwnerIdentityError && error.code === 'invalid_mnemonic',
  );
  assert.equal(await readOwnerIdentity(systemHomeDir), null);
});

test('import of the same mnemonic reproduces the same globalMetaId', async () => {
  const systemHomeDir = await tempSystemHome();
  const created = await createOwnerIdentity(systemHomeDir, { name: 'Alice' });
  const mnemonic = created.mnemonic;
  await deleteOwnerIdentity(systemHomeDir);
  assert.equal(await readOwnerIdentity(systemHomeDir), null);

  const imported = await importOwnerIdentity(systemHomeDir, { name: 'Alice Restored', mnemonic });
  assert.equal(imported.globalMetaId, created.globalMetaId);
  assert.equal(imported.mvcAddress, created.mvcAddress);
  assert.equal(imported.name, 'Alice Restored');
});

test('rename updates the display name and reveal returns the mnemonic', async () => {
  const systemHomeDir = await tempSystemHome();
  const created = await createOwnerIdentity(systemHomeDir, { name: 'Alice' });
  const renamed = await renameOwnerIdentity(systemHomeDir, 'Alicia');
  assert.equal(renamed.name, 'Alicia');
  assert.equal(renamed.globalMetaId, created.globalMetaId);
  assert.equal(await revealOwnerMnemonic(systemHomeDir), created.mnemonic);
});

test('rename and reveal fail when no owner identity exists', async () => {
  const systemHomeDir = await tempSystemHome();
  await assert.rejects(
    () => renameOwnerIdentity(systemHomeDir, 'Nobody'),
    (error) => error instanceof OwnerIdentityError && error.code === 'owner_missing',
  );
  await assert.rejects(
    () => revealOwnerMnemonic(systemHomeDir),
    (error) => error instanceof OwnerIdentityError && error.code === 'owner_missing',
  );
});

test('ensure creates once and then returns the existing identity', async () => {
  const systemHomeDir = await tempSystemHome();
  const first = await ensureOwnerIdentity(systemHomeDir, { name: 'Default' });
  assert.equal(first.name, 'Default');
  const second = await ensureOwnerIdentity(systemHomeDir, { name: 'Something Else' });
  assert.equal(second.globalMetaId, first.globalMetaId);
  assert.equal(second.name, 'Default');
});

test('delete removes the owner identity file', async () => {
  const systemHomeDir = await tempSystemHome();
  await createOwnerIdentity(systemHomeDir, { name: 'Alice' });
  await deleteOwnerIdentity(systemHomeDir);
  assert.equal(await readOwnerIdentity(systemHomeDir), null);
  // Deleting again is a no-op, not an error.
  await deleteOwnerIdentity(systemHomeDir);
});

test('owner identity path lives under ~/.metabot/owner, not manager/', async () => {
  const systemHomeDir = await tempSystemHome();
  const filePath = resolveOwnerIdfilePath(systemHomeDir);
  assert.equal(filePath, path.join(systemHomeDir, '.metabot', 'owner', 'identity.json'));
  assert.ok(!filePath.includes(`${path.sep}manager${path.sep}`));
});
