import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { createProviderPresenceStateStore } = require('../../dist/core/provider/providerPresenceState.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { generateProfileSlug } = require('../../dist/core/identity/profileNameResolution.js');
const { buildMasterResponseJson } = require('../../dist/core/master/masterMessageSchema.js');

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const MASTER_PROVIDER_FIXTURE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/master-service-debug.json');
const MASTER_REQUEST_FIXTURE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/master-ask-request.json');
const VALID_TEST_PROVIDER_CHAT_PUBLIC_KEY = '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf';

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

async function createCanonicalProfile(prefix, displayNamePrefix) {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), prefix));
  const displayName = `${displayNamePrefix} ${path.basename(systemHome)}`;
  const homeDir = path.join(systemHome, '.metabot', 'profiles', generateProfileSlug(displayName));
  await mkdir(homeDir, { recursive: true });
  return {
    systemHome,
    homeDir,
    displayName,
  };
}

async function runCommand(homeDir, args, envOverrides = {}) {
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

async function stopDaemon(homeDir) {
  const daemonStatePath = resolveMetabotPaths(homeDir).daemonStatePath;

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

async function fetchJson(baseUrl, routePath, options = {}) {
  const response = await fetch(`${baseUrl}${routePath}`, options);
  return {
    response,
    payload: await response.json(),
  };
}

async function prepareMasterHomes(t) {
  const callerProfile = await createCanonicalProfile('metabot-master-e2e-caller-', 'Caller Bot');
  const providerProfile = await createCanonicalProfile('metabot-master-e2e-provider-', 'Debug Master Provider');
  const callerHome = callerProfile.homeDir;
  const providerHome = providerProfile.homeDir;
  const providerName = providerProfile.displayName;
  const callerName = callerProfile.displayName;
  t.after(async () => stopDaemon(callerHome));
  t.after(async () => stopDaemon(providerHome));
  t.after(async () => rm(callerProfile.systemHome, { recursive: true, force: true }));
  t.after(async () => rm(providerProfile.systemHome, { recursive: true, force: true }));

  const providerIdentity = await runCommand(providerHome, ['identity', 'create', '--name', providerName]);
  assert.equal(providerIdentity.exitCode, 0);
  const callerIdentity = await runCommand(callerHome, ['identity', 'create', '--name', callerName]);
  assert.equal(callerIdentity.exitCode, 0);

  const publishPayload = await readFile(MASTER_PROVIDER_FIXTURE_PATH, 'utf8');
  const publishFile = path.join(providerHome, 'master-publish.json');
  await writeFile(publishFile, publishPayload, 'utf8');

  const published = await runCommand(providerHome, ['master', 'publish', '--payload-file', publishFile]);
  assert.equal(published.exitCode, 0);
  assert.equal(published.payload.ok, true);

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

  const addedSource = await runCommand(callerHome, [
    'network',
    'sources',
    'add',
    '--base-url',
    providerDaemon.payload.data.baseUrl,
  ]);
  assert.equal(addedSource.exitCode, 0);
  assert.equal(addedSource.payload.ok, true);

  const listed = await runCommand(callerHome, ['master', 'list']);
  assert.equal(listed.exitCode, 0);
  assert.equal(listed.payload.ok, true);
  assert.equal(listed.payload.data.masters.length, 1);

  const requestFixture = JSON.parse(await readFile(MASTER_REQUEST_FIXTURE_PATH, 'utf8'));
  const listedMaster = listed.payload.data.masters[0];
  const requestFile = path.join(callerHome, 'master-request.json');
  await writeFile(requestFile, JSON.stringify({
    ...requestFixture,
    target: {
      ...requestFixture.target,
      servicePinId: listedMaster.servicePinId ?? listedMaster.masterPinId,
      providerGlobalMetaId: listedMaster.providerGlobalMetaId,
      displayName: listedMaster.displayName,
      masterKind: listedMaster.masterKind,
    },
  }, null, 2), 'utf8');

  const preview = await runCommand(callerHome, ['master', 'ask', '--request-file', requestFile]);
  assert.equal(preview.exitCode, 0);
  assert.equal(preview.payload.ok, true);
  assert.equal(preview.payload.state, 'awaiting_confirmation');

  return {
    callerHome,
    providerHome,
    providerIdentity,
    providerDaemonBaseUrl: providerDaemon.payload.data.baseUrl,
    preview,
  };
}

function buildFakeMasterResponse(preview, overrides = {}) {
  const request = preview.payload.data.preview.request;
  return buildMasterResponseJson({
    type: 'master_response',
    version: '1.0.0',
    requestId: preview.payload.data.requestId,
    traceId: preview.payload.data.traceId,
    responder: {
      providerGlobalMetaId: request.target.providerGlobalMetaId,
      masterServicePinId: request.target.masterServicePinId,
      masterKind: request.target.masterKind,
    },
    status: 'completed',
    summary: 'Default fake master response.',
    structuredData: {
      findings: [],
      recommendations: [],
      risks: [],
    },
    ...overrides,
  });
}

test('caller can preview, confirm, and receive a structured response from the official debug master', { concurrency: false }, async (t) => {
  const prepared = await prepareMasterHomes(t);

  const providerReply = await fetchJson(prepared.providerDaemonBaseUrl, '/api/master/receive', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...prepared.preview.payload.data.preview.request,
      deliverResponse: false,
    }),
  });

  assert.equal(providerReply.response.status, 200);
  assert.equal(providerReply.payload.ok, true);
  assert.equal(providerReply.payload.data.response.status, 'completed');

  const confirm = await runCommand(
    prepared.callerHome,
    ['master', 'ask', '--trace-id', prepared.preview.payload.data.traceId, '--confirm'],
    {
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: VALID_TEST_PROVIDER_CHAT_PUBLIC_KEY,
      METABOT_TEST_FAKE_MASTER_REPLY: JSON.stringify({
        responseJson: providerReply.payload.data.responseJson,
      }),
    }
  );

  assert.equal(confirm.exitCode, 0);
  assert.equal(confirm.payload.ok, true);
  assert.equal(confirm.payload.state, 'success');
  assert.equal(confirm.payload.data.session.publicStatus, 'completed');
  assert.equal(confirm.payload.data.session.event, 'provider_completed');
  assert.equal(confirm.payload.data.response.status, 'completed');
  assert.equal(confirm.payload.data.response.summary, providerReply.payload.data.response.summary);

  const trace = await runCommand(prepared.callerHome, ['master', 'trace', '--id', prepared.preview.payload.data.traceId]);
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.canonicalStatus, 'completed');
  assert.equal(trace.payload.data.response.status, 'completed');
  assert.equal(trace.payload.data.response.summary, providerReply.payload.data.response.summary);

  const transcriptMarkdown = await readFile(confirm.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /Ask Master/);
  assert.match(transcriptMarkdown, /Official Debug Master/);
  assert.match(transcriptMarkdown, new RegExp(providerReply.payload.data.response.summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('caller timeout semantics remain unchanged after master ask integration', { concurrency: false }, async (t) => {
  const prepared = await prepareMasterHomes(t);

  const confirm = await runCommand(
    prepared.callerHome,
    ['master', 'ask', '--trace-id', prepared.preview.payload.data.traceId, '--confirm'],
    {
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: VALID_TEST_PROVIDER_CHAT_PUBLIC_KEY,
      METABOT_TEST_FAKE_MASTER_REPLY: JSON.stringify({
        state: 'timeout',
      }),
    }
  );

  assert.equal(confirm.exitCode, 0);
  assert.equal(confirm.payload.ok, true);
  assert.equal(confirm.payload.state, 'success');
  assert.equal(confirm.payload.data.session.publicStatus, 'timeout');
  assert.equal(confirm.payload.data.session.event, 'timeout');
  assert.equal('response' in confirm.payload.data, false);

  const trace = await runCommand(prepared.callerHome, ['master', 'trace', '--id', prepared.preview.payload.data.traceId]);
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.canonicalStatus, 'timed_out');

  const transcriptMarkdown = await readFile(confirm.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /Foreground wait ended before the remote MetaBot returned|Foreground timeout reached/i);
});

test('caller trace upgrades when a late master_response arrives after the foreground timeout', { concurrency: false }, async (t) => {
  const prepared = await prepareMasterHomes(t);

  const providerReply = await fetchJson(prepared.providerDaemonBaseUrl, '/api/master/receive', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...prepared.preview.payload.data.preview.request,
      deliverResponse: false,
    }),
  });

  assert.equal(providerReply.response.status, 200);
  assert.equal(providerReply.payload.ok, true);
  assert.equal(providerReply.payload.data.response.status, 'completed');

  const replyConfig = JSON.stringify({
    sequence: [
      {
        state: 'timeout',
      },
      {
        responseJson: providerReply.payload.data.responseJson,
        delayMs: 50,
      },
    ],
  });

  const confirm = await runCommand(
    prepared.callerHome,
    ['master', 'ask', '--trace-id', prepared.preview.payload.data.traceId, '--confirm'],
    {
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: VALID_TEST_PROVIDER_CHAT_PUBLIC_KEY,
      METABOT_TEST_FAKE_MASTER_REPLY: replyConfig,
    }
  );

  assert.equal(confirm.exitCode, 0);
  assert.equal(confirm.payload.ok, true);
  assert.equal(confirm.payload.data.session.publicStatus, 'timeout');
  assert.equal(confirm.payload.data.session.event, 'timeout');

  let trace = null;
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    trace = await runCommand(
      prepared.callerHome,
      ['master', 'trace', '--id', prepared.preview.payload.data.traceId],
      {
        METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: VALID_TEST_PROVIDER_CHAT_PUBLIC_KEY,
        METABOT_TEST_FAKE_MASTER_REPLY: replyConfig,
      }
    );
    if (trace.payload?.data?.canonicalStatus === 'completed') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.ok(trace, 'expected master trace polling to produce a response');
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.canonicalStatus, 'completed');
  assert.equal(trace.payload.data.response.status, 'completed');
  assert.equal(trace.payload.data.response.summary, providerReply.payload.data.response.summary);

  const transcriptMarkdown = await readFile(confirm.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /Foreground wait ended before the remote MetaBot returned|Foreground timeout reached/i);
  assert.match(
    transcriptMarkdown,
    new RegExp(providerReply.payload.data.response.summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
});

test('caller surfaces need_more_context replies as manual_action_required and preserves the follow-up question', { concurrency: false }, async (t) => {
  const prepared = await prepareMasterHomes(t);
  const responseJson = buildFakeMasterResponse(prepared.preview, {
    status: 'need_more_context',
    summary: 'More concrete failure output is required before a reliable diagnosis is possible.',
    structuredData: {
      missing: ['The exact failing command output.'],
      risks: ['Any fix would be low-confidence without the concrete failing output.'],
    },
    followUpQuestion: 'Can you share the exact failing command output?',
  });

  const confirm = await runCommand(
    prepared.callerHome,
    ['master', 'ask', '--trace-id', prepared.preview.payload.data.traceId, '--confirm'],
    {
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: VALID_TEST_PROVIDER_CHAT_PUBLIC_KEY,
      METABOT_TEST_FAKE_MASTER_REPLY: JSON.stringify({ responseJson }),
    }
  );

  assert.equal(confirm.exitCode, 0);
  assert.equal(confirm.payload.ok, true);
  assert.equal(confirm.payload.data.session.publicStatus, 'manual_action_required');
  assert.equal(confirm.payload.data.session.event, 'clarification_needed');
  assert.equal(confirm.payload.data.response.status, 'need_more_context');
  assert.equal(
    confirm.payload.data.response.followUpQuestion,
    'Can you share the exact failing command output?'
  );

  const trace = await runCommand(prepared.callerHome, ['master', 'trace', '--id', prepared.preview.payload.data.traceId]);
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.canonicalStatus, 'need_more_context');
  assert.equal(trace.payload.data.response.status, 'need_more_context');
  assert.equal(
    trace.payload.data.response.followUpQuestion,
    'Can you share the exact failing command output?'
  );

  const transcriptMarkdown = await readFile(confirm.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /More concrete failure output is required/i);
});

test('caller surfaces failed replies as remote_failed and preserves the structured failure details', { concurrency: false }, async (t) => {
  const prepared = await prepareMasterHomes(t);
  const responseJson = buildFakeMasterResponse(prepared.preview, {
    status: 'failed',
    summary: 'The remote master could not validate the request payload.',
    errorCode: 'invalid_master_runner_result',
    structuredData: {
      risks: ['The provider response was structurally invalid for the requested operation.'],
    },
  });

  const confirm = await runCommand(
    prepared.callerHome,
    ['master', 'ask', '--trace-id', prepared.preview.payload.data.traceId, '--confirm'],
    {
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: VALID_TEST_PROVIDER_CHAT_PUBLIC_KEY,
      METABOT_TEST_FAKE_MASTER_REPLY: JSON.stringify({ responseJson }),
    }
  );

  assert.equal(confirm.exitCode, 0);
  assert.equal(confirm.payload.ok, true);
  assert.equal(confirm.payload.data.session.publicStatus, 'remote_failed');
  assert.equal(confirm.payload.data.session.event, 'provider_failed');
  assert.equal(confirm.payload.data.response.status, 'failed');
  assert.equal(confirm.payload.data.response.errorCode, 'invalid_master_runner_result');

  const trace = await runCommand(prepared.callerHome, ['master', 'trace', '--id', prepared.preview.payload.data.traceId]);
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.canonicalStatus, 'failed');
  assert.equal(trace.payload.data.response.status, 'failed');
  assert.equal(trace.payload.data.response.errorCode, 'invalid_master_runner_result');

  const transcriptMarkdown = await readFile(confirm.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /The remote master could not validate the request payload/i);
});

test('caller surfaces declined replies as remote_failed and preserves the decline details', { concurrency: false }, async (t) => {
  const prepared = await prepareMasterHomes(t);
  const responseJson = buildFakeMasterResponse(prepared.preview, {
    status: 'declined',
    summary: 'The remote master declined because the request is outside its supported scope.',
    errorCode: 'master_declined',
    structuredData: {
      risks: ['This master is intentionally refusing the request rather than failing to process it.'],
    },
    followUpQuestion: 'Can you route this to a planning-oriented master instead?',
  });

  const confirm = await runCommand(
    prepared.callerHome,
    ['master', 'ask', '--trace-id', prepared.preview.payload.data.traceId, '--confirm'],
    {
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: VALID_TEST_PROVIDER_CHAT_PUBLIC_KEY,
      METABOT_TEST_FAKE_MASTER_REPLY: JSON.stringify({ responseJson }),
    }
  );

  assert.equal(confirm.exitCode, 0);
  assert.equal(confirm.payload.ok, true);
  assert.equal(confirm.payload.data.session.publicStatus, 'remote_failed');
  assert.equal(confirm.payload.data.session.event, 'provider_failed');
  assert.equal(confirm.payload.data.response.status, 'declined');
  assert.equal(confirm.payload.data.response.errorCode, 'master_declined');
  assert.equal(
    confirm.payload.data.response.followUpQuestion,
    'Can you route this to a planning-oriented master instead?'
  );

  const trace = await runCommand(prepared.callerHome, ['master', 'trace', '--id', prepared.preview.payload.data.traceId]);
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.canonicalStatus, 'failed');
  assert.equal(trace.payload.data.response.status, 'declined');
  assert.equal(trace.payload.data.response.errorCode, 'master_declined');
  assert.equal(trace.payload.data.failure.code, 'master_declined');

  const transcriptMarkdown = await readFile(confirm.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /outside its supported scope/i);
});

test('caller surfaces unavailable replies as remote_failed and preserves the availability details', { concurrency: false }, async (t) => {
  const prepared = await prepareMasterHomes(t);
  const responseJson = buildFakeMasterResponse(prepared.preview, {
    status: 'unavailable',
    summary: 'The remote master is temporarily unavailable while the provider is restarting.',
    errorCode: 'master_temporarily_unavailable',
    structuredData: {
      risks: ['Retrying immediately may fail until the provider finishes restarting.'],
    },
  });

  const confirm = await runCommand(
    prepared.callerHome,
    ['master', 'ask', '--trace-id', prepared.preview.payload.data.traceId, '--confirm'],
    {
      METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY: VALID_TEST_PROVIDER_CHAT_PUBLIC_KEY,
      METABOT_TEST_FAKE_MASTER_REPLY: JSON.stringify({ responseJson }),
    }
  );

  assert.equal(confirm.exitCode, 0);
  assert.equal(confirm.payload.ok, true);
  assert.equal(confirm.payload.data.session.publicStatus, 'remote_failed');
  assert.equal(confirm.payload.data.session.event, 'provider_failed');
  assert.equal(confirm.payload.data.response.status, 'unavailable');
  assert.equal(confirm.payload.data.response.errorCode, 'master_temporarily_unavailable');

  const trace = await runCommand(prepared.callerHome, ['master', 'trace', '--id', prepared.preview.payload.data.traceId]);
  assert.equal(trace.exitCode, 0);
  assert.equal(trace.payload.ok, true);
  assert.equal(trace.payload.data.canonicalStatus, 'failed');
  assert.equal(trace.payload.data.response.status, 'unavailable');
  assert.equal(trace.payload.data.response.errorCode, 'master_temporarily_unavailable');
  assert.equal(trace.payload.data.failure.code, 'master_temporarily_unavailable');

  const transcriptMarkdown = await readFile(confirm.payload.data.transcriptMarkdownPath, 'utf8');
  assert.match(transcriptMarkdown, /temporarily unavailable/i);
});
