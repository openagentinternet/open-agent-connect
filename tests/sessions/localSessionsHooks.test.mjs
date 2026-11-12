import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  detectHookAgent,
  formatHookMail,
  grokIgnores,
  hookEventKind,
  runHook,
  takesMail,
} = require('../../dist/core/sessions/hooks.js');
const { runHookCommand } = require('../../dist/cli/commands/hook.js');

// ---------- dialect detection ----------

test('detectHookAgent: env beats the settings-file agent (cross-loaded hooks)', () => {
  assert.equal(detectHookAgent({ CURSOR_AGENT: '1' }, 'claude-code'), 'cursor');
  assert.equal(detectHookAgent({ COPILOT_CLI: '1' }, 'claude-code'), 'copilot');
  assert.equal(detectHookAgent({ GEMINI_CLI: '1' }, 'claude-code'), 'gemini');
  assert.equal(detectHookAgent({ GROK_SESSION_ID: '1' }, 'claude-code'), 'grok');
  assert.equal(detectHookAgent({ CLAUDECODE: '1' }, 'cursor'), 'claude-code');
  assert.equal(detectHookAgent({}, 'gemini'), 'gemini');
  assert.equal(detectHookAgent({}, undefined), 'claude-code');
  assert.equal(detectHookAgent({ OAC_HOOK_AGENT: 'zcode' }, 'claude-code'), 'zcode');
});

test('event kinds and the takes-mail table match the hosts', () => {
  assert.equal(hookEventKind('session-start'), 'start');
  assert.equal(hookEventKind('post-tool-use'), 'tool');
  assert.equal(hookEventKind('nonsense'), null);
  assert.equal(takesMail('claude-code', 'post-tool-use'), true);
  assert.equal(takesMail('claude-code', 'stop'), true);
  assert.equal(takesMail('gemini', 'user-prompt-submit'), true);
  assert.equal(takesMail('cursor', 'user-prompt-submit'), false, 'cursor prompt hooks cannot add context');
  assert.equal(takesMail('copilot', 'user-prompt-submit'), false);
  assert.equal(takesMail('grok', 'session-start'), false, 'grok drops SessionStart output');
  assert.equal(takesMail('grok', 'stop'), true);
});

test('grokIgnores: subagent runs and shutdown stops', () => {
  assert.equal(grokIgnores('stop', { subagentType: 'worker' }), true);
  assert.equal(grokIgnores('stop', { reason: 'shutdown' }), true);
  assert.equal(grokIgnores('stop', { reason: 'end_turn' }), false);
  assert.equal(grokIgnores('post-tool-use', {}), false);
});

test('formatHookMail speaks each host dialect', () => {
  const claudeTool = JSON.parse(formatHookMail('claude-code', 'post-tool-use', 'tool', 'MAIL'));
  assert.equal(claudeTool.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.equal(claudeTool.hookSpecificOutput.additionalContext, 'MAIL');
  const geminiPrompt = JSON.parse(formatHookMail('gemini', 'user-prompt-submit', 'prompt', 'MAIL'));
  assert.equal(geminiPrompt.hookSpecificOutput.hookEventName, 'BeforeAgent');
  const grokStart = JSON.parse(formatHookMail('grok', 'session-start', 'start', 'MAIL'));
  assert.equal(grokStart.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.deepEqual(JSON.parse(formatHookMail('cursor', 'post-tool-use', 'tool', 'MAIL')), { additional_context: 'MAIL' });
  assert.deepEqual(JSON.parse(formatHookMail('copilot', 'stop', 'stop', 'MAIL')), { additionalContext: 'MAIL' });
  assert.equal(formatHookMail('claude-code', 'session-end', 'end', 'MAIL'), null);
});

// ---------- runHook ----------

function backendWith(mail) {
  const calls = { registered: [], inboxChecks: [] };
  return {
    calls,
    backend: {
      async registerSession(input) {
        calls.registered.push(input);
        return { ok: true, state: 'success', data: { record: { sessionKey: `${input.agent}:${input.sessionId}` } } };
      },
      async inboxCheck(input) {
        calls.inboxChecks.push(input);
        return { ok: true, state: 'success', data: { messages: mail, pending: 0 } };
      },
    },
  };
}

const MAIL = [
  { id: 'mail-1', from: 'peer-gmid', fromName: 'Grok Bot', body: 'fix the bug' },
];

test('runHook registers the session and frames pending mail in the host dialect', async () => {
  const { calls, backend } = backendWith(MAIL);
  const result = await runHook({
    agent: 'claude-code',
    event: 'post-tool-use',
    payload: { session_id: 'sess-1', cwd: '/work/api' },
    env: {},
    pid: 4242,
    backend,
  });
  assert.ok(result);
  assert.equal(result.sessionKey, 'claude-code:sess-1');
  assert.deepEqual(result.mailIds, ['mail-1']);
  const parsed = JSON.parse(result.output);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(parsed.hookSpecificOutput.additionalContext, /fix the bug/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /"to": "peer-gmid"/);
  assert.deepEqual(calls.registered, [{
    agent: 'claude-code',
    sessionId: 'sess-1',
    pid: 4242,
    cwd: '/work/api',
    source: 'hook',
    deliverable: true,
    status: 'busy',
  }]);
  assert.deepEqual(calls.inboxChecks, [{ sessionKey: 'claude-code:sess-1', waitSecs: 0 }]);
});

test('runHook returns null when there is no session id, no mail, or the event cannot carry mail', async () => {
  const noSession = await runHook({
    agent: 'claude-code', event: 'post-tool-use', payload: { cwd: '/x' }, env: {}, backend: backendWith(MAIL).backend,
  });
  assert.equal(noSession, null);

  const emptyInbox = await runHook({
    agent: 'claude-code', event: 'post-tool-use', payload: { session_id: 's' }, env: {}, backend: backendWith([]).backend,
  });
  assert.equal(emptyInbox, null);

  const noMailEvent = await runHook({
    agent: 'cursor', event: 'user-prompt-submit', payload: { session_id: 's' }, env: {}, backend: backendWith(MAIL).backend,
  });
  assert.equal(noMailEvent, null, 'cursor prompt-submit cannot carry mail');

  const grokSubagent = await runHook({
    agent: 'grok', event: 'stop', payload: { session_id: 's', subagentType: 'w' }, env: {}, backend: backendWith(MAIL).backend,
  });
  assert.equal(grokSubagent, null);
});

test('runHook maps status to busy/idle and never throws on backend failures', async () => {
  const { calls, backend } = backendWith([]);
  await runHook({
    agent: 'gemini', event: 'stop', payload: { session_id: 's' }, env: {}, backend,
  });
  assert.equal(calls.registered[0].status, 'idle');

  const failing = {
    async registerSession() {
      throw new Error('daemon down');
    },
    async inboxCheck() {
      throw new Error('nope');
    },
  };
  const safe = await runHook({
    agent: 'claude-code', event: 'stop', payload: { session_id: 's' }, env: {}, backend: failing,
  });
  assert.equal(safe, null, 'hook failures stay silent');
});

test('hook command: unknown events and missing handlers stay silent', async () => {
  const unknown = await runHookCommand(['bogus-event'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    env: {},
    cwd: '/x',
    stdin: null,
    readTextFile: async () => '',
    dependencies: {},
  });
  assert.equal(unknown.data.handled, false);
  assert.equal(unknown.data.reason, 'unknown_event');
  assert.equal(unknown.__rawStdoutHandled, true);

  const notImplemented = await runHookCommand(['post-tool-use'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    env: {},
    cwd: '/x',
    stdin: null,
    readTextFile: async () => '',
    dependencies: {},
  });
  assert.equal(notImplemented.data.handled, false);
  assert.equal(notImplemented.data.reason, 'not_implemented');
});

// ---------- host hook wiring (cursor / gemini) ----------

const { wireHostHooks } = require('../../dist/core/sessions/hostHooks.js');
const { mkdir: mkDir, readFile, rm: rmPath, writeFile } = require('node:fs/promises');
const path = require('node:path');

test('wireHostHooks writes cursor mcp + hooks and removes only our entries', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-wire-cursor-');
  const cursorDir = path.join(root, '.cursor');
  await mkDir(cursorDir, { recursive: true });
  await writeFile(path.join(cursorDir, 'mcp.json'), JSON.stringify({ mcpServers: { existing: { command: 'x' } } }));
  await writeFile(path.join(cursorDir, 'hooks.json'), JSON.stringify({
    version: 1,
    hooks: { stop: [{ command: 'their hook' }] },
  }));

  const wired = await wireHostHooks({
    host: 'cursor',
    cursorDir,
    commandFor: (host, event) => `"node" "cli.js" hook ${host} ${event}`,
    mcpCommand: { command: '/usr/bin/node', args: ['/opt/metabot/main.js', 'mcp'] },
  });
  assert.equal(wired.host, 'cursor');
  assert.equal(wired.files.length, 2);

  const mcp = JSON.parse(await readFile(path.join(cursorDir, 'mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers['metabot-sessions'], {
    type: 'stdio', command: '/usr/bin/node', args: ['/opt/metabot/main.js', 'mcp'], env: { OAC_HOOK_AGENT: 'cursor' },
  });
  assert.ok(mcp.mcpServers.existing);

  const hooks = JSON.parse(await readFile(path.join(cursorDir, 'hooks.json'), 'utf8'));
  assert.equal(hooks.version, 1);
  assert.ok(hooks.hooks.stop.some((group) => JSON.stringify(group).includes('their hook')), 'their hooks survive');
  assert.ok(hooks.hooks.stop.some((group) => JSON.stringify(group).includes(' hook cursor ')));
  assert.ok(hooks.hooks.postToolUse[0].matcher === '*');
  assert.ok(JSON.stringify(hooks.hooks.sessionStart).includes(' hook cursor session-start'));
  // Backups exist for both edited files.
  assert.ok(wired.files.every((file) => file.backedUpTo));

  // A second wire does not duplicate our groups (merge drops ours first).
  await wireHostHooks({
    host: 'cursor', cursorDir,
    commandFor: (host, event) => `"node" "cli.js" hook ${host} ${event}`,
  });
  const hooksAgain = JSON.parse(await readFile(path.join(cursorDir, 'hooks.json'), 'utf8'));
  assert.equal(JSON.stringify(hooksAgain.hooks.stop).match(/ hook cursor /g).length, 1);

  // Remove: only our entries go.
  await wireHostHooks({
    host: 'cursor', cursorDir, remove: true,
    commandFor: (host, event) => `"node" "cli.js" hook ${host} ${event}`,
  });
  const hooksRemoved = JSON.parse(await readFile(path.join(cursorDir, 'hooks.json'), 'utf8'));
  assert.equal(JSON.stringify(hooksRemoved.hooks.stop).includes(' hook cursor '), false);
  assert.ok(hooksRemoved.hooks.stop.some((group) => JSON.stringify(group).includes('their hook')));
  const mcpRemoved = JSON.parse(await readFile(path.join(cursorDir, 'mcp.json'), 'utf8'));
  assert.equal(mcpRemoved.mcpServers['metabot-sessions'], undefined);
  assert.ok(mcpRemoved.mcpServers.existing);
});

test('wireHostHooks writes gemini settings hooks and falls back to nothing silently', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-wire-gemini-');
  const geminiDir = path.join(root, '.gemini');
  await mkDir(geminiDir, { recursive: true });
  await writeFile(path.join(geminiDir, 'settings.json'), JSON.stringify({ theme: 'auto' }));

  const wired = await wireHostHooks({
    host: 'gemini',
    geminiDir,
    commandFor: (host, event) => `"node" "cli.js" hook ${host} ${event}`,
  });
  const settings = JSON.parse(await readFile(path.join(geminiDir, 'settings.json'), 'utf8'));
  assert.equal(settings.theme, 'auto');
  assert.equal(settings.mcpServers['metabot-sessions'].timeout, 660000);
  assert.equal(settings.mcpServers['metabot-sessions'].trust, true);
  const startGroup = settings.hooks.SessionStart[0];
  assert.equal(startGroup.matcher, '*');
  assert.equal(startGroup.hooks[0].name, 'metabot-sessions-session-start');
  assert.equal(startGroup.hooks[0].timeout, 10000);
  assert.ok(settings.hooks.BeforeAgent[0].hooks[0].command.includes(' hook gemini user-prompt-submit'));

  const removed = await wireHostHooks({
    host: 'gemini', geminiDir, remove: true,
    commandFor: (host, event) => `"node" "cli.js" hook ${host} ${event}`,
  });
  const settingsRemoved = JSON.parse(await readFile(removed.files[0].file, 'utf8'));
  assert.equal(Object.keys(settingsRemoved.hooks).length, 0);
  assert.equal(settingsRemoved.mcpServers['metabot-sessions'], undefined);
  await rmPath(root, { recursive: true, force: true });
});

test('wireHostHooks rejects unsupported hosts', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-wire-bad-');
  await assert.rejects(
    () => wireHostHooks({ host: 'copilot', geminiDir: root, commandFor: (host, event) => `${host} ${event}` }),
    /Unsupported host/,
  );
  await rmPath(root, { recursive: true, force: true });
});
