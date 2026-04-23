import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { getDefaultDaemonPort } = require('../../dist/cli/runtime.js');
const { resolveMetabotHomeSelection } = require('../../dist/core/state/homeSelection.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createProviderPresenceStateStore } = require('../../dist/core/provider/providerPresenceState.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createLocalEvolutionStore } = require('../../dist/core/evolution/localEvolutionStore.js');
const { createRemoteEvolutionStore } = require('../../dist/core/evolution/remoteEvolutionStore.js');

const NETWORK_DIRECTORY_SCOPE_HASH = JSON.stringify({
  allowedCommands: [
    'metabot network services --online',
    'metabot ui open --page hub',
  ],
  chainRead: true,
  chainWrite: false,
  localUiOpen: true,
  remoteDelegation: false,
});

function parseLastJson(chunks) {
  return JSON.parse(chunks.join('').trim());
}

function deriveSystemHome(homeDir) {
  const normalizedHomeDir = path.resolve(homeDir);
  const profilesRoot = path.dirname(normalizedHomeDir);
  const metabotRoot = path.dirname(profilesRoot);
  if (path.basename(profilesRoot) === 'profiles' && path.basename(metabotRoot) === '.metabot') {
    return path.dirname(metabotRoot);
  }
  return normalizedHomeDir;
}

async function createProfileHome(systemHome, slug = 'test-profile') {
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  await mkdir(homeDir, { recursive: true });
  return homeDir;
}

async function createProfileHomeTemp(prefix, slug = 'test-profile') {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), prefix || 'metabot-cli-runtime-'));
  return createProfileHome(systemHome, slug);
}

function runtimePath(homeDir, ...segments) {
  return path.join(homeDir, '.runtime', ...segments);
}

function metabotPaths(homeDir) {
  return resolveMetabotPaths(homeDir);
}

async function ensureIndexedProfileHome(homeDir) {
  const systemHome = deriveSystemHome(homeDir);
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  const profilesPath = path.join(managerRoot, 'identity-profiles.json');
  const activeHomePath = path.join(managerRoot, 'active-home.json');
  await mkdir(managerRoot, { recursive: true });

  let profilesState = { profiles: [] };
  try {
    profilesState = JSON.parse(await readFile(profilesPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const normalizedHomeDir = path.resolve(homeDir);
  const existingProfiles = Array.isArray(profilesState?.profiles) ? profilesState.profiles : [];
  if (!existingProfiles.some((profile) => path.resolve(profile.homeDir) === normalizedHomeDir)) {
    existingProfiles.push({
      name: path.basename(normalizedHomeDir),
      homeDir: normalizedHomeDir,
      globalMetaId: '',
      mvcAddress: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await writeFile(profilesPath, `${JSON.stringify({ profiles: existingProfiles }, null, 2)}\n`, 'utf8');
  }

  await writeFile(
    activeHomePath,
    `${JSON.stringify({ homeDir: normalizedHomeDir, updatedAt: Date.now() }, null, 2)}\n`,
    'utf8',
  );
}

async function runCommand(homeDir, args, envOverrides = {}) {
  await ensureIndexedProfileHome(homeDir);
  const stdout = [];
  const stderr = [];
  const env = {
    ...process.env,
    HOME: deriveSystemHome(homeDir),
    METABOT_HOME: homeDir,
    METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    METABOT_TEST_FAKE_SUBSIDY: '1',
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
    ...envOverrides,
  };

  const exitCode = await runCli(args, {
    env,
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
  });

  return {
    exitCode,
    stdout,
    stderr,
    payload: parseLastJson(stdout),
  };
}

async function runCommandWithEnv(cwd, args, envOverrides = {}) {
  const stdout = [];
  const stderr = [];
  const env = {
    ...process.env,
    METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    METABOT_TEST_FAKE_SUBSIDY: '1',
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
    ...envOverrides,
  };

  const exitCode = await runCli(args, {
    env,
    cwd,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
  });

  return {
    exitCode,
    stdout,
    stderr,
    payload: parseLastJson(stdout),
  };
}

async function runCommandText(homeDir, args, envOverrides = {}) {
  await ensureIndexedProfileHome(homeDir);
  const stdout = [];
  const stderr = [];
  const env = {
    ...process.env,
    HOME: deriveSystemHome(homeDir),
    METABOT_HOME: homeDir,
    METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    METABOT_TEST_FAKE_SUBSIDY: '1',
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
    ...envOverrides,
  };

  const exitCode = await runCli(args, {
    env,
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
  });

  return {
    exitCode,
    stdout: stdout.join(''),
    stderr: stderr.join(''),
  };
}

function createImportedArtifactFixture(overrides = {}) {
  const variantId = overrides.variantId ?? 'variant-remote-1';
  const skillName = overrides.skillName ?? 'metabot-network-directory';
  const instructionsPatch = overrides.instructionsPatch
    ?? 'Prefer deterministic provider ordering when listing online services.';
  return {
    artifact: {
      variantId,
      skillName,
      status: 'inactive',
      scope: {
        allowedCommands: [
          'metabot network services --online',
          'metabot ui open --page hub',
        ],
        chainRead: true,
        chainWrite: false,
        localUiOpen: true,
        remoteDelegation: false,
      },
      metadata: {
        sameSkill: true,
        sameScope: true,
        scopeHash: NETWORK_DIRECTORY_SCOPE_HASH,
      },
      patch: {
        instructionsPatch,
      },
      lineage: {
        lineageId: `lineage-${variantId}`,
        parentVariantId: null,
        rootVariantId: variantId,
        executionId: `execution-${variantId}`,
        analysisId: `analysis-${variantId}`,
        createdAt: 1_760_000_000_000,
      },
      verification: {
        passed: true,
        checkedAt: 1_760_000_004_000,
        protocolCompatible: true,
        replayValid: true,
        notWorseThanBase: true,
        notes: 'remote fixture verification',
      },
      adoption: 'manual',
      createdAt: 1_760_000_001_000,
      updatedAt: 1_760_000_002_000,
    },
    sidecar: {
      pinId: overrides.pinId ?? `pin-${variantId}`,
      variantId,
      publisherGlobalMetaId: overrides.publisherGlobalMetaId ?? 'idqprovider',
      artifactUri: overrides.artifactUri ?? `metafile:///${variantId}.json`,
      skillName,
      scopeHash: NETWORK_DIRECTORY_SCOPE_HASH,
      publishedAt: 1_760_000_003_000,
      importedAt: 1_760_000_004_500,
    },
  };
}

async function startFakeChainApiServer(options = {}) {
  const ratingPins = Array.isArray(options.ratingPins) ? options.ratingPins : [];
  const evolutionMetadataPinId = 'evolution-metadata-pin-1';
  const evolutionArtifactPinId = 'evolution-artifact-pin-1';
  const evolutionScopeHash = JSON.stringify({
    allowedCommands: [
      'metabot network services --online',
      'metabot ui open --page hub',
    ],
    chainRead: true,
    chainWrite: false,
    localUiOpen: true,
    remoteDelegation: false,
  });
  const evolutionMetadata = {
    protocolVersion: '1',
    skillName: 'metabot-network-directory',
    variantId: 'variant-remote-1',
    artifactUri: `metafile://${evolutionArtifactPinId}`,
    evolutionType: 'FIX',
    triggerSource: 'hard_failure',
    scopeHash: evolutionScopeHash,
    sameSkill: true,
    sameScope: true,
    verificationPassed: true,
    replayValid: true,
    notWorseThanBase: true,
    lineage: {
      lineageId: 'lineage-remote-1',
      parentVariantId: null,
      rootVariantId: 'variant-remote-1',
      executionId: 'execution-remote-1',
      analysisId: 'analysis-remote-1',
      createdAt: 1_760_000_000_000,
    },
    publisherGlobalMetaId: 'idqprovider',
    artifactCreatedAt: 1_760_000_001_000,
    artifactUpdatedAt: 1_760_000_002_000,
    publishedAt: 1_760_000_003_000,
  };
  const evolutionArtifactBody = {
    variantId: 'variant-remote-1',
    skillName: 'metabot-network-directory',
    scope: {
      allowedCommands: [
        'metabot network services --online',
        'metabot ui open --page hub',
      ],
      chainRead: true,
      chainWrite: false,
      localUiOpen: true,
      remoteDelegation: false,
    },
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash: evolutionScopeHash,
    },
    patch: {
      instructionsPatch: 'Prefer deterministic provider ordering when listing online services.',
    },
    lineage: {
      lineageId: 'lineage-remote-1',
      parentVariantId: null,
      rootVariantId: 'variant-remote-1',
      executionId: 'execution-remote-1',
      analysisId: 'analysis-remote-1',
      createdAt: 1_760_000_000_000,
    },
    verification: {
      passed: true,
      checkedAt: 1_760_000_004_000,
      protocolCompatible: true,
      replayValid: true,
      notWorseThanBase: true,
      notes: 'remote fixture verification',
    },
    createdAt: 1_760_000_001_000,
    updatedAt: 1_760_000_002_000,
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const nowSec = Math.floor(Date.now() / 1000);
    let payload = null;

    if (url.pathname === '/pin/path/list') {
      const pathFilter = url.searchParams.get('path');
      if (pathFilter === '/protocols/skill-service-rate') {
        payload = {
          data: {
            list: ratingPins,
            nextCursor: null,
          },
        };
      } else if (pathFilter === '/protocols/metabot-evolution-artifact-v1') {
        payload = {
          data: {
            list: [
              {
                id: evolutionMetadataPinId,
                metaid: 'metaid-evolution-provider',
                address: 'mvc-evolution-provider-address',
                timestamp: nowSec,
                status: 0,
                operation: 'create',
                path: '/protocols/metabot-evolution-artifact-v1',
                contentSummary: evolutionMetadata,
              },
            ],
            nextCursor: null,
          },
        };
      } else {
        payload = {
          data: {
            list: [
                {
                  id: 'chain-service-pin-1',
                  metaid: 'metaid-provider',
                  address: 'mvc-provider-address',
                  timestamp: nowSec,
                  status: 0,
                  operation: 'create',
                  path: '/protocols/skill-service',
                  contentSummary: JSON.stringify({
                  serviceName: 'weather-oracle',
                  displayName: 'Weather Oracle',
                  description: 'Returns tomorrow weather.',
                  providerMetaBot: 'idq1provider',
                  providerSkill: 'metabot-weather-oracle',
                  price: '0.00001',
                  currency: 'SPACE',
                  skillDocument: '# Weather Oracle',
                  inputType: 'text',
                  outputType: 'text',
                  endpoint: 'simplemsg',
                  paymentAddress: 'mvc-payment-address',
                }),
              },
            ],
            nextCursor: null,
          },
        };
      }
    } else if (url.pathname === '/address/pin/list/mvc-provider-address') {
      payload = {
        data: {
          list: [
            {
              seenTime: nowSec - 30,
            },
          ],
        },
      };
    } else if (url.pathname === `/pin/${evolutionMetadataPinId}`) {
      payload = {
        data: {
          id: evolutionMetadataPinId,
          contentSummary: evolutionMetadata,
        },
      };
    } else if (url.pathname === `/content/${evolutionArtifactPinId}`) {
      payload = {
        data: {
          content: JSON.stringify(evolutionArtifactBody),
        },
      };
    }

    if (payload == null) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP fake chain server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function startFakeSocketPresenceApiServer(options = {}) {
  const users = Array.isArray(options.users) ? options.users : [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/group-chat/socket/online-users') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 404, message: 'not_found' }));
      return;
    }

    const requestedSize = Number.parseInt(url.searchParams.get('size') ?? '', 10);
    const size = Number.isFinite(requestedSize) && requestedSize > 0 ? requestedSize : 10;
    const payload = {
      code: 0,
      data: {
        total: users.length,
        cursor: 0,
        size,
        onlineWindowSeconds: 1200,
        list: users.slice(0, size),
      },
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP fake socket presence server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function stopDaemon(homeDir) {
  const daemonStatePath = runtimePath(homeDir, 'daemon.json');

  let daemonState;
  try {
    daemonState = JSON.parse(await readFile(daemonStatePath, 'utf8'));
  } catch (error) {
    const code = error?.code;
    if (code === 'ENOENT') {
      return;
    }
    throw error;
  }

  if (Number.isFinite(daemonState.pid)) {
    try {
      process.kill(Number(daemonState.pid), 'SIGTERM');
    } catch (error) {
      const code = error?.code;
      if (code !== 'ESRCH') {
        throw error;
      }
    }
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await readFile(daemonStatePath, 'utf8');
    } catch (error) {
      const code = error?.code;
      if (code === 'ENOENT') {
        return;
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  await rm(daemonStatePath, { force: true });
}

async function writeDirectorySeeds(homeDir, providers) {
  const seedsPath = metabotPaths(homeDir).directorySeedsPath;
  await mkdir(path.dirname(seedsPath), { recursive: true });
  await writeFile(seedsPath, JSON.stringify({ providers }, null, 2), 'utf8');
  return seedsPath;
}

async function fetchJson(baseUrl, routePath, options = {}) {
  const response = await fetch(`${baseUrl}${routePath}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    payload: await response.json(),
  };
}

test('runtime home selection rejects METABOT_HOME paths outside the v2 profiles root', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));

  assert.throws(
    () => resolveMetabotHomeSelection({
      env: {
        HOME: systemHome,
        METABOT_HOME: '/tmp/arbitrary-dir',
      },
      cwd: systemHome,
    }),
    /METABOT_HOME.*\.metabot\/profiles\//i
  );
});

test('runtime home selection rejects METABOT_HOME pointed at the raw system home', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));

  assert.throws(
    () => resolveMetabotHomeSelection({
      env: {
        HOME: systemHome,
        METABOT_HOME: systemHome,
      },
      cwd: systemHome,
    }),
    /METABOT_HOME.*\.metabot\/profiles\//i
  );
});

test('runtime home selection rejects an unindexed orphan METABOT_HOME for existing-profile operations', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const orphanHome = await createProfileHome(systemHome, 'orphan-profile');

  assert.throws(
    () => resolveMetabotHomeSelection({
      env: {
        HOME: systemHome,
        METABOT_HOME: orphanHome,
      },
      cwd: systemHome,
    }),
    /manager-indexed profile|unindexed profile/i
  );
});

test('runtime home selection rejects a legacy-only .metabot hot layout', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  await mkdir(path.join(systemHome, '.metabot', 'hot'), { recursive: true });

  assert.throws(
    () => resolveMetabotHomeSelection({
      env: {
        HOME: systemHome,
      },
      cwd: systemHome,
    }),
    /legacy.*\.metabot\/hot|clean.*reinitialized/i
  );
});

test('runtime home selection reports no active profile initialized instead of falling back to raw HOME', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));

  assert.throws(
    () => resolveMetabotHomeSelection({
      env: {
        HOME: systemHome,
      },
      cwd: systemHome,
    }),
    /no active profile initialized/i
  );
});

test('identity create autostarts the local daemon and doctor reports the identity as loaded', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);

  assert.equal(created.exitCode, 0);
  assert.equal(created.payload.ok, true);
  assert.equal(created.payload.data.name, 'Alice');
  assert.match(created.payload.data.globalMetaId, /^id/);
  assert.equal(created.payload.data.subsidyState, 'claimed');
  assert.equal(created.payload.data.syncState, 'synced');
  assert.match(created.payload.data.namePinId, /^\/info\/name-pin-/);
  assert.match(created.payload.data.chatPublicKeyPinId, /^\/info\/chatpubkey-pin-/);

  const doctor = await runCommand(homeDir, ['doctor']);

  assert.equal(doctor.exitCode, 0);
  assert.equal(doctor.payload.ok, true);
  assert.equal(
    doctor.payload.data.checks.some((check) => check.code === 'identity_loaded' && check.ok === true),
    true
  );

  const daemonState = JSON.parse(await readFile(runtimePath(homeDir, 'daemon.json'), 'utf8'));
  assert.match(daemonState.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(Number.isInteger(daemonState.pid), true);
});

test('identity create returns identity_name_conflict when an active identity with a different name already exists', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Bob']);
  assert.equal(created.exitCode, 0);
  assert.equal(created.payload.ok, true);
  assert.equal(created.payload.data.name, 'Bob');

  const conflict = await runCommand(homeDir, ['identity', 'create', '--name', 'Charles']);
  assert.equal(conflict.exitCode, 1);
  assert.equal(conflict.payload.ok, false);
  assert.equal(conflict.payload.code, 'identity_name_conflict');

  const state = JSON.parse(
    await readFile(runtimePath(homeDir, 'runtime-state.json'), 'utf8')
  );
  assert.equal(state.identity.name, 'Bob');
});

test('identity list/assign/who supports switching active local bot home across registered profiles', async (t) => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const bobHome = path.join(systemHome, '.metabot', 'profiles', 'bob-home');
  const charlesHome = path.join(systemHome, '.metabot', 'profiles', 'charles-home');
  await mkdir(bobHome, { recursive: true });
  await mkdir(charlesHome, { recursive: true });

  t.after(async () => stopDaemon(bobHome));
  t.after(async () => stopDaemon(charlesHome));

  const commonEnv = {
    HOME: systemHome,
  };

  const createdBob = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'Bob'], {
    ...commonEnv,
    METABOT_HOME: bobHome,
  });
  assert.equal(createdBob.exitCode, 0);
  assert.equal(createdBob.payload.ok, true);
  assert.equal(createdBob.payload.data.name, 'Bob');

  const createdCharles = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'Charles'], {
    ...commonEnv,
    METABOT_HOME: charlesHome,
  });
  assert.equal(createdCharles.exitCode, 0);
  assert.equal(createdCharles.payload.ok, true);
  assert.equal(createdCharles.payload.data.name, 'Charles');

  const listed = await runCommandWithEnv(systemHome, ['identity', 'list'], commonEnv);
  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(Array.isArray(listed.payload.data.profiles), true);
  assert.equal(listed.payload.data.profiles.some((profile) => profile.name === 'Bob'), true);
  assert.equal(listed.payload.data.profiles.some((profile) => profile.name === 'Charles'), true);
  assert.equal(listed.payload.data.activeHomeDir, charlesHome);

  const assignedBob = await runCommandWithEnv(systemHome, ['identity', 'assign', '--name', 'Bob'], commonEnv);
  assert.equal(assignedBob.exitCode, 0);
  assert.equal(assignedBob.payload.ok, true);
  assert.equal(assignedBob.payload.data.activeHomeDir, bobHome);

  const who = await runCommandWithEnv(systemHome, ['identity', 'who'], commonEnv);
  assert.equal(who.exitCode, 0);
  assert.equal(who.payload.ok, true);
  assert.equal(who.payload.data.identity.name, 'Bob');
  assert.equal(who.payload.data.activeHomeDir, bobHome);
});

test('identity assign resolves a slugged profile from a human display name', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  const canonicalHome = path.join(systemHome, '.metabot', 'profiles', 'charles-zhang');
  await mkdir(canonicalHome, { recursive: true });
  await mkdir(managerRoot, { recursive: true });

  await writeFile(
    path.join(managerRoot, 'identity-profiles.json'),
    `${JSON.stringify({
      profiles: [{
        name: 'Charles Zhang',
        slug: 'charles-zhang',
        aliases: ['Charles Zhang', 'charles zhang', 'charles-zhang'],
        homeDir: canonicalHome,
        globalMetaId: '',
        mvcAddress: '',
        createdAt: 1,
        updatedAt: 1,
      }],
    }, null, 2)}\n`,
    'utf8',
  );

  const assigned = await runCommandWithEnv(systemHome, ['identity', 'assign', '--name', 'Charles Zhang'], {
    HOME: systemHome,
  });

  assert.equal(assigned.exitCode, 0);
  assert.equal(assigned.payload.ok, true);
  assert.equal(assigned.payload.data.activeHomeDir, canonicalHome);
  assert.equal(assigned.payload.data.assignedProfile.slug, 'charles-zhang');
});

test('identity assign rejects ambiguous near-tied profile matches', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  const zhangHome = path.join(systemHome, '.metabot', 'profiles', 'charles-zhang');
  const zhaoHome = path.join(systemHome, '.metabot', 'profiles', 'charles-zhao');
  await mkdir(zhangHome, { recursive: true });
  await mkdir(zhaoHome, { recursive: true });
  await mkdir(managerRoot, { recursive: true });

  await writeFile(
    path.join(managerRoot, 'identity-profiles.json'),
    `${JSON.stringify({
      profiles: [
        {
          name: 'Charles Zhang',
          slug: 'charles-zhang',
          aliases: ['Charles Zhang', 'charles zhang', 'charles-zhang'],
          homeDir: zhangHome,
          globalMetaId: '',
          mvcAddress: '',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          name: 'Charles Zhao',
          slug: 'charles-zhao',
          aliases: ['Charles Zhao', 'charles zhao', 'charles-zhao'],
          homeDir: zhaoHome,
          globalMetaId: '',
          mvcAddress: '',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );

  const assigned = await runCommandWithEnv(systemHome, ['identity', 'assign', '--name', 'Charles Zh'], {
    HOME: systemHome,
  });

  assert.equal(assigned.exitCode, 1);
  assert.equal(assigned.payload.ok, false);
  assert.equal(assigned.payload.code, 'identity_profile_ambiguous');
  assert.match(assigned.payload.message, /ambiguous/i);
  assert.match(assigned.payload.message, /Charles Zhang/i);
  assert.match(assigned.payload.message, /Charles Zhao/i);
});

test('identity create rejects duplicate names across different local homes on the same machine', async (t) => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const firstHome = path.join(systemHome, '.metabot', 'profiles', 'david-home-a');
  const secondHome = path.join(systemHome, '.metabot', 'profiles', 'david-home-b');
  await mkdir(firstHome, { recursive: true });
  await mkdir(secondHome, { recursive: true });

  t.after(async () => stopDaemon(firstHome));
  t.after(async () => stopDaemon(secondHome));

  const commonEnv = {
    HOME: systemHome,
  };

  const createdFirst = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'David'], {
    ...commonEnv,
    METABOT_HOME: firstHome,
  });
  assert.equal(createdFirst.exitCode, 0);
  assert.equal(createdFirst.payload.ok, true);
  assert.equal(createdFirst.payload.data.name, 'David');

  const duplicateAttempt = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'David'], {
    ...commonEnv,
    METABOT_HOME: secondHome,
  });
  assert.equal(duplicateAttempt.exitCode, 1);
  assert.equal(duplicateAttempt.payload.ok, false);
  assert.equal(duplicateAttempt.payload.code, 'identity_name_taken');

  const whoSecondHome = await runCommandWithEnv(systemHome, ['identity', 'who'], {
    ...commonEnv,
    METABOT_HOME: secondHome,
  });
  assert.equal(whoSecondHome.exitCode, 1);
  assert.equal(whoSecondHome.payload.code, 'cli_execution_failed');
  assert.match(whoSecondHome.payload.message, /manager-indexed profile|unindexed profile/i);
});

test('daemon config restarts keep the previous port so local inspector URLs stay stable', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice'], {
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
  });
  assert.equal(created.exitCode, 0);

  const firstDaemonState = JSON.parse(
    await readFile(runtimePath(homeDir, 'daemon.json'), 'utf8')
  );
  const firstPort = new URL(firstDaemonState.baseUrl).port;

  const doctor = await runCommand(homeDir, ['doctor'], {
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:10',
  });
  assert.equal(doctor.exitCode, 0);
  assert.equal(doctor.payload.ok, true);

  const secondDaemonState = JSON.parse(
    await readFile(runtimePath(homeDir, 'daemon.json'), 'utf8')
  );
  const secondPort = new URL(secondDaemonState.baseUrl).port;

  assert.equal(secondPort, firstPort);
  assert.notEqual(secondDaemonState.configHash, firstDaemonState.configHash);
});

test('getDefaultDaemonPort is stable per home and avoids a single shared default port', () => {
  const firstHome = '/tmp/metabot-home-a';
  const secondHome = '/tmp/metabot-home-b';

  const firstPort = getDefaultDaemonPort(firstHome);
  const repeatedFirstPort = getDefaultDaemonPort(firstHome);
  const secondPort = getDefaultDaemonPort(secondHome);

  assert.equal(firstPort, repeatedFirstPort);
  assert.notEqual(firstPort, secondPort);
  assert.equal(firstPort >= 24000 && firstPort < 44000, true);
  assert.equal(secondPort >= 24000 && secondPort < 44000, true);
});

test('fresh daemon starts for the same home reuse the home-derived port', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const firstStart = await runCommand(homeDir, ['daemon', 'start']);
  assert.equal(firstStart.exitCode, 0);
  const firstPort = new URL(firstStart.payload.data.baseUrl).port;

  await stopDaemon(homeDir);

  const secondStart = await runCommand(homeDir, ['daemon', 'start']);
  assert.equal(secondStart.exitCode, 0);
  const secondPort = new URL(secondStart.payload.data.baseUrl).port;

  assert.equal(firstPort, secondPort);
  assert.equal(firstPort, String(getDefaultDaemonPort(homeDir)));
});

test('daemon start writes a provider heartbeat when provider presence is enabled', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  await stopDaemon(homeDir);
  const presenceStore = createProviderPresenceStateStore(homeDir);
  await presenceStore.write({
    enabled: true,
    lastHeartbeatAt: null,
    lastHeartbeatPinId: null,
    lastHeartbeatTxid: null,
  });

  const started = await runCommand(homeDir, ['daemon', 'start']);
  assert.equal(started.exitCode, 0);
  assert.equal(started.payload.ok, true);

  let presenceState = await presenceStore.read();
  for (let attempt = 0; attempt < 30 && !presenceState.lastHeartbeatPinId; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    presenceState = await presenceStore.read();
  }

  assert.equal(presenceState.enabled, true);
  assert.match(presenceState.lastHeartbeatPinId, /^\/protocols\/metabot-heartbeat-pin-/);
  assert.match(presenceState.lastHeartbeatTxid, /^\/protocols\/metabot-heartbeat-tx-/);
  assert.equal(Number.isFinite(presenceState.lastHeartbeatAt), true);
});

test('ui open trace returns a local trace inspector url with the requested trace id', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['ui', 'open', '--page', 'trace', '--trace-id', 'trace-123']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  assert.equal(opened.payload.data.page, 'trace');
  assert.match(opened.payload.data.localUiUrl, /\/ui\/trace\?traceId=trace-123$/);
});

test('ui open buzz returns the bundled Buzz entry html url', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['ui', 'open', '--page', 'buzz']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  assert.equal(opened.payload.data.page, 'buzz');
  assert.match(opened.payload.data.localUiUrl, /\/ui\/buzz\/app\/index\.html$/);
});

test('ui open chat returns the bundled Chat entry html url', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['ui', 'open', '--page', 'chat']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  assert.equal(opened.payload.data.page, 'chat');
  assert.match(opened.payload.data.localUiUrl, /\/ui\/chat\/app\/chat\.html$/);
});

test('buzz post succeeds immediately after bootstrap identity create', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'buzz-request.json');
  await writeFile(requestFile, JSON.stringify({
    content: 'hello from the first metabot buzz',
  }), 'utf8');

  const posted = await runCommand(homeDir, ['buzz', 'post', '--request-file', requestFile]);

  assert.equal(posted.exitCode, 0);
  assert.equal(posted.payload.ok, true);
  assert.equal(posted.payload.data.content, 'hello from the first metabot buzz');
  assert.equal(posted.payload.data.globalMetaId, created.payload.data.globalMetaId);
  assert.match(posted.payload.data.pinId, /^\/protocols\/simplebuzz-pin-/);
  assert.match(posted.payload.data.localUiUrl, /\/ui\/buzz\/app\/index\.html(?:\?|$)/);

  const buzzViewResponse = await fetch(posted.payload.data.localUiUrl);
  const buzzViewHtml = await buzzViewResponse.text();

  assert.equal(buzzViewResponse.status, 200);
  assert.match(buzzViewResponse.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(buzzViewHtml, /IDFramework - Buzz Feed Demo/);
});

test('services publish persists a local directory entry that network services --online can read back', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const payloadFile = path.join(homeDir, 'payload.json');
  await writeFile(payloadFile, JSON.stringify({
    serviceName: 'weather-oracle',
    displayName: 'Weather Oracle',
    description: 'Returns tomorrow weather from the local connected-agent runtime.',
    providerSkill: 'metabot-weather-oracle',
    price: '0.00001',
    currency: 'SPACE',
    outputType: 'text',
    skillDocument: '# Weather Oracle',
  }), 'utf8');

  const published = await runCommand(homeDir, ['services', 'publish', '--payload-file', payloadFile]);

  assert.equal(published.exitCode, 0);
  assert.equal(published.payload.ok, true);
  assert.equal(published.payload.data.displayName, 'Weather Oracle');
  assert.equal(published.payload.data.providerGlobalMetaId, created.payload.data.globalMetaId);
  assert.match(published.payload.data.servicePinId, /^\/protocols\/skill-service-pin-/);
  assert.equal(published.payload.data.sourceServicePinId, published.payload.data.servicePinId);
  assert.equal(
    published.payload.data.chainPinIds.includes(published.payload.data.servicePinId),
    true
  );

  const listed = await runCommand(homeDir, ['network', 'services', '--online']);

  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(Array.isArray(listed.payload.data.services), true);
  assert.equal(listed.payload.data.services.length, 1);
  assert.equal(listed.payload.data.services[0].servicePinId, published.payload.data.servicePinId);
  assert.equal(listed.payload.data.services[0].displayName, 'Weather Oracle');
  assert.equal(listed.payload.data.services[0].online, true);
  assert.equal(listed.payload.data.services[0].providerGlobalMetaId, created.payload.data.globalMetaId);
});

test('services call with providerDaemonBaseUrl rejects a provider that is offline in socket presence', async (t) => {
  const callerHome = await createProfileHomeTemp('', 'caller-profile');
  const providerHome = await createProfileHomeTemp('', 'provider-profile');
  const socketPresenceApi = await startFakeSocketPresenceApiServer({ users: [] });
  const providerEnv = { METABOT_SOCKET_PRESENCE_API_BASE_URL: socketPresenceApi.baseUrl };
  t.after(async () => stopDaemon(callerHome));
  t.after(async () => stopDaemon(providerHome));
  t.after(async () => socketPresenceApi.close());

  const providerIdentity = await runCommand(
    providerHome,
    ['identity', 'create', '--name', 'Tarot Provider'],
    providerEnv
  );
  assert.equal(providerIdentity.exitCode, 0);

  const publishFile = path.join(providerHome, 'provider-offline-payload.json');
  await writeFile(publishFile, JSON.stringify({
    serviceName: 'tarot-rws-service',
    displayName: 'Tarot Reading',
    description: 'Reads one tarot card.',
    providerSkill: 'tarot-rws',
    price: '0.00001',
    currency: 'SPACE',
    outputType: 'text',
    skillDocument: '# Tarot Reading',
  }), 'utf8');

  const published = await runCommand(providerHome, ['services', 'publish', '--payload-file', publishFile], providerEnv);
  assert.equal(published.exitCode, 0);
  assert.equal(published.payload.ok, true);

  const providerDaemon = await runCommand(
    providerHome,
    ['daemon', 'start'],
    providerEnv
  );
  assert.equal(providerDaemon.exitCode, 0);
  assert.equal(providerDaemon.payload.ok, true);

  const providerOnlineDirectory = await fetchJson(
    providerDaemon.payload.data.baseUrl,
    '/api/network/services?online=true'
  );
  assert.equal(providerOnlineDirectory.status, 200);
  assert.equal(providerOnlineDirectory.payload.ok, true);
  assert.equal(providerOnlineDirectory.payload.data.services.length, 0);

  const callerIdentity = await runCommand(callerHome, ['identity', 'create', '--name', 'Caller Bot']);
  assert.equal(callerIdentity.exitCode, 0);

  const requestFile = path.join(callerHome, 'provider-offline-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: published.payload.data.servicePinId,
      providerGlobalMetaId: providerIdentity.payload.data.globalMetaId,
      providerDaemonBaseUrl: providerDaemon.payload.data.baseUrl,
      userTask: 'Do one tarot reading',
      taskContext: 'Offline provider gate coverage',
    },
  }), 'utf8');

  const called = await runCommand(callerHome, ['services', 'call', '--request-file', requestFile]);
  assert.equal(called.exitCode, 1);
  assert.equal(called.payload.ok, false);
  assert.equal(called.payload.code, 'service_offline');
});

test('provider closure runtime can publish, go online, receive a seller trace, and surface a manual refund queue item', async (t) => {
  const callerHome = await createProfileHomeTemp('', 'caller-profile');
  const providerHome = await createProfileHomeTemp('', 'provider-profile');
  t.after(async () => stopDaemon(callerHome));
  t.after(async () => stopDaemon(providerHome));

  const providerIdentity = await runCommand(providerHome, ['identity', 'create', '--name', 'Tarot Provider']);
  assert.equal(providerIdentity.exitCode, 0);

  const publishFile = path.join(providerHome, 'provider-payload.json');
  await writeFile(publishFile, JSON.stringify({
    serviceName: 'tarot-rws-service',
    displayName: 'Tarot Reading',
    description: 'Reads one tarot card.',
    providerSkill: 'tarot-rws',
    price: '0.00001',
    currency: 'SPACE',
    outputType: 'text',
    skillDocument: '# Tarot Reading',
  }), 'utf8');

  const published = await runCommand(providerHome, ['services', 'publish', '--payload-file', publishFile]);
  assert.equal(published.exitCode, 0);
  assert.equal(published.payload.ok, true);

  const providerDaemon = await runCommand(providerHome, ['daemon', 'start']);
  assert.equal(providerDaemon.exitCode, 0);
  assert.equal(providerDaemon.payload.ok, true);

  const presenceEnabled = await fetchJson(providerDaemon.payload.data.baseUrl, '/api/provider/presence', {
    method: 'POST',
    body: { enabled: true },
  });
  assert.equal(presenceEnabled.status, 200);
  assert.equal(presenceEnabled.payload.ok, true);
  assert.equal(presenceEnabled.payload.data.presence.enabled, true);

  const listed = await runCommand(providerHome, ['network', 'services', '--online']);
  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(listed.payload.data.services.length, 1);
  assert.equal(listed.payload.data.services[0].servicePinId, published.payload.data.servicePinId);
  assert.equal(listed.payload.data.services[0].online, true);

  const callerIdentity = await runCommand(callerHome, ['identity', 'create', '--name', 'Caller Bot']);
  assert.equal(callerIdentity.exitCode, 0);

  const requestFile = path.join(callerHome, 'provider-closure-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: published.payload.data.servicePinId,
      providerGlobalMetaId: providerIdentity.payload.data.globalMetaId,
      providerDaemonBaseUrl: providerDaemon.payload.data.baseUrl,
      userTask: 'Do one tarot reading',
      taskContext: 'Acceptance coverage for provider console closure',
    },
  }), 'utf8');

  const called = await runCommand(callerHome, ['services', 'call', '--request-file', requestFile]);
  assert.equal(called.exitCode, 0);
  assert.equal(called.payload.ok, true);

  const providerTrace = await runCommand(providerHome, ['trace', 'get', '--trace-id', called.payload.data.traceId]);
  assert.equal(providerTrace.exitCode, 0);
  assert.equal(providerTrace.payload.ok, true);
  assert.equal(providerTrace.payload.data.order.role, 'seller');
  assert.equal(providerTrace.payload.data.order.serviceId, published.payload.data.servicePinId);

  const runtimeStateStore = createRuntimeStateStore(providerHome);
  const state = await runtimeStateStore.readState();
  const traceId = called.payload.data.traceId;
  const nextTraces = state.traces.map((entry) => {
    if (entry.traceId !== traceId || !entry.order) {
      return entry;
    }
    return {
      ...entry,
      order: {
        ...entry.order,
        status: 'refund_pending',
        refundRequestPinId: 'refund-pin-acceptance-1',
        coworkSessionId: 'seller-session-acceptance-1',
      },
      a2a: {
        ...(entry.a2a ?? {}),
        publicStatus: 'manual_action_required',
        taskRunState: 'manual_action_required',
      },
    };
  });
  await runtimeStateStore.writeState({
    ...state,
    traces: nextTraces,
  });

  const summary = await fetchJson(providerDaemon.payload.data.baseUrl, '/api/provider/summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.payload.ok, true);
  assert.equal(summary.payload.data.presence.enabled, true);
  assert.equal(summary.payload.data.services.length, 1);
  assert.equal(summary.payload.data.recentOrders.length, 1);
  assert.equal(summary.payload.data.recentOrders[0].traceId, traceId);
  assert.equal(summary.payload.data.manualActions.length, 1);
  assert.equal(summary.payload.data.manualActions[0].orderId, providerTrace.payload.data.order.id);
  assert.equal(summary.payload.data.manualActions[0].refundRequestPinId, 'refund-pin-acceptance-1');
});

test('provider summary refreshes rating detail from chain and exposes rated seller-order closure', async (t) => {
  const providerHome = await createProfileHomeTemp('', 'provider-profile');
  const callerHome = await createProfileHomeTemp('', 'caller-profile');
  const ratingPins = [];
  const chainApi = await startFakeChainApiServer({ ratingPins });
  t.after(async () => stopDaemon(providerHome));
  t.after(async () => stopDaemon(callerHome));
  t.after(async () => chainApi.close());
  t.after(async () => rm(providerHome, { recursive: true, force: true }));
  t.after(async () => rm(callerHome, { recursive: true, force: true }));

  const providerIdentity = await runCommand(providerHome, ['identity', 'create', '--name', 'Provider Bot']);
  assert.equal(providerIdentity.exitCode, 0);
  const callerIdentity = await runCommand(callerHome, ['identity', 'create', '--name', 'Caller Bot']);
  assert.equal(callerIdentity.exitCode, 0);

  const publishFile = path.join(providerHome, 'provider-rating-payload.json');
  await writeFile(publishFile, JSON.stringify({
    serviceName: 'tarot-rws-service',
    displayName: 'Tarot Reading',
    description: 'Reads one tarot card.',
    providerSkill: 'tarot-rws',
    price: '0.00001',
    currency: 'SPACE',
    outputType: 'text',
    skillDocument: '# Tarot Reading',
  }), 'utf8');

  const published = await runCommand(providerHome, ['services', 'publish', '--payload-file', publishFile]);
  assert.equal(published.exitCode, 0);
  assert.equal(published.payload.ok, true);

  const providerDaemon = await runCommand(
    providerHome,
    ['daemon', 'start'],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );
  assert.equal(providerDaemon.exitCode, 0);
  assert.equal(providerDaemon.payload.ok, true);

  const requestFile = path.join(callerHome, 'provider-rating-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: published.payload.data.servicePinId,
      providerGlobalMetaId: providerIdentity.payload.data.globalMetaId,
      providerDaemonBaseUrl: providerDaemon.payload.data.baseUrl,
      userTask: 'Do one tarot reading',
      taskContext: 'Acceptance coverage for provider rating closure',
    },
  }), 'utf8');

  const called = await runCommand(
    callerHome,
    ['services', 'call', '--request-file', requestFile],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );
  assert.equal(called.exitCode, 0);
  assert.equal(called.payload.ok, true);

  const providerRuntimeStateStore = createRuntimeStateStore(providerHome);
  const providerState = await providerRuntimeStateStore.readState();
  await providerRuntimeStateStore.writeState({
    ...providerState,
    traces: providerState.traces.map((entry) => {
      if (entry.traceId !== called.payload.data.traceId || !entry.order) {
        return entry;
      }
      return {
        ...entry,
        order: {
          ...entry.order,
          paymentTxid: called.payload.data.paymentTxid,
        },
      };
    }),
  });

  const rateRequestFile = path.join(callerHome, 'provider-rating-request.json');
  await writeFile(rateRequestFile, JSON.stringify({
    traceId: called.payload.data.traceId,
    rate: 4,
    comment: '解释很具体。',
  }), 'utf8');

  const rated = await runCommand(
    callerHome,
    ['services', 'rate', '--request-file', rateRequestFile],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );
  assert.equal(rated.exitCode, 0);
  assert.equal(rated.payload.ok, true);

  ratingPins.push({
    id: rated.payload.data.pinId,
    globalMetaId: callerIdentity.payload.data.globalMetaId,
    metaid: callerIdentity.payload.data.metaId,
    timestamp: Math.floor(Date.now() / 1000),
    contentSummary: JSON.stringify({
      serviceID: rated.payload.data.serviceId,
      servicePaidTx: rated.payload.data.servicePaidTx,
      rate: rated.payload.data.rate,
      comment: rated.payload.data.comment,
    }),
  });

  const summary = await fetchJson(providerDaemon.payload.data.baseUrl, '/api/provider/summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.payload.ok, true);
  assert.equal(summary.payload.data.ratingSyncState, 'ready');
  assert.equal(summary.payload.data.ratingSyncError, null);
  assert.equal(summary.payload.data.recentOrders.length, 1);
  assert.equal(summary.payload.data.recentOrders[0].traceId, called.payload.data.traceId);
  assert.equal(summary.payload.data.recentOrders[0].ratingStatus, 'rated_on_chain');
  assert.equal(summary.payload.data.recentOrders[0].ratingValue, 4);
  assert.equal(summary.payload.data.recentOrders[0].ratingComment, '解释很具体。');
  assert.equal(summary.payload.data.recentOrders[0].ratingPinId, rated.payload.data.pinId);
  assert.ok(Number.isFinite(summary.payload.data.recentOrders[0].ratingCreatedAt));
});

test('network services reads chain-backed online services without local directory seeds', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer();
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const listed = await runCommand(
    homeDir,
    ['network', 'services', '--online'],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );

  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(listed.payload.data.discoverySource, 'chain');
  assert.equal(listed.payload.data.fallbackUsed, false);
  assert.equal(Array.isArray(listed.payload.data.services), true);
  assert.equal(listed.payload.data.services.length, 1);
  assert.equal(listed.payload.data.services[0].servicePinId, 'chain-service-pin-1');
  assert.equal(listed.payload.data.services[0].displayName, 'Weather Oracle');
  assert.equal(listed.payload.data.services[0].providerGlobalMetaId, 'idq1provider');
  assert.equal(listed.payload.data.services[0].online, true);
});

test('network bots --online falls back to service directory when socket presence is unavailable', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer();
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const listed = await runCommand(
    homeDir,
    ['network', 'bots', '--online', '--limit', '10'],
    {
      METABOT_TEST_FAKE_CHAIN_WRITE: '',
      METABOT_TEST_FAKE_SUBSIDY: '',
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_SOCKET_PRESENCE_API_BASE_URL: 'http://127.0.0.1:9',
    }
  );

  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(listed.payload.data.source, 'service_directory_fallback');
  assert.equal(listed.payload.data.fallbackUsed, true);
  assert.equal(Array.isArray(listed.payload.data.bots), true);
  assert.equal(listed.payload.data.bots.length, 0);
});

test('evolution search/import read published artifact metadata + body via chain API and write remote artifact files', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer();
  t.after(async () => chainApi.close());

  const searched = await runCommand(
    homeDir,
    ['evolution', 'search', '--skill', 'metabot-network-directory'],
    {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_CHAIN_WRITE: '',
      METABOT_TEST_FAKE_SUBSIDY: '',
    }
  );

  assert.equal(searched.exitCode, 0);
  assert.equal(searched.payload.ok, true);
  assert.equal(searched.payload.data.skillName, 'metabot-network-directory');
  assert.equal(searched.payload.data.count, 1);
  assert.equal(searched.payload.data.results[0].pinId, 'evolution-metadata-pin-1');
  assert.equal(searched.stdout.join('').trim().startsWith('{'), true);

  const imported = await runCommand(
    homeDir,
    ['evolution', 'import', '--pin-id', 'evolution-metadata-pin-1'],
    {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_CHAIN_WRITE: '',
      METABOT_TEST_FAKE_SUBSIDY: '',
    }
  );

  assert.equal(imported.exitCode, 0);
  assert.equal(imported.payload.ok, true);
  assert.equal(imported.payload.data.pinId, 'evolution-metadata-pin-1');
  assert.equal(imported.payload.data.variantId, 'variant-remote-1');
  assert.equal(imported.payload.data.artifactPath.includes(`${path.sep}.runtime${path.sep}evolution${path.sep}remote${path.sep}artifacts${path.sep}`), true);
  assert.equal(imported.payload.data.metadataPath.includes(`${path.sep}.runtime${path.sep}evolution${path.sep}remote${path.sep}artifacts${path.sep}`), true);
  assert.equal(imported.payload.data.artifactPath.endsWith(`${path.sep}variant-remote-1.json`), true);
  assert.equal(imported.payload.data.metadataPath.endsWith(`${path.sep}variant-remote-1.meta.json`), true);

  const artifactSaved = JSON.parse(await readFile(imported.payload.data.artifactPath, 'utf8'));
  const metadataSaved = JSON.parse(await readFile(imported.payload.data.metadataPath, 'utf8'));
  assert.equal(artifactSaved.variantId, 'variant-remote-1');
  assert.equal(artifactSaved.skillName, 'metabot-network-directory');
  assert.equal(metadataSaved.pinId, 'evolution-metadata-pin-1');
  assert.equal(metadataSaved.variantId, 'variant-remote-1');
});

test('evolution search returns a search-level command failure when chain metadata fetch fails', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/pin/path/list') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP fake chain server');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  const searched = await runCommand(
    homeDir,
    ['evolution', 'search', '--skill', 'metabot-network-directory'],
    {
      METABOT_CHAIN_API_BASE_URL: baseUrl,
      METABOT_TEST_FAKE_CHAIN_WRITE: '',
      METABOT_TEST_FAKE_SUBSIDY: '',
    }
  );

  assert.equal(searched.exitCode, 1);
  assert.equal(searched.payload.ok, false);
  assert.equal(searched.payload.code, 'evolution_chain_query_failed');
  assert.match(searched.payload.message, /evolution_chain_query_failed:chain_evolution_http_500/);
});

test('evolution search rejects unsupported skills in this round', async () => {
  const homeDir = await createProfileHomeTemp('');

  const searched = await runCommand(
    homeDir,
    ['evolution', 'search', '--skill', 'metabot-trace-inspector'],
    {
      METABOT_TEST_FAKE_CHAIN_WRITE: '',
      METABOT_TEST_FAKE_SUBSIDY: '',
    }
  );

  assert.equal(searched.exitCode, 1);
  assert.equal(searched.payload.ok, false);
  assert.equal(searched.payload.code, 'evolution_search_not_supported');
  assert.match(
    searched.payload.message,
    /Evolution search is currently supported only for "metabot-network-directory"\./
  );
});

test('evolution search returns a stable invalid-result error when chain search payload is malformed', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/pin/path/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { rows: [] } }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP fake chain server');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  const searched = await runCommand(
    homeDir,
    ['evolution', 'search', '--skill', 'metabot-network-directory'],
    {
      METABOT_CHAIN_API_BASE_URL: baseUrl,
      METABOT_TEST_FAKE_CHAIN_WRITE: '',
      METABOT_TEST_FAKE_SUBSIDY: '',
    }
  );

  assert.equal(searched.exitCode, 1);
  assert.equal(searched.payload.ok, false);
  assert.equal(searched.payload.code, 'evolution_search_result_invalid');
  assert.match(searched.payload.message, /evolution_search_result_invalid:invalid_page_payload/);
});

test('evolution import returns a stable import error when metadata pin lookup fails in transport', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/pin/evolution-metadata-pin-transport-error') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP fake chain server');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  const imported = await runCommand(
    homeDir,
    ['evolution', 'import', '--pin-id', 'evolution-metadata-pin-transport-error'],
    {
      METABOT_CHAIN_API_BASE_URL: baseUrl,
      METABOT_TEST_FAKE_CHAIN_WRITE: '',
      METABOT_TEST_FAKE_SUBSIDY: '',
    }
  );

  assert.equal(imported.exitCode, 1);
  assert.equal(imported.payload.ok, false);
  assert.equal(imported.payload.code, 'evolution_import_metadata_invalid');
  assert.match(
    imported.payload.message,
    /Failed to read metadata pin "evolution-metadata-pin-transport-error": chain_evolution_http_500/
  );
});

test('evolution status exposes activeVariantRefs and skills resolve reports remote activeVariantSource', async () => {
  const homeDir = await createProfileHomeTemp('');
  const localStore = createLocalEvolutionStore(homeDir);
  const remoteStore = createRemoteEvolutionStore(homeDir);
  const fixture = createImportedArtifactFixture();
  await remoteStore.writeImport(fixture);
  await localStore.setActiveVariantRef('metabot-network-directory', {
    source: 'remote',
    variantId: fixture.artifact.variantId,
  });

  const status = await runCommand(homeDir, ['evolution', 'status']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.payload.ok, true);
  assert.deepEqual(status.payload.data.activeVariants, {
    'metabot-network-directory': fixture.artifact.variantId,
  });
  assert.deepEqual(status.payload.data.activeVariantRefs, {
    'metabot-network-directory': {
      source: 'remote',
      variantId: fixture.artifact.variantId,
    },
  });

  const resolved = await runCommand(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-network-directory',
    '--host',
    'codex',
    '--format',
    'json',
  ]);
  assert.equal(resolved.exitCode, 0);
  assert.equal(resolved.payload.ok, true);
  assert.equal(resolved.payload.data.contract.activeVariantId, fixture.artifact.variantId);
  assert.equal(resolved.payload.data.contract.activeVariantSource, 'remote');
  assert.equal(resolved.payload.data.contract.source, 'merged');
  assert.match(
    resolved.payload.data.contract.instructions,
    /Prefer deterministic provider ordering when listing online services\./
  );
});

test('evolution imported lists local imported artifacts without chain lookups', async () => {
  const homeDir = await createProfileHomeTemp('');
  const remoteStore = createRemoteEvolutionStore(homeDir);
  const fixture = createImportedArtifactFixture();
  await remoteStore.writeImport(fixture);

  const imported = await runCommand(homeDir, [
    'evolution',
    'imported',
    '--skill',
    'metabot-network-directory',
  ]);

  assert.equal(imported.exitCode, 0);
  assert.equal(imported.payload.ok, true);
  assert.equal(imported.payload.data.skillName, 'metabot-network-directory');
  assert.equal(imported.payload.data.count, 1);
  assert.equal(imported.payload.data.results[0].variantId, fixture.artifact.variantId);
  assert.equal(imported.payload.data.results[0].pinId, fixture.sidecar.pinId);
  assert.equal(imported.payload.data.results[0].active, false);
});

test('skills resolve falls back to the base contract when the remote active artifact cache is malformed', async () => {
  const homeDir = await createProfileHomeTemp('');
  const localStore = createLocalEvolutionStore(homeDir);
  const remoteStore = createRemoteEvolutionStore(homeDir);
  const fixture = createImportedArtifactFixture();
  await remoteStore.writeImport(fixture);
  await writeFile(
    path.join(remoteStore.paths.evolutionRemoteArtifactsRoot, `${fixture.artifact.variantId}.json`),
    '{',
    'utf8',
  );
  await localStore.setActiveVariantRef('metabot-network-directory', {
    source: 'remote',
    variantId: fixture.artifact.variantId,
  });

  const resolved = await runCommand(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-network-directory',
    '--host',
    'codex',
    '--format',
    'json',
  ]);

  assert.equal(resolved.exitCode, 0);
  assert.equal(resolved.payload.ok, true);
  assert.equal(resolved.payload.data.contract.source, 'base');
  assert.equal(resolved.payload.data.contract.activeVariantId, null);
  assert.equal(resolved.payload.data.contract.activeVariantSource, null);
});

test('evolution adopt --source remote writes remote active refs and skills resolve uses imported artifact body', async () => {
  const homeDir = await createProfileHomeTemp('');
  const localStore = createLocalEvolutionStore(homeDir);
  const remoteStore = createRemoteEvolutionStore(homeDir);
  const fixture = createImportedArtifactFixture({
    instructionsPatch: 'Remote-only instructions patch for adopted imported variant.',
  });
  await remoteStore.writeImport(fixture);

  const adopted = await runCommand(homeDir, [
    'evolution',
    'adopt',
    '--skill',
    'metabot-network-directory',
    '--variant-id',
    fixture.artifact.variantId,
    '--source',
    'remote',
  ]);

  assert.equal(adopted.exitCode, 0);
  assert.equal(adopted.payload.ok, true);
  assert.equal(adopted.payload.data.skillName, 'metabot-network-directory');
  assert.equal(adopted.payload.data.variantId, fixture.artifact.variantId);
  assert.equal(adopted.payload.data.source, 'remote');
  assert.equal(adopted.payload.data.active, true);

  const index = await localStore.readIndex();
  assert.deepEqual(index.activeVariants['metabot-network-directory'], {
    source: 'remote',
    variantId: fixture.artifact.variantId,
  });

  const resolved = await runCommand(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-network-directory',
    '--host',
    'codex',
    '--format',
    'json',
  ]);
  assert.equal(resolved.exitCode, 0);
  assert.equal(resolved.payload.ok, true);
  assert.equal(resolved.payload.data.contract.activeVariantId, fixture.artifact.variantId);
  assert.equal(resolved.payload.data.contract.activeVariantSource, 'remote');
  assert.equal(resolved.payload.data.contract.source, 'merged');
  assert.match(
    resolved.payload.data.contract.instructions,
    /Remote-only instructions patch for adopted imported variant\./
  );
});

test('evolution imported rejects unsupported skills', async () => {
  const homeDir = await createProfileHomeTemp('');

  const imported = await runCommand(homeDir, [
    'evolution',
    'imported',
    '--skill',
    'metabot-trace-inspector',
  ]);

  assert.equal(imported.exitCode, 1);
  assert.equal(imported.payload.ok, false);
  assert.equal(imported.payload.code, 'evolution_imported_not_supported');
});

test('evolution adopt --source remote rejects unsupported skills in this round', async () => {
  const homeDir = await createProfileHomeTemp('');

  const adopted = await runCommand(homeDir, [
    'evolution',
    'adopt',
    '--skill',
    'metabot-trace-inspector',
    '--variant-id',
    'variant-remote-1',
    '--source',
    'remote',
  ]);

  assert.equal(adopted.exitCode, 1);
  assert.equal(adopted.payload.ok, false);
  assert.equal(adopted.payload.code, 'evolution_remote_adopt_not_supported');
});

test('evolution adopt rejects unsupported source values in this round', async () => {
  const homeDir = await createProfileHomeTemp('');

  const adopted = await runCommand(homeDir, [
    'evolution',
    'adopt',
    '--skill',
    'metabot-network-directory',
    '--variant-id',
    'variant-remote-1',
    '--source',
    'cloud',
  ]);

  assert.equal(adopted.exitCode, 1);
  assert.equal(adopted.payload.ok, false);
  assert.equal(adopted.payload.code, 'evolution_remote_adopt_not_supported');
});

test('evolution imported and remote adopt return evolution_network_disabled when disabled', async () => {
  const homeDir = await createProfileHomeTemp('');
  const configStore = createConfigStore(homeDir);
  const config = await configStore.read();
  await configStore.set({
    ...config,
    evolution_network: {
      ...config.evolution_network,
      enabled: false,
    },
  });

  const imported = await runCommand(homeDir, [
    'evolution',
    'imported',
    '--skill',
    'metabot-network-directory',
  ]);
  assert.equal(imported.exitCode, 1);
  assert.equal(imported.payload.ok, false);
  assert.equal(imported.payload.code, 'evolution_network_disabled');

  const adopted = await runCommand(homeDir, [
    'evolution',
    'adopt',
    '--skill',
    'metabot-network-directory',
    '--variant-id',
    'variant-remote-1',
    '--source',
    'remote',
  ]);
  assert.equal(adopted.exitCode, 1);
  assert.equal(adopted.payload.ok, false);
  assert.equal(adopted.payload.code, 'evolution_network_disabled');
});

test('network services merges remote demo directory seeds and returns provider daemon base urls for agent-side invocation', async (t) => {
  const callerHome = await createProfileHomeTemp('', 'caller-profile');
  const providerHome = await createProfileHomeTemp('', 'provider-profile');
  t.after(async () => stopDaemon(callerHome));
  t.after(async () => stopDaemon(providerHome));

  const providerIdentity = await runCommand(providerHome, ['identity', 'create', '--name', 'Weather Provider']);
  assert.equal(providerIdentity.exitCode, 0);

  const publishFile = path.join(providerHome, 'payload.json');
  await writeFile(publishFile, JSON.stringify({
    serviceName: 'weather-oracle',
    displayName: 'Weather Oracle',
    description: 'Returns tomorrow weather from the local connected-agent runtime.',
    providerSkill: 'metabot-weather-oracle',
    price: '0.00001',
    currency: 'SPACE',
    outputType: 'text',
    skillDocument: '# Weather Oracle',
  }), 'utf8');

  const published = await runCommand(providerHome, ['services', 'publish', '--payload-file', publishFile]);
  assert.equal(published.exitCode, 0);

  const providerDaemon = await runCommand(providerHome, ['daemon', 'start']);
  assert.equal(providerDaemon.exitCode, 0);
  assert.equal(providerDaemon.payload.ok, true);

  await writeDirectorySeeds(callerHome, [{
    baseUrl: providerDaemon.payload.data.baseUrl,
    label: 'weather-demo',
  }]);

  const listed = await runCommand(callerHome, ['network', 'services', '--online']);

  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(Array.isArray(listed.payload.data.services), true);
  assert.equal(listed.payload.data.services.length, 1);
  assert.equal(listed.payload.data.services[0].displayName, 'Weather Oracle');
  assert.equal(listed.payload.data.services[0].providerGlobalMetaId, providerIdentity.payload.data.globalMetaId);
  assert.equal(listed.payload.data.services[0].providerDaemonBaseUrl, providerDaemon.payload.data.baseUrl);
  assert.equal(listed.payload.data.services[0].online, true);
});

test('master list merges remote debug-master directory seeds and returns provider daemon base urls for caller-side invocation', async (t) => {
  const callerHome = await createProfileHomeTemp('', 'caller-profile');
  const providerHome = await createProfileHomeTemp('', 'provider-profile');
  t.after(async () => stopDaemon(callerHome));
  t.after(async () => stopDaemon(providerHome));

  const providerIdentity = await runCommand(providerHome, ['identity', 'create', '--name', 'Debug Master Provider']);
  assert.equal(providerIdentity.exitCode, 0);

  const publishFile = path.join(providerHome, 'master-payload.json');
  await writeFile(publishFile, JSON.stringify({
    serviceName: 'official-debug-master',
    displayName: 'Official Debug Master',
    description: 'Structured debugging help from the official Ask Master fixture.',
    masterKind: 'debug',
    specialties: ['debugging'],
    hostModes: ['codex'],
    modelInfo: {
      provider: 'metaweb',
      model: 'official-debug-master-v1',
    },
    style: 'direct_and_structured',
    pricingMode: 'free',
    price: '0',
    currency: 'SPACE',
    responseMode: 'structured',
    contextPolicy: 'standard',
    official: true,
    trustedTier: 'official',
  }), 'utf8');

  const published = await runCommand(providerHome, ['master', 'publish', '--payload-file', publishFile]);
  assert.equal(published.exitCode, 0);

  const providerPresenceStore = createProviderPresenceStateStore(providerHome);
  await providerPresenceStore.write({
    enabled: true,
    lastHeartbeatAt: Date.now(),
    lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-1',
    lastHeartbeatTxid: 'heartbeat-tx-master-1',
  });

  const providerDaemon = await runCommand(providerHome, ['daemon', 'start']);
  assert.equal(providerDaemon.exitCode, 0);
  assert.equal(providerDaemon.payload.ok, true);

  await writeDirectorySeeds(callerHome, [{
    baseUrl: providerDaemon.payload.data.baseUrl,
    label: 'debug-master-demo',
  }]);

  const listed = await runCommand(callerHome, ['master', 'list']);

  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(Array.isArray(listed.payload.data.masters), true);
  assert.equal(listed.payload.data.masters.length, 1);
  assert.equal(listed.payload.data.masters[0].displayName, 'Official Debug Master');
  assert.equal(listed.payload.data.masters[0].providerGlobalMetaId, providerIdentity.payload.data.globalMetaId);
  assert.equal(listed.payload.data.masters[0].providerDaemonBaseUrl, providerDaemon.payload.data.baseUrl);
  assert.equal(listed.payload.data.masters[0].online, true);
});

test('network sources add/list/remove manages the local demo provider registry without manual file edits', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const added = await runCommand(homeDir, [
    'network',
    'sources',
    'add',
    '--base-url',
    'http://127.0.0.1:4827',
    '--label',
    'weather-demo',
  ]);

  assert.equal(added.exitCode, 0);
  assert.equal(added.payload.ok, true);
  assert.equal(added.payload.data.baseUrl, 'http://127.0.0.1:4827');
  assert.equal(added.payload.data.label, 'weather-demo');

  const listed = await runCommand(homeDir, ['network', 'sources', 'list']);

  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(listed.payload.data.sources.length, 1);
  assert.equal(listed.payload.data.sources[0].baseUrl, 'http://127.0.0.1:4827');
  assert.equal(listed.payload.data.sources[0].label, 'weather-demo');

  const seedsFile = JSON.parse(await readFile(metabotPaths(homeDir).directorySeedsPath, 'utf8'));
  assert.equal(seedsFile.providers.length, 1);
  assert.equal(seedsFile.providers[0].baseUrl, 'http://127.0.0.1:4827');

  const removed = await runCommand(homeDir, ['network', 'sources', 'remove', '--base-url', 'http://127.0.0.1:4827']);

  assert.equal(removed.exitCode, 0);
  assert.equal(removed.payload.ok, true);
  assert.equal(removed.payload.data.removed, true);

  const relisted = await runCommand(homeDir, ['network', 'sources', 'list']);
  assert.equal(relisted.exitCode, 0);
  assert.equal(relisted.payload.ok, true);
  assert.equal(relisted.payload.data.sources.length, 0);
});

test('services call stores a trace that trace get can read back from the local runtime', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const publishFile = path.join(homeDir, 'payload.json');
  await writeFile(publishFile, JSON.stringify({
    serviceName: 'weather-oracle',
    displayName: 'Weather Oracle',
    description: 'Returns tomorrow weather from the local connected-agent runtime.',
    providerSkill: 'metabot-weather-oracle',
    price: '0.00001',
    currency: 'SPACE',
    outputType: 'text',
    skillDocument: '# Weather Oracle',
  }), 'utf8');

  const published = await runCommand(homeDir, ['services', 'publish', '--payload-file', publishFile]);
  assert.equal(published.exitCode, 0);

  const requestFile = path.join(homeDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: published.payload.data.servicePinId,
      providerGlobalMetaId: created.payload.data.globalMetaId,
      userTask: 'Tell me tomorrow weather',
      taskContext: 'Shanghai tomorrow',
    },
  }), 'utf8');

  const called = await runCommand(homeDir, ['services', 'call', '--request-file', requestFile]);

  assert.equal(called.exitCode, 0);
  assert.equal(called.payload.ok, true);
  assert.match(called.payload.data.traceId, /^trace-/);
  assert.equal(called.payload.data.session.role, 'caller');
  assert.equal(called.payload.data.session.state, 'timeout');
  assert.equal(called.payload.data.session.publicStatus, 'timeout');
  assert.equal(called.payload.data.session.event, 'timeout');
  assert.match(called.payload.data.session.externalConversationId, /^a2a-session:/);
  assert.equal(called.payload.data.confirmation.requiresConfirmation, true);
  assert.equal(called.payload.data.confirmation.policyMode, 'confirm_all');
  assert.equal(called.payload.data.confirmation.policyReason, 'confirm_all_requires_confirmation');
  assert.equal(called.payload.data.confirmation.requestedPolicyMode, 'confirm_all');
  assert.match(called.payload.data.traceJsonPath, /\/\.runtime\/exports\/traces\/.*\.json$/);
  assert.match(called.payload.data.traceMarkdownPath, /\/\.runtime\/exports\/traces\/.*\.md$/);

  const trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', called.payload.data.traceId]);

  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.traceId, called.payload.data.traceId);
  assert.equal(trace.payload.data.session.peerGlobalMetaId, created.payload.data.globalMetaId);
  assert.equal(trace.payload.data.order.serviceId, published.payload.data.servicePinId);
  assert.equal(trace.payload.data.order.serviceName, 'Weather Oracle');

  const traceJson = JSON.parse(await readFile(called.payload.data.traceJsonPath, 'utf8'));
  assert.equal(traceJson.traceId, called.payload.data.traceId);

  const traceMarkdown = await readFile(called.payload.data.traceMarkdownPath, 'utf8');
  assert.match(traceMarkdown, /Weather Oracle/);
  assert.match(traceMarkdown, /timeout/i);

  const sessionState = JSON.parse(
    await readFile(metabotPaths(homeDir).sessionStatePath, 'utf8')
  );
  const callerSession = sessionState.sessions.find((entry) => entry.traceId === called.payload.data.traceId);
  const callerTaskRun = sessionState.taskRuns.find((entry) => entry.runId === called.payload.data.session.taskRunId);
  assert.equal(callerSession.role, 'caller');
  assert.equal(callerSession.state, 'timeout');
  assert.equal(callerTaskRun.state, 'timeout');
});

test('services call returns an A2A start contract while provider execution flows through provider session state', async (t) => {
  const callerHome = await createProfileHomeTemp('', 'caller-profile');
  const providerHome = await createProfileHomeTemp('', 'provider-profile');
  t.after(async () => stopDaemon(callerHome));
  t.after(async () => stopDaemon(providerHome));

  const providerIdentity = await runCommand(providerHome, ['identity', 'create', '--name', 'Weather Provider']);
  assert.equal(providerIdentity.exitCode, 0);

  const publishFile = path.join(providerHome, 'payload.json');
  await writeFile(publishFile, JSON.stringify({
    serviceName: 'weather-oracle',
    displayName: 'Weather Oracle',
    description: 'Returns tomorrow weather from the local connected-agent runtime.',
    providerSkill: 'metabot-weather-oracle',
    price: '0.00001',
    currency: 'SPACE',
    outputType: 'text',
    skillDocument: '# Weather Oracle',
  }), 'utf8');

  const published = await runCommand(providerHome, ['services', 'publish', '--payload-file', publishFile]);
  assert.equal(published.exitCode, 0);

  const providerDaemon = await runCommand(providerHome, ['daemon', 'start']);
  assert.equal(providerDaemon.exitCode, 0);
  assert.equal(providerDaemon.payload.ok, true);

  const callerIdentity = await runCommand(callerHome, ['identity', 'create', '--name', 'Caller Bot']);
  assert.equal(callerIdentity.exitCode, 0);

  const requestFile = path.join(callerHome, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: published.payload.data.servicePinId,
      providerGlobalMetaId: providerIdentity.payload.data.globalMetaId,
      providerDaemonBaseUrl: providerDaemon.payload.data.baseUrl,
      userTask: 'Tell me tomorrow weather',
      taskContext: 'Shanghai tomorrow',
    },
  }), 'utf8');

  const called = await runCommand(callerHome, ['services', 'call', '--request-file', requestFile]);

  assert.equal(called.exitCode, 0);
  assert.equal(called.payload.ok, true);
  assert.match(called.payload.data.traceId, /^trace-/);
  assert.equal(called.payload.data.session.role, 'caller');
  assert.equal(called.payload.data.session.state, 'requesting_remote');
  assert.equal(called.payload.data.session.publicStatus, 'requesting_remote');
  assert.equal(called.payload.data.confirmation.policyMode, 'confirm_all');
  assert.equal(called.payload.data.providerGlobalMetaId, providerIdentity.payload.data.globalMetaId);
  assert.equal(called.payload.data.serviceName, 'Weather Oracle');
  assert.equal('responseText' in called.payload.data, false);
  assert.equal('providerTraceJsonPath' in called.payload.data, false);
  assert.equal('providerTraceMarkdownPath' in called.payload.data, false);

  const callerTrace = await runCommand(callerHome, ['trace', 'get', '--trace-id', called.payload.data.traceId]);
  assert.equal(callerTrace.exitCode, 0);
  assert.equal(callerTrace.payload.ok, true);
  assert.equal(callerTrace.payload.data.order.serviceName, 'Weather Oracle');
  assert.equal(callerTrace.payload.data.session.peerGlobalMetaId, providerIdentity.payload.data.globalMetaId);

  const callerTranscriptMarkdown = await readFile(called.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(callerTranscriptMarkdown, /remote MetaBot task session/i);

  const providerTrace = await runCommand(providerHome, ['trace', 'get', '--trace-id', called.payload.data.traceId]);
  assert.equal(providerTrace.exitCode, 0);
  assert.equal(providerTrace.payload.ok, true);
  assert.equal(providerTrace.payload.data.order.role, 'seller');
  assert.equal(providerTrace.payload.data.order.serviceName, 'Weather Oracle');
  assert.equal(providerTrace.payload.data.session.peerGlobalMetaId, callerIdentity.payload.data.globalMetaId);

  const providerSessionState = JSON.parse(
    await readFile(metabotPaths(providerHome).sessionStatePath, 'utf8')
  );
  const providerSession = providerSessionState.sessions.find((entry) => entry.traceId === called.payload.data.traceId);
  const providerTaskRun = providerSessionState.taskRuns.find((entry) => entry.sessionId === providerSession.sessionId);
  assert.equal(providerSession.role, 'provider');
  assert.equal(providerSession.state, 'completed');
  assert.equal(providerTaskRun.state, 'completed');
});

test('services call resolves a chain-discovered online service into a real MetaWeb reply path without providerDaemonBaseUrl', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer();
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'chain-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  }), 'utf8');

  const called = await runCommand(
    homeDir,
    ['services', 'call', '--request-file', requestFile],
    {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
      METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
        responseText: 'Tomorrow will be bright with a light wind.',
        deliveryPinId: 'delivery-pin-1',
      }),
    }
  );

  assert.equal(called.exitCode, 0);
  assert.equal(called.payload.ok, true);
  assert.equal(called.payload.data.providerGlobalMetaId, 'idq1provider');
  assert.equal(called.payload.data.serviceName, 'Weather Oracle');
  assert.equal(called.payload.data.responseText, 'Tomorrow will be bright with a light wind.');
  assert.equal(called.payload.data.deliveryPinId, 'delivery-pin-1');
  assert.equal(called.payload.data.session.role, 'caller');
  assert.equal(called.payload.data.session.publicStatus, 'completed');
  assert.equal(called.payload.data.session.event, 'provider_completed');
  assert.match(called.payload.data.orderPinId, /^\/protocols\/simplemsg-pin-/);

  const trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', called.payload.data.traceId], {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
      responseText: 'Tomorrow will be bright with a light wind.',
      deliveryPinId: 'delivery-pin-1',
    }),
  });

  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.order.serviceId, 'chain-service-pin-1');
  assert.equal(trace.payload.data.session.peerGlobalMetaId, 'idq1provider');
  assert.equal(trace.payload.data.a2a.publicStatus, 'completed');
  assert.equal(trace.payload.data.a2a.latestEvent, 'provider_completed');
  assert.equal(trace.payload.data.resultText, 'Tomorrow will be bright with a light wind.');
  assert.equal(trace.payload.data.resultDeliveryPinId, 'delivery-pin-1');
  assert.equal(trace.payload.data.ratingRequestText, null);
  assert.match(trace.payload.data.order.paymentTxid, /^[0-9a-f]{64}$/i);

  const transcriptMarkdown = await readFile(called.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /Tomorrow will be bright with a light wind/);
});

test('services call persists timeout state when a chain-discovered service does not reply during the foreground wait', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer();
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'chain-timeout-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  }), 'utf8');

  const called = await runCommand(
    homeDir,
    ['services', 'call', '--request-file', requestFile],
    {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
      METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
        state: 'timeout',
      }),
    }
  );

  assert.equal(called.exitCode, 0);
  assert.equal(called.payload.ok, true);
  assert.equal(called.payload.data.session.role, 'caller');
  assert.equal(called.payload.data.session.publicStatus, 'timeout');
  assert.equal(called.payload.data.session.event, 'timeout');
  assert.equal('responseText' in called.payload.data, false);

  const trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', called.payload.data.traceId], {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
  });

  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.a2a.publicStatus, 'timeout');
  assert.equal(trace.payload.data.a2a.latestEvent, 'timeout');

  const transcriptMarkdown = await readFile(called.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /Foreground timeout reached|Foreground wait ended before the remote MetaBot returned/i);
});

test('services call upgrades a timed-out chain-discovered caller trace when the remote reply arrives later', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer();
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'chain-late-reply-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  }), 'utf8');

  const replyConfig = JSON.stringify({
    state: 'timeout',
    sequence: [
      {
        state: 'timeout',
      },
      {
        state: 'completed',
        delayMs: 50,
        responseText: 'A late weather reply finally arrived.',
        deliveryPinId: 'delivery-pin-late-1',
      },
    ],
  });

  const called = await runCommand(
    homeDir,
    ['services', 'call', '--request-file', requestFile],
    {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
      METABOT_TEST_FAKE_METAWEB_REPLY: replyConfig,
    }
  );

  assert.equal(called.exitCode, 0);
  assert.equal(called.payload.ok, true);
  assert.equal(called.payload.data.session.publicStatus, 'timeout');
  assert.equal(called.payload.data.session.event, 'timeout');

  let trace = null;
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', called.payload.data.traceId], {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
      METABOT_TEST_FAKE_METAWEB_REPLY: replyConfig,
    });
    if (trace.payload?.data?.a2a?.publicStatus === 'completed') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.ok(trace, 'expected trace polling to produce a response');
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.a2a.publicStatus, 'completed');
  assert.equal(trace.payload.data.a2a.latestEvent, 'provider_completed');
  assert.equal(trace.payload.data.a2a.taskRunState, 'completed');
  assert.equal(trace.payload.data.resultText, 'A late weather reply finally arrived.');
  assert.equal(trace.payload.data.resultDeliveryPinId, 'delivery-pin-late-1');
  assert.equal(trace.payload.data.ratingRequestText, null);

  const transcriptMarkdown = await readFile(called.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /Foreground timeout reached|Foreground wait ended before the remote MetaBot returned/i);
  assert.match(transcriptMarkdown, /A late weather reply finally arrived\./i);
});

test('trace watch waits through the timeout handoff so one follow-up can observe the eventual late completion', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer();
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'chain-trace-watch-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  }), 'utf8');

  const replyConfig = JSON.stringify({
    state: 'timeout',
    sequence: [
      {
        state: 'timeout',
      },
      {
        state: 'completed',
        delayMs: 300,
        responseText: 'A late weather reply finally arrived.',
        deliveryPinId: 'delivery-pin-late-2',
      },
    ],
  });

  const called = await runCommand(
    homeDir,
    ['services', 'call', '--request-file', requestFile],
    {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
      METABOT_TEST_FAKE_METAWEB_REPLY: replyConfig,
    }
  );

  assert.equal(called.exitCode, 0);
  assert.equal(called.payload.ok, true);
  assert.equal(called.payload.data.session.publicStatus, 'timeout');

  const startedAt = Date.now();
  const watched = await runCommandText(
    homeDir,
    ['trace', 'watch', '--trace-id', called.payload.data.traceId],
    {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
      METABOT_TEST_FAKE_METAWEB_REPLY: replyConfig,
    }
  );
  const elapsedMs = Date.now() - startedAt;

  assert.equal(watched.exitCode, 0);
  assert.equal(watched.stderr, '');
  assert.ok(elapsedMs >= 250, `expected trace watch to wait for late completion, got ${elapsedMs}ms`);

  const events = watched.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.status), [
    'requesting_remote',
    'timeout',
    'remote_received',
    'completed',
  ]);
  assert.equal(events.at(-1)?.terminal, true);
});

test('trace get exposes a remote rating request when the provider later asks for T-stage feedback', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer();
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'chain-rating-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  }), 'utf8');

  const called = await runCommand(
    homeDir,
    ['services', 'call', '--request-file', requestFile],
    {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
      METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
        responseText: 'Tomorrow will be bright with a light wind.',
        deliveryPinId: 'delivery-pin-rating-1',
        ratingRequestText: '服务已完成，如果方便请给我一个评价吧。',
      }),
    }
  );

  assert.equal(called.exitCode, 0);
  assert.equal(called.payload.ok, true);

  const trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', called.payload.data.traceId], {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
      responseText: 'Tomorrow will be bright with a light wind.',
      deliveryPinId: 'delivery-pin-rating-1',
      ratingRequestText: '服务已完成，如果方便请给我一个评价吧。',
    }),
  });

  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.ratingRequestText, '服务已完成，如果方便请给我一个评价吧。');
});

test('services rate publishes one buyer-side skill-service-rate record from a completed remote trace', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer();
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'chain-rating-publish-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '0.00002',
        currency: 'SPACE',
      },
    },
  }), 'utf8');

  const called = await runCommand(
    homeDir,
    ['services', 'call', '--request-file', requestFile],
    {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
      METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
        responseText: 'Tomorrow will be bright with a light wind.',
        deliveryPinId: 'delivery-pin-rating-2',
        ratingRequestText: '服务已完成，如果方便请给我一个评价吧。',
      }),
    }
  );

  assert.equal(called.exitCode, 0);
  assert.equal(called.payload.ok, true);

  const rateRequestFile = path.join(homeDir, 'service-rate.json');
  await writeFile(rateRequestFile, JSON.stringify({
    traceId: called.payload.data.traceId,
    rate: 5,
    comment: '结果清晰，响应也可靠。',
  }), 'utf8');

  const rated = await runCommand(
    homeDir,
    ['services', 'rate', '--request-file', rateRequestFile],
    {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
      METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
        responseText: 'Tomorrow will be bright with a light wind.',
        deliveryPinId: 'delivery-pin-rating-2',
        ratingRequestText: '服务已完成，如果方便请给我一个评价吧。',
      }),
    }
  );

  assert.equal(rated.exitCode, 0);
  assert.equal(rated.payload.ok, true);
  assert.equal(rated.payload.data.traceId, called.payload.data.traceId);
  assert.equal(rated.payload.data.rate, '5');
  assert.equal(rated.payload.data.comment, '结果清晰，响应也可靠。');
  assert.equal(rated.payload.data.path, '/protocols/skill-service-rate');
  assert.match(rated.payload.data.pinId, /^\/protocols\/skill-service-rate-pin-/);
  assert.equal(rated.payload.data.serviceId, 'chain-service-pin-1');
  assert.equal(rated.payload.data.servicePaidTx, called.payload.data.paymentTxid);
  assert.equal(rated.payload.data.serverBot, 'idq1provider');
  assert.equal(rated.payload.data.ratingMessageSent, true);
  assert.match(rated.payload.data.ratingMessagePinId, /^\/protocols\/simplemsg-pin-/);
  assert.equal(rated.payload.data.ratingMessageError, null);

  const trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', called.payload.data.traceId], {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
      responseText: 'Tomorrow will be bright with a light wind.',
      deliveryPinId: 'delivery-pin-rating-2',
      ratingRequestText: '服务已完成，如果方便请给我一个评价吧。',
    }),
  });

  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.ratingRequested, true);
  assert.equal(trace.payload.data.ratingPublished, true);
  assert.equal(trace.payload.data.ratingPinId, rated.payload.data.pinId);
  assert.equal(trace.payload.data.ratingValue, 5);
  assert.equal(trace.payload.data.ratingComment, '结果清晰，响应也可靠。');
  assert.equal(trace.payload.data.ratingMessageSent, true);
  assert.equal(trace.payload.data.ratingMessageError, null);
  assert.equal(trace.payload.data.tStageCompleted, true);

  const transcriptMarkdown = await readFile(rated.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /结果清晰，响应也可靠。/);
  assert.match(transcriptMarkdown, /我的评分已记录在链上/);
  assert.match(transcriptMarkdown, /\/protocols\/skill-service-rate-pin-/);
});

test('chat private writes encrypted simplemsg on chain and stores a chat trace in the local runtime', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'chat-request.json');
  await writeFile(requestFile, JSON.stringify({
    to: created.payload.data.globalMetaId,
    content: 'hello from loopback',
    replyPin: 'reply-pin-1',
  }), 'utf8');

  const sent = await runCommand(homeDir, ['chat', 'private', '--request-file', requestFile]);

  assert.equal(sent.exitCode, 0);
  assert.equal(sent.payload.ok, true);
  assert.equal(sent.payload.data.to, created.payload.data.globalMetaId);
  assert.equal(sent.payload.data.path, '/protocols/simplemsg');
  assert.equal(sent.payload.data.deliveryMode, 'onchain_simplemsg');
  assert.match(sent.payload.data.pinId, /^\/protocols\/simplemsg-pin-/);
  assert.match(sent.payload.data.txids[0], /^\/protocols\/simplemsg-tx-/);
  assert.match(sent.payload.data.traceId, /^trace-private-/);
  assert.match(sent.payload.data.payload, /"encrypt":"ecdh"/);
  assert.match(sent.payload.data.traceJsonPath, /\/\.runtime\/exports\/traces\/.*\.json$/);

  const trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', sent.payload.data.traceId]);

  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.traceId, sent.payload.data.traceId);
  assert.equal(trace.payload.data.channel, 'simplemsg');
  assert.equal(trace.payload.data.session.peerGlobalMetaId, created.payload.data.globalMetaId);

  const transcriptMarkdown = await readFile(sent.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /hello from loopback/);
});
