import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { cleanupProfileHome } from '../helpers/profileHome.mjs';
import { mkdtempTempRoot, stopTestDaemonsUnderRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');
const {
  buildDaemonConfigHash,
  createServiceRefundSyncLoop,
  createPrivateChatReplyRunnerForProfile,
  getDefaultDaemonPort,
  refreshA2ASimplemsgListenerForIdentityProfileRegistration,
} = require('../../dist/cli/runtime.js');
const { createMetabotProfile, updateMetabotProfile } = require('../../dist/core/bot/metabotProfileManager.js');
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { createLlmRuntimeResolver } = require('../../dist/core/llm/llmRuntimeResolver.js');
const { resolveMetabotHomeSelection } = require('../../dist/core/state/homeSelection.js');
const {
  resolveMetabotDaemonPaths,
  resolveMetabotPaths,
} = require('../../dist/core/state/paths.js');
const { createDaemonStateStore } = require('../../dist/core/state/daemonStateStore.js');
const { createProviderPresenceStateStore } = require('../../dist/core/provider/providerPresenceState.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createSellerOrderRecord } = require('../../dist/core/orders/sellerOrderState.js');
const { createSessionStateStore } = require('../../dist/core/a2a/sessionStateStore.js');
const { createA2AConversationStore } = require('../../dist/core/a2a/conversationStore.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createTestServicePaymentExecutor } = require('../../dist/core/payments/servicePayment.js');

// Daemon boots in this file must not probe the ambient PATH for LLM runtimes.
process.env.METABOT_TEST_SKIP_BACKGROUND_LLM_DISCOVERY = '1';

const TEST_JSON_READ_RETRIES = 5;
const TEST_JSON_READ_DELAY_MS = 10;
const LEGACY_PROVIDER_PRESENCE_KEYS = [
  ['last', 'Heartbeat', 'At'].join(''),
  ['last', 'Heartbeat', 'PinId'].join(''),
  ['last', 'Heartbeat', 'Txid'].join(''),
];

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
  const systemHome = await mkdtempTempRoot(prefix || 'metabot-cli-runtime-');
  return createProfileHome(systemHome, slug);
}

function runtimePath(homeDir, ...segments) {
  return path.join(homeDir, '.runtime', ...segments);
}

function daemonStatePath(homeDir) {
  return resolveMetabotDaemonPaths(deriveSystemHome(homeDir)).daemonStatePath;
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
    METABOT_TEST_FAKE_PROVIDER_LLM_REPLY: 'Provider test result from {{skill}}.',
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
    ...envOverrides,
  };

  const exitCode = await runCli(args, {
    env,
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
  });

  const payload = parseLastJson(stdout);

  return {
    exitCode,
    stdout,
    stderr,
    payload,
  };
}

test('refreshA2ASimplemsgListenerForIdentityProfileRegistration restarts the listener and watchdog when enabled', async () => {
  const events = [];
  const listener = {
    stop: () => {
      events.push('listener:stop');
    },
    start: async () => {
      events.push('listener:start');
      return {
        started: [
          {
            slug: 'new-bot',
            name: 'New Bot',
            homeDir: '/tmp/new-bot',
            globalMetaId: 'idq1newbot',
          },
        ],
        skipped: [],
      };
    },
  };
  const watchdog = {
    stop: () => {
      events.push('watchdog:stop');
    },
    start: () => {
      events.push('watchdog:start');
    },
  };
  const backfill = {
    stop: () => {
      events.push('backfill:stop');
    },
    start: async () => {
      events.push('backfill:start');
      return { started: [], skipped: [] };
    },
  };

  const result = await refreshA2ASimplemsgListenerForIdentityProfileRegistration({
    enabled: true,
    listener,
    backfill,
    watchdog,
  });

  assert.deepEqual(events, [
    'watchdog:stop',
    'listener:stop',
    'backfill:stop',
    'listener:start',
    'backfill:start',
    'watchdog:start',
  ]);
  assert.equal(result.refreshed, true);
  assert.deepEqual(result.report.started.map((profile) => profile.slug), ['new-bot']);
});

test('service refund sync loop prevents overlapping runs and clears its interval', async () => {
  const warnings = [];
  const scheduled = [];
  const cleared = [];
  let calls = 0;
  let releaseFirstRun;

  const loop = createServiceRefundSyncLoop({
    intervalMs: 1000,
    syncRefunds: async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise((resolve) => {
          releaseFirstRun = resolve;
        });
      }
    },
    setIntervalFn: (callback, intervalMs) => {
      const handle = { intervalMs, unrefCalled: false, unref() { this.unrefCalled = true; } };
      scheduled.push({ callback, handle });
      return handle;
    },
    clearIntervalFn: (handle) => {
      cleared.push(handle);
    },
    logWarning: (message) => {
      warnings.push(message);
    },
  });

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].handle.intervalMs, 60_000);
  assert.equal(scheduled[0].handle.unrefCalled, true);

  const firstRun = scheduled[0].callback();
  const overlappingRun = scheduled[0].callback();
  assert.equal(calls, 1);
  releaseFirstRun();
  await firstRun;
  await overlappingRun;

  assert.equal(calls, 1);
  assert.deepEqual(warnings, []);

  loop.stop();
  loop.stop();
  assert.deepEqual(cleared, [scheduled[0].handle]);
});

test('createPrivateChatReplyRunnerForProfile wires allowed chat skills for the active profile path', async (t) => {
  const systemHomeDir = await mkdtempTempRoot('metabot-active-allowed-skills-');
  t.after(async () => {
    await rm(systemHomeDir, { recursive: true, force: true });
  });
  const profile = await createMetabotProfile(systemHomeDir, { name: 'Active Bot' });
  await updateMetabotProfile(systemHomeDir, profile.slug, {
    allowChatSkills: ['metabot-weather'],
  });
  const paths = resolveMetabotPaths(profile.homeDir);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.write({
    version: 1,
    runtimes: [createLlmRuntime('runtime-codex', 'codex')],
  });
  await bindingStore.write({
    version: 1,
    bindings: [createLlmBinding('binding-codex-primary', profile.slug, 'runtime-codex', 'primary')],
  });
  const skillRoot = path.join(systemHomeDir, '.codex', 'skills', 'metabot-weather');
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, 'SKILL.md'), '# metabot-weather\n', 'utf8');
  const executorCalls = [];
  const runner = createPrivateChatReplyRunnerForProfile({
    paths,
    metaBotSlug: profile.slug,
    runtimeResolver: createLlmRuntimeResolver({
      runtimeStore,
      bindingStore,
      getPreferredRuntimeId: async () => null,
    }),
    runtimeStore,
    bindingStore,
    llmExecutor: {
      execute: async (request) => {
        executorCalls.push(request);
        return 'llm-session-active-allowed';
      },
      getSession: async (sessionId) => ({
        sessionId,
        status: 'completed',
        result: {
          status: 'completed',
          output: 'Weather reply.',
          durationMs: 1,
        },
      }),
    },
    env: {},
  });

  const result = await runner({
    conversation: {
      conversationId: 'pc-self-peer',
      peerGlobalMetaId: 'peer-gm-1',
      peerName: 'PeerBot',
      topic: null,
      strategyId: null,
      state: 'active',
      turnCount: 1,
      lastDirection: 'inbound',
      createdAt: 1000,
      updatedAt: 2000,
    },
    recentMessages: [
      { conversationId: 'pc-self-peer', messageId: 'm1', direction: 'inbound', senderGlobalMetaId: 'peer', content: 'weather?', messagePinId: null, extensions: null, timestamp: 1000 },
    ],
    persona: { role: 'Local bot', soul: 'Concise', goal: 'Help peers' },
    strategy: null,
    inboundMessage: {
      conversationId: 'pc-self-peer',
      messageId: 'm1',
      direction: 'inbound',
      senderGlobalMetaId: 'peer',
      content: 'weather?',
      messagePinId: null,
      extensions: null,
      timestamp: 1000,
    },
  });

  assert.deepEqual(result, {
    state: 'reply',
    content: 'Weather reply.',
  });
  assert.equal(executorCalls.length, 1);
  assert.deepEqual(executorCalls[0].skills, ['metabot-weather']);
  assert.match(executorCalls[0].skillSourcePaths['metabot-weather'], /\.codex[/\\]skills[/\\]metabot-weather$/);
  // Chat turns run with the host's normal environment so allowed skills can
  // fully execute (IDBots-style); the allow-list is scoped in the prompt.
  assert.equal(Object.hasOwn(executorCalls[0], 'skillIsolation'), false);
});

test('refreshA2ASimplemsgListenerForIdentityProfileRegistration is a no-op when disabled', async () => {
  const events = [];

  const result = await refreshA2ASimplemsgListenerForIdentityProfileRegistration({
    enabled: false,
    listener: {
      stop: () => {
        events.push('listener:stop');
      },
      start: async () => {
        events.push('listener:start');
        return { started: [], skipped: [] };
      },
    },
  });

  assert.deepEqual(events, []);
  assert.equal(result.refreshed, false);
  assert.equal(result.report, null);
});

async function runCommandWithEnv(cwd, args, envOverrides = {}) {
  const stdout = [];
  const stderr = [];
  const env = {
    ...process.env,
    METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    METABOT_TEST_FAKE_SUBSIDY: '1',
    METABOT_TEST_FAKE_PROVIDER_LLM_REPLY: 'Provider test result from {{skill}}.',
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

async function startProfileRecordingDaemon(homeDir, env, routeData = {}) {
  const requests = [];
  let daemonStatus = null;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (url.pathname === '/api/daemon/status') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(commandSuccess({
          state: 'online',
          daemonId: daemonStatus?.ownerId ?? null,
          pid: daemonStatus?.pid ?? null,
        })));
        return;
      }

      requests.push({
        method: req.method ?? 'GET',
        pathname: url.pathname,
        search: url.search,
        body: chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(commandSuccess(routeData[url.pathname] ?? { ok: true })));
    });
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
    throw new Error('Expected TCP daemon address');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const store = createDaemonStateStore(deriveSystemHome(homeDir));
  daemonStatus = {
    schemaVersion: 1,
    instanceId: 'default',
    ownerId: `daemon-${path.basename(homeDir)}`,
    pid: 999_999,
    host: '127.0.0.1',
    port: address.port,
    baseUrl,
    startedAt: Date.now(),
    configHash: buildDaemonConfigHash(env),
    oacVersion: '0.2.32',
    runtimeFingerprint: 'test-runtime',
    supervisor: { kind: 'none', serviceId: null },
  };
  await store.writeDaemon(daemonStatus);

  return {
    baseUrl,
    requests,
    async close() {
      await store.clearDaemon();
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
    METABOT_TEST_FAKE_PROVIDER_LLM_REPLY: 'Provider test result from {{skill}}.',
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

async function waitForTrace(homeDir, traceId, envOverrides, predicate, timeoutMs = 30_000, intervalMs = 50) {
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
  const sockets = new Set();
  let closed = false;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
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
      if (closed) {
        return;
      }
      closed = true;
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
        if (typeof server.closeIdleConnections === 'function') {
          server.closeIdleConnections();
        }
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        } else {
          for (const socket of sockets) {
            socket.destroy();
          }
        }
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
  const sockets = new Set();
  let closed = false;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
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
      if (closed) {
        return;
      }
      closed = true;
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
        if (typeof server.closeIdleConnections === 'function') {
          server.closeIdleConnections();
        }
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        } else {
          for (const socket of sockets) {
            socket.destroy();
          }
        }
      });
    },
  };
}

// Teardown for tests that may have spawned a real detached daemon: stop the
// whole process group and wait for the processes to exit (handled inside
// stopTestDaemonsUnderRoot) before the temp system home is removed.
async function stopDaemon(homeDir) {
  await stopTestDaemonsUnderRoot(deriveSystemHome(homeDir));
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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');

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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');

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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');
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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');
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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');

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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');
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
    '.runtime/exports',
    '.runtime/state',
    '.runtime/locks',
    '.runtime/config.json',
    '.runtime/identity-secrets.json',
  ]) {
    const targetStat = await stat(path.join(homeDir, relativePath));
    assert.equal(Boolean(targetStat), true, `${relativePath} should exist inside the profile workspace`);
  }
  await assert.rejects(stat(path.join(homeDir, '.runtime/evolution')), { code: 'ENOENT' });

  const doctor = await runCommandWithEnv(systemHome, ['doctor'], {
    HOME: systemHome,
  });

  assert.equal(doctor.exitCode, 0);
  assert.equal(doctor.payload.ok, true);
  assert.equal(
    doctor.payload.data.checks.some((check) => check.code === 'identity_loaded' && check.ok === true),
    true
  );

  const daemonState = JSON.parse(await readFile(daemonStatePath(homeDir), 'utf8'));
  assert.match(daemonState.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(Number.isInteger(daemonState.pid), true);
});

test('doctor reports canonical CLI shim path using METABOT_BIN_DIR override', async (t) => {
  const systemHome = await mkdtempTempRoot('metabot-system-home-');
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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');
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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');
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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');
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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');
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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');
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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');
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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');
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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');
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
  const systemHome = await mkdtempTempRoot('metabot-system-home-');

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

  const firstDaemonState = JSON.parse(await readFile(daemonStatePath(homeDir), 'utf8'));
  const firstPort = new URL(firstDaemonState.baseUrl).port;

  const doctor = await runCommand(homeDir, ['doctor'], {
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:10',
  });
  assert.equal(doctor.exitCode, 0);
  assert.equal(doctor.payload.ok, true);

  const secondDaemonState = JSON.parse(await readFile(daemonStatePath(homeDir), 'utf8'));
  const secondPort = new URL(secondDaemonState.baseUrl).port;

  assert.equal(secondPort, firstPort);
  assert.notEqual(secondDaemonState.configHash, firstDaemonState.configHash);
});

test('getDefaultDaemonPort is the single installation default', () => {
  const firstHome = '/tmp/metabot-home-a';
  const secondHome = '/tmp/metabot-home-b';

  const firstPort = getDefaultDaemonPort(firstHome);
  const repeatedFirstPort = getDefaultDaemonPort(firstHome);
  const secondPort = getDefaultDaemonPort(secondHome);

  assert.equal(firstPort, repeatedFirstPort);
  assert.equal(firstPort, secondPort);
  assert.equal(firstPort, 10001);
});

test('fresh daemon starts for the same installation reuse the persisted port', async (t) => {
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
  assert.ok(Number(firstPort) >= 10_001 && Number(firstPort) <= 10_020);
});

test('daemon start does not write legacy provider presence pins when presence is enabled', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  await stopDaemon(homeDir);
  const presenceStore = createProviderPresenceStateStore(homeDir);
  await presenceStore.write({
    enabled: true,
  });

  const started = await runCommand(homeDir, ['daemon', 'start']);
  assert.equal(started.exitCode, 0);
  assert.equal(started.payload.ok, true);

  await new Promise((resolve) => setTimeout(resolve, 150));
  const presenceState = await presenceStore.read();

  assert.equal(presenceState.enabled, true);
  for (const key of LEGACY_PROVIDER_PRESENCE_KEYS) {
    assert.equal(Object.hasOwn(presenceState, key), false);
  }
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

test('ui open bot create forwards the current host in the local UI URL', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, [
    'ui', 'open', '--page', 'bot', '--mode', 'create', '--host', 'codex',
  ]);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  const uiUrl = new URL(opened.payload.data.localUiUrl);
  assert.equal(uiUrl.pathname, '/ui/bot');
  assert.equal(uiUrl.searchParams.get('mode'), 'create');
  assert.equal(uiUrl.searchParams.get('host'), 'codex');
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

test('browser open returns the dedicated browser url instead of a ui route', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['browser', 'open']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  const browserUrl = new URL(opened.payload.data.localUiUrl);
  assert.equal(browserUrl.pathname, '/browser');
  assert.equal(browserUrl.search, '');
  assert.notEqual(browserUrl.pathname, '/ui/browser');
});

test('browser open --uri uses the Browser MetaID deep-link route', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['browser', 'open', '--uri', 'metaid://idq1alice']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  const browserUrl = new URL(opened.payload.data.localUiUrl);
  assert.equal(browserUrl.pathname, '/browser/metaid/idq1alice');
  assert.equal(browserUrl.search, '');
  assert.notEqual(browserUrl.pathname, '/ui/browser');
});

test('browser open --uri uses Browser MetaApp and MetaFile deep-link routes', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const pinId = '8544d8a15126296abe36a0bad740a4f293580575b5b00d345029bf99b74c78eci0';
  const cases = [
    [`metaapp://${pinId}`, `/browser/metaapp/${pinId}`],
    [`metafile://${pinId}`, `/browser/metafile/${pinId}`],
  ];

  for (const [uri, pathname] of cases) {
    const opened = await runCommand(homeDir, ['browser', 'open', '--uri', uri]);

    assert.equal(opened.exitCode, 0);
    assert.equal(opened.payload.ok, true);
    const browserUrl = new URL(opened.payload.data.localUiUrl);
    assert.equal(browserUrl.pathname, pathname);
    assert.equal(browserUrl.search, '');
    assert.notEqual(browserUrl.pathname, '/ui/browser');
  }
});

test('browser open preserves surrounding `--uri` whitespace while still using the dedicated browser route', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['browser', 'open', '--uri', ' metaid://idq1alice ']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  const browserUrl = new URL(opened.payload.data.localUiUrl);
  assert.equal(browserUrl.pathname, '/browser');
  assert.equal(browserUrl.searchParams.get('uri'), ' metaid://idq1alice ');
  assert.notEqual(browserUrl.pathname, '/ui/browser');
});

test('browser tab open --uri asks the running Browser page to open a new tab', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  // No Browser page is open during this test, so pagesReached is 0 with a note.
  // The command still succeeds: the open is fire-and-forget transport.
  const opened = await runCommand(homeDir, ['browser', 'tab', 'open', '--uri', 'metaid://idq1alice']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  assert.equal(opened.payload.data.uri, 'metaid://idq1alice');
  assert.equal(opened.payload.data.pagesReached, 0);
  assert.match(opened.payload.data.note, /no Browser page currently open/);
});

test('browser tab open without --uri fails with a helpful error', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['browser', 'tab', 'open']);

  assert.notEqual(opened.exitCode, 0);
  assert.equal(opened.payload.ok, false);
  assert.match(opened.payload.message, /--uri/);
});

test('browser tab open --uri with a flag-like value fails', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['browser', 'tab', 'open', '--uri', '--flag']);

  assert.notEqual(opened.exitCode, 0);
  assert.equal(opened.payload.ok, false);
  assert.match(opened.payload.message, /--uri/);
});

test('browser tab with an unknown subcommand fails', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['browser', 'tab', 'close', '--uri', 'metaid://idq1alice']);

  assert.notEqual(opened.exitCode, 0);
  assert.equal(opened.payload.ok, false);
});

test('browser open --uri metaapp:// reports the resolve outcome in the envelope', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  // `not-a-real-pin` fails resolve validation locally, so the probe is fast
  // and deterministic without any chain access.
  const opened = await runCommand(homeDir, ['browser', 'open', '--uri', 'metaapp://not-a-real-pin']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  const browserUrl = new URL(opened.payload.data.localUiUrl);
  assert.equal(browserUrl.pathname, '/browser/metaapp/not-a-real-pin');
  assert.equal(opened.payload.data.resolve.ok, false);
  assert.equal(opened.payload.data.resolve.code, 'invalid_browser_uri');
});

test('browser tab open --uri metaapp:// reports the resolve outcome in the envelope', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['browser', 'tab', 'open', '--uri', 'metaapp://not-a-real-pin']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  assert.equal(opened.payload.data.resolve.ok, false);
  assert.equal(opened.payload.data.resolve.code, 'invalid_browser_uri');
});

test('browser open --uri metaid:// skips the metaapp resolve probe', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['browser', 'open', '--uri', 'metaid://idq1alice']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  assert.equal('resolve' in opened.payload.data, false);
});

test('metaapp view returns a local apps owner console url for one pin id', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['metaapp', 'view', '--pin-id', 'pin-1i0']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  assert.equal(opened.payload.data.page, 'apps');
  assert.match(opened.payload.data.localUiUrl, /\/ui\/apps\?pinId=pin-1i0$/);
});

test('metaapp view returns a local apps owner console url for mine scope and from selector', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const opened = await runCommand(homeDir, ['metaapp', 'view', '--mine', '--from', 'alice']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  assert.equal(opened.payload.data.page, 'apps');
  assert.match(opened.payload.data.localUiUrl, /\/ui\/apps\?from=alice&mine=true$/);
});

test('metaapp owner runtime commands call durable metaapp daemon routes', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await stopDaemon(homeDir);
  });

  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url));
    requests.push({
      method: options.method || 'GET',
      pathname: parsed.pathname,
      search: parsed.search,
      body: options.body ? JSON.parse(String(options.body)) : null,
    });
    return new Response(JSON.stringify(commandSuccess({ ok: true })), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const baseEnv = { METABOT_DAEMON_BASE_URL: 'http://127.0.0.1:48271' };
  const payloadFile = path.join(homeDir, 'metaapp-payload.json');
  await writeFile(payloadFile, JSON.stringify({
    title: 'Owner App',
    appName: 'owner-app',
    runtime: ['browser'],
  }), 'utf8');

  const list = await runCommandWithEnv(homeDir, ['metaapp', 'list', '--from', 'alice', '--size', '12', '--cursor', 'cursor-1'], baseEnv);
  const deleted = await runCommandWithEnv(homeDir, ['metaapp', 'delete', '--from', 'alice', '--target-pin-id', 'a'.repeat(64) + 'i0', '--confirm'], baseEnv);
  const publishedPayload = await runCommandWithEnv(homeDir, ['metaapp', 'publish', '--from', 'alice', '--payload-file', payloadFile, '--chain', 'mvc', '--confirm'], baseEnv);
  const updatedPayload = await runCommandWithEnv(homeDir, ['metaapp', 'update', '--from', 'alice', '--target-pin-id', 'c'.repeat(64) + 'i0', '--payload-file', payloadFile, '--chain', 'mvc', '--confirm'], baseEnv);
  const publishedProject = await runCommandWithEnv(homeDir, ['metaapp', 'publish-project', '--from', 'alice', '--project-dir', './site', '--manifest-file', './metaapp.json', '--confirm'], baseEnv);
  const updatedProject = await runCommandWithEnv(homeDir, ['metaapp', 'update-project', '--from', 'alice', '--target-pin-id', 'b'.repeat(64) + 'i0', '--project-dir', './site', '--confirm'], baseEnv);

  assert.equal(list.exitCode, 0);
  assert.equal(deleted.exitCode, 0);
  assert.equal(publishedPayload.exitCode, 0);
  assert.equal(updatedPayload.exitCode, 0);
  assert.equal(publishedProject.exitCode, 0);
  assert.equal(updatedProject.exitCode, 0);
  assert.deepEqual(requests.map(({ method, pathname }) => ({ method, pathname })), [
    { method: 'GET', pathname: '/api/metaapp/list' },
    { method: 'POST', pathname: '/api/metaapp/delete' },
    { method: 'POST', pathname: '/api/metaapp/publish' },
    { method: 'POST', pathname: '/api/metaapp/update' },
    { method: 'POST', pathname: '/api/metaapp/publish-project' },
    { method: 'POST', pathname: '/api/metaapp/update-project' },
  ]);
  assert.equal(requests[0].search, '?from=alice&cursor=cursor-1&size=12');
  assert.deepEqual(requests[1].body, {
    targetPinId: 'a'.repeat(64) + 'i0',
    from: 'alice',
    confirm: true,
  });
  assert.deepEqual(requests[2].body, {
    title: 'Owner App',
    appName: 'owner-app',
    runtime: ['browser'],
    network: 'mvc',
    from: 'alice',
    confirm: true,
  });
  assert.deepEqual(requests[3].body, {
    title: 'Owner App',
    appName: 'owner-app',
    runtime: ['browser'],
    targetPinId: 'c'.repeat(64) + 'i0',
    network: 'mvc',
    from: 'alice',
    confirm: true,
  });
  assert.equal(requests[4].body.projectDir, path.join(homeDir, 'site'));
  assert.equal(requests[4].body.manifestFile, path.join(homeDir, 'metaapp.json'));
  assert.equal(requests[4].body.from, 'alice');
  assert.equal(requests[4].body.confirm, true);
  assert.equal(requests[5].body.projectDir, path.join(homeDir, 'site'));
  assert.equal(requests[5].body.targetPinId, 'b'.repeat(64) + 'i0');
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

test('buzz post --from uses the selected actor identity and default write network', async (t) => {
  const systemHome = await mkdtempTempRoot('metabot-cli-runtime-buzz-from-');
  const aliceHome = await createProfileHome(systemHome, 'actor-alice');
  const bobHome = await createProfileHome(systemHome, 'actor-bob');
  t.after(async () => {
    await stopDaemon(aliceHome);
    await stopDaemon(bobHome);
  });

  const aliceCreated = await runCommand(aliceHome, ['identity', 'create', '--name', 'Alice']);
  assert.equal(aliceCreated.exitCode, 0);
  const bobCreated = await runCommand(bobHome, ['identity', 'create', '--name', 'Bob']);
  assert.equal(bobCreated.exitCode, 0);
  assert.notEqual(aliceCreated.payload.data.globalMetaId, bobCreated.payload.data.globalMetaId);

  const configured = await runCommand(aliceHome, ['config', 'set', 'chain.defaultWriteNetwork', 'opcat']);
  assert.equal(configured.exitCode, 0);

  const requestFile = path.join(bobHome, 'buzz-from-alice.json');
  await writeFile(requestFile, JSON.stringify({
    content: 'alice speaks through an explicit actor flag',
  }), 'utf8');

  const posted = await runCommand(bobHome, ['buzz', 'post', '--from', 'actor-alice', '--request-file', requestFile]);

  assert.equal(posted.exitCode, 0);
  assert.equal(posted.payload.ok, true);
  assert.equal(posted.payload.data.content, 'alice speaks through an explicit actor flag');
  assert.equal(posted.payload.data.globalMetaId, aliceCreated.payload.data.globalMetaId);
  assert.equal(posted.payload.data.network, 'opcat');
});

test('buzz post --from bob uses the shared daemon and forwards bob as the actor', async (t) => {
  const systemHome = await mkdtempTempRoot('metabot-cross-profile-daemon-');
  const aliceHome = await createProfileHome(systemHome, 'alice');
  const bobHome = await createProfileHome(systemHome, 'bob');

  const env = {
    HOME: systemHome,
    METABOT_HOME: aliceHome,
    METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    METABOT_TEST_FAKE_SUBSIDY: '1',
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
  };

  await ensureIndexedProfileHome(bobHome);
  await ensureIndexedProfileHome(aliceHome);

  const daemon = await startProfileRecordingDaemon(aliceHome, env, {
    '/api/buzz/post': { pinId: 'bob-pin', ok: true },
  });
  t.after(async () => {
    await daemon.close();
    await cleanupProfileHome(systemHome);
  });

  const requestFile = path.join(aliceHome, 'buzz.json');
  await writeFile(requestFile, JSON.stringify({ content: 'hello from bob' }), 'utf8');

  const result = await runCommandWithEnv(
    aliceHome,
    ['buzz', 'post', '--from', 'bob', '--request-file', requestFile],
    env,
  );

  assert.equal(result.exitCode, 0);
  assert.equal(daemon.requests.at(-1)?.pathname, '/api/buzz/post');
  assert.equal(daemon.requests.at(-1)?.body?.from, 'bob');
});

test('metaapp view --from bob keeps the selected actor in the shared daemon localUiUrl', async (t) => {
  const systemHome = await mkdtempTempRoot('metabot-metaapp-view-daemon-');
  const aliceHome = await createProfileHome(systemHome, 'alice');
  const bobHome = await createProfileHome(systemHome, 'bob');

  const env = {
    HOME: systemHome,
    METABOT_HOME: aliceHome,
    METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    METABOT_TEST_FAKE_SUBSIDY: '1',
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
  };

  await ensureIndexedProfileHome(bobHome);
  await ensureIndexedProfileHome(aliceHome);

  const daemon = await startProfileRecordingDaemon(aliceHome, env);
  t.after(async () => {
    await daemon.close();
    await cleanupProfileHome(systemHome);
  });

  const opened = await runCommandWithEnv(aliceHome, ['metaapp', 'view', '--from', 'bob', '--mine'], env);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.data.localUiUrl, `${daemon.baseUrl}/ui/apps?from=bob&mine=true`);
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

  const cachedListed = await runCommand(homeDir, ['network', 'services', '--cached', '--online']);

  assert.equal(cachedListed.exitCode, 0);
  assert.equal(cachedListed.payload.ok, true);
  assert.equal(cachedListed.payload.data.discoverySource, 'cache');
  assert.equal(cachedListed.payload.data.services.length, 1);
  assert.equal(cachedListed.payload.data.services[0].servicePinId, published.payload.data.servicePinId);
  assert.equal(cachedListed.payload.data.services[0].displayName, 'Weather Oracle');
  assert.equal(cachedListed.payload.data.services[0].online, true);
  assert.equal(cachedListed.payload.data.services[0].providerGlobalMetaId, created.payload.data.globalMetaId);

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

test('provider CLI inspects seller orders by order id or payment txid and reports refund fields', async (t) => {
  const providerHome = await createProfileHomeTemp('', 'provider-profile');
  t.after(async () => stopDaemon(providerHome));

  const created = await runCommand(providerHome, ['identity', 'create', '--name', 'Provider Operator']);
  assert.equal(created.exitCode, 0);

  const runtimeStateStore = createRuntimeStateStore(providerHome);
  const state = await runtimeStateStore.readState();
  const sellerOrder = createSellerOrderRecord({
    id: 'seller-order-cli-inspect-1',
    state: 'refund_pending',
    localMetabotId: state.identity.metabotId,
    localMetabotSlug: path.basename(providerHome),
    providerGlobalMetaId: state.identity.globalMetaId,
    buyerGlobalMetaId: 'idq1buyercliinspect',
    servicePinId: '/protocols/skill-service-pin-cli-1',
    currentServicePinId: '/protocols/skill-service-pin-cli-1',
    serviceName: 'CLI Tarot Reading',
    providerSkill: 'tarot-rws',
    orderMessageId: 'order-message-cli-inspect-1',
    paymentTxid: '1'.repeat(64),
    paymentAmount: '0.00001',
    paymentCurrency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
    traceId: 'trace-provider-cli-inspect-1',
    a2aSessionId: 'seller-session-cli-inspect-1',
    a2aTaskRunId: 'seller-run-cli-inspect-1',
    llmSessionId: 'llm-session-cli-inspect-1',
    runtimeId: 'runtime-codex',
    runtimeProvider: 'codex',
    refundRequestPinId: 'refund-request-cli-inspect-1',
    refundTxid: 'refund-transfer-cli-inspect-1',
    refundFinalizePinId: 'refund-finalize-cli-inspect-1',
    refundBlockingReason: 'insufficient_balance',
    createdAt: 1_775_000_020_000,
    updatedAt: 1_775_000_030_000,
  });
  await runtimeStateStore.writeState({
    ...state,
    sellerOrders: [sellerOrder],
  });

  const byOrderId = await runCommand(providerHome, ['provider', 'order', 'inspect', '--order-id', 'seller-order-cli-inspect-1']);
  assert.equal(byOrderId.exitCode, 0);
  assert.equal(byOrderId.payload.ok, true);
  assert.equal(byOrderId.payload.data.order.orderId, 'seller-order-cli-inspect-1');
  assert.equal(byOrderId.payload.data.order.service.name, 'CLI Tarot Reading');
  assert.equal(byOrderId.payload.data.order.buyer.globalMetaId, 'idq1buyercliinspect');
  assert.equal(byOrderId.payload.data.order.status.state, 'refund_pending');
  assert.equal(byOrderId.payload.data.order.trace.id, 'trace-provider-cli-inspect-1');
  assert.equal(byOrderId.payload.data.order.payment.txid, '1'.repeat(64));
  assert.equal(byOrderId.payload.data.order.runtime.sessionId, 'llm-session-cli-inspect-1');
  assert.equal(byOrderId.payload.data.order.refund.refundRequestPinId, 'refund-request-cli-inspect-1');
  assert.equal(byOrderId.payload.data.order.refund.refundTxid, 'refund-transfer-cli-inspect-1');
  assert.equal(byOrderId.payload.data.order.refund.refundFinalizePinId, 'refund-finalize-cli-inspect-1');
  assert.equal(byOrderId.payload.data.order.refund.blockingReason, 'insufficient_balance');

  const byPayment = await runCommand(providerHome, ['provider', 'order', 'inspect', '--payment-txid', '1'.repeat(64)]);
  assert.equal(byPayment.exitCode, 0);
  assert.equal(byPayment.payload.ok, true);
  assert.equal(byPayment.payload.data.order.orderId, 'seller-order-cli-inspect-1');
});

test('provider CLI manual refund settlement returns structured blockers for pending seller orders', async (t) => {
  const providerHome = await createProfileHomeTemp('', 'provider-profile');
  t.after(async () => stopDaemon(providerHome));

  const created = await runCommand(providerHome, ['identity', 'create', '--name', 'Provider Operator']);
  assert.equal(created.exitCode, 0);

  const runtimeStateStore = createRuntimeStateStore(providerHome);
  const state = await runtimeStateStore.readState();
  const sellerOrder = createSellerOrderRecord({
    id: 'seller-order-cli-settle-blocked-1',
    state: 'failed',
    localMetabotId: state.identity.metabotId,
    localMetabotSlug: path.basename(providerHome),
    providerGlobalMetaId: state.identity.globalMetaId,
    buyerGlobalMetaId: 'idq1buyercliblocked',
    servicePinId: '/protocols/skill-service-pin-cli-2',
    currentServicePinId: '/protocols/skill-service-pin-cli-2',
    serviceName: 'CLI Tarot Reading',
    providerSkill: 'tarot-rws',
    orderMessageId: 'order-message-cli-blocked-1',
    paymentTxid: '2'.repeat(64),
    paymentAmount: '0.00001',
    paymentCurrency: 'SPACE',
    paymentChain: 'mvc',
    settlementKind: 'native',
    traceId: 'trace-provider-cli-blocked-1',
    a2aSessionId: 'seller-session-cli-blocked-1',
    a2aTaskRunId: 'seller-run-cli-blocked-1',
    failureReason: 'provider_execution_failed',
    refundRequestPinId: null,
    createdAt: 1_775_000_020_000,
    updatedAt: 1_775_000_030_000,
  });
  await runtimeStateStore.writeState({
    ...state,
    sellerOrders: [sellerOrder],
  });

  const settled = await runCommand(providerHome, ['provider', 'refund', 'settle', '--payment-txid', '2'.repeat(64)]);
  assert.equal(settled.exitCode, 2);
  assert.equal(settled.payload.ok, false);
  assert.equal(settled.payload.state, 'manual_action_required');
  assert.equal(settled.payload.code, 'refund_request_missing');
  assert.equal(settled.payload.data.order.orderId, 'seller-order-cli-settle-blocked-1');
  assert.equal(settled.payload.data.order.refund.blockingReason, 'refund_request_missing');
  assert.equal(settled.payload.data.order.trace.id, 'trace-provider-cli-blocked-1');
});

test('provider summary refreshes rating detail from chain and exposes rated seller-order closure', async (t) => {
  const providerHome = await createProfileHomeTemp('', 'provider-profile');
  const callerHome = await createProfileHomeTemp('', 'caller-profile');
  const ratingPins = [];
  const chainApi = await startFakeChainApiServer({ ratingPins });
  t.after(async () => stopDaemon(providerHome));
  t.after(async () => stopDaemon(callerHome));
  t.after(async () => chainApi.close());
  t.after(async () => cleanupProfileHome(providerHome));
  t.after(async () => cleanupProfileHome(callerHome));

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
  t.after(async () => chainApi.close());

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

test('network bots --online fails strictly when socket presence is unavailable', async (t) => {
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

  assert.equal(listed.exitCode, 1);
  assert.equal(listed.payload.ok, false);
  assert.equal(listed.payload.code, 'socket_presence_unavailable');
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

test('wallet balance --from reads the selected actor identity and address', async (t) => {
  const systemHome = await mkdtempTempRoot('metabot-cli-runtime-wallet-from-');
  const aliceHome = await createProfileHome(systemHome, 'actor-alice');
  const bobHome = await createProfileHome(systemHome, 'actor-bob');
  t.after(async () => {
    await stopDaemon(aliceHome);
    await stopDaemon(bobHome);
  });

  const aliceCreated = await runCommand(aliceHome, ['identity', 'create', '--name', 'Alice']);
  assert.equal(aliceCreated.exitCode, 0);
  const bobCreated = await runCommand(bobHome, ['identity', 'create', '--name', 'Bob']);
  assert.equal(bobCreated.exitCode, 0);
  assert.notEqual(aliceCreated.payload.data.globalMetaId, bobCreated.payload.data.globalMetaId);

  const aliceState = await createRuntimeStateStore(aliceHome).readState();
  const aliceBtcAddress = aliceState.identity?.addresses?.btc;
  assert.equal(typeof aliceBtcAddress, 'string');
  assert.ok(aliceBtcAddress.length > 0);

  const originalFetch = globalThis.fetch;
  const fetchedUrls = [];
  globalThis.fetch = async (url) => {
    fetchedUrls.push(String(url));
    return new Response(JSON.stringify({
      code: 0,
      data: {
        balance: 0.125,
        safeBalance: 0.125,
        pendingBalance: 0,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const balance = await runCommand(bobHome, ['wallet', 'balance', '--from', 'actor-alice', '--chain', 'btc']);

  assert.equal(balance.exitCode, 0);
  assert.equal(balance.payload.ok, true);
  assert.equal(balance.payload.data.globalMetaId, aliceCreated.payload.data.globalMetaId);
  assert.equal(balance.payload.data.balances.btc.address, aliceBtcAddress);
  assert.equal(balance.payload.data.balances.btc.totalSatoshis, 12_500_000);
  assert.equal(fetchedUrls.length, 1);
  assert.match(fetchedUrls[0], new RegExp(`address=${encodeURIComponent(aliceBtcAddress)}`));
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
  assert.equal(providerDaemonTraceUrl.pathname, '/ui/conversations');
  assert.equal(providerDaemonTraceUrl.searchParams.get('peer'), providerIdentity.payload.data.globalMetaId);
  assert.ok(providerDaemonTraceUrl.searchParams.get('local'));
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
  assert.equal(traceUrl.pathname, '/ui/conversations');
  assert.equal(traceUrl.searchParams.get('peer'), 'idq1provider');
  assert.equal(traceUrl.searchParams.get('local'), created.payload.data.globalMetaId);
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
  }, (data) => (
    data?.a2a?.publicStatus === 'completed'
    && data?.resultText === 'Tomorrow will be bright with a light wind.'
    && data?.resultDeliveryPinId === 'delivery-pin-1'
  ));

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
  assert.equal(traceGetUrl.pathname, '/ui/conversations');
  assert.ok(traceGetUrl.searchParams.get('local'));
  assert.ok(traceGetUrl.searchParams.get('peer'));

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
  assert.equal(sessionTraceUrl.pathname, '/ui/conversations');
  assert.ok(sessionTraceUrl.searchParams.get('local'));
  assert.ok(sessionTraceUrl.searchParams.get('peer'));

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
  t.after(async () => chainApi.close());

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

test('services call creates a refund request when a chain-discovered paid service times out', async (t) => {
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

  const trace = await waitForTrace(homeDir, called.payload.data.traceId, {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    METABOT_TEST_FAKE_METAWEB_REPLY: JSON.stringify({
      state: 'timeout',
    }),
  }, (data) => data?.order?.status === 'refund_pending');
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.order.status, 'refund_pending');
  assert.equal(trace.payload.data.order.failureReason, 'delivery_timeout');
  assert.match(trace.payload.data.order.refundRequestPinId, /service-refund-request/);

  const transcriptMarkdown = await readFile(called.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /Local MetaBot delegated|remote MetaBot task session/i);
});

test('services call keeps a timed-out paid chain-discovered caller trace in refund pending state', async (t) => {
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

  const trace = await waitForTrace(homeDir, called.payload.data.traceId, {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    METABOT_TEST_FAKE_METAWEB_REPLY: replyConfig,
  }, (data) => data?.order?.status === 'refund_pending');
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.order.status, 'refund_pending');
  assert.equal(trace.payload.data.order.failureReason, 'delivery_timeout');
  assert.match(trace.payload.data.order.refundRequestPinId, /service-refund-request/);
  assert.notEqual(trace.payload.data.resultText, 'A late weather reply finally arrived.');

  const transcriptMarkdown = await readFile(called.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /Local MetaBot delegated|remote MetaBot task session/i);
});

test('trace get exposes refund pending state after a chain-discovered paid timeout', async (t) => {
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

  const trace = await waitForTrace(homeDir, called.payload.data.traceId, {
    METABOT_CHAIN_API_BASE_URL: chainApi.baseUrl,
    METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf',
    METABOT_TEST_FAKE_METAWEB_REPLY: replyConfig,
  }, (data) => data?.order?.status === 'refund_pending');
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.order.status, 'refund_pending');
  assert.equal(trace.payload.data.order.failureReason, 'delivery_timeout');
  assert.match(trace.payload.data.order.refundRequestPinId, /service-refund-request/);
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
  assert.doesNotMatch(orderEnd.content, /\/protocols\/skill-service-rate-pin-/);
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
  assert.doesNotMatch(transcriptMarkdown, /我的评分已记录在链上/);
});

test('chat private writes encrypted simplemsg on chain and stores a chat trace in the local runtime', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);
  const configured = await runCommand(homeDir, ['config', 'set', 'chain.defaultWriteNetwork', 'doge']);
  assert.equal(configured.exitCode, 0);
  assert.equal(configured.payload.data.value, 'doge');

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
  assert.equal(sent.payload.data.network, 'doge');
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
  assert.equal(viewerUrl.pathname, '/ui/conversations');
  assert.equal(viewerUrl.searchParams.get('local'), created.payload.data.globalMetaId);
  assert.equal(viewerUrl.searchParams.get('peer'), created.payload.data.globalMetaId);

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
  assert.equal(chatMessage.chain, 'doge');
  assert.equal(chatMessage.replyPinId, 'reply-pin-1');
  assert.equal(chatConversation.sessions.some(
    (session) => session.sessionId === chatMessage.sessionId && session.type === 'peer',
  ), true);

  const transcriptMarkdown = await readFile(sent.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /hello from loopback/);
});

test('chat private --from uses the selected actor identity, default write network, and local stores', async (t) => {
  const systemHome = await mkdtempTempRoot('metabot-cli-runtime-chat-from-');
  const aliceHome = await createProfileHome(systemHome, 'actor-alice');
  const bobHome = await createProfileHome(systemHome, 'actor-bob');
  t.after(async () => {
    await stopDaemon(aliceHome);
    await stopDaemon(bobHome);
  });

  const aliceCreated = await runCommand(aliceHome, ['identity', 'create', '--name', 'Alice']);
  assert.equal(aliceCreated.exitCode, 0);
  const bobCreated = await runCommand(bobHome, ['identity', 'create', '--name', 'Bob']);
  assert.equal(bobCreated.exitCode, 0);
  assert.notEqual(aliceCreated.payload.data.globalMetaId, bobCreated.payload.data.globalMetaId);

  const configured = await runCommand(aliceHome, ['config', 'set', 'chain.defaultWriteNetwork', 'opcat']);
  assert.equal(configured.exitCode, 0);

  const requestFile = path.join(bobHome, 'chat-from-alice.json');
  await writeFile(requestFile, JSON.stringify({
    to: bobCreated.payload.data.globalMetaId,
    peerChatPublicKey: bobCreated.payload.data.chatPublicKey,
    content: 'alice speaks through explicit chat actor selection',
    replyPin: 'reply-pin-from-alice',
  }), 'utf8');

  const sent = await runCommand(bobHome, ['chat', 'private', '--from', 'actor-alice', '--request-file', requestFile]);

  assert.equal(sent.exitCode, 0);
  assert.equal(sent.payload.ok, true);
  assert.equal(sent.payload.data.to, bobCreated.payload.data.globalMetaId);
  assert.equal(sent.payload.data.network, 'opcat');
  assert.equal(sent.payload.data.deliveryMode, 'onchain_simplemsg');

  const aliceState = await createRuntimeStateStore(aliceHome).readState();
  const bobState = await createRuntimeStateStore(bobHome).readState();
  assert.equal(
    aliceState.traces.some((trace) => trace.traceId === sent.payload.data.traceId),
    true,
  );
  assert.equal(
    bobState.traces.some((trace) => trace.traceId === sent.payload.data.traceId),
    false,
  );

  const aliceConversation = await createA2AConversationStore({
    homeDir: aliceHome,
    local: {
      globalMetaId: aliceCreated.payload.data.globalMetaId,
      name: aliceCreated.payload.data.name,
      chatPublicKey: aliceCreated.payload.data.chatPublicKey,
    },
    peer: {
      globalMetaId: bobCreated.payload.data.globalMetaId,
      name: bobCreated.payload.data.name,
      chatPublicKey: bobCreated.payload.data.chatPublicKey,
    },
  }).readConversation();
  const aliceMessage = aliceConversation.messages.find(
    (message) => message.content === 'alice speaks through explicit chat actor selection',
  );
  assert.ok(aliceMessage, 'expected outgoing private chat message in the selected actor store');
  assert.equal(aliceMessage.chain, 'opcat');
  assert.equal(aliceMessage.replyPinId, 'reply-pin-from-alice');

  const bobConversation = await createA2AConversationStore({
    homeDir: bobHome,
    local: {
      globalMetaId: bobCreated.payload.data.globalMetaId,
      name: bobCreated.payload.data.name,
      chatPublicKey: bobCreated.payload.data.chatPublicKey,
    },
    peer: {
      globalMetaId: bobCreated.payload.data.globalMetaId,
      name: bobCreated.payload.data.name,
      chatPublicKey: bobCreated.payload.data.chatPublicKey,
    },
  }).readConversation();
  assert.equal(
    bobConversation.messages.some((message) => message.content === 'alice speaks through explicit chat actor selection'),
    false,
  );
});

test('file upload fails clearly when default write network is DOGE', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);
  const configured = await runCommand(homeDir, ['config', 'set', 'chain.defaultWriteNetwork', 'doge']);
  assert.equal(configured.exitCode, 0);

  const filePath = path.join(homeDir, 'hello.txt');
  const requestFile = path.join(homeDir, 'file-request.json');
  await writeFile(filePath, 'hello doge upload guard', 'utf8');
  await writeFile(requestFile, JSON.stringify({
    filePath,
    contentType: 'text/plain',
  }), 'utf8');

  const uploaded = await runCommand(homeDir, ['file', 'upload', '--request-file', requestFile]);

  assert.equal(uploaded.exitCode, 1);
  assert.equal(uploaded.payload.ok, false);
  assert.equal(uploaded.payload.code, 'file_upload_failed');
  assert.match(uploaded.payload.message, /DOGE is not supported for file upload/i);
});

test('file upload-large daemon route supports direct small uploads', async (t) => {
  const homeDir = await createProfileHomeTemp('');
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const filePath = path.join(homeDir, 'small-large-route.txt');
  const requestFile = path.join(homeDir, 'large-file-request.json');
  await writeFile(filePath, 'hello large upload direct route', 'utf8');
  await writeFile(requestFile, JSON.stringify({
    filePath: 'small-large-route.txt',
    contentType: 'text/plain',
  }), 'utf8');

  const uploaded = await runCommand(homeDir, ['file', 'upload-large', '--request-file', requestFile]);

  assert.equal(uploaded.exitCode, 0);
  assert.equal(uploaded.payload.ok, true);
  assert.equal(uploaded.payload.data.uploadMode, 'direct');
  assert.equal(uploaded.payload.data.network, 'mvc');
  assert.equal(uploaded.payload.data.contentType, 'text/plain');
  assert.equal(uploaded.payload.data.fileName, 'small-large-route.txt');
  assert.match(uploaded.payload.data.metafileUri, /^metafile:\/\//);
});
