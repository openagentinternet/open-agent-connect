import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
const { createSessionStateStore } = require('../../dist/core/a2a/sessionStateStore.js');
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createLocalEvolutionStore } = require('../../dist/core/evolution/localEvolutionStore.js');
const { createRemoteEvolutionStore } = require('../../dist/core/evolution/remoteEvolutionStore.js');
const { createTestServicePaymentExecutor } = require('../../dist/core/payments/servicePayment.js');

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
const TEST_JSON_READ_RETRIES = 5;
const TEST_JSON_READ_DELAY_MS = 10;

let testAtomicWriteSequence = 0;

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

async function readJsonFileWithTransientRetry(filePath, fallback) {
  for (let attempt = 0; attempt <= TEST_JSON_READ_RETRIES; attempt += 1) {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return fallback;
      }
      if (error instanceof SyntaxError && attempt < TEST_JSON_READ_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, TEST_JSON_READ_DELAY_MS));
        continue;
      }
      throw error;
    }
  }
  return fallback;
}

async function writeFileAtomic(filePath, content) {
  testAtomicWriteSequence += 1;
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${testAtomicWriteSequence}.tmp`;
  try {
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function createLlmRuntime(id, provider, health = 'healthy') {
  const now = '2026-05-07T00:00:00.000Z';
  return {
    id,
    provider,
    displayName: `${provider} runtime`,
    binaryPath: `/bin/${provider}`,
    version: '1.0.0',
    authState: 'authenticated',
    health,
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function createLlmBinding(id, slug, llmRuntimeId, role, enabled = true) {
  const now = '2026-05-07T00:00:00.000Z';
  return {
    id,
    metaBotSlug: slug,
    llmRuntimeId,
    role,
    priority: 0,
    enabled,
    createdAt: now,
    updatedAt: now,
  };
}

async function writeSkill(root, skillName) {
  await mkdir(path.join(root, skillName), { recursive: true });
  await writeFile(path.join(root, skillName, 'SKILL.md'), `# ${skillName}\n`, 'utf8');
}

async function preparePrimaryRuntimeSkill(homeDir, skillName, options = {}) {
  const paths = metabotPaths(homeDir);
  const slug = path.basename(path.resolve(homeDir));
  const provider = options.provider || 'codex';
  await mkdir(path.dirname(paths.llmRuntimesPath), { recursive: true });
  await writeFileAtomic(
    paths.llmRuntimesPath,
    `${JSON.stringify({
      version: 1,
      runtimes: [
        createLlmRuntime(`runtime-${provider}`, provider, options.health || 'healthy'),
        createLlmRuntime('runtime-claude-code', 'claude-code'),
      ],
    }, null, 2)}\n`,
  );
  await writeFileAtomic(
    paths.llmBindingsPath,
    `${JSON.stringify({
      version: 1,
      bindings: [
        createLlmBinding(`binding-${provider}-primary`, slug, `runtime-${provider}`, 'primary', options.primaryEnabled !== false),
        createLlmBinding('binding-claude-fallback', slug, 'runtime-claude-code', 'fallback', true),
      ],
    }, null, 2)}\n`,
  );
  if (skillName) {
    const rootName = provider === 'claude-code' ? '.claude' : `.${provider}`;
    await writeSkill(path.join(homeDir, rootName, 'skills'), skillName);
  }
}

async function ensureIndexedProfileHome(homeDir) {
  const systemHome = deriveSystemHome(homeDir);
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  const profilesPath = path.join(managerRoot, 'identity-profiles.json');
  const activeHomePath = path.join(managerRoot, 'active-home.json');
  await mkdir(managerRoot, { recursive: true });

  const profilesState = await readJsonFileWithTransientRetry(profilesPath, { profiles: [] });

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
    await writeFileAtomic(profilesPath, `${JSON.stringify({ profiles: existingProfiles }, null, 2)}\n`);
  }

  await writeFileAtomic(
    activeHomePath,
    `${JSON.stringify({ homeDir: normalizedHomeDir, updatedAt: Date.now() }, null, 2)}\n`,
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

async function waitForTrace(homeDir, traceId, envOverrides, predicate, timeoutMs = 2_500, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let lastTrace = null;
  while (Date.now() < deadline) {
    const trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', traceId], envOverrides);
    if (trace.exitCode === 0 && trace.payload?.ok) {
      lastTrace = trace;
      if (predicate(trace.payload.data)) {
        return trace;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return lastTrace;
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
  const serviceCurrency = typeof options.serviceCurrency === 'string' ? options.serviceCurrency : 'SPACE';
  const servicePrice = typeof options.servicePrice === 'string' ? options.servicePrice : '0.00001';
  const paymentAddress = typeof options.paymentAddress === 'string' ? options.paymentAddress : 'mvc-payment-address';
  const serviceSummary = {
    serviceName: typeof options.serviceName === 'string' ? options.serviceName : 'weather-oracle',
    displayName: typeof options.displayName === 'string' ? options.displayName : 'Weather Oracle',
    description: typeof options.description === 'string' ? options.description : 'Returns tomorrow weather.',
    providerMetaBot: typeof options.providerMetaBot === 'string' ? options.providerMetaBot : 'idq1provider',
    providerSkill: typeof options.providerSkill === 'string' ? options.providerSkill : 'metabot-weather-oracle',
    price: servicePrice,
    currency: serviceCurrency,
    skillDocument: typeof options.skillDocument === 'string' ? options.skillDocument : '# Weather Oracle',
    inputType: typeof options.inputType === 'string' ? options.inputType : 'text',
    outputType: typeof options.outputType === 'string' ? options.outputType : 'text',
    endpoint: typeof options.endpoint === 'string' ? options.endpoint : 'simplemsg',
    paymentAddress,
  };
  const serviceSummaries = Array.isArray(options.serviceSummaries) && options.serviceSummaries.length > 0
    ? options.serviceSummaries
    : [serviceSummary];
  const providerChatPublicKeys = options.providerChatPublicKeys && typeof options.providerChatPublicKeys === 'object'
    ? options.providerChatPublicKeys
    : {};
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
            list: serviceSummaries.map((summary, index) => ({
              id: typeof summary.pinId === 'string' ? summary.pinId : `chain-service-pin-${index + 1}`,
              metaid: typeof summary.metaid === 'string' ? summary.metaid : 'metaid-provider',
              address: typeof summary.providerAddress === 'string' ? summary.providerAddress : 'mvc-provider-address',
              timestamp: nowSec + index,
              status: 0,
              operation: 'create',
              path: '/protocols/skill-service',
              contentSummary: JSON.stringify(summary),
            })),
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
    } else if (url.pathname.startsWith('/api/info/metaid/')) {
      const globalMetaId = decodeURIComponent(url.pathname.slice('/api/info/metaid/'.length));
      const chatpubkey = providerChatPublicKeys[globalMetaId]
        ?? (typeof options.providerChatPublicKey === 'string' ? options.providerChatPublicKey : '');
      if (chatpubkey) {
        payload = {
          data: {
            chatpubkey,
          },
        };
      }
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
    /legacy.*pre-v2|clean.*reinitialize/i
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

test('identity create auto-creates the slugged profile workspace and doctor reports the identity as loaded', async (t) => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'alice');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'Alice'], {
    HOME: systemHome,
  });

  assert.equal(created.exitCode, 0);
  assert.equal(created.payload.ok, true);
  assert.equal(created.payload.data.name, 'Alice');
  assert.match(created.payload.data.globalMetaId, /^id/);
  assert.equal(created.payload.data.subsidyState, 'claimed');
  assert.equal(created.payload.data.syncState, 'synced');
  assert.match(created.payload.data.namePinId, /^\/info\/name-pin-/);
  assert.match(created.payload.data.chatPublicKeyPinId, /^\/info\/chatpubkey-pin-/);

  for (const relativePath of [
    'AGENTS.md',
    'SOUL.md',
    'IDENTITY.md',
    'USER.md',
    'MEMORY.md',
    'memory',
    '.runtime',
    '.runtime/sessions',
    '.runtime/evolution',
    '.runtime/exports',
    '.runtime/state',
    '.runtime/locks',
    '.runtime/config.json',
    '.runtime/identity-secrets.json',
  ]) {
    const targetStat = await stat(path.join(homeDir, relativePath));
    assert.equal(Boolean(targetStat), true, `${relativePath} should exist inside the profile workspace`);
  }

  const doctor = await runCommandWithEnv(systemHome, ['doctor'], {
    HOME: systemHome,
  });

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

test('doctor reports canonical CLI shim path using METABOT_BIN_DIR override', async (t) => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'alice');
  const canonicalBinDir = path.join(systemHome, 'custom-bin');
  const canonicalMetabotPath = path.join(canonicalBinDir, 'metabot');
  t.after(async () => stopDaemon(homeDir));

  await mkdir(canonicalBinDir, { recursive: true });
  await writeFile(canonicalMetabotPath, '#!/usr/bin/env bash\n', 'utf8');

  const created = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'Alice'], {
    HOME: systemHome,
  });
  assert.equal(created.exitCode, 0);
  assert.equal(created.payload.ok, true);

  const doctor = await runCommandWithEnv(systemHome, ['doctor'], {
    HOME: systemHome,
    METABOT_BIN_DIR: canonicalBinDir,
  });

  assert.equal(doctor.exitCode, 0);
  assert.equal(doctor.payload.ok, true);
  assert.deepEqual(
    doctor.payload.data.checks.find((check) => check.code === 'canonical_cli_shim_preferred'),
    {
      code: 'canonical_cli_shim_preferred',
      ok: true,
      canonicalShimPath: canonicalMetabotPath,
    },
  );
});

test('identity create returns identity_name_conflict when an active identity with a different name already exists', async (t) => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'bob');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'Bob'], {
    HOME: systemHome,
  });
  assert.equal(created.exitCode, 0);
  assert.equal(created.payload.ok, true);
  assert.equal(created.payload.data.name, 'Bob');

  const conflict = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'Charles'], {
    HOME: systemHome,
    METABOT_HOME: homeDir,
  });
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
  const bobHome = path.join(systemHome, '.metabot', 'profiles', 'bob');
  const charlesHome = path.join(systemHome, '.metabot', 'profiles', 'charles');

  t.after(async () => stopDaemon(bobHome));
  t.after(async () => stopDaemon(charlesHome));

  const commonEnv = {
    HOME: systemHome,
  };

  const createdBob = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'Bob'], commonEnv);
  assert.equal(createdBob.exitCode, 0);
  assert.equal(createdBob.payload.ok, true);
  assert.equal(createdBob.payload.data.name, 'Bob');

  const createdCharles = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'Charles'], commonEnv);
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
  const firstHome = path.join(systemHome, '.metabot', 'profiles', 'david');
  const secondHome = path.join(systemHome, '.metabot', 'profiles', 'david-2');

  t.after(async () => stopDaemon(firstHome));

  const commonEnv = {
    HOME: systemHome,
  };

  const createdFirst = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'David'], commonEnv);
  assert.equal(createdFirst.exitCode, 0);
  assert.equal(createdFirst.payload.ok, true);
  assert.equal(createdFirst.payload.data.name, 'David');

  const duplicateAttempt = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'David'], commonEnv);
  assert.equal(duplicateAttempt.exitCode, 1);
  assert.equal(duplicateAttempt.payload.ok, false);
  assert.equal(duplicateAttempt.payload.code, 'identity_name_taken');

  await assert.rejects(
    readFile(runtimePath(secondHome, 'runtime-state.json'), 'utf8'),
    /ENOENT/,
  );

  const who = await runCommandWithEnv(systemHome, ['identity', 'who'], commonEnv);
  assert.equal(who.exitCode, 0);
  assert.equal(who.payload.ok, true);
  assert.equal(who.payload.data.activeHomeDir, firstHome);
  assert.equal(who.payload.data.identity.name, 'David');
});

test('identity create rejects a ready explicit home when another indexed profile already owns the same name', async (t) => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const indexedHome = path.join(systemHome, '.metabot', 'profiles', 'bob');
  const explicitHome = path.join(systemHome, '.metabot', 'profiles', 'bob-shadow');
  t.after(async () => stopDaemon(indexedHome));
  t.after(async () => stopDaemon(explicitHome));

  const commonEnv = {
    HOME: systemHome,
  };

  const created = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'Bob'], commonEnv);
  assert.equal(created.exitCode, 0);
  assert.equal(created.payload.ok, true);

  await mkdir(path.join(explicitHome, '.runtime'), { recursive: true });
  await writeFile(
    runtimePath(explicitHome, 'runtime-state.json'),
    `${JSON.stringify({
      identity: created.payload.data,
      services: [],
      traces: [],
    }, null, 2)}\n`,
    'utf8',
  );

  const duplicateAttempt = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'Bob'], {
    ...commonEnv,
    METABOT_HOME: explicitHome,
  });
  assert.equal(duplicateAttempt.exitCode, 1);
  assert.equal(duplicateAttempt.payload.ok, false);
  assert.equal(duplicateAttempt.payload.code, 'identity_name_taken');
});

test('identity create ignores a fresh explicit noncanonical home and activates the canonical slugged profile', async (t) => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const explicitHome = path.join(systemHome, '.metabot', 'profiles', 'custom-home');
  const canonicalHome = path.join(systemHome, '.metabot', 'profiles', 'alice');
  t.after(async () => stopDaemon(canonicalHome));

  const created = await runCommandWithEnv(systemHome, ['identity', 'create', '--name', 'Alice'], {
    HOME: systemHome,
    METABOT_HOME: explicitHome,
  });
  assert.equal(created.exitCode, 0);
  assert.equal(created.payload.ok, true);

  const who = await runCommandWithEnv(systemHome, ['identity', 'who'], {
    HOME: systemHome,
  });
  assert.equal(who.exitCode, 0);
  assert.equal(who.payload.ok, true);
  assert.equal(who.payload.data.activeHomeDir, canonicalHome);
  assert.equal(who.payload.data.identity.name, 'Alice');

  const activeHome = JSON.parse(
    await readFile(path.join(systemHome, '.metabot', 'manager', 'active-home.json'), 'utf8')
  );
  assert.equal(activeHome.homeDir, canonicalHome);
});

test('identity list reads only from manager/identity-profiles.json and does not rewrite it from runtime state', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  const bobHome = path.join(systemHome, '.metabot', 'profiles', 'bob');
  await mkdir(path.join(bobHome, '.runtime'), { recursive: true });
  await mkdir(managerRoot, { recursive: true });

  const profilesPath = path.join(managerRoot, 'identity-profiles.json');
  const activeHomePath = path.join(managerRoot, 'active-home.json');
  const originalState = {
    profiles: [{
      name: 'Bob',
      slug: 'bob',
      aliases: ['Bob', 'bob'],
      homeDir: bobHome,
      globalMetaId: 'gm-bob',
      mvcAddress: 'mvc-bob',
      createdAt: 1,
      updatedAt: 1,
    }],
  };

  await writeFile(profilesPath, `${JSON.stringify(originalState, null, 2)}\n`, 'utf8');
  await writeFile(activeHomePath, `${JSON.stringify({ homeDir: bobHome, updatedAt: 1 }, null, 2)}\n`, 'utf8');
  await writeFile(
    runtimePath(bobHome, 'runtime-state.json'),
    `${JSON.stringify({ identity: { name: 'Mallory', globalMetaId: 'gm-mallory', mvcAddress: 'mvc-mallory' }, services: [], traces: [] }, null, 2)}\n`,
    'utf8',
  );

  const listed = await runCommandWithEnv(systemHome, ['identity', 'list'], {
    HOME: systemHome,
  });

  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.deepEqual(
    listed.payload.data.profiles.map((profile) => profile.name),
    ['Bob'],
  );

  const persisted = JSON.parse(await readFile(profilesPath, 'utf8'));
  assert.deepEqual(persisted, originalState);
});

test('identity who returns an explicit error when no active profile is initialized', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-system-home-'));

  const who = await runCommandWithEnv(systemHome, ['identity', 'who'], {
    HOME: systemHome,
  });

  assert.equal(who.exitCode, 1);
  assert.equal(who.payload.ok, false);
  assert.equal(who.payload.code, 'identity_profile_not_initialized');
  assert.match(who.payload.message, /no active profile initialized/i);
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
  await preparePrimaryRuntimeSkill(homeDir, 'metabot-weather-oracle');

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

test('services publish-skills lists only active MetaBot primary runtime skills', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);
  await preparePrimaryRuntimeSkill(homeDir, 'metabot-weather-oracle');
  await writeSkill(path.join(homeDir, '.claude', 'skills'), 'metabot-claude-only');

  const listed = await runCommand(homeDir, ['services', 'publish-skills']);

  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(listed.payload.data.identity.globalMetaId, created.payload.data.globalMetaId);
  assert.equal(listed.payload.data.runtime.provider, 'codex');
  assert.deepEqual(
    listed.payload.data.skills.map((skill) => skill.skillName),
    ['metabot-weather-oracle'],
  );
});

test('services publish rejects missing primary runtime before chain write', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const payloadFile = path.join(homeDir, 'payload-missing-primary.json');
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

  assert.equal(published.exitCode, 1);
  assert.equal(published.payload.ok, false);
  assert.equal(published.payload.code, 'primary_runtime_missing');
});

test('services publish rejects fallback-only providerSkill before chain write', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);
  await preparePrimaryRuntimeSkill(homeDir, null);
  await writeSkill(path.join(homeDir, '.claude', 'skills'), 'metabot-weather-oracle');

  const payloadFile = path.join(homeDir, 'payload-fallback-only.json');
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

  assert.equal(published.exitCode, 1);
  assert.equal(published.payload.ok, false);
  assert.equal(published.payload.code, 'provider_skill_missing');
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
  await preparePrimaryRuntimeSkill(providerHome, 'tarot-rws');

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
  await preparePrimaryRuntimeSkill(providerHome, 'tarot-rws');

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
  assert.equal(called.payload.data.session.publicStatus, 'requesting_remote');

  const providerTrace = await runCommand(providerHome, ['trace', 'get', '--trace-id', called.payload.data.traceId]);
  assert.equal(providerTrace.exitCode, 0);
  assert.equal(providerTrace.payload.ok, true);
  assert.equal(providerTrace.payload.data.order.role, 'seller');
  assert.equal(providerTrace.payload.data.order.serviceId, published.payload.data.servicePinId);
  assert.equal(providerTrace.payload.data.order.paymentTxid, called.payload.data.paymentTxid);
  assert.equal(providerTrace.payload.data.order.paymentCurrency, 'SPACE');
  assert.equal(providerTrace.payload.data.order.paymentAmount, '0.00001');

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
  t.after(async () => rm(deriveSystemHome(providerHome), { recursive: true, force: true }));
  t.after(async () => rm(deriveSystemHome(callerHome), { recursive: true, force: true }));

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
  await preparePrimaryRuntimeSkill(providerHome, 'tarot-rws');

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

test('network services refreshes the global online service cache and reuses it when chain discovery is unavailable', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer({
    serviceName: 'tarot-reading',
    displayName: '塔罗牌占卜',
    description: '为明天运程、事业和情感提供塔罗牌占卜。',
    providerSkill: 'metabot-tarot-reader',
    servicePrice: '0',
    ratingPins: [
      {
        id: 'rating-pin-1',
        metaid: 'rater-1',
        globalMetaId: 'idq1rater1',
        timestamp: 1_775_000_100,
        contentSummary: JSON.stringify({
          serviceID: 'chain-service-pin-1',
          servicePaidTx: 'payment-1',
          rate: '5',
          comment: '很准确。',
        }),
      },
      {
        id: 'rating-pin-2',
        metaid: 'rater-2',
        globalMetaId: 'idq1rater2',
        timestamp: 1_775_000_200,
        contentSummary: JSON.stringify({
          serviceID: 'chain-service-pin-1',
          servicePaidTx: 'payment-2',
          rate: '3',
          comment: '可参考。',
        }),
      },
    ],
  });
  t.after(async () => stopDaemon(homeDir));

  const listed = await runCommand(
    homeDir,
    ['network', 'services', '--online', '--query', '塔罗牌 明天运程'],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );

  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(listed.payload.data.discoverySource, 'chain');
  assert.equal(listed.payload.data.services.length, 1);
  assert.equal(listed.payload.data.services[0].displayName, '塔罗牌占卜');
  assert.equal(listed.payload.data.services[0].ratingAvg, 4);
  assert.equal(listed.payload.data.services[0].ratingCount, 2);

  const cachePath = path.join(deriveSystemHome(homeDir), '.metabot', 'services', 'services.json');
  const cached = JSON.parse(await readFile(cachePath, 'utf8'));
  assert.equal(cached.services[0].servicePinId, 'chain-service-pin-1');
  assert.equal(cached.services[0].ratingAvg, 4);
  assert.equal(cached.services[0].ratingCount, 2);

  await chainApi.close();
  const fromCache = await runCommand(
    homeDir,
    ['network', 'services', '--online', '--query', '塔罗牌'],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );

  assert.equal(fromCache.exitCode, 0);
  assert.equal(fromCache.payload.ok, true);
  assert.equal(fromCache.payload.data.discoverySource, 'cache');
  assert.equal(fromCache.payload.data.fallbackUsed, true);
  assert.equal(fromCache.payload.data.services.length, 1);
  assert.equal(fromCache.payload.data.services[0].servicePinId, 'chain-service-pin-1');
  assert.equal(fromCache.payload.data.services[0].ratingAvg, 4);
});

test('network services --cached searches the local online service cache without refreshing chain data', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const servicesRoot = path.join(deriveSystemHome(homeDir), '.metabot', 'services');
  await mkdir(servicesRoot, { recursive: true });
  await writeFile(path.join(servicesRoot, 'services.json'), JSON.stringify({
    version: 1,
    services: [
      {
        servicePinId: 'cached-weather-service',
        sourceServicePinId: 'cached-weather-service',
        chainPinIds: ['cached-weather-service'],
        providerGlobalMetaId: 'idq1weather',
        providerMetaId: null,
        providerAddress: null,
        providerName: 'WeatherBot',
        providerSkill: 'metabot-weather-oracle',
        providerDaemonBaseUrl: null,
        providerChatPublicKey: null,
        serviceName: 'weather-oracle',
        displayName: 'Weather Oracle',
        description: 'Returns tomorrow weather.',
        price: '0.00001',
        currency: 'SPACE',
        serviceIcon: null,
        skillDocument: '# Weather Oracle',
        inputType: 'text',
        outputType: 'text',
        endpoint: 'simplemsg',
        paymentAddress: 'mvc-weather-payment',
        available: true,
        online: true,
        lastSeenSec: 1_775_000_030,
        lastSeenAt: 1_775_000_030_000,
        lastSeenAgoSeconds: 12,
        updatedAt: 1_775_000_000_000,
        ratingAvg: 4.9,
        ratingCount: 20,
        cachedAt: 1_775_000_400_000,
      },
      {
        servicePinId: 'cached-tarot-service',
        sourceServicePinId: 'cached-tarot-service',
        chainPinIds: ['cached-tarot-service'],
        providerGlobalMetaId: 'idq1tarot',
        providerMetaId: null,
        providerAddress: null,
        providerName: 'TarotBot',
        providerSkill: 'metabot-tarot-reader',
        providerDaemonBaseUrl: null,
        providerChatPublicKey: null,
        serviceName: 'tarot-reading',
        displayName: '塔罗牌占卜',
        description: '为明天运程、事业和情感提供塔罗牌占卜。',
        price: '0',
        currency: 'SPACE',
        serviceIcon: null,
        skillDocument: '# Tarot Reader',
        inputType: 'text',
        outputType: 'markdown',
        endpoint: 'simplemsg',
        paymentAddress: 'mvc-tarot-payment',
        available: true,
        online: true,
        lastSeenSec: 1_775_000_031,
        lastSeenAt: 1_775_000_031_000,
        lastSeenAgoSeconds: 6,
        updatedAt: 1_775_000_100_000,
        ratingAvg: 4.8,
        ratingCount: 10,
        cachedAt: 1_775_000_400_000,
      },
    ],
    totalServices: 2,
    limit: 1000,
    discoverySource: 'chain',
    fallbackUsed: false,
    lastSyncedAt: 1_775_000_400_000,
    lastError: null,
  }, null, 2), 'utf8');

  const listed = await runCommand(
    homeDir,
    ['network', 'services', '--cached', '--online', '--query', '塔罗牌 明天运程'],
    { METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9' }
  );

  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(listed.payload.data.discoverySource, 'cache');
  assert.equal(listed.payload.data.fallbackUsed, false);
  assert.equal(listed.payload.data.services.length, 1);
  assert.equal(listed.payload.data.services[0].servicePinId, 'cached-tarot-service');
  assert.equal(listed.payload.data.services[0].displayName, '塔罗牌占卜');
});

test('daemon-backed network services forwards --query and filters refreshed online service cache results', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer({
    serviceSummaries: [
      {
        serviceName: 'weather-oracle',
        displayName: 'Weather Oracle',
        description: 'Returns tomorrow weather.',
        providerMetaBot: 'idq1weather',
        providerSkill: 'metabot-weather-oracle',
        price: '0.00001',
        currency: 'SPACE',
        skillDocument: '# Weather Oracle',
        inputType: 'text',
        outputType: 'text',
        endpoint: 'simplemsg',
        paymentAddress: 'mvc-weather-payment',
      },
      {
        serviceName: 'tarot-reading',
        displayName: '塔罗牌占卜',
        description: '为明天运程、事业和情感提供塔罗牌占卜。',
        providerMetaBot: 'idq1tarot',
        providerSkill: 'metabot-tarot-reader',
        price: '0',
        currency: 'SPACE',
        skillDocument: '# Tarot Reader',
        inputType: 'text',
        outputType: 'markdown',
        endpoint: 'simplemsg',
        paymentAddress: 'mvc-tarot-payment',
      },
    ],
  });
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const listed = await runCommand(
    homeDir,
    ['network', 'services', '--online', '--query', '塔罗牌 明天运程'],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );

  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(listed.payload.data.services.length, 1);
  assert.equal(listed.payload.data.services[0].displayName, '塔罗牌占卜');
});

test('skills resolve injects the current cached online remote services context', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer({
    serviceName: 'tarot-reading',
    displayName: '塔罗牌占卜',
    description: '为明天运程、事业和情感提供塔罗牌占卜。',
    providerSkill: 'metabot-tarot-reader',
    servicePrice: '0',
  });
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const listed = await runCommand(
    homeDir,
    ['network', 'services', '--online', '--query', '塔罗牌'],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );
  assert.equal(listed.exitCode, 0);

  const resolved = await runCommand(
    homeDir,
    ['skills', 'resolve', '--skill', 'metabot-network-directory', '--format', 'markdown'],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );

  assert.equal(resolved.exitCode, 0);
  assert.equal(resolved.payload.ok, true);
  assert.match(resolved.payload.data, /<available_remote_services>/);
  assert.match(resolved.payload.data, /<service_name>塔罗牌占卜<\/service_name>/);
  assert.match(resolved.payload.data, /policyMode "confirm_paid_only"/);
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
  await preparePrimaryRuntimeSkill(providerHome, 'metabot-weather-oracle');

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
  await preparePrimaryRuntimeSkill(homeDir, 'metabot-weather-oracle');

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

  assert.equal(called.exitCode, 2);
  assert.equal(called.payload.ok, false);
  assert.equal(called.payload.state, 'waiting');
  assert.match(called.payload.data.traceId, /^trace-/);
  assert.equal(called.payload.data.session.role, 'caller');
  assert.equal(called.payload.data.session.state, 'requesting_remote');
  assert.equal(called.payload.data.session.publicStatus, 'requesting_remote');
  assert.equal(called.payload.data.session.event, 'request_sent');
  assert.match(called.payload.data.session.externalConversationId, /^a2a-session:/);
  assert.equal(called.payload.data.confirmation.requiresConfirmation, true);
  assert.equal(called.payload.data.confirmation.policyMode, 'confirm_all');
  assert.equal(called.payload.data.confirmation.policyReason, 'confirm_all_requires_confirmation');
  assert.equal(called.payload.data.confirmation.requestedPolicyMode, 'confirm_all');
  assert.match(called.payload.data.traceJsonPath, /\/\.runtime\/exports\/traces\/.*\.json$/);
  assert.match(called.payload.data.traceMarkdownPath, /\/\.runtime\/exports\/traces\/.*\.md$/);

  const trace = await waitForTrace(
    homeDir,
    called.payload.data.traceId,
    {},
    (data) => data?.a2a?.publicStatus === 'timeout',
  );

  assert.ok(trace, 'expected trace polling to produce a response');
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
  assert.match(traceMarkdown, /requesting_remote|request_sent/i);

  const sessionState = JSON.parse(
    await readFile(metabotPaths(homeDir).sessionStatePath, 'utf8')
  );
  const callerSession = sessionState.sessions.find((entry) => entry.traceId === called.payload.data.traceId);
  const callerTaskRun = sessionState.taskRuns.find((entry) => entry.runId === called.payload.data.session.taskRunId);
  assert.equal(callerSession.role, 'caller');
  assert.equal(callerSession.state, 'requesting_remote');
  assert.equal(callerTaskRun.state, 'queued');
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
  await preparePrimaryRuntimeSkill(providerHome, 'metabot-weather-oracle');

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
  const providerDaemonTraceUrl = new URL(called.payload.data.localUiUrl);
  assert.equal(providerDaemonTraceUrl.pathname, '/ui/trace');
  assert.equal(providerDaemonTraceUrl.searchParams.get('traceId'), called.payload.data.traceId);
  assert.equal(providerDaemonTraceUrl.searchParams.get('sessionId'), called.payload.data.session.sessionId);
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

test('trace get by session id returns an inspector-shaped fallback when the runtime trace is missing', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const sessionStore = createSessionStateStore(homeDir);
  const now = Date.now();
  await sessionStore.writeState({
    version: 1,
    sessions: [
      {
        sessionId: 'session-missing-trace',
        traceId: 'trace-missing',
        role: 'caller',
        state: 'requesting_remote',
        createdAt: now,
        updatedAt: now,
        callerGlobalMetaId: 'idq1caller',
        providerGlobalMetaId: 'idq1provider',
        servicePinId: 'service-pin-1',
        currentTaskRunId: 'run-missing-trace',
        latestTaskRunState: 'running',
      },
    ],
    taskRuns: [
      {
        runId: 'run-missing-trace',
        sessionId: 'session-missing-trace',
        state: 'running',
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        completedAt: null,
        failureCode: null,
        failureReason: null,
        clarificationRounds: [],
      },
    ],
    transcriptItems: [
      {
        id: 'transcript-1',
        sessionId: 'session-missing-trace',
        taskRunId: 'run-missing-trace',
        timestamp: now,
        type: 'message',
        sender: 'caller',
        content: 'hello provider',
        metadata: null,
      },
    ],
    cursors: {
      caller: null,
      provider: null,
    },
    publicStatusSnapshots: [
      {
        sessionId: 'session-missing-trace',
        taskRunId: 'run-missing-trace',
        status: 'requesting_remote',
        mapped: true,
        rawEvent: 'order_sent',
        resolvedAt: now,
      },
    ],
  });

  const result = await runCommand(homeDir, [
    'trace',
    'get',
    '--session-id',
    'session-missing-trace',
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.traceId, 'trace-missing');
  assert.equal(result.payload.data.sessionId, 'session-missing-trace');
  assert.equal(result.payload.data.session.sessionId, 'session-missing-trace');
  assert.equal(result.payload.data.session.peerGlobalMetaId, 'idq1provider');
  assert.equal(result.payload.data.order, null);
  assert.equal(result.payload.data.orderTxid, null);
  assert.equal(result.payload.data.paymentTxid, null);
  assert.equal(result.payload.data.a2a.sessionId, 'session-missing-trace');
  assert.equal(result.payload.data.a2a.publicStatus, 'requesting_remote');
  assert.deepEqual(result.payload.data.artifacts, {
    transcriptMarkdownPath: null,
    traceMarkdownPath: null,
    traceJsonPath: null,
  });
  assert.equal(result.payload.data.inspector.session.sessionId, 'session-missing-trace');
  assert.equal(result.payload.data.inspector.transcriptItems[0].content, 'hello provider');
  const localUiUrl = new URL(result.payload.data.localUiUrl);
  assert.equal(localUiUrl.pathname, '/ui/trace');
  assert.equal(localUiUrl.searchParams.get('traceId'), 'trace-missing');
  assert.equal(localUiUrl.searchParams.get('sessionId'), 'session-missing-trace');
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

  assert.equal(called.exitCode, 2);
  assert.equal(called.payload.ok, false);
  assert.equal(called.payload.state, 'waiting');
  assert.equal(called.payload.data.session.publicStatus, 'requesting_remote');
  assert.equal(called.payload.data.providerGlobalMetaId, 'idq1provider');
  assert.equal(called.payload.data.serviceName, 'Weather Oracle');
  assert.equal(called.payload.data.session.role, 'caller');
  assert.match(called.payload.data.orderPinId, /^\/protocols\/simplemsg-pin-/);
  assert.match(called.payload.data.orderTxid, /^\/protocols\/simplemsg-tx-/);
  assert.deepEqual(called.payload.data.orderTxids, [called.payload.data.orderTxid]);
  const traceUrl = new URL(called.payload.localUiUrl);
  assert.equal(traceUrl.pathname, '/ui/trace');
  assert.equal(traceUrl.searchParams.get('traceId'), called.payload.data.traceId);
  assert.equal(traceUrl.searchParams.get('sessionId'), called.payload.data.session.sessionId);
  const orderConversation = await createA2AConversationStore({
    homeDir,
    local: {
      globalMetaId: created.payload.data.globalMetaId,
      name: created.payload.data.name,
      chatPublicKey: created.payload.data.chatPublicKey,
    },
    peer: {
      globalMetaId: 'idq1provider',
      name: 'Weather Oracle',
    },
  }).readConversation();
  const orderMessage = orderConversation.messages.find(
    (message) => message.protocolTag === 'ORDER',
  );
  assert.ok(orderMessage, 'expected outgoing ORDER message in the unified A2A store');
  assert.equal(orderMessage.direction, 'outgoing');
  assert.equal(orderMessage.kind, 'order_protocol');
  assert.equal(orderMessage.orderTxid, called.payload.data.orderTxid);
  assert.equal(orderMessage.paymentTxid, called.payload.data.paymentTxid);
  assert.equal(orderMessage.pinId, called.payload.data.orderPinId);
  assert.deepEqual(orderMessage.txids, called.payload.data.orderTxids);
  assert.match(orderMessage.content, /^\[ORDER\]/);
  assert.equal(orderConversation.sessions.some(
    (session) => session.sessionId === orderMessage.sessionId && session.type === 'peer',
  ), true);
  assert.equal(orderConversation.indexes.orderTxidToSessionId[called.payload.data.orderTxid], orderMessage.orderSessionId);
  const expectedPayment = await createTestServicePaymentExecutor().execute({
    servicePinId: 'chain-service-pin-1',
    providerGlobalMetaId: 'idq1provider',
    paymentAddress: 'mvc-payment-address',
    amount: '0.00001',
    currency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
  });
  assert.equal(called.payload.data.paymentTxid, expectedPayment.paymentTxid);

  const trace = await waitForTrace(homeDir, called.payload.data.traceId, {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
      responseText: 'Tomorrow will be bright with a light wind.',
      deliveryPinId: 'delivery-pin-1',
    }),
  }, (data) => data?.a2a?.publicStatus === 'completed');

  assert.ok(trace, 'expected trace polling to produce a response');
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.order.serviceId, 'chain-service-pin-1');
  assert.equal(trace.payload.data.session.peerGlobalMetaId, 'idq1provider');
  assert.equal(trace.payload.data.a2a.publicStatus, 'completed');
  assert.equal(trace.payload.data.a2a.latestEvent, 'provider_completed');
  assert.equal(trace.payload.data.resultText, 'Tomorrow will be bright with a light wind.');
  assert.equal(trace.payload.data.resultDeliveryPinId, 'delivery-pin-1');
  assert.equal(trace.payload.data.ratingRequestText, null);
  assert.equal(trace.payload.data.order.paymentTxid, expectedPayment.paymentTxid);
  assert.equal(trace.payload.data.order.orderPinId, called.payload.data.orderPinId);
  assert.equal(trace.payload.data.order.orderTxid, called.payload.data.orderTxid);
  assert.deepEqual(trace.payload.data.order.orderTxids, called.payload.data.orderTxids);
  const traceGetUrl = new URL(trace.payload.data.localUiUrl);
  assert.equal(traceGetUrl.pathname, '/ui/trace');
  assert.equal(traceGetUrl.searchParams.get('traceId'), called.payload.data.traceId);
  assert.equal(traceGetUrl.searchParams.get('sessionId'), called.payload.data.session.sessionId);

  const sessionDetail = await runCommand(homeDir, [
    'trace',
    'get',
    '--session-id',
    called.payload.data.session.sessionId,
  ], {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
  });
  assert.equal(sessionDetail.exitCode, 0);
  assert.equal(sessionDetail.payload.ok, true);
  assert.equal(sessionDetail.payload.data.traceId, called.payload.data.traceId);
  assert.equal(sessionDetail.payload.data.session.sessionId, called.payload.data.session.sessionId);
  assert.equal(sessionDetail.payload.data.order.orderPinId, called.payload.data.orderPinId);
  assert.equal(sessionDetail.payload.data.order.orderTxid, called.payload.data.orderTxid);
  assert.deepEqual(sessionDetail.payload.data.order.orderTxids, called.payload.data.orderTxids);
  assert.equal(sessionDetail.payload.data.order.paymentTxid, expectedPayment.paymentTxid);
  const sessionTraceUrl = new URL(sessionDetail.payload.data.localUiUrl);
  assert.equal(sessionTraceUrl.pathname, '/ui/trace');
  assert.equal(sessionTraceUrl.searchParams.get('traceId'), called.payload.data.traceId);
  assert.equal(sessionTraceUrl.searchParams.get('sessionId'), called.payload.data.session.sessionId);

  const transcriptMarkdown = await readFile(called.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /Tomorrow will be bright with a light wind/);
});

test('services call can resolve a cached online service when the chain directory is temporarily unavailable', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const providerChatPublicKey = '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf';
  const chainApi = await startFakeChainApiServer({
    servicePrice: '0',
    providerChatPublicKeys: {
      idq1provider: providerChatPublicKey,
    },
  });
  t.after(async () => stopDaemon(homeDir));

  const listed = await runCommand(
    homeDir,
    ['network', 'services', '--online'],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );
  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(listed.payload.data.services[0].servicePinId, 'chain-service-pin-1');

  const created = await runCommand(
    homeDir,
    ['identity', 'create', '--name', 'Alice'],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );
  assert.equal(created.exitCode, 0);

  await chainApi.close();

  const requestFile = path.join(homeDir, 'cached-chain-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      policyMode: 'confirm_paid_only',
    },
  }), 'utf8');

  const called = await runCommand(
    homeDir,
    ['services', 'call', '--request-file', requestFile],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );

  assert.equal(called.exitCode, 2);
  assert.equal(called.payload.ok, false);
  assert.equal(called.payload.state, 'waiting');
  assert.equal(called.payload.data.serviceName, 'Weather Oracle');
  assert.equal(called.payload.data.providerGlobalMetaId, 'idq1provider');
  assert.equal(called.payload.data.confirmation.requiresConfirmation, false);
  assert.equal(called.payload.data.confirmation.policyMode, 'confirm_paid_only');
  assert.equal(called.payload.data.confirmation.confirmationBypassed, true);
});

test('services call can select a cached free online service from a natural-language task', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const providerChatPublicKey = '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf';
  t.after(async () => stopDaemon(homeDir));

  const servicesRoot = path.join(deriveSystemHome(homeDir), '.metabot', 'services');
  await mkdir(servicesRoot, { recursive: true });
  await writeFile(path.join(servicesRoot, 'services.json'), JSON.stringify({
    version: 1,
    services: [
      {
        servicePinId: 'cached-tarot-service',
        sourceServicePinId: 'cached-tarot-service',
        chainPinIds: ['cached-tarot-service'],
        providerGlobalMetaId: 'idq1tarot',
        providerMetaId: null,
        providerAddress: null,
        providerName: 'TarotBot',
        providerSkill: 'metabot-tarot-reader',
        providerDaemonBaseUrl: null,
        providerChatPublicKey,
        serviceName: 'tarot-reading',
        displayName: '塔罗牌占卜',
        description: '为明天运程、事业和情感提供塔罗牌占卜。',
        price: '0',
        currency: 'SPACE',
        serviceIcon: null,
        skillDocument: '# Tarot Reader',
        inputType: 'text',
        outputType: 'markdown',
        endpoint: 'simplemsg',
        paymentAddress: 'mvc-tarot-payment',
        available: true,
        online: true,
        lastSeenSec: 1_775_000_031,
        lastSeenAt: 1_775_000_031_000,
        lastSeenAgoSeconds: 6,
        updatedAt: 1_775_000_100_000,
        ratingAvg: 4.8,
        ratingCount: 10,
        cachedAt: 1_775_000_400_000,
      },
    ],
    totalServices: 1,
    limit: 1000,
    discoverySource: 'chain',
    fallbackUsed: false,
    lastSyncedAt: 1_775_000_400_000,
    lastError: null,
  }, null, 2), 'utf8');

  const created = await runCommand(
    homeDir,
    ['identity', 'create', '--name', 'Alice'],
    { METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9' }
  );
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'intent-cache-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      userTask: '帮我使用塔罗牌占卜',
      rawRequest: '帮我使用塔罗牌占卜',
      taskContext: 'The user asked for a tarot reading in natural language.',
      policyMode: 'confirm_paid_only',
    },
  }), 'utf8');

  const called = await runCommand(
    homeDir,
    ['services', 'call', '--request-file', requestFile],
    { METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9' }
  );

  assert.equal(called.exitCode, 2);
  assert.equal(called.payload.ok, false);
  assert.equal(called.payload.state, 'waiting');
  assert.equal(called.payload.data.servicePinId, 'cached-tarot-service');
  assert.equal(called.payload.data.serviceName, '塔罗牌占卜');
  assert.equal(called.payload.data.providerGlobalMetaId, 'idq1tarot');
  assert.equal(called.payload.data.selectedFromCache, true);
  assert.equal(called.payload.data.confirmation.requiresConfirmation, false);
  assert.equal(called.payload.data.confirmation.confirmationBypassed, true);
});

test('services call does not honor confirmed=true on natural-language cached paid selection', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const servicesRoot = path.join(deriveSystemHome(homeDir), '.metabot', 'services');
  await mkdir(servicesRoot, { recursive: true });
  await writeFile(path.join(servicesRoot, 'services.json'), JSON.stringify({
    version: 1,
    services: [
      {
        servicePinId: 'cached-paid-tarot-service',
        sourceServicePinId: 'cached-paid-tarot-service',
        chainPinIds: ['cached-paid-tarot-service'],
        providerGlobalMetaId: 'idq1paidtarot',
        providerMetaId: null,
        providerAddress: null,
        providerName: 'PaidTarotBot',
        providerSkill: 'metabot-tarot-reader',
        providerDaemonBaseUrl: null,
        providerChatPublicKey: null,
        serviceName: 'paid-tarot-reading',
        displayName: '付费塔罗牌占卜',
        description: '为明天运程、事业和情感提供付费塔罗牌占卜。',
        price: '0.00001',
        currency: 'SPACE',
        serviceIcon: null,
        skillDocument: '# Paid Tarot Reader',
        inputType: 'text',
        outputType: 'markdown',
        endpoint: 'simplemsg',
        paymentAddress: 'mvc-paid-tarot-payment',
        available: true,
        online: true,
        lastSeenSec: 1_775_000_031,
        lastSeenAt: 1_775_000_031_000,
        lastSeenAgoSeconds: 6,
        updatedAt: 1_775_000_100_000,
        ratingAvg: 4.8,
        ratingCount: 10,
        cachedAt: 1_775_000_400_000,
      },
    ],
    totalServices: 1,
    limit: 1000,
    discoverySource: 'chain',
    fallbackUsed: false,
    lastSyncedAt: 1_775_000_400_000,
    lastError: null,
  }, null, 2), 'utf8');

  const created = await runCommand(
    homeDir,
    ['identity', 'create', '--name', 'Alice'],
    { METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9' }
  );
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'intent-paid-cache-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      userTask: '帮我使用付费塔罗牌占卜',
      rawRequest: '帮我使用付费塔罗牌占卜',
      taskContext: 'The user asked for a tarot reading in natural language.',
      policyMode: 'confirm_paid_only',
      confirmed: true,
    },
  }), 'utf8');

  const called = await runCommand(
    homeDir,
    ['services', 'call', '--request-file', requestFile],
    { METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9' }
  );

  assert.equal(called.exitCode, 0);
  assert.equal(called.payload.ok, true);
  assert.equal(called.payload.state, 'awaiting_confirmation');
  assert.equal(called.payload.data.serviceName, '付费塔罗牌占卜');
  assert.equal(called.payload.data.providerGlobalMetaId, 'idq1paidtarot');
  assert.equal(called.payload.data.selectedFromCache, true);
  assert.equal(called.payload.data.payment.amount, '0.00001');
  assert.equal(called.payload.data.confirmation.requiresConfirmation, true);
  assert.equal(called.payload.data.confirmRequest.request.servicePinId, 'cached-paid-tarot-service');
  assert.equal(called.payload.data.confirmRequest.request.providerGlobalMetaId, 'idq1paidtarot');
  assert.equal(called.payload.data.confirmRequest.request.confirmed, true);
  assert.equal(called.payload.data.traceId, null);
});

test('paid confirm_paid_only service call returns confirmation preview before payment or order write', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer({
    servicePrice: '0.00001',
  });
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const listed = await runCommand(
    homeDir,
    ['network', 'services', '--online'],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );
  assert.equal(listed.exitCode, 0);

  const created = await runCommand(
    homeDir,
    ['identity', 'create', '--name', 'Alice'],
    { METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl }
  );
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'paid-confirm-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      policyMode: 'confirm_paid_only',
    },
  }), 'utf8');

  const called = await runCommand(
    homeDir,
    ['services', 'call', '--request-file', requestFile],
    {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    }
  );

  assert.equal(called.exitCode, 0);
  assert.equal(called.payload.ok, true);
  assert.equal(called.payload.state, 'awaiting_confirmation');
  assert.equal(called.payload.data.serviceName, 'Weather Oracle');
  assert.equal(called.payload.data.payment.amount, '0.00001');
  assert.equal(called.payload.data.confirmation.requiresConfirmation, true);
  assert.equal(called.payload.data.confirmRequest.request.confirmed, true);
  assert.equal(called.payload.data.traceId, null);
});

test('services call rejects unsupported chain service payment before sending order', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer({
    serviceCurrency: 'DOGE',
    servicePrice: '1',
    paymentAddress: 'doge-payment-address',
  });
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'chain-doge-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: 'chain-service-pin-1',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Tell me tomorrow weather',
      taskContext: 'User is in Shanghai',
      spendCap: {
        amount: '2',
        currency: 'DOGE',
      },
    },
  }), 'utf8');

  const called = await runCommand(
    homeDir,
    ['services', 'call', '--request-file', requestFile],
    {
      METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    }
  );

  assert.equal(called.exitCode, 1);
  assert.equal(called.payload.ok, false);
  assert.equal(called.payload.state, 'failed');
  assert.equal(called.payload.code, 'service_payment_unsupported_settlement');
  assert.equal(called.payload.data?.orderPinId, undefined);

  const state = await createRuntimeStateStore(homeDir).readState();
  assert.equal(state.traces.some((trace) => trace.session?.peerGlobalMetaId === 'idq1provider'), false);
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

  assert.equal(called.exitCode, 2);
  assert.equal(called.payload.ok, false);
  assert.equal(called.payload.state, 'waiting');
  assert.equal(called.payload.data.session.role, 'caller');
  assert.equal(called.payload.data.session.publicStatus, 'requesting_remote');
  assert.equal(called.payload.data.session.event, 'request_sent');
  assert.equal('responseText' in called.payload.data, false);

  const trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', called.payload.data.traceId], {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
  });
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.a2a.publicStatus, 'requesting_remote');
  assert.equal(trace.payload.data.a2a.latestEvent, 'request_sent');

  const transcriptMarkdown = await readFile(called.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /remote MetaBot task session/i);
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

  assert.equal(called.exitCode, 2);
  assert.equal(called.payload.ok, false);
  assert.equal(called.payload.state, 'waiting');
  assert.equal(called.payload.data.session.publicStatus, 'requesting_remote');
  assert.equal(called.payload.data.session.event, 'request_sent');

  const trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', called.payload.data.traceId], {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    METABOT_TEST_FAKE_METAWEB_REPLY: replyConfig,
  });
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.a2a.publicStatus, 'requesting_remote');
  assert.equal(trace.payload.data.a2a.latestEvent, 'request_sent');

  const transcriptMarkdown = await readFile(called.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /remote MetaBot task session/i);
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

  assert.equal(called.exitCode, 2);
  assert.equal(called.payload.ok, false);
  assert.equal(called.payload.state, 'waiting');
  assert.equal(called.payload.data.session.publicStatus, 'requesting_remote');

  const trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', called.payload.data.traceId], {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    METABOT_TEST_FAKE_METAWEB_REPLY: replyConfig,
  });
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.a2a.publicStatus, 'requesting_remote');
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

  assert.equal(called.exitCode, 2);
  assert.equal(called.payload.ok, false);
  assert.equal(called.payload.state, 'waiting');
  assert.equal(called.payload.data.session.publicStatus, 'requesting_remote');

  const trace = await waitForTrace(homeDir, called.payload.data.traceId, {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
      responseText: 'Tomorrow will be bright with a light wind.',
      deliveryPinId: 'delivery-pin-rating-1',
      ratingRequestText: '服务已完成，如果方便请给我一个评价吧。',
    }),
  }, (data) => data?.ratingRequestText !== null);

  assert.ok(trace, 'expected trace polling to produce a response');
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.ratingRequestText, '服务已完成，如果方便请给我一个评价吧。');
});

test('services call auto-rates with ORDER_END after a provider NeedsRating request', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const chainApi = await startFakeChainApiServer();
  t.after(async () => stopDaemon(homeDir));
  t.after(async () => chainApi.close());

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const requestFile = path.join(homeDir, 'chain-auto-rating-request.json');
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

  const env = {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
      responseText: 'Tomorrow will be bright with a light wind.',
      deliveryPinId: 'delivery-pin-auto-rating-1',
      ratingRequestText: '服务已完成，如果方便请给我一个评价吧。',
    }),
    METABOT_TEST_FAKE_BUYER_RATING_REPLY: '评分：5分。结果清晰，响应可靠，谢谢你的天气服务。',
  };

  const called = await runCommand(
    homeDir,
    ['services', 'call', '--request-file', requestFile],
    env,
  );

  assert.equal(called.exitCode, 2);
  assert.equal(called.payload.ok, false);
  assert.equal(called.payload.state, 'waiting');

  const trace = await waitForTrace(
    homeDir,
    called.payload.data.traceId,
    env,
    (data) => data?.ratingPublished === true && data?.ratingMessageSent === true,
  );

  assert.ok(trace, 'expected trace polling to observe automatic buyer rating');
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.ratingPublished, true);
  assert.equal(trace.payload.data.ratingValue, 5);
  assert.equal(trace.payload.data.ratingComment, '评分：5分。结果清晰，响应可靠，谢谢你的天气服务。');
  assert.match(trace.payload.data.ratingPinId, /^\/protocols\/skill-service-rate-pin-/);
  assert.equal(trace.payload.data.ratingMessageSent, true);
  assert.match(trace.payload.data.ratingMessagePinId, /^\/protocols\/simplemsg-pin-/);
  assert.equal(trace.payload.data.tStageCompleted, true);

  const orderEndTranscript = trace.payload.data.inspector.transcriptItems.find((item) => (
    typeof item.content === 'string' && item.content.startsWith('[ORDER_END')
  ));
  assert.ok(orderEndTranscript, 'expected trace transcript to include the ORDER_END ceremony');
  assert.match(orderEndTranscript.content, /rated\]/);
  assert.match(orderEndTranscript.content, /评分：5分/);

  const chatConversation = await createA2AConversationStore({
    homeDir,
    local: {
      globalMetaId: created.payload.data.globalMetaId,
      name: created.payload.data.name,
      chatPublicKey: created.payload.data.chatPublicKey,
    },
    peer: {
      globalMetaId: 'idq1provider',
      name: 'Weather Oracle',
      chatPublicKey: env.METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY,
    },
  }).readConversation();
  const orderEnd = chatConversation.messages.find((message) => message.protocolTag === 'ORDER_END');
  assert.ok(orderEnd, 'expected automatic rating to persist an outgoing ORDER_END message');
  assert.equal(orderEnd.direction, 'outgoing');
  assert.match(orderEnd.content, /^\[ORDER_END(?::[0-9a-f]{64})? rated\]/);
  assert.match(orderEnd.content, /\/protocols\/skill-service-rate-pin-/);
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

  assert.equal(called.exitCode, 2);
  assert.equal(called.payload.ok, false);
  assert.equal(called.payload.state, 'waiting');

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

  const trace = await waitForTrace(homeDir, called.payload.data.traceId, {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
      responseText: 'Tomorrow will be bright with a light wind.',
      deliveryPinId: 'delivery-pin-rating-2',
      ratingRequestText: '服务已完成，如果方便请给我一个评价吧。',
    }),
  }, (data) => data?.ratingPublished === true);

  assert.ok(trace, 'expected trace polling to produce a response');
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(typeof trace.payload.data.ratingRequested, 'boolean');
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
  assert.equal(Object.hasOwn(sent.payload.data, 'payload'), false);
  assert.equal(Object.hasOwn(sent.payload.data, 'encryptedContent'), false);
  assert.equal(Object.hasOwn(sent.payload.data, 'secretVariant'), false);
  assert.equal(Object.hasOwn(sent.payload.data, 'peerChatPublicKey'), false);
  assert.doesNotMatch(JSON.stringify(sent.payload.data), /"encrypt":"ecdh"/);
  assert.match(sent.payload.data.traceJsonPath, /\/\.runtime\/exports\/traces\/.*\.json$/);
  assert.equal(typeof sent.payload.data.a2aSessionId, 'string');
  assert.ok(sent.payload.data.a2aSessionId.length > 0);
  assert.doesNotMatch(sent.payload.data.localUiUrl, /\/ui\/chat-viewer/);
  const viewerUrl = new URL(sent.payload.data.localUiUrl);
  assert.equal(viewerUrl.pathname, '/ui/trace');
  assert.equal(viewerUrl.searchParams.get('traceId'), sent.payload.data.a2aSessionId);
  assert.equal(viewerUrl.searchParams.get('sessionId'), sent.payload.data.a2aSessionId);

  const trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', sent.payload.data.traceId]);

  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.traceId, sent.payload.data.traceId);
  assert.equal(trace.payload.data.channel, 'simplemsg');
  assert.equal(trace.payload.data.session.peerGlobalMetaId, created.payload.data.globalMetaId);

  const chatConversation = await createA2AConversationStore({
    homeDir,
    local: {
      globalMetaId: created.payload.data.globalMetaId,
      name: created.payload.data.name,
      chatPublicKey: created.payload.data.chatPublicKey,
    },
    peer: {
      globalMetaId: created.payload.data.globalMetaId,
      name: created.payload.data.name,
      chatPublicKey: created.payload.data.chatPublicKey,
    },
  }).readConversation();
  const chatMessage = chatConversation.messages.find(
    (message) => message.content === 'hello from loopback',
  );
  assert.ok(chatMessage, 'expected outgoing private chat message in the unified A2A store');
  assert.equal(chatMessage.direction, 'outgoing');
  assert.equal(chatMessage.kind, 'private_chat');
  assert.equal(chatMessage.protocolTag, null);
  assert.equal(chatMessage.sessionId, sent.payload.data.a2aSessionId);
  assert.equal(chatMessage.pinId, sent.payload.data.pinId);
  assert.deepEqual(chatMessage.txids, sent.payload.data.txids);
  assert.equal(chatMessage.replyPinId, 'reply-pin-1');
  assert.equal(chatConversation.sessions.some(
    (session) => session.sessionId === chatMessage.sessionId && session.type === 'peer',
  ), true);

  const transcriptMarkdown = await readFile(sent.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /hello from loopback/);
});
