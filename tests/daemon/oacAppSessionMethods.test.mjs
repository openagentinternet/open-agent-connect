import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createOacBrowserHostAdapter } = require('../../dist/daemon/browser/oacBrowserHostAdapter.js');
const { createMetabotProfileFromIdentity, getMetabotProfile } = require('../../dist/core/bot/metabotProfileManager.js');
const { commandFailed } = require('../../dist/core/contracts/commandResult.js');
const { createMetaAppPreviewSessionRegistry } = require('../../dist/core/metaapp/previewSessions.js');

const LOCAL_GLOBAL_META_ID = 'idq1j3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const ADAPTER_HASH = `sha256:${'a'.repeat(64)}`;

function makeSession(overrides = {}) {
  return {
    sessionId: 'sess-1',
    appId: 'llmchess.v2',
    sessionType: 'agent-game',
    groupId: 'room1234567890abcdef',
    gameId: 'xiangqi',
    manifestUri: 'metafile://abc123.zip',
    adapterHash: ADAPTER_HASH,
    rulesHash: `sha256:${'b'.repeat(64)}`,
    seat: 'red',
    agentId: LOCAL_GLOBAL_META_ID,
    status: 'running',
    lastIndex: 0,
    lastActionSeq: 0,
    lastError: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    expiresAt: 1700086400000,
    budget: { llmCalls: 500, llmCallsUsed: 0, writes: 500, writesUsed: 0 },
    ...overrides,
  };
}

function createFakeAppSessionHost(options = {}) {
  const calls = [];
  const session = options.session ?? makeSession();
  const host = {
    calls,
    async validateStart(input) {
      calls.push(['validateStart', input]);
      if (options.validateStartError) {
        return { ok: false, error: options.validateStartError };
      }
      return { ok: true, adapterHash: ADAPTER_HASH };
    },
    async start(input) {
      calls.push(['start', input]);
      return { ...session, agentId: input.agentId };
    },
    async list(input) {
      calls.push(['list', input]);
      return options.sessions ?? [];
    },
    async status(sessionId) {
      calls.push(['status', sessionId]);
      if (sessionId === 'missing') {
        throw { code: 'session_not_found', message: `session ${sessionId} not found` };
      }
      return session;
    },
    async pause(sessionId) {
      calls.push(['pause', sessionId]);
      return { ...session, status: 'paused' };
    },
    async resume(sessionId) {
      calls.push(['resume', sessionId]);
      return { ...session, status: 'running' };
    },
    async stop(sessionId, actor, optionsStop = {}) {
      calls.push(['stop', sessionId, optionsStop]);
      return { ...session, status: 'stopped' };
    },
  };
  return host;
}

async function createAdapter(input) {
  return createOacBrowserHostAdapter({
    homeDir: input.homeDir,
    systemHomeDir: input.systemHomeDir,
    metaAppPreviewSessions: createMetaAppPreviewSessionRegistry(),
    env: input.env ?? {},
    fetch: input.fetch ?? globalThis.fetch,
    now: input.now,
    confirmationTtlMs: input.confirmationTtlMs,
    appSession: input.appSession,
    audit: input.audit,
    resolveActorWriteContext: async (rawActor) => {
      const slug = typeof rawActor === 'string' ? rawActor.trim() : '';
      if (!slug) {
        return { homeDir: input.homeDir };
      }
      const profile = await getMetabotProfile(input.systemHomeDir, slug);
      if (!profile) {
        return {
          failure: commandFailed('profile_not_found', `MetaBot profile not found: ${slug}`),
        };
      }
      return { homeDir: profile.homeDir };
    },
  });
}

const startParams = {
  appId: 'llmchess.v2',
  sessionType: 'agent-game',
  groupId: 'room1234567890abcdef',
  gameId: 'xiangqi',
  manifestUri: 'metafile://abc123.zip',
  rulesHash: `sha256:${'b'.repeat(64)}`,
  seat: 'red',
  agentId: LOCAL_GLOBAL_META_ID,
  ttlMs: 86_400_000,
  budget: { llmCalls: 500, writes: 500 },
};

async function setup(t) {
  const profileHome = await createProfileHome('oac-app-session-methods');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const created = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'App Session Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18AppSession',
  });
  return { profileHome, systemHomeDir, slug: created.slug };
}

test('app-session-start first phase issues a task authorization card', async (t) => {
  const { systemHomeDir, profileHome, slug } = await setup(t);
  const host = createFakeAppSessionHost();
  const adapter = await createAdapter({ homeDir: profileHome, systemHomeDir, appSession: host });

  const result = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: { ...startParams },
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'manual_action_required');
  assert.equal(result.code, 'manual_action_required');
  const data = result.data;
  assert.equal(data.confirmation.actor.globalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(data.confirmation.gameId, 'xiangqi');
  assert.equal(data.confirmation.adapterHash, ADAPTER_HASH);
  assert.equal(data.confirmation.seat, 'red');
  assert.deepEqual(data.confirmation.protocolPaths, [
    '/protocols/simplegroupjoin',
    '/protocols/simplegroupchat',
  ]);
  assert.equal(data.confirmation.ttlMs, 86_400_000);
  assert.deepEqual(data.confirmation.budget, { llmCalls: 500, writes: 500 });
  assert.equal(data.confirmRequest.kind, 'app-session-start');
  assert.equal(data.confirmRequest.resourceUri, 'metaapp://llmchess.v2');
  assert.equal(data.confirmRequest.payload.confirmed, true);
  assert.ok(data.confirmRequest.payload.hostConfirmation.id);
  assert.ok(data.confirmRequest.payload.hostConfirmation.token);

  const validateCall = host.calls.find(([name]) => name === 'validateStart');
  assert.ok(validateCall);
  assert.equal(validateCall[1].actorId, slug);
  assert.equal(validateCall[1].actorGlobalMetaId, LOCAL_GLOBAL_META_ID);
  assert.equal(validateCall[1].resourceUri, 'metaapp://llmchess.v2');
  assert.equal(validateCall[1].agentId, LOCAL_GLOBAL_META_ID);
});

test('app-session-start confirms with the host token and returns the session', async (t) => {
  const { systemHomeDir, profileHome, slug } = await setup(t);
  const host = createFakeAppSessionHost();
  const adapter = await createAdapter({ homeDir: profileHome, systemHomeDir, appSession: host });

  const card = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: { ...startParams },
  });
  const confirmRequest = card.data.confirmRequest;
  const result = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: confirmRequest.payload,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.data.session.sessionId, 'sess-1');
  assert.equal(result.data.data.session.agentId, LOCAL_GLOBAL_META_ID);
  const startCall = host.calls.find(([name]) => name === 'start');
  assert.equal(startCall[1].seat, 'red');
  assert.equal(startCall[1].groupId, 'room1234567890abcdef');
});

test('app-session-start rejects forged or expired confirmations with consent_denied', async (t) => {
  const { systemHomeDir, profileHome, slug } = await setup(t);
  const host = createFakeAppSessionHost();
  const adapter = await createAdapter({ homeDir: profileHome, systemHomeDir, appSession: host });

  const card = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: { ...startParams },
  });
  const forged = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: {
      ...card.data.confirmRequest.payload,
      hostConfirmation: { id: card.data.confirmRequest.payload.hostConfirmation.id, token: 'forged' },
    },
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.code, 'consent_denied');

  const tampered = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: {
      ...card.data.confirmRequest.payload,
      seat: 'black',
    },
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.code, 'consent_denied');
});

test('app-session-start rejects expired confirmations', async (t) => {
  const { systemHomeDir, profileHome, slug } = await setup(t);
  let currentTime = 1_700_000_000_000;
  const host = createFakeAppSessionHost();
  const adapter = await createAdapter({
    homeDir: profileHome,
    systemHomeDir,
    appSession: host,
    now: () => currentTime,
    confirmationTtlMs: 60_000,
  });

  const card = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: { ...startParams },
  });
  currentTime += 61_000;
  const expired = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: card.data.confirmRequest.payload,
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'consent_denied');
});

test('app-session-start validates params and actor binding', async (t) => {
  const { systemHomeDir, profileHome, slug } = await setup(t);
  const host = createFakeAppSessionHost();
  const adapter = await createAdapter({ homeDir: profileHome, systemHomeDir, appSession: host });

  const missing = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: { ...startParams, groupId: '' },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'invalid_params');

  const badSessionType = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: { ...startParams, sessionType: 'game' },
  });
  assert.equal(badSessionType.code, 'invalid_params');

  const wrongAgent = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: { ...startParams, agentId: 'idq1someone-else' },
  });
  assert.equal(wrongAgent.code, 'invalid_params');
});

test('app-session-start surfaces preflight errors with stable codes', async (t) => {
  const { systemHomeDir, profileHome, slug } = await setup(t);
  const host = createFakeAppSessionHost({
    validateStartError: { code: 'rules_hash_mismatch', message: 'rules hash mismatch' },
  });
  const adapter = await createAdapter({ homeDir: profileHome, systemHomeDir, appSession: host });
  const result = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: { ...startParams },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'rules_hash_mismatch');
});

test('app-session methods without a configured runtime return unsupported_method', async (t) => {
  const { systemHomeDir, profileHome, slug } = await setup(t);
  const adapter = await createAdapter({ homeDir: profileHome, systemHomeDir });
  const result = await adapter.runTrustedAction({
    actorId: slug,
    resourceUri: 'metaapp://llmchess.v2',
    kind: 'app-session-start',
    payload: { ...startParams },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unsupported_method');
});

test('app-session-list/status/pause/resume/stop route to the runtime', async (t) => {
  const { systemHomeDir, profileHome, slug } = await setup(t);
  const session = makeSession();
  const host = createFakeAppSessionHost({ session, sessions: [session] });
  const adapter = await createAdapter({ homeDir: profileHome, systemHomeDir, appSession: host });
  const base = { actorId: slug, resourceUri: 'metaapp://llmchess.v2' };

  const list = await adapter.runTrustedAction({
    ...base,
    kind: 'app-session-list',
    payload: { appId: 'llmchess.v2', status: 'running', groupId: 'room1234567890abcdef' },
  });
  assert.equal(list.ok, true);
  assert.deepEqual(list.data.data.sessions, [session]);
  const listCall = host.calls.find(([name]) => name === 'list');
  assert.equal(listCall[1].appId, 'llmchess.v2');
  assert.equal(listCall[1].status, 'running');
  assert.equal(listCall[1].groupId, 'room1234567890abcdef');

  const status = await adapter.runTrustedAction({
    ...base,
    kind: 'app-session-status',
    payload: { sessionId: 'sess-1' },
  });
  assert.equal(status.ok, true);
  assert.equal(status.data.data.session.sessionId, 'sess-1');

  const missing = await adapter.runTrustedAction({
    ...base,
    kind: 'app-session-status',
    payload: { sessionId: 'missing' },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'session_not_found');

  const missingId = await adapter.runTrustedAction({
    ...base,
    kind: 'app-session-status',
    payload: {},
  });
  assert.equal(missingId.code, 'invalid_params');

  const paused = await adapter.runTrustedAction({
    ...base,
    kind: 'app-session-pause',
    payload: { sessionId: 'sess-1' },
  });
  assert.equal(paused.ok, true);
  assert.equal(paused.data.data.session.status, 'paused');

  const resumed = await adapter.runTrustedAction({
    ...base,
    kind: 'app-session-resume',
    payload: { sessionId: 'sess-1' },
  });
  assert.equal(resumed.data.data.session.status, 'running');

  const stopped = await adapter.runTrustedAction({
    ...base,
    kind: 'app-session-stop',
    payload: { sessionId: 'sess-1', releaseSeat: true },
  });
  assert.equal(stopped.data.data.session.status, 'stopped');
  const stopCall = host.calls.find(([name]) => name === 'stop');
  assert.deepEqual(stopCall[2], { releaseSeat: true });
});
