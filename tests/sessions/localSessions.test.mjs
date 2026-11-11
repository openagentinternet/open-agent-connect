import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  defaultSessionName,
  resolveSessionName,
  slugifySessionName,
} = require('../../dist/core/sessions/naming.js');
const {
  SESSION_LAPSE_TTL_MS,
  SESSION_LIVE_WINDOW_MS,
  createLocalSessionRegistry,
} = require('../../dist/core/sessions/registry.js');
const {
  epochToMs,
  parseClaudeSessionFile,
  scanClaudeSessions,
} = require('../../dist/core/sessions/discovery/claude.js');
const {
  parseCodexSessionIndexLine,
  scanCodexSessions,
} = require('../../dist/core/sessions/discovery/codex.js');
const { createSessionsDaemonHandlers } = require('../../dist/daemon/sessionsHandlers.js');
const { runSessionsCommand } = require('../../dist/cli/commands/sessions.js');

const NO_REPO = { repo: '', branch: '' };
function fakeProbeRepo(preferred = {}) {
  return async (cwd) => ({
    repo: preferred.repo ?? `${path.basename(cwd)}-repo`,
    branch: preferred.branch ?? 'main',
  });
}

function fixedNow(startMs) {
  let current = startMs;
  return {
    now: () => current,
    advanceMs: (delta) => {
      current += delta;
    },
  };
}

// ---------- naming ----------

test('defaultSessionName slugs the cwd basename with the short agent name', () => {
  assert.equal(defaultSessionName({ cwd: '/Users/x/api-server', agent: 'claude-code' }), 'api-server-claude');
  assert.equal(defaultSessionName({ cwd: '/Users/x/My Weird Dir!', agent: 'claude-code' }), 'my-weird-dir-claude');
  assert.equal(defaultSessionName({ agent: 'codex' }), 'session-codex');
  assert.equal(slugifySessionName('Fix the Login Bug!!'), 'fix-the-login-bug');
});

test('resolveSessionName honors free names and suffixes taken ones', () => {
  assert.equal(resolveSessionName({ requested: 'mine', defaultName: 'api-claude', takenNames: [] }), 'mine');
  assert.equal(
    resolveSessionName({ requested: 'mine', defaultName: 'api-claude', takenNames: ['mine'] }),
    'mine-2',
  );
  assert.equal(
    resolveSessionName({ defaultName: 'api-claude', takenNames: ['api-claude', 'api-claude-2'] }),
    'api-claude-3',
  );
});

// ---------- registry ----------

test('registerSession creates a deliverable record with probed repo identity', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-registry-');
  const clock = fixedNow(1_000_000);
  const registry = createLocalSessionRegistry({
    statePath: path.join(root, 'local-sessions.json'),
    now: clock.now,
    probeRepo: fakeProbeRepo({ branch: 'feat/auth' }),
  });
  const record = await registry.registerSession({
    agent: 'claude-code',
    sessionId: 'abc-123',
    cwd: '/Users/x/api-server',
    source: 'mcp',
    deliverable: true,
    status: 'busy',
  });
  assert.equal(record.sessionKey, 'claude-code:abc-123');
  assert.equal(record.name, 'api-server-claude');
  assert.equal(record.tier, 'push');
  assert.equal(record.deliverable, true);
  assert.equal(record.repo, 'api-server-repo');
  assert.equal(record.branch, 'feat/auth');

  const listed = await registry.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].alive, true);
});

test('a re-registered session key keeps its name; a new session takes the next suffix', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-registry-');
  const clock = fixedNow(1_000_000);
  const registry = createLocalSessionRegistry({
    statePath: path.join(root, 'local-sessions.json'),
    now: clock.now,
    probeRepo: fakeProbeRepo(),
  });
  const first = await registry.registerSession({
    agent: 'claude-code',
    sessionId: 'one',
    cwd: '/work/api',
    source: 'mcp',
    deliverable: true,
  });
  const resumed = await registry.registerSession({
    agent: 'claude-code',
    sessionId: 'one',
    cwd: '/work/api',
    source: 'hook',
    deliverable: true,
    name: 'i-want-this',
  });
  assert.equal(resumed.name, first.name, 'name keeping across resume');

  const second = await registry.registerSession({
    agent: 'claude-code',
    sessionId: 'two',
    cwd: '/work/api',
    source: 'mcp',
    deliverable: true,
  });
  assert.equal(second.name, `${first.name}-2`);
});

test('list applies the live window and the 24h lapse TTL', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-registry-ttl-');
  const clock = fixedNow(1_000_000);
  const statePath = path.join(root, 'local-sessions.json');
  const registry = createLocalSessionRegistry({
    statePath,
    now: clock.now,
    probeRepo: fakeProbeRepo(),
  });
  await registry.registerSession({
    agent: 'codex',
    sessionId: 'live-one',
    source: 'mcp',
    deliverable: true,
  });
  clock.advanceMs(SESSION_LIVE_WINDOW_MS + 1);
  assert.equal((await registry.list()).length, 0, 'outside the live window: not listed by default');
  const all = await registry.list({ all: true });
  assert.equal(all.length, 1);
  assert.equal(all[0].alive, false);

  clock.advanceMs(SESSION_LAPSE_TTL_MS);
  assert.equal((await registry.list({ all: true })).length, 0, 'lapsed records are pruned');
  const persisted = JSON.parse(await readFile(statePath, 'utf8'));
  assert.deepEqual(persisted.sessions, [], 'prune is persisted');
});

test('claim-sourced records are permanent and never lapse', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-registry-claim-');
  const clock = fixedNow(1_000_000);
  const registry = createLocalSessionRegistry({
    statePath: path.join(root, 'local-sessions.json'),
    now: clock.now,
    probeRepo: fakeProbeRepo(),
  });
  await registry.registerSession({
    agent: 'cli',
    sessionId: 'terminal',
    name: 'terminal',
    source: 'claim',
    deliverable: true,
  });
  clock.advanceMs(SESSION_LAPSE_TTL_MS * 3);
  const all = await registry.list({ all: true });
  assert.equal(all.length, 1);
  assert.equal(all[0].sessionKey, 'cli:terminal');
});

// ---------- discovery: claude ----------

test('parseClaudeSessionFile reads the camelCase registry format; junk is rejected', () => {
  const valid = parseClaudeSessionFile(JSON.stringify({
    pid: 4242,
    sessionId: 's-1',
    cwd: '/work/api',
    name: 'Fix the login bug',
    nameSource: 'auto',
    status: 'busy',
    startedAt: 1_700_000_000,
    messagingSocketPath: '/tmp/inbox.sock',
  }));
  assert.equal(valid.pid, 4242);
  assert.equal(valid.sessionId, 's-1');
  assert.equal(valid.messagingSocketPath, '/tmp/inbox.sock');
  assert.equal(parseClaudeSessionFile('not json'), null);
  assert.equal(parseClaudeSessionFile('{"nope":1}'), null);
  assert.equal(epochToMs(1_700_000_000), 1_700_000_000_000, 'epoch seconds are scaled');
  assert.equal(epochToMs(1_700_000_000_000), 1_700_000_000_000, 'epoch ms pass through');
});

test('scanClaudeSessions reads live registry files, filters dead pids, dedupes', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-claude-');
  const claudeDir = path.join(root, '.claude');
  await mkdir(path.join(claudeDir, 'sessions'), { recursive: true });
  const sessionsDir = path.join(claudeDir, 'sessions');
  await writeFile(path.join(sessionsDir, '111.json'), JSON.stringify({
    pid: 111,
    sessionId: 'alive-a',
    cwd: '/work/api',
    name: 'Fix the login bug soon now',
    nameSource: 'auto',
    status: 'busy',
  }));
  await writeFile(path.join(sessionsDir, '222.json'), JSON.stringify({
    pid: 222,
    sessionId: 'alive-b',
    cwd: '/work/api',
    name: 'Renamed by user',
    nameSource: 'user',
    status: 'idle',
    messagingSocketPath: '/tmp/inbox-b.sock',
  }));
  await writeFile(path.join(sessionsDir, '333.json'), JSON.stringify({ pid: 333, sessionId: 'dead' }));
  await writeFile(path.join(sessionsDir, 'junk.json'), '{oops');
  await writeFile(path.join(sessionsDir, 'notes.txt'), 'ignored');

  const discovered = await scanClaudeSessions({
    claudeDir,
    pidAlive: (pid) => pid !== 333,
  });
  assert.equal(discovered.length, 2);
  const bySessionId = new Map(discovered.map((entry) => [entry.sessionId, entry]));
  const auto = bySessionId.get('alive-a');
  assert.equal(auto.agent, 'claude-code');
  assert.equal(auto.name, 'Fix the login', 'auto names are cut to three words');
  assert.equal(auto.doing, 'Fix the login bug soon now');
  const renamed = bySessionId.get('alive-b');
  assert.equal(renamed.name, 'Renamed by user');
  assert.equal(renamed.inboxSocketPath, '/tmp/inbox-b.sock');
});

test('a missing Claude sessions directory scans as empty', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-claude-missing-');
  assert.deepEqual(await scanClaudeSessions({ claudeDir: path.join(root, 'nope') }), []);
});

// ---------- discovery: codex ----------

test('parseCodexSessionIndexLine reads the live index format; junk is rejected', () => {
  const entry = parseCodexSessionIndexLine('{"id":"t-1","thread_name":"Guardian review","updated_at":"2026-11-12T10:00:00.000Z"}');
  assert.equal(entry.id, 't-1');
  assert.equal(entry.threadName, 'Guardian review');
  assert.equal(parseCodexSessionIndexLine(''), null);
  assert.equal(parseCodexSessionIndexLine('[1,2]'), null);
  assert.equal(parseCodexSessionIndexLine('{"thread_name":"no id"}'), null);
});

test('scanCodexSessions keeps fresh entries, drops stale ones, later lines win', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-codex-');
  const codexDir = path.join(root, '.codex');
  await mkdir(codexDir, { recursive: true });
  const nowMs = Date.parse('2026-11-12T12:00:00.000Z');
  const hoursAgo = (h) => new Date(nowMs - h * 3_600_000).toISOString();
  await writeFile(path.join(codexDir, 'session_index.jsonl'), [
    `{"id":"fresh","thread_name":"First title","updated_at":"${hoursAgo(1)}"}`,
    `{"id":"fresh","thread_name":"Second title","updated_at":"${hoursAgo(0.5)}"}`,
    `{"id":"stale","thread_name":"Old","updated_at":"${hoursAgo(30)}"}`,
    'garbage line',
    '',
  ].join('\n'));

  const clock = fixedNow(nowMs);
  const discovered = await scanCodexSessions({ codexDir, now: clock.now });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].sessionId, 'fresh');
  assert.equal(discovered[0].doing, 'Second title', 'later index lines win');
  assert.ok(discovered[0].observedAt > 0);

  assert.deepEqual(await scanCodexSessions({ codexDir: path.join(root, 'missing'), now: clock.now }), []);
});

// ---------- registry merge ----------

test('applyDiscovery creates presence-only records and refreshes existing ones', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-merge-');
  const clock = fixedNow(1_000_000);
  const registry = createLocalSessionRegistry({
    statePath: path.join(root, 'local-sessions.json'),
    now: clock.now,
    probeRepo: fakeProbeRepo({ branch: 'develop' }),
  });

  await registry.applyDiscovery([
    { agent: 'claude-code', sessionId: 'disc-1', cwd: '/work/api', name: 'Fix the bug', status: 'busy' },
  ]);
  let listed = await registry.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].deliverable, false, 'presence-only until wired');
  assert.equal(listed[0].source, 'discovery');
  assert.equal(listed[0].repo, 'api-repo');

  // A P2+ registration of the same key upgrades deliverability, keeps the name.
  const registered = await registry.registerSession({
    agent: 'claude-code',
    sessionId: 'disc-1',
    cwd: '/work/api',
    source: 'mcp',
    deliverable: true,
  });
  assert.equal(registered.name, listed[0].name);
  assert.equal(registered.deliverable, true);

  // A later scan refreshes the same record instead of duplicating it.
  clock.advanceMs(60_000);
  await registry.applyDiscovery([
    { agent: 'claude-code', sessionId: 'disc-1', doing: 'New title', status: 'idle' },
  ]);
  listed = await registry.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].doing, 'New title');
  assert.equal(listed[0].status, 'idle');
  assert.equal(listed[0].deliverable, true, 'scan does not downgrade registration');
});

// ---------- daemon handler ----------

test('createSessionsDaemonHandlers merges both scans into one directory listing', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-handler-');
  const claudeDir = path.join(root, '.claude');
  const codexDir = path.join(root, '.codex');
  await mkdir(path.join(claudeDir, 'sessions'), { recursive: true });
  await mkdir(codexDir, { recursive: true });
  // The Claude fixture uses this test process's own pid: the scanner's real
  // liveness probe (signal 0) must see it as alive.
  await writeFile(path.join(claudeDir, 'sessions', `${process.pid}.json`), JSON.stringify({
    pid: process.pid,
    sessionId: 'claude-live',
    cwd: '/work/api',
    name: 'Fix the bug',
    nameSource: 'user',
    status: 'busy',
  }));
  const nowMs = Date.now();
  await writeFile(path.join(codexDir, 'session_index.jsonl'), `{"id":"codex-live","thread_name":"Review PR","updated_at":"${new Date(nowMs).toISOString()}"}`);

  const handlers = createSessionsDaemonHandlers({
    systemHomeDir: root,
    claudeDir,
    codexDir,
  });
  const result = await handlers.list({});
  assert.equal(result.ok, true);
  const sessions = result.data.sessions;
  assert.equal(sessions.length, 2);
  const byAgent = new Map(sessions.map((session) => [session.agent, session]));
  assert.equal(byAgent.get('claude-code').sessionKey, 'claude-code:claude-live');
  assert.equal(byAgent.get('claude-code').pid, process.pid);
  assert.equal(byAgent.get('codex').sessionKey, 'codex:codex-live');

  // Idempotent: a second list does not duplicate rows.
  const again = await handlers.list({ all: true });
  assert.equal(again.data.sessions.length, 2);
});

// ---------- CLI ----------

test('runSessionsCommand rejects unknown subcommands and missing handlers', async () => {
  const unknown = await runSessionsCommand(['frobnicate', 'x'], { dependencies: {} });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'unknown_command');

  const notImplemented = await runSessionsCommand(['list'], { dependencies: {} });
  assert.equal(notImplemented.ok, false);
  assert.equal(notImplemented.code, 'not_implemented');

  // P2b: bind/unbind are known verbs now — missing handlers surface as
  // not_implemented, not unknown_command.
  const bindNotImplemented = await runSessionsCommand(['bind', 'x', 'pc-1'], { dependencies: {} });
  assert.equal(bindNotImplemented.ok, false);
  assert.equal(bindNotImplemented.code, 'not_implemented');
});
