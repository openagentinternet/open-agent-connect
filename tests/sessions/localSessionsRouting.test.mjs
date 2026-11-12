import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths, resolveMetabotSessionPaths } = require('../../dist/core/state/paths.js');
const { createLocalSessionRegistry } = require('../../dist/core/sessions/registry.js');
const { createSessionMailQueue } = require('../../dist/core/sessions/mailQueue.js');
const { createLocalSessionRouter } = require('../../dist/core/sessions/router.js');
const { createSessionLayer } = require('../../dist/daemon/sessionsHandlers.js');
const { createSessionsDaemonHandlers } = require('../../dist/daemon/sessionsHandlers.js');
const { createPrivateChatStateStore } = require('../../dist/core/chat/privateChatStateStore.js');
const { createChatStrategyStore } = require('../../dist/core/chat/chatStrategyStore.js');
const { createPrivateChatAutoReplyOrchestrator } = require('../../dist/core/chat/privateChatAutoReply.js');
const { wireSessionsMcp } = require('../../dist/core/sessions/hostWire.js');
const { createMcpSessionServer } = require('../../dist/core/sessions/mcpServer.js');

// ---------- registry bindings ----------

test('registry bind/unbind by name or key; bindings survive re-registration', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-bind-');
  const registry = createLocalSessionRegistry({
    statePath: path.join(root, 'local-sessions.json'),
    probeRepo: async () => ({ repo: 'r', branch: 'main' }),
  });
  const created = await registry.registerSession({
    agent: 'mcp-client',
    sessionId: 's1',
    source: 'mcp',
    deliverable: true,
  });
  assert.equal(created.name, 'session-mcp-client', 'default name is <dir|session>-<agent>');

  const bound = await registry.bindConversation({
    sessionRef: created.name,
    conversationId: 'pc-self-peer',
    profileSlug: 'twin',
  });
  assert.deepEqual(bound.boundConversations.map(({ conversationId, profileSlug }) => ({ conversationId, profileSlug })), [{
    conversationId: 'pc-self-peer',
    profileSlug: 'twin',
  }]);

  // Re-registration (resume) keeps the binding.
  await registry.registerSession({ agent: 'mcp-client', sessionId: 's1', source: 'mcp', deliverable: true });
  const found = await registry.findByConversation('pc-self-peer');
  assert.equal(found.sessionKey, 'mcp-client:s1');
  assert.equal(found.boundConversations.length, 1);

  // Unbind drops it; a second unbind finds nothing.
  const unbound = await registry.unbindConversation('pc-self-peer');
  assert.equal(unbound.sessionKey, 'mcp-client:s1');
  assert.deepEqual(await registry.unbindConversation('pc-self-peer'), null);

  // Binding to an unknown ref fails clearly.
  await assert.rejects(
    () => registry.bindConversation({ sessionRef: 'ghost', conversationId: 'pc-x' }),
    /no local session matches/,
  );
});

// ---------- router ----------

test('router enqueues mail for bound conversations and enriches the binding; null otherwise', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-router-');
  const registry = createLocalSessionRegistry({
    statePath: path.join(root, 'local-sessions.json'),
    probeRepo: async () => ({ repo: 'r', branch: 'main' }),
  });
  const mailQueue = createSessionMailQueue({ statePath: path.join(root, 'session-mail.json') });
  const router = createLocalSessionRouter({ registry, mailQueue });
  const created = await registry.registerSession({ agent: 'mcp-client', sessionId: 'dev1', source: 'mcp', deliverable: true });

  // Unbound conversation: null (bot runtime answers).
  assert.equal(await router.routeInbound({
    conversationId: 'pc-self-otherpeer',
    peerGlobalMetaId: 'peer-a',
    body: 'hello',
  }), null);

  await registry.bindConversation({ sessionRef: created.name, conversationId: 'pc-self-peer-a' });
  const routed = await router.routeInbound({
    conversationId: 'pc-self-peer-a',
    peerGlobalMetaId: 'peer-a',
    body: 'fix the login bug',
    profileSlug: 'twin',
  });
  assert.equal(routed.delivered, true);
  assert.equal(routed.sessionKey, 'mcp-client:dev1');
  assert.equal(routed.sessionName, created.name);

  // The binding now carries the observed peer + profile (send anchor).
  const record = await registry.findByRef('mcp-client:dev1');
  assert.deepEqual(record.boundConversations, [{
    conversationId: 'pc-self-peer-a',
    profileSlug: 'twin',
    peerGlobalMetaId: 'peer-a',
  }]);

  // The mail sits in the queue (the offline waiting room) until check.
  const handed = await mailQueue.checkInbox({ sessionKey: 'mcp-client:dev1' });
  assert.equal(handed.length, 1);
  assert.equal(handed[0].body, 'fix the login bug');
  assert.equal(handed[0].from, 'peer-a');
});

// ---------- orchestrator hook ----------

async function createRoutingHarness(routeInboundToLocalSession) {
  const base = await mkdtempTempRoot('metabot-sessions-orchestrator-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  const paths = resolveMetabotPaths(profileRoot);
  const localGlobalMetaId = 'idq1localbot0000000000000000000000000';
  const peerGlobalMetaId = 'idq1peerbot00000000000000000000000000';
  const runnerInputs = [];
  const stateStore = createPrivateChatStateStore(paths);
  const orchestrator = createPrivateChatAutoReplyOrchestrator({
    stateStore,
    strategyStore: createChatStrategyStore(paths),
    paths,
    signer: {
      async getIdentity() {
        throw new Error('not used');
      },
      async getPrivateChatIdentity() {
        return {
          globalMetaId: localGlobalMetaId,
          chatPublicKey: 'k',
          privateKeyHex: 'k',
        };
      },
      async writePin() {
        return {
          txids: ['t'], pinId: 'p', totalCost: 0, network: 'mvc',
          operation: 'create', path: 'x', contentType: 'text/plain', encoding: 'utf-8',
          globalMetaId: localGlobalMetaId, mvcAddress: 'm',
        };
      },
    },
    selfGlobalMetaId: async () => localGlobalMetaId,
    resolvePeerChatPublicKey: async () => 'peer-key',
    replyRunner: async (input) => {
      runnerInputs.push(input);
      return { state: 'reply', content: 'bot reply' };
    },
    routeInboundToLocalSession,
    now: () => 1_770_000_000_000,
  }, {
    enabled: true,
    acceptPolicy: 'accept_all',
    defaultStrategyId: null,
  });
  return {
    orchestrator,
    stateStore,
    peerGlobalMetaId,
    runnerInputs,
    async handleInbound() {
      return orchestrator.handleInboundMessage({
        fromGlobalMetaId: peerGlobalMetaId,
        content: 'hello from remote bot',
        messagePinId: 'in-pin-1',
        fromChatPublicKey: 'peer-key',
        timestamp: 1_770_000_000_000,
        rawMessage: null,
      });
    },
  };
}

test('bound conversation: mail routed to the session, no bot runtime turn', async () => {
  const routed = [];
  const h = await createRoutingHarness(async (input) => {
    routed.push(input);
    return { delivered: true, sessionKey: 'mcp-client:dev1', sessionName: 'session-dev1', mailId: 'mail-1' };
  });
  await h.handleInbound();
  assert.equal(h.runnerInputs.length, 0, 'no bot runtime turn for a bound conversation');
  assert.equal(routed.length, 1);
  assert.match(routed[0].conversationId, /^pc-idq1localbot/);
  assert.equal(routed[0].peerGlobalMetaId, h.peerGlobalMetaId);
  assert.equal(routed[0].body, 'hello from remote bot');
  // The inbound is still persisted (the conversation tail stays readable).
  const conversation = await h.stateStore.getConversationByPeer(h.peerGlobalMetaId);
  const messages = await h.stateStore.getRecentMessages(conversation.conversationId, 10);
  assert.equal(messages.filter((m) => m.direction === 'inbound').length, 1);
});

test('unbound conversation (router returns null): bot runtime turn as before', async () => {
  const h = await createRoutingHarness(async () => null);
  await h.handleInbound();
  assert.equal(h.runnerInputs.length, 1, 'behavior unchanged for unbound conversations');
});

test('routing failure fails open: the bot runtime answers', async () => {
  const h = await createRoutingHarness(async () => {
    throw new Error('registry exploded');
  });
  await h.handleInbound();
  assert.equal(h.runnerInputs.length, 1, 'fail-open keeps the bot answering');
});

// ---------- daemon handlers: bind/unbind/send ----------

test('sessions handlers bind and send anchored replies through chat.private', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-send-');
  const layer = createSessionLayer(root);
  const sends = [];
  const handlers = createSessionsDaemonHandlers({
    systemHomeDir: root,
    sessionLayer: layer,
    getChatPrivateSend: () => async (rawInput) => {
      sends.push(rawInput);
      return { ok: true, state: 'success', data: { pinId: 'out-pin' } };
    },
  });

  await handlers.register({ agent: 'mcp-client', sessionId: 'dev9' });
  const listed = await handlers.list({});
  const createdName = listed.data.sessions[0].name;
  const bound = await handlers.bind({
    sessionRef: createdName,
    conversationId: 'pc-self-peer-a',
    profileSlug: 'twin',
  });
  assert.equal(bound.ok, true);
  assert.deepEqual(bound.data.record.boundConversations.map((b) => b.conversationId), ['pc-self-peer-a']);

  // Send before any routed mail: no observed peer -> refused (never guessed).
  const early = await handlers.sendMessage({
    sessionKey: 'mcp-client:dev9',
    to: 'peer-a-gmid',
    message: 'on it',
  });
  assert.equal(early.ok, false);
  assert.equal(early.code, 'session_not_bound_to_peer');

  // Mail routes through the shared layer's router (enriches the binding).
  const routed = await layer.router.routeInbound({
    conversationId: 'pc-self-peer-a',
    peerGlobalMetaId: 'peer-a-gmid',
    body: 'please fix',
    profileSlug: 'twin',
  });
  assert.equal(routed.delivered, true);

  const sent = await handlers.sendMessage({
    sessionKey: createdName,
    to: 'peer-a-gmid',
    message: 'on it now',
  });
  assert.equal(sent.ok, true);
  assert.equal(sent.data.profileSlug, 'twin');
  assert.deepEqual(sends, [{ from: 'twin', to: 'peer-a-gmid', content: 'on it now' }]);

  // No chat pipeline wired (unit context): explicit unavailable error.
  const bare = createSessionsDaemonHandlers({ systemHomeDir: root, sessionLayer: layer });
  await layer.router.routeInbound({
    conversationId: 'pc-self-peer-a',
    peerGlobalMetaId: 'peer-a-gmid',
    body: 'again',
  });
  const unavailable = await bare.sendMessage({
    sessionKey: createdName,
    to: 'peer-a-gmid',
    message: 'x',
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, 'chat_send_unavailable');

  // Unbind stops the routing.
  const unbound = await handlers.unbind({ conversationId: 'pc-self-peer-a' });
  assert.equal(unbound.ok, true);
  assert.equal(await layer.router.routeInbound({
    conversationId: 'pc-self-peer-a',
    peerGlobalMetaId: 'peer-a-gmid',
    body: 'after unbind',
  }), null);
});

// ---------- host wiring (ZCode first) ----------

test('wireSessionsMcp writes, backs up, and removes the metabot-sessions entry', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-wire-');
  const zcodeDir = path.join(root, '.zcode');
  const cliDir = path.join(zcodeDir, 'cli');
  await fs.mkdir(cliDir, { recursive: true });
  await fs.writeFile(path.join(cliDir, 'config.json'), JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));

  const wired = await wireSessionsMcp({
    host: 'zcode',
    zcodeDir,
    mcpCommand: { command: '/usr/bin/node', args: ['/opt/metabot/main.js', 'mcp'] },
  });
  assert.equal(wired.wired, true);
  assert.ok(wired.configFile.endsWith('cli/config.json'));
  assert.ok(wired.backedUpTo);

  const parsed = JSON.parse(await fs.readFile(wired.configFile, 'utf8'));
  assert.equal(parsed.theme, 'dark', 'unrelated keys are preserved');
  assert.deepEqual(parsed.mcpServers['metabot-sessions'], { command: '/usr/bin/node', args: ['/opt/metabot/main.js', 'mcp'] });
  assert.ok(parsed.mcpServers.other);
  // The backup holds the pre-wire content.
  const backup = JSON.parse(await fs.readFile(wired.backedUpTo, 'utf8'));
  assert.equal(backup.mcpServers['metabot-sessions'], undefined);

  const removed = await wireSessionsMcp({
    host: 'zcode',
    zcodeDir,
    remove: true,
    mcpCommand: { command: 'x', args: [] },
  });
  assert.equal(removed.wired, false);
  const afterRemove = JSON.parse(await fs.readFile(removed.configFile, 'utf8'));
  assert.equal(afterRemove.mcpServers['metabot-sessions'], undefined);
  assert.ok(afterRemove.mcpServers.other);

  // Creating config from nothing: the first candidate is the creation target.
  const fresh = await wireSessionsMcp({
    host: 'zcode',
    zcodeDir: path.join(root, '.zcode-empty'),
    agentsDir: path.join(root, '.agents-empty'),
    mcpCommand: { command: 'node', args: ['m'] },
  });
  assert.ok(fresh.configFile.endsWith('.zcode-empty/cli/config.json'), 'no candidate exists: create the first');
  const freshParsed = JSON.parse(await fs.readFile(fresh.configFile, 'utf8'));
  assert.deepEqual(freshParsed.mcpServers['metabot-sessions'], { command: 'node', args: ['m'] });

  // Missing ZCode config but an existing agents fallback: the fallback wins.
  await fs.writeFile(path.join(root, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  const fallback = await wireSessionsMcp({
    host: 'zcode',
    zcodeDir: path.join(root, '.zcode-fallback'),
    agentsDir: root,
    mcpCommand: { command: 'node', args: ['m'] },
  });
  assert.equal(fallback.configFile, path.join(root, 'mcp.json'), 'missing zcode config falls back to agents/mcp.json');
  const fallbackParsed = JSON.parse(await fs.readFile(fallback.configFile, 'utf8'));
  assert.deepEqual(fallbackParsed.mcpServers['metabot-sessions'], { command: 'node', args: ['m'] });

  // Broken JSON is refused, not clobbered.
  await fs.writeFile(path.join(cliDir, 'config.json'), '{nope');
  await assert.rejects(
    () => wireSessionsMcp({ host: 'zcode', zcodeDir, mcpCommand: { command: 'x', args: [] } }),
    /not valid JSON/,
  );

  await assert.rejects(
    () => wireSessionsMcp({ host: 'claude-code', zcodeDir, mcpCommand: { command: 'x', args: [] } }),
    /Unsupported host/,
  );
});

// ---------- MCP send_message tool ----------

test('mcpServer send_message routes through the backend and errors without a session', async () => {
  const sends = [];
  const backend = {
    listSessions: async () => ({}),
    registerSession: async () => ({}),
    checkInbox: async () => ({}),
    messageStatus: async () => ({}),
    sendMessage: async (input) => {
      sends.push(input);
      return { ok: true, state: 'success', data: { sent: true } };
    },
  };
  const responses = [];
  const server = createMcpSessionServer(
    {
      input: (async function* generate() {
        yield JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'send_message', arguments: { to: 'peer-1', message: 'on it' } } });
        await new Promise((resolve) => setTimeout(resolve, 20));
      })(),
      write: (line) => responses.push(JSON.parse(line)),
    },
    backend,
    { sessionKey: 'mcp-client:dev1' },
  );
  await server.run();
  assert.equal(responses.length, 1);
  assert.equal(responses[0].result.isError, false);
  assert.deepEqual(sends, [{ sessionKey: 'mcp-client:dev1', to: 'peer-1', message: 'on it' }]);

  const noSessionResponses = [];
  const serverNoSession = createMcpSessionServer(
    {
      input: (async function* generate() {
        yield JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'send_message', arguments: { to: 'p', message: 'm' } } });
        await new Promise((resolve) => setTimeout(resolve, 20));
      })(),
      write: (line) => noSessionResponses.push(JSON.parse(line)),
    },
    backend,
    {},
  );
  await serverNoSession.run();
  assert.equal(noSessionResponses[0].result.isError, true);
  assert.match(noSessionResponses[0].result.content[0].text, /no bound session/);
});

// ---------- P5a: kimi wiring + doctor check ----------

const { buildSessionsDoctorCheck } = require('../../dist/core/sessions/sessionsDoctor.js');
const { mkdir: mkDir, readFile, writeFile } = fs;

test('wireSessionsMcp supports the kimi host (~/.kimi-code/mcp.json, same stdio shape)', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-wire-kimi-');
  const kimiDir = path.join(root, '.kimi-code');
  await mkDir(kimiDir, { recursive: true });
  await writeFile(path.join(kimiDir, 'mcp.json'), JSON.stringify({ mcpServers: { 'kimi-cu': { command: 'x' } } }));

  const wired = await wireSessionsMcp({
    host: 'kimi',
    kimiDir,
    mcpCommand: { command: '/usr/bin/node', args: ['/opt/metabot/main.js', 'mcp'] },
  });
  assert.equal(wired.wired, true);
  assert.ok(wired.configFile.endsWith('.kimi-code/mcp.json'));
  const parsed = JSON.parse(await readFile(wired.configFile, 'utf8'));
  assert.deepEqual(parsed.mcpServers['metabot-sessions'], { command: '/usr/bin/node', args: ['/opt/metabot/main.js', 'mcp'] });
  assert.ok(parsed.mcpServers['kimi-cu'], 'existing servers preserved');

  const removed = await wireSessionsMcp({ host: 'kimi', kimiDir, remove: true, mcpCommand: { command: 'x', args: [] } });
  assert.equal(removed.wired, false);
  const after = JSON.parse(await readFile(removed.configFile, 'utf8'));
  assert.equal(after.mcpServers['metabot-sessions'], undefined);
  assert.ok(after.mcpServers['kimi-cu']);
});

test('buildSessionsDoctorCheck reports registry state and wiring presence without throwing', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-doctor-');
  const kimiDir = path.join(root, '.kimi-code');
  await mkDir(kimiDir, { recursive: true });
  await writeFile(path.join(kimiDir, 'mcp.json'), JSON.stringify({ mcpServers: {} }));

  // Nothing registered yet: still ok, with the setup note.
  const empty = await buildSessionsDoctorCheck(root, { kimiDir, zcodeDir: path.join(root, 'no-zcode'), cursorDir: path.join(root, 'no-cursor'), geminiDir: path.join(root, 'no-gemini') });
  assert.equal(empty.ok, true);
  assert.equal(empty.liveSessions, 0);
  assert.equal(empty.registryReadable, false);
  assert.match(empty.note, /No sessions registered yet/);
  assert.equal(empty.wiring.kimi, 'wired');
  assert.equal(empty.wiring.zcode, 'not-wired');

  // A registry with a live + deliverable session and one binding.
  const registry = createLocalSessionRegistry({
    statePath: require('../../dist/core/state/paths.js').resolveMetabotSessionPaths(root).localSessionsPath,
    probeRepo: async () => ({ repo: 'r', branch: 'main' }),
  });
  const created = await registry.registerSession({ agent: 'mcp-client', sessionId: 'live1', source: 'mcp', deliverable: true });
  await registry.bindConversation({ sessionRef: created.name, conversationId: 'pc-x-y' });
  const report = await buildSessionsDoctorCheck(root, { kimiDir, zcodeDir: path.join(root, 'no-zcode'), cursorDir: path.join(root, 'no-cursor'), geminiDir: path.join(root, 'no-gemini') });
  assert.equal(report.registryReadable, true);
  assert.ok(report.liveSessions >= 1);
  assert.ok(report.deliverableSessions >= 1);
  assert.equal(report.boundConversations, 1);
  assert.equal(report.note, undefined);
});
