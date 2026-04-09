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
const { createProviderPresenceStateStore } = require('../../dist/core/provider/providerPresenceState.js');

function parseLastJson(chunks) {
  return JSON.parse(chunks.join('').trim());
}

async function runCommand(homeDir, args, envOverrides = {}) {
  const stdout = [];
  const stderr = [];
  const env = {
    ...process.env,
    HOME: homeDir,
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

async function runCommandText(homeDir, args, envOverrides = {}) {
  const stdout = [];
  const stderr = [];
  const env = {
    ...process.env,
    HOME: homeDir,
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

async function startFakeChainApiServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const nowSec = Math.floor(Date.now() / 1000);
    let payload = null;

    if (url.pathname === '/pin/path/list') {
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

async function stopDaemon(homeDir) {
  const daemonStatePath = path.join(homeDir, '.metabot', 'hot', 'daemon.json');

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
  const seedsPath = path.join(homeDir, '.metabot', 'hot', 'directory-seeds.json');
  await mkdir(path.dirname(seedsPath), { recursive: true });
  await writeFile(seedsPath, JSON.stringify({ providers }, null, 2), 'utf8');
  return seedsPath;
}

test('identity create autostarts the local daemon and doctor reports the identity as loaded', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
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

  const daemonState = JSON.parse(await readFile(path.join(homeDir, '.metabot', 'hot', 'daemon.json'), 'utf8'));
  assert.match(daemonState.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(Number.isInteger(daemonState.pid), true);
});

test('daemon config restarts keep the previous port so local inspector URLs stay stable', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice'], {
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:9',
  });
  assert.equal(created.exitCode, 0);

  const firstDaemonState = JSON.parse(
    await readFile(path.join(homeDir, '.metabot', 'hot', 'daemon.json'), 'utf8')
  );
  const firstPort = new URL(firstDaemonState.baseUrl).port;

  const doctor = await runCommand(homeDir, ['doctor'], {
    METABOT_CHAIN_API_BASE_URL: 'http://127.0.0.1:10',
  });
  assert.equal(doctor.exitCode, 0);
  assert.equal(doctor.payload.ok, true);

  const secondDaemonState = JSON.parse(
    await readFile(path.join(homeDir, '.metabot', 'hot', 'daemon.json'), 'utf8')
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
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
  t.after(async () => stopDaemon(homeDir));

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
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
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
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
  t.after(async () => stopDaemon(homeDir));

  const opened = await runCommand(homeDir, ['ui', 'open', '--page', 'trace', '--trace-id', 'trace-123']);

  assert.equal(opened.exitCode, 0);
  assert.equal(opened.payload.ok, true);
  assert.equal(opened.payload.data.page, 'trace');
  assert.match(opened.payload.data.localUiUrl, /\/ui\/trace\?traceId=trace-123$/);
});

test('buzz post succeeds immediately after bootstrap identity create', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
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
});

test('services publish persists a local directory entry that network services --online can read back', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const payloadFile = path.join(homeDir, 'payload.json');
  await writeFile(payloadFile, JSON.stringify({
    serviceName: 'weather-oracle',
    displayName: 'Weather Oracle',
    description: 'Returns tomorrow weather from the local MetaBot runtime.',
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

test('network services reads chain-backed online services without local directory seeds', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
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

test('network services merges remote demo directory seeds and returns provider daemon base urls for agent-side invocation', async (t) => {
  const callerHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-caller-'));
  const providerHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-provider-'));
  t.after(async () => stopDaemon(callerHome));
  t.after(async () => stopDaemon(providerHome));

  const providerIdentity = await runCommand(providerHome, ['identity', 'create', '--name', 'Weather Provider']);
  assert.equal(providerIdentity.exitCode, 0);

  const publishFile = path.join(providerHome, 'payload.json');
  await writeFile(publishFile, JSON.stringify({
    serviceName: 'weather-oracle',
    displayName: 'Weather Oracle',
    description: 'Returns tomorrow weather from the local MetaBot runtime.',
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

test('network sources add/list/remove manages the local demo provider registry without manual file edits', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
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

  const seedsFile = JSON.parse(await readFile(path.join(homeDir, '.metabot', 'hot', 'directory-seeds.json'), 'utf8'));
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
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
  t.after(async () => stopDaemon(homeDir));

  const created = await runCommand(homeDir, ['identity', 'create', '--name', 'Alice']);
  assert.equal(created.exitCode, 0);

  const publishFile = path.join(homeDir, 'payload.json');
  await writeFile(publishFile, JSON.stringify({
    serviceName: 'weather-oracle',
    displayName: 'Weather Oracle',
    description: 'Returns tomorrow weather from the local MetaBot runtime.',
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
  assert.match(called.payload.data.traceJsonPath, /\/\.metabot\/exports\/traces\/.*\.json$/);
  assert.match(called.payload.data.traceMarkdownPath, /\/\.metabot\/exports\/traces\/.*\.md$/);

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
    await readFile(path.join(homeDir, '.metabot', 'hot', 'a2a-session-state.json'), 'utf8')
  );
  const callerSession = sessionState.sessions.find((entry) => entry.traceId === called.payload.data.traceId);
  const callerTaskRun = sessionState.taskRuns.find((entry) => entry.runId === called.payload.data.session.taskRunId);
  assert.equal(callerSession.role, 'caller');
  assert.equal(callerSession.state, 'timeout');
  assert.equal(callerTaskRun.state, 'timeout');
});

test('services call returns an A2A start contract while provider execution flows through provider session state', async (t) => {
  const callerHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-caller-'));
  const providerHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-provider-'));
  t.after(async () => stopDaemon(callerHome));
  t.after(async () => stopDaemon(providerHome));

  const providerIdentity = await runCommand(providerHome, ['identity', 'create', '--name', 'Weather Provider']);
  assert.equal(providerIdentity.exitCode, 0);

  const publishFile = path.join(providerHome, 'payload.json');
  await writeFile(publishFile, JSON.stringify({
    serviceName: 'weather-oracle',
    displayName: 'Weather Oracle',
    description: 'Returns tomorrow weather from the local MetaBot runtime.',
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
    await readFile(path.join(providerHome, '.metabot', 'hot', 'a2a-session-state.json'), 'utf8')
  );
  const providerSession = providerSessionState.sessions.find((entry) => entry.traceId === called.payload.data.traceId);
  const providerTaskRun = providerSessionState.taskRuns.find((entry) => entry.sessionId === providerSession.sessionId);
  assert.equal(providerSession.role, 'provider');
  assert.equal(providerSession.state, 'completed');
  assert.equal(providerTaskRun.state, 'completed');
});

test('services call resolves a chain-discovered online service into a real MetaWeb reply path without providerDaemonBaseUrl', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
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
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
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
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
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
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
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
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
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
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
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

  const transcriptMarkdown = await readFile(rated.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /结果清晰，响应也可靠。/);
  assert.match(transcriptMarkdown, /我的评分已记录在链上/);
  assert.match(transcriptMarkdown, /\/protocols\/skill-service-rate-pin-/);
});

test('chat private encrypts a loopback message and stores a chat trace in the local runtime', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-runtime-'));
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
  assert.equal(sent.payload.data.deliveryMode, 'local_runtime');
  assert.match(sent.payload.data.traceId, /^trace-private-/);
  assert.match(sent.payload.data.payload, /"encrypt":"ecdh"/);
  assert.match(sent.payload.data.traceJsonPath, /\/\.metabot\/exports\/traces\/.*\.json$/);

  const trace = await runCommand(homeDir, ['trace', 'get', '--trace-id', sent.payload.data.traceId]);

  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.traceId, sent.payload.data.traceId);
  assert.equal(trace.payload.data.channel, 'simplemsg');
  assert.equal(trace.payload.data.session.peerGlobalMetaId, created.payload.data.globalMetaId);

  const transcriptMarkdown = await readFile(sent.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /hello from loopback/);
});
