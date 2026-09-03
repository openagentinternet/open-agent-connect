import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { resolveContactNames } = require('../../dist/core/memory/contactNames.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');

async function createTempProfilePaths() {
  const base = await mkdtempTempRoot('metabot-contact-names-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

async function seedA2APeer(paths, fileName, peer) {
  await fs.mkdir(paths.a2aRoot, { recursive: true });
  await fs.writeFile(
    path.join(paths.a2aRoot, fileName),
    `${JSON.stringify({ peer, messages: [] }, null, 2)}\n`,
    'utf8',
  );
}

test('resolveContactNames prefers the local Bot profile name over the A2A peer name', async () => {
  const paths = await createTempProfilePaths();
  await upsertIdentityProfile({
    systemHomeDir: paths.systemHomeDir,
    name: 'Alice Local',
    homeDir: path.join(paths.systemHomeDir, '.metabot', 'profiles', 'alice'),
    globalMetaId: 'gm-alice',
  });
  await seedA2APeer(paths, 'chat-a2a-alice.json', { globalMetaId: 'gm-alice', name: 'Alice A2A' });

  const names = await resolveContactNames(paths, ['gm-alice']);
  assert.equal(names.get('gm-alice'), 'Alice Local');
});

test('resolveContactNames falls back to the A2A peer name when no local profile matches', async () => {
  const paths = await createTempProfilePaths();
  await seedA2APeer(paths, 'chat-a2a-bob.json', { globalMetaId: 'gm-bob', name: 'Bob' });

  const names = await resolveContactNames(paths, ['gm-bob']);
  assert.equal(names.get('gm-bob'), 'Bob');
});

test('resolveContactNames leaves unknown subjects unresolved and ignores malformed files', async () => {
  const paths = await createTempProfilePaths();
  await fs.mkdir(paths.a2aRoot, { recursive: true });
  await fs.writeFile(path.join(paths.a2aRoot, 'chat-broken.json'), 'not json', 'utf8');
  await seedA2APeer(paths, 'chat-a2a-noname.json', { globalMetaId: 'gm-noname' });

  const names = await resolveContactNames(paths, ['gm-unknown', 'gm-noname']);
  assert.equal(names.size, 0);
});
