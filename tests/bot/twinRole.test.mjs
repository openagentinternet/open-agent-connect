import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { writeBotRoleInfo, readBotRoleInfo } = require('../../dist/core/bot/botRole.js');
const {
  applyTwinInvariant,
  buildTwinWorkerRoster,
  formatTwinWorkerRosterBlock,
  resolveCurrentTwinSlug,
} = require('../../dist/core/bot/twinRole.js');

async function createTempSystemHome() {
  const base = await mkdtempTempRoot('metabot-twin-test-');
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'profiles'), { recursive: true });
  return base;
}

async function addProfile(systemHomeDir, name, createdAt) {
  await upsertIdentityProfile({
    systemHomeDir,
    name,
    homeDir: path.join(systemHomeDir, '.metabot', 'profiles', name),
    globalMetaId: `gm-${name}`,
    mvcAddress: `mvc-${name}`,
  });
  const profileRoot = path.join(systemHomeDir, '.metabot', 'profiles', name);
  await fs.mkdir(path.join(profileRoot, '.runtime', 'state'), { recursive: true });
  // Backdate the index record so "earliest created" is deterministic.
  const indexPath = path.join(systemHomeDir, '.metabot', 'manager', 'identity-profiles.json');
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  const record = index.profiles.find((profile) => profile.slug === name);
  record.createdAt = createdAt;
  record.updatedAt = createdAt;
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return resolveMetabotPaths(profileRoot);
}

test('promoting a twin demotes the previous twin (at most one per machine)', async () => {
  const base = await createTempSystemHome();
  const pathsA = await addProfile(base, 'alice', 1000);
  const pathsB = await addProfile(base, 'bob', 2000);

  let result = await applyTwinInvariant(base, { preferredTwinSlug: 'alice' });
  assert.equal(result.twinSlug, 'alice');
  assert.equal(result.promoted, 'alice');

  result = await applyTwinInvariant(base, { preferredTwinSlug: 'bob' });
  assert.equal(result.twinSlug, 'bob');
  assert.deepEqual(result.demoted, ['alice']);

  assert.equal((await readBotRoleInfo(pathsA.botRoleStatePath)).botType, 'worker');
  assert.equal((await readBotRoleInfo(pathsB.botRoleStatePath)).botType, 'twin');
  assert.equal(await resolveCurrentTwinSlug(base), 'bob');
});

test('a missing twin is repaired by promoting the earliest-created Bot', async () => {
  const base = await createTempSystemHome();
  await addProfile(base, 'alice', 1000);
  await addProfile(base, 'bob', 2000);
  await addProfile(base, 'carol', 500);

  const result = await applyTwinInvariant(base, {});
  assert.equal(result.twinSlug, 'carol');
  assert.equal(result.promoted, 'carol');
});

test('duplicate twins from out-of-band edits collapse to one', async () => {
  const base = await createTempSystemHome();
  const pathsA = await addProfile(base, 'alice', 1000);
  const pathsB = await addProfile(base, 'bob', 2000);
  await writeBotRoleInfo(pathsA.botRoleStatePath, { botType: 'twin' });
  await writeBotRoleInfo(pathsB.botRoleStatePath, { botType: 'twin' });

  const result = await applyTwinInvariant(base, {});
  assert.ok(result.twinSlug);
  assert.equal(result.demoted.length, 1);
  const types = [
    (await readBotRoleInfo(pathsA.botRoleStatePath)).botType,
    (await readBotRoleInfo(pathsB.botRoleStatePath)).botType,
  ];
  assert.deepEqual(types.sort(), ['twin', 'worker']);
});

test('worker roster is sanitized and renders the roster block', async () => {
  const base = await createTempSystemHome();
  await addProfile(base, 'alice', 1000);
  const pathsB = await addProfile(base, 'bob', 2000);
  await fs.writeFile(resolveMetabotPaths(pathsB.profileRoot).roleMdPath, '代码审查员', 'utf8');
  await applyTwinInvariant(base, { preferredTwinSlug: 'alice' });

  const roster = await buildTwinWorkerRoster(base, 'alice');
  assert.equal(roster.length, 1);
  assert.equal(roster[0].slug, 'bob');
  assert.equal(roster[0].role, '代码审查员');
  assert.equal(roster[0].botType, 'worker');
  assert.equal(roster[0].activeSteps, 0);

  const block = formatTwinWorkerRosterBlock(roster);
  assert.match(block, /## Local Worker Roster/);
  assert.match(block, /bob/);
  assert.match(block, /代码审查员/);
});
