import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  listIdentityProfiles,
  readIdentityProfilesState,
  readActiveMetabotHome,
  resolveIdentityManagerPaths,
  setActiveMetabotHome,
  upsertIdentityProfile,
} = require('../../dist/core/identity/identityProfiles.js');

async function createSystemHome() {
  return mkdtemp(path.join(os.tmpdir(), 'metabot-identity-profiles-'));
}

test('profile records persist slug and aliases in the manager index', async () => {
  const systemHome = await createSystemHome();
  const canonicalHome = path.join(systemHome, '.metabot', 'profiles', 'charles-zhang');
  const stored = await upsertIdentityProfile({
    systemHomeDir: systemHome,
    name: 'Charles Zhang',
    homeDir: canonicalHome,
    globalMetaId: 'idq-charles',
    mvcAddress: 'mvc-charles',
    now: () => 1_770_000_000_000,
  });

  assert.equal(stored.slug, 'charles-zhang');
  assert.deepEqual(stored.aliases, ['Charles Zhang', 'charles zhang', 'charles-zhang']);
  assert.equal(
    stored.homeDir,
    canonicalHome,
  );

  const managerPaths = resolveIdentityManagerPaths(systemHome);
  const persisted = JSON.parse(await readFile(managerPaths.profilesPath, 'utf8'));
  assert.deepEqual(persisted.profiles, [stored]);

  const listed = await listIdentityProfiles(systemHome);
  assert.deepEqual(listed, [stored]);
});

test('legacy manager records are normalized and persisted in the v2 profile shape on read', async () => {
  const systemHome = await createSystemHome();
  const managerPaths = resolveIdentityManagerPaths(systemHome);
  const canonicalHome = path.join(systemHome, '.metabot', 'profiles', 'charles-zhang');
  await mkdir(managerPaths.managerRoot, { recursive: true });

  await writeFile(
    managerPaths.profilesPath,
    `${JSON.stringify({
      profiles: [{
        name: 'Charles Zhang',
        homeDir: '/tmp/legacy-charles',
        globalMetaId: 'idq-charles',
        mvcAddress: 'mvc-charles',
        createdAt: 1_770_000_000_000,
        updatedAt: 1_770_000_000_100,
      }],
    }, null, 2)}\n`,
    'utf8',
  );

  const state = await readIdentityProfilesState(systemHome);
  assert.deepEqual(state.profiles, [{
    name: 'Charles Zhang',
    slug: 'charles-zhang',
    aliases: ['Charles Zhang', 'charles zhang', 'charles-zhang'],
    homeDir: canonicalHome,
    globalMetaId: 'idq-charles',
    mvcAddress: 'mvc-charles',
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_100,
  }]);

  const persisted = JSON.parse(await readFile(managerPaths.profilesPath, 'utf8'));
  assert.deepEqual(persisted, state);
});

test('existing profile upserts preserve the stable slug and canonical home when matched by identity fields', async () => {
  const systemHome = await createSystemHome();
  const managerPaths = resolveIdentityManagerPaths(systemHome);
  const canonicalHome = path.join(systemHome, '.metabot', 'profiles', 'charles-zhang');
  await mkdir(managerPaths.managerRoot, { recursive: true });

  await writeFile(
    managerPaths.profilesPath,
    `${JSON.stringify({
      profiles: [{
        name: 'Charles Zhang',
        slug: 'charles-zhang',
        aliases: ['Charles Zhang', 'charles zhang', 'charles-zhang'],
        homeDir: canonicalHome,
        globalMetaId: 'idq-charles',
        mvcAddress: 'mvc-charles',
        createdAt: 1_770_000_000_000,
        updatedAt: 1_770_000_000_100,
      }],
    }, null, 2)}\n`,
    'utf8',
  );

  const updated = await upsertIdentityProfile({
    systemHomeDir: systemHome,
    name: 'Charles Zhang Prime',
    homeDir: path.join(systemHome, '.metabot', 'profiles', 'charles-prime'),
    globalMetaId: 'idq-charles',
    mvcAddress: 'mvc-charles-2',
    now: () => 1_770_000_000_200,
  });

  assert.equal(updated.slug, 'charles-zhang');
  assert.equal(updated.homeDir, canonicalHome);
  assert.equal(updated.name, 'Charles Zhang Prime');
  assert.deepEqual(
    updated.aliases,
    ['Charles Zhang Prime', 'Charles Zhang', 'charles zhang', 'charles-zhang', 'charles zhang prime'],
  );

  const persisted = JSON.parse(await readFile(managerPaths.profilesPath, 'utf8'));
  assert.deepEqual(persisted.profiles, [updated]);
});

test('legacy records with colliding normalized slugs are preserved with deterministic suffixed homes', async () => {
  const systemHome = await createSystemHome();
  const managerPaths = resolveIdentityManagerPaths(systemHome);
  await mkdir(managerPaths.managerRoot, { recursive: true });

  await writeFile(
    managerPaths.profilesPath,
    `${JSON.stringify({
      profiles: [
        {
          name: 'Charles Zhang',
          homeDir: '/tmp/legacy-charles-a',
          globalMetaId: 'idq-charles-a',
          mvcAddress: 'mvc-charles-a',
          createdAt: 1_770_000_000_000,
          updatedAt: 1_770_000_000_100,
        },
        {
          name: 'Charles_Zhang',
          homeDir: '/tmp/legacy-charles-b',
          globalMetaId: 'idq-charles-b',
          mvcAddress: 'mvc-charles-b',
          createdAt: 1_770_000_000_000,
          updatedAt: 1_770_000_000_200,
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );

  const state = await readIdentityProfilesState(systemHome);
  assert.deepEqual(
    state.profiles.map((profile) => ({
      name: profile.name,
      slug: profile.slug,
      homeDir: profile.homeDir,
    })),
    [
      {
        name: 'Charles_Zhang',
        slug: 'charles-zhang',
        homeDir: path.join(systemHome, '.metabot', 'profiles', 'charles-zhang'),
      },
      {
        name: 'Charles Zhang',
        slug: 'charles-zhang-2',
        homeDir: path.join(systemHome, '.metabot', 'profiles', 'charles-zhang-2'),
      },
    ],
  );

  const persisted = JSON.parse(await readFile(managerPaths.profilesPath, 'utf8'));
  assert.equal(persisted.profiles.length, 2);
  assert.deepEqual(
    persisted.profiles.map((profile) => profile.slug),
    ['charles-zhang', 'charles-zhang-2'],
  );
});

test('active-home pointer is ignored when it does not reference an indexed profile', async () => {
  const systemHome = await createSystemHome();
  const canonicalHome = path.join(systemHome, '.metabot', 'profiles', 'charles-zhang');
  await mkdir(path.dirname(canonicalHome), { recursive: true });

  await upsertIdentityProfile({
    systemHomeDir: systemHome,
    name: 'Charles Zhang',
    homeDir: canonicalHome,
    now: () => 1_770_000_000_000,
  });

  await setActiveMetabotHome({
    systemHomeDir: systemHome,
    homeDir: canonicalHome,
    now: () => 1_770_000_000_100,
  });
  assert.equal(await readActiveMetabotHome(systemHome), canonicalHome);

  const managerPaths = resolveIdentityManagerPaths(systemHome);
  await writeFile(
    managerPaths.activeHomePath,
    `${JSON.stringify({ homeDir: path.join(systemHome, '.metabot', 'profiles', 'orphan'), updatedAt: 1 }, null, 2)}\n`,
    'utf8',
  );

  assert.equal(await readActiveMetabotHome(systemHome), null);
});
