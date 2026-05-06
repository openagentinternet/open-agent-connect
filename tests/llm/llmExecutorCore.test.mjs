import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

const {
  LlmExecutor,
  claudeBackendFactory,
  codexBackendFactory,
  createClaudeBackend,
  createCodexBackend,
  createCopilotBackend,
  createCursorBackend,
  createFileSessionManager,
  createGeminiBackend,
  createHermesBackend,
  createKimiBackend,
  createKiroBackend,
  createOpenClawBackend,
  createOpenCodeBackend,
  createPiBackend,
  createRegistryBackendFactories,
  injectSkills,
  openClawBackendFactory,
} = require('../../dist/core/llm/executor/index.js');
const {
  getPlatformDefinition,
  getRuntimePlatforms,
} = require('../../dist/core/platform/platformRegistry.js');

async function createTempDir(prefix = 'metabot-llm-executor-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeExecutableScript(dir, name, source) {
  const scriptPath = path.join(dir, name);
  await fs.writeFile(scriptPath, source, 'utf8');
  await fs.chmod(scriptPath, 0o755);
  return scriptPath;
}

async function collectEvents(iterable) {
  const events = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

async function assertSameRealpath(actualPath, expectedPath) {
  assert.equal(await fs.realpath(actualPath), await fs.realpath(expectedPath));
}

function fakeAcpServerSource() {
  return `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const recordPath = process.env.FAKE_ACP_RECORD_PATH;
const provider = process.env.FAKE_ACP_PROVIDER || 'hermes';
const toolTitle = process.env.FAKE_ACP_TOOL_TITLE || 'terminal: pwd';
const toolName = process.env.FAKE_ACP_TOOL_NAME || '';
const sessionId = process.env.FAKE_ACP_SESSION_ID || provider + '-session-new';
const record = {
  argv: process.argv.slice(2),
  env: { HERMES_YOLO_MODE: process.env.HERMES_YOLO_MODE || '' },
  requests: [],
  permissionResponses: []
};
let pendingPromptId = null;
let activeSessionId = sessionId;

function save() {
  if (recordPath) fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
}
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
function response(id, result) {
  send({ jsonrpc: '2.0', id, result });
}
function errorResponse(id, message) {
  send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
}
function notify(update) {
  send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: activeSessionId, update } });
}
function completePrompt(id) {
  if (process.env.FAKE_ACP_STDERR_ONLY_ERROR === '1') {
    process.stderr.write('Error: HTTP 400: provider model unsupported\\n');
    response(id, { stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } });
    save();
    process.exit(0);
  }
  notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: provider + ' text ' } });
  notify({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: provider + ' thinking' } });
  notify({ sessionUpdate: 'tool_call', toolCallId: 'tool-acp', name: toolName, title: toolTitle, kind: 'execute', rawInput: { command: 'pwd' } });
  notify({ sessionUpdate: 'tool_call_update', toolCallId: 'tool-acp', status: 'completed', title: toolTitle, kind: 'execute', rawOutput: 'tool ok' });
  notify({ sessionUpdate: 'usage_update', usage: { inputTokens: 2, outputTokens: 3, cachedReadTokens: 1 } });
  notify({ sessionUpdate: 'turn_end', stopReason: 'end_turn', usage: { inputTokens: 4, outputTokens: 5, cachedReadTokens: 1 } });
  response(id, { stopReason: 'end_turn', usage: { inputTokens: 4, outputTokens: 5, cachedReadTokens: 1 } });
  save();
  process.exit(0);
}

save();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);

  if (message.id === 900 && !message.method) {
    record.permissionResponses.push(message.result);
    save();
    if (pendingPromptId !== null) completePrompt(pendingPromptId);
    return;
  }

  if (!message.method) return;
  record.requests.push({ method: message.method, params: message.params });
  save();

  if (message.method === 'initialize') {
    response(message.id, { protocolVersion: 1 });
    return;
  }
  if (message.method === 'session/new') {
    activeSessionId = sessionId;
    response(message.id, { sessionId });
    return;
  }
  if (message.method === 'session/resume' || message.method === 'session/load') {
    activeSessionId = message.params.sessionId;
    response(message.id, { sessionId: activeSessionId });
    return;
  }
  if (message.method === 'session/set_model') {
    if (process.env.FAKE_ACP_FAIL_SET_MODEL === '1') {
      errorResponse(message.id, 'set model rejected');
    } else {
      response(message.id, {});
    }
    return;
  }
  if (message.method === 'session/prompt') {
    pendingPromptId = message.id;
    send({ jsonrpc: '2.0', id: 900, method: 'session/request_permission', params: { sessionId: activeSessionId } });
    return;
  }
  errorResponse(message.id, 'unexpected method ' + message.method);
});
`;
}

const runtime = {
  id: 'llm_test_runtime',
  provider: 'custom',
  displayName: 'Test Runtime',
  binaryPath: '/bin/test-agent',
  authState: 'authenticated',
  health: 'healthy',
  capabilities: ['streaming'],
  lastSeenAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test('registry preserves Claude Code and Codex executor metadata', async () => {
  const claude = getPlatformDefinition('claude-code');
  const codex = getPlatformDefinition('codex');

  assert.equal(claude.id, 'claude-code');
  assert.equal(claude.displayName, 'Claude Code');
  assert.equal(claude.executor.kind, 'claude-stream-json');
  assert.equal(claude.executor.backendFactoryExport, 'claudeBackendFactory');
  assert.equal(claude.executor.launchCommand, 'claude -p --output-format stream-json');
  assert.equal(claude.executor.multicaReferencePath, 'agent/claude.go');

  assert.equal(codex.id, 'codex');
  assert.equal(codex.displayName, 'Codex (OpenAI)');
  assert.equal(codex.executor.kind, 'codex-app-server');
  assert.equal(codex.executor.backendFactoryExport, 'codexBackendFactory');
  assert.equal(codex.executor.launchCommand, 'codex app-server --listen stdio://');
  assert.equal(codex.executor.multicaReferencePath, 'agent/codex.go');
});

test('registry backend factory helper covers every managed provider and CLI runtime uses it', async () => {
  assert.equal(typeof createRegistryBackendFactories, 'function');

  const factories = createRegistryBackendFactories();
  const platformIds = getRuntimePlatforms().map((platform) => platform.id);
  assert.deepEqual(Object.keys(factories), platformIds);
  assert.equal(factories['claude-code'], claudeBackendFactory);
  assert.equal(factories.codex, codexBackendFactory);
  assert.equal(factories.openclaw, openClawBackendFactory);

  const base = await createTempDir();
  const executor = new LlmExecutor({
    sessionsRoot: path.join(base, 'sessions'),
    transcriptsRoot: path.join(base, 'transcripts'),
    skillsRoot: path.join(base, 'skills'),
    backends: factories,
  });
  assert.ok(executor);

  const runtimeSource = await fs.readFile(path.resolve('src/cli/runtime.ts'), 'utf8');
  assert.match(runtimeSource, /createRegistryBackendFactories\(\)/);
  assert.doesNotMatch(runtimeSource, /backends:\s*\{\s*codex:\s*codexBackendFactory,\s*['"]claude-code['"]:\s*claudeBackendFactory,\s*openclaw:\s*openClawBackendFactory,\s*\}/s);
});

test('file session manager persists, updates, lists, and deletes session records', async () => {
  const root = path.join(await createTempDir(), 'sessions');
  const manager = createFileSessionManager(root);

  await manager.create({
    sessionId: 'session-b',
    status: 'starting',
    runtimeId: 'runtime-1',
    provider: 'codex',
    prompt: 'second',
    createdAt: '2026-05-05T12:00:00.000Z',
  });
  await manager.create({
    sessionId: 'session-a',
    status: 'starting',
    runtimeId: 'runtime-1',
    provider: 'codex',
    prompt: 'first',
    createdAt: '2026-05-05T11:00:00.000Z',
  });

  await manager.update('session-a', {
    status: 'completed',
    result: {
      status: 'completed',
      output: 'done',
      durationMs: 12,
    },
    completedAt: '2026-05-05T11:00:12.000Z',
  });

  const loaded = await manager.get('session-a');
  assert.equal(loaded.status, 'completed');
  assert.equal(loaded.result.output, 'done');

  const listed = await manager.list(10);
  assert.deepEqual(listed.map((record) => record.sessionId), ['session-b', 'session-a']);

  await manager.delete('session-a');
  assert.equal(await manager.get('session-a'), null);
});

test('file session manager filters by MetaBot slug before applying the limit', async () => {
  const root = path.join(await createTempDir(), 'sessions');
  const manager = createFileSessionManager(root);

  await manager.create({
    sessionId: 'session-bob-new',
    status: 'completed',
    runtimeId: 'runtime-1',
    provider: 'codex',
    metaBotSlug: 'bob-bot',
    prompt: 'bob latest',
    createdAt: '2026-05-05T12:03:00.000Z',
  });
  await manager.create({
    sessionId: 'session-bob-old',
    status: 'completed',
    runtimeId: 'runtime-1',
    provider: 'codex',
    metaBotSlug: 'bob-bot',
    prompt: 'bob second',
    createdAt: '2026-05-05T12:02:00.000Z',
  });
  await manager.create({
    sessionId: 'session-alice-new',
    status: 'completed',
    runtimeId: 'runtime-1',
    provider: 'codex',
    metaBotSlug: 'alice-bot',
    prompt: 'alice latest',
    createdAt: '2026-05-05T12:01:00.000Z',
  });
  await manager.create({
    sessionId: 'session-alice-old',
    status: 'failed',
    runtimeId: 'runtime-1',
    provider: 'codex',
    metaBotSlug: 'alice-bot',
    prompt: 'alice second',
    createdAt: '2026-05-05T12:00:00.000Z',
  });

  const listed = await manager.list(2, { metaBotSlug: 'alice-bot' });

  assert.deepEqual(
    listed.map((record) => record.sessionId),
    ['session-alice-new', 'session-alice-old'],
  );
});

test('file session manager keeps a session readable while an update write is in flight', async () => {
  const root = path.join(await createTempDir(), 'sessions');
  const manager = createFileSessionManager(root);
  const sessionId = 'session-readable';

  await manager.create({
    sessionId,
    status: 'starting',
    runtimeId: 'runtime-1',
    provider: 'codex',
    prompt: 'initial',
    createdAt: '2026-05-05T11:00:00.000Z',
  });

  const originalWriteFile = fs.writeFile;
  let intercepted = false;
  let releaseWrite = () => {};
  let markInvalidWritten = () => {};
  const invalidWritten = new Promise((resolve) => {
    markInvalidWritten = resolve;
  });
  const writeReleased = new Promise((resolve) => {
    releaseWrite = resolve;
  });

  fs.writeFile = async function patchedWriteFile(file, data, options) {
    const filePath = String(file);
    if (!intercepted && filePath.includes(`${sessionId}.json`)) {
      intercepted = true;
      await originalWriteFile.call(fs, file, '{', options);
      markInvalidWritten();
      await writeReleased;
    }
    return originalWriteFile.call(fs, file, data, options);
  };

  let updatePromise;
  try {
    updatePromise = manager.update(sessionId, { providerSessionId: 'provider-session-1' });
    await invalidWritten;
    const duringUpdate = await manager.get(sessionId);
    releaseWrite();
    await updatePromise;

    assert.ok(duringUpdate, 'existing session should remain readable during an in-flight update write');
    assert.equal(duringUpdate.sessionId, sessionId);

    const afterUpdate = await manager.get(sessionId);
    assert.equal(afterUpdate.providerSessionId, 'provider-session-1');
  } finally {
    fs.writeFile = originalWriteFile;
    releaseWrite();
    if (updatePromise) await updatePromise.catch(() => undefined);
  }
});

test('file session manager serializes concurrent updates without dropping fields', async () => {
  const root = path.join(await createTempDir(), 'sessions');
  const manager = createFileSessionManager(root);
  const sessionId = 'session-merge';

  await manager.create({
    sessionId,
    status: 'starting',
    runtimeId: 'runtime-1',
    provider: 'codex',
    prompt: 'initial',
    createdAt: '2026-05-05T11:00:00.000Z',
  });

  const originalReadFile = fs.readFile;
  let gateActive = true;
  let blockedReads = 0;
  let releaseReads = () => {};
  let resolveReadWindow = () => {};
  const readWindow = new Promise((resolve) => {
    resolveReadWindow = resolve;
  });
  const readsReleased = new Promise((resolve) => {
    releaseReads = resolve;
  });
  const readWindowTimer = setTimeout(() => {
    resolveReadWindow();
  }, 25);

  fs.readFile = async function patchedReadFile(file, options) {
    const filePath = String(file);
    if (gateActive && filePath.endsWith(`${sessionId}.json`) && blockedReads < 2) {
      const raw = await originalReadFile.call(fs, file, options);
      blockedReads += 1;
      if (blockedReads === 2) {
        clearTimeout(readWindowTimer);
        resolveReadWindow();
      }
      await readsReleased;
      return raw;
    }
    return originalReadFile.call(fs, file, options);
  };

  let firstUpdate;
  let secondUpdate;
  try {
    firstUpdate = manager.update(sessionId, { providerSessionId: 'provider-session-1' });
    secondUpdate = manager.update(sessionId, {
      status: 'completed',
      result: {
        status: 'completed',
        output: 'done',
        durationMs: 12,
      },
      completedAt: '2026-05-05T11:00:12.000Z',
    });
    await readWindow;
    gateActive = false;
    releaseReads();
    await Promise.all([firstUpdate, secondUpdate]);

    const loaded = await manager.get(sessionId);
    assert.equal(loaded.status, 'completed');
    assert.equal(loaded.providerSessionId, 'provider-session-1');
    assert.equal(loaded.result.output, 'done');
  } finally {
    clearTimeout(readWindowTimer);
    fs.readFile = originalReadFile;
    gateActive = false;
    releaseReads();
    await Promise.all([
      firstUpdate?.catch(() => undefined),
      secondUpdate?.catch(() => undefined),
    ]);
  }
});

test('skill injector copies requested skills into provider-native skill roots', async () => {
  const base = await createTempDir();
  const skillsRoot = path.join(base, 'skills');
  const cwd = path.join(base, 'work');
  await fs.mkdir(path.join(skillsRoot, 'metabot-post-buzz', 'scripts'), { recursive: true });
  await fs.writeFile(path.join(skillsRoot, 'metabot-post-buzz', 'SKILL.md'), '# Post Buzz\n', 'utf8');
  await fs.writeFile(path.join(skillsRoot, 'metabot-post-buzz', 'scripts', 'post.mjs'), 'export {};\n', 'utf8');

  const result = await injectSkills({
    skills: ['metabot-post-buzz', 'missing-skill'],
    skillsRoot,
    provider: 'claude-code',
    cwd,
  });

  assert.deepEqual(result.injected, ['metabot-post-buzz']);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].skill, 'missing-skill');

  const copiedSkill = await fs.readFile(path.join(cwd, '.claude', 'skills', 'metabot-post-buzz', 'SKILL.md'), 'utf8');
  const copiedScript = await fs.readFile(path.join(cwd, '.claude', 'skills', 'metabot-post-buzz', 'scripts', 'post.mjs'), 'utf8');
  assert.match(copiedSkill, /Post Buzz/);
  assert.match(copiedScript, /export/);
});

test('LlmExecutor starts a session, streams events, injects skills, and persists the terminal result', async () => {
  const base = await createTempDir();
  const skillsRoot = path.join(base, 'skills');
  const cwd = path.join(base, 'work');
  await fs.mkdir(path.join(skillsRoot, 'metabot-test-skill'), { recursive: true });
  await fs.writeFile(path.join(skillsRoot, 'metabot-test-skill', 'SKILL.md'), '# Test Skill\n', 'utf8');

  const executor = new LlmExecutor({
    sessionsRoot: path.join(base, 'sessions'),
    transcriptsRoot: path.join(base, 'transcripts'),
    skillsRoot,
    backends: {
      custom: () => ({
        provider: 'custom',
        async execute(request, emitter, signal) {
          assert.equal(request.prompt, 'Say hello');
          assert.equal(signal.aborted, false);
          emitter.emit({ type: 'status', status: 'running', sessionId: 'provider-session-1' });
          emitter.emit({ type: 'text', content: 'Hello ' });
          emitter.emit({ type: 'text', content: 'MetaBot' });
          return {
            status: 'completed',
            output: 'Hello MetaBot',
            providerSessionId: 'provider-session-1',
            durationMs: 9,
            usage: {
              test: {
                inputTokens: 2,
                outputTokens: 2,
              },
            },
          };
        },
      }),
    },
  });

  const sessionId = await executor.execute({
    runtimeId: runtime.id,
    runtime,
    prompt: 'Say hello',
    cwd,
    skills: ['metabot-test-skill'],
    metaBotSlug: 'alice',
  });

  const events = await collectEvents(executor.streamEvents(sessionId));
  const session = await executor.getSession(sessionId);

  assert.equal(session.status, 'completed');
  assert.equal(session.metaBotSlug, 'alice');
  assert.equal(session.providerSessionId, 'provider-session-1');
  assert.equal(session.result.output, 'Hello MetaBot');
  assert.equal(session.result.usage.test.inputTokens, 2);
  assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.content), ['Hello ', 'MetaBot']);
  assert.equal(events.at(-1).type, 'result');
  assert.equal(events.at(-1).result.status, 'completed');

  const injected = await fs.readFile(path.join(cwd, '.agent_context', 'skills', 'metabot-test-skill', 'SKILL.md'), 'utf8');
  assert.match(injected, /Test Skill/);
});

test('LlmExecutor cancel preserves completed session history', async () => {
  const base = await createTempDir();
  const executor = new LlmExecutor({
    sessionsRoot: path.join(base, 'sessions'),
    transcriptsRoot: path.join(base, 'transcripts'),
    skillsRoot: path.join(base, 'skills'),
    backends: {
      custom: () => ({
        provider: 'custom',
        async execute() {
          return {
            status: 'completed',
            output: 'already done',
            durationMs: 3,
          };
        },
      }),
    },
  });

  const sessionId = await executor.execute({
    runtimeId: runtime.id,
    runtime,
    prompt: 'Complete quickly',
  });

  await collectEvents(executor.streamEvents(sessionId));
  const completed = await executor.getSession(sessionId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.output, 'already done');

  await executor.cancel(sessionId);
  const afterCancel = await executor.getSession(sessionId);

  assert.equal(afterCancel.status, 'completed');
  assert.equal(afterCancel.result.status, 'completed');
  assert.equal(afterCancel.result.output, 'already done');
});

test('OpenClaw backend launches JSON mode on stderr and returns normalized events', async () => {
  const base = await createTempDir();
  const argsPath = path.join(base, 'args.json');
  const cwdPath = path.join(base, 'cwd.txt');
  const envPath = path.join(base, 'env.txt');
  const binaryPath = await writeExecutableScript(base, 'fake-openclaw.js', `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.FAKE_OPENCLAW_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(process.env.FAKE_OPENCLAW_CWD_PATH, process.cwd());
fs.writeFileSync(process.env.FAKE_OPENCLAW_ENV_PATH, process.env.OAC_TEST_MARKER || '');
function send(message) {
  process.stderr.write(JSON.stringify(message) + '\\n');
}
send({ type: 'step_start', session_id: 'openclaw-session-1' });
send({ type: 'text', text: 'Open ' });
send({ type: 'tool_use', id: 'tool-openclaw', name: 'Shell', input: { cmd: 'pwd' } });
send({ type: 'tool_result', tool_use_id: 'tool-openclaw', name: 'Shell', text: 'ok' });
send({ type: 'step_finish', model: 'openclaw-agent', usage: { input_tokens: 7, output_tokens: 3, cached_input_tokens: 2 } });
send({ type: 'result', status: 'completed', session_id: 'openclaw-session-1', result: 'OpenClaw done' });
`);

  const backend = createOpenClawBackend(binaryPath, {
    FAKE_OPENCLAW_ARGS_PATH: argsPath,
    FAKE_OPENCLAW_CWD_PATH: cwdPath,
    FAKE_OPENCLAW_ENV_PATH: envPath,
  });
  const emitted = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_openclaw',
      runtime: { ...runtime, provider: 'openclaw', binaryPath },
      prompt: 'hello openclaw',
      systemPrompt: 'system openclaw',
      cwd: base,
      model: 'custom-agent',
      env: { OAC_TEST_MARKER: 'openclaw-env' },
      extraArgs: ['--message', 'blocked-message', '--model', 'blocked-model', '--system-prompt', 'blocked-system', '--debug'],
    },
    { emit: (event) => emitted.push(event) },
    new AbortController().signal,
  );

  const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
  assert.deepEqual(args.slice(0, 4), ['agent', '--local', '--json', '--session-id']);
  assert.ok(args.includes('custom-agent'));
  assert.ok(args.includes('--debug'));
  assert.equal(args.includes('blocked-message'), false);
  assert.equal(args.includes('blocked-model'), false);
  assert.equal(args.includes('blocked-system'), false);
  assert.match(args.at(-1), /system openclaw\n\nhello openclaw/);
  await assertSameRealpath(await fs.readFile(cwdPath, 'utf8'), base);
  assert.equal(await fs.readFile(envPath, 'utf8'), 'openclaw-env');
  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'OpenClaw done');
  assert.equal(result.providerSessionId, 'openclaw-session-1');
  assert.equal(result.usage['openclaw-agent'].inputTokens, 7);
  assert.equal(result.usage['openclaw-agent'].cacheReadTokens, 2);
  assert.deepEqual(emitted.filter((event) => event.type === 'text').map((event) => event.content), ['Open ']);
  assert.equal(emitted.some((event) => event.type === 'tool_use' && event.tool === 'Shell'), true);
  assert.equal(emitted.some((event) => event.type === 'tool_result' && event.output === 'ok'), true);
});

test('OpenClaw backend supports legacy final result blobs', async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-openclaw-legacy.js', `#!/usr/bin/env node
process.stderr.write(JSON.stringify({
  payloads: [{ text: 'Legacy OpenClaw' }],
  meta: {
    durationMs: 15,
    agentMeta: {
      sessionId: 'openclaw-legacy-session',
      model: 'legacy-model',
      usage: { input_tokens: 2, output_tokens: 3 }
    }
  }
}) + '\\n');
`);
  const backend = createOpenClawBackend(binaryPath);
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_openclaw',
      runtime: { ...runtime, provider: 'openclaw', binaryPath },
      prompt: 'legacy',
      cwd: base,
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'Legacy OpenClaw');
  assert.equal(result.providerSessionId, 'openclaw-legacy-session');
  assert.equal(result.usage['legacy-model'].inputTokens, 2);
  assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.content), ['Legacy OpenClaw']);
});

test('OpenClaw backend supports pretty-printed legacy result blobs', async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-openclaw-pretty-legacy.js', `#!/usr/bin/env node
process.stderr.write(JSON.stringify({
  payloads: [{ text: 'Pretty OpenClaw' }],
  meta: {
    agentMeta: {
      sessionId: 'openclaw-pretty-session',
      model: 'pretty-model',
      usage: { input_tokens: 4, output_tokens: 5 }
    }
  }
}, null, 2) + '\\n');
`);
  const backend = createOpenClawBackend(binaryPath);
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_openclaw',
      runtime: { ...runtime, provider: 'openclaw', binaryPath },
      prompt: 'pretty',
      cwd: base,
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'Pretty OpenClaw');
  assert.equal(result.providerSessionId, 'openclaw-pretty-session');
  assert.equal(result.usage['pretty-model'].outputTokens, 5);
  assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.content), ['Pretty OpenClaw']);
});

test('OpenClaw backend treats lifecycle failure phases as failed', async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-openclaw-lifecycle-fail.js', `#!/usr/bin/env node
process.stderr.write(JSON.stringify({ type: 'lifecycle', phase: 'failed', error: { message: 'agent failed' } }) + '\\n');
`);
  const backend = createOpenClawBackend(binaryPath);
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_openclaw',
      runtime: { ...runtime, provider: 'openclaw', binaryPath },
      prompt: 'fail',
      cwd: base,
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  assert.equal(result.status, 'failed');
  assert.match(result.error, /agent failed/);
  assert.equal(events.some((event) => event.type === 'error' && /agent failed/.test(event.message)), true);
});

test('OpenClaw backend surfaces structured error data messages', async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-openclaw-structured-error.js', `#!/usr/bin/env node
process.stderr.write(JSON.stringify({ type: 'error', error: { message: 'generic wrapper', name: 'PaperClipError', data: { message: 'structured failure' } } }) + '\\n');
`);
  const backend = createOpenClawBackend(binaryPath);
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_openclaw',
      runtime: { ...runtime, provider: 'openclaw', binaryPath },
      prompt: 'structured error',
      cwd: base,
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  assert.equal(result.status, 'failed');
  assert.match(result.error, /structured failure/);
  assert.equal(events.some((event) => event.type === 'error' && /structured failure/.test(event.message)), true);
});

test('Copilot backend launches JSON output and normalizes JSONL events', async () => {
  const base = await createTempDir();
  const argsPath = path.join(base, 'args.json');
  const cwdPath = path.join(base, 'cwd.txt');
  const envPath = path.join(base, 'env.txt');
  const binaryPath = await writeExecutableScript(base, 'fake-copilot.js', `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.FAKE_COPILOT_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(process.env.FAKE_COPILOT_CWD_PATH, process.cwd());
fs.writeFileSync(process.env.FAKE_COPILOT_ENV_PATH, process.env.OAC_TEST_MARKER || '');
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
send({ type: 'session.start', data: { sessionId: 'copilot-session-1', selectedModel: 'gpt-test' } });
send({ type: 'assistant.turn_start', data: {} });
send({ type: 'assistant.reasoning_delta', data: { deltaContent: 'thinking' } });
send({ type: 'assistant.message_delta', data: { deltaContent: 'Co' } });
send({ type: 'tool.execution_complete', data: { toolCallId: 'tool-copilot', model: 'gpt-test', success: true, result: { content: 'ok' } } });
send({ type: 'assistant.message', data: { content: 'Copilot done', outputTokens: 4, toolRequests: [{ toolCallId: 'tool-copilot-2', name: 'read_file', arguments: { path: 'README.md' } }] } });
send({ type: 'result', status: 'completed', sessionId: 'copilot-session-result' });
`);

  const backend = createCopilotBackend(binaryPath, {
    FAKE_COPILOT_ARGS_PATH: argsPath,
    FAKE_COPILOT_CWD_PATH: cwdPath,
    FAKE_COPILOT_ENV_PATH: envPath,
  });
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_copilot',
      runtime: { ...runtime, provider: 'copilot', binaryPath },
      prompt: 'hello copilot',
      cwd: base,
      model: 'gpt-test',
      resumeSessionId: 'copilot-session-old',
      env: { OAC_TEST_MARKER: 'copilot-env' },
      extraArgs: ['--output-format', 'text', '--allow-all', '--allow-all-tools', '--allow-all-paths', '--allow-all-urls', '--yolo', '--no-ask-user', '--acp', '--debug'],
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
  assert.deepEqual(args.slice(0, 4), ['-p', 'hello copilot', '--output-format', 'json']);
  assert.ok(args.includes('--allow-all'));
  assert.ok(args.includes('--no-ask-user'));
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('gpt-test'));
  assert.ok(args.includes('--resume'));
  assert.ok(args.includes('copilot-session-old'));
  assert.ok(args.includes('--debug'));
  assert.equal(args.includes('text'), false);
  assert.equal(args.filter((arg) => arg === '--allow-all').length, 1);
  assert.equal(args.filter((arg) => arg === '--no-ask-user').length, 1);
  assert.equal(args.includes('--allow-all-tools'), false);
  assert.equal(args.includes('--allow-all-paths'), false);
  assert.equal(args.includes('--allow-all-urls'), false);
  assert.equal(args.includes('--yolo'), false);
  assert.equal(args.includes('--acp'), false);
  await assertSameRealpath(await fs.readFile(cwdPath, 'utf8'), base);
  assert.equal(await fs.readFile(envPath, 'utf8'), 'copilot-env');
  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'Copilot done');
  assert.equal(result.providerSessionId, 'copilot-session-result');
  assert.equal(result.usage['gpt-test'].outputTokens, 4);
  assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.content), ['Co']);
  assert.equal(events.some((event) => event.type === 'thinking' && event.content === 'thinking'), true);
  assert.equal(events.some((event) => event.type === 'tool_use' && event.tool === 'read_file'), true);
  assert.equal(events.some((event) => event.type === 'tool_use' && event.callId === 'tool-copilot-2' && event.input.path === 'README.md'), true);
  assert.equal(events.some((event) => event.type === 'tool_result' && event.output === 'ok'), true);
});

test('Copilot backend preserves multiple assistant turns and usage by active model', async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-copilot-multi-turn.js', `#!/usr/bin/env node
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
send({ type: 'session.start', data: { sessionId: 'copilot-multi-session', selectedModel: 'model-a' } });
send({ type: 'assistant.message_delta', data: { deltaContent: 'First' } });
send({ type: 'assistant.message', data: { content: 'First', outputTokens: 2 } });
send({ type: 'tool.execution_complete', data: { toolCallId: 'tool-switch', model: 'model-b', success: true, result: { content: 'ok' } } });
send({ type: 'assistant.message_delta', data: { deltaContent: 'Second' } });
send({ type: 'assistant.message', data: { content: 'Second', outputTokens: 3 } });
send({ type: 'result', status: 'completed', sessionId: 'copilot-multi-result' });
`);
  const backend = createCopilotBackend(binaryPath);
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_copilot',
      runtime: { ...runtime, provider: 'copilot', binaryPath },
      prompt: 'multi turn',
      cwd: base,
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'First\n\nSecond');
  assert.equal(result.providerSessionId, 'copilot-multi-result');
  assert.equal(result.usage['model-a'].outputTokens, 2);
  assert.equal(result.usage['model-b'].outputTokens, 3);
  assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.content), ['First', 'Second']);
});

test('Copilot backend returns timeout promptly when the child ignores SIGTERM', { timeout: 4_000 }, async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-copilot-ignore-sigterm.js', `#!/usr/bin/env node
process.on('SIGTERM', () => {});
const keepAlive = setInterval(() => {}, 100);
process.stdout.write(JSON.stringify({ type: 'session.start', sessionId: 'copilot-timeout' }) + '\\n');
setTimeout(() => {
  clearInterval(keepAlive);
  process.exit(0);
}, 2_000);
`);
  const backend = createCopilotBackend(binaryPath);
  const startedAt = Date.now();
  const result = await backend.execute(
    {
      runtimeId: 'llm_copilot',
      runtime: { ...runtime, provider: 'copilot', binaryPath },
      prompt: 'timeout',
      cwd: base,
      timeout: 300,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  assert.equal(result.status, 'timeout');
  assert.match(result.error, /timed out/i);
  assert.ok(Date.now() - startedAt < 1_000);
});

test('OpenCode backend launches run JSON mode and normalizes tool/usage events', async () => {
  const base = await createTempDir();
  const argsPath = path.join(base, 'args.json');
  const envPath = path.join(base, 'env.json');
  const binaryPath = await writeExecutableScript(base, 'fake-opencode.js', `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.FAKE_OPENCODE_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(process.env.FAKE_OPENCODE_ENV_PATH, JSON.stringify({ cwd: process.cwd(), marker: process.env.OAC_TEST_MARKER || '', permission: process.env.OPENCODE_PERMISSION || '' }));
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
send({ type: 'step_start', sessionID: 'opencode-session-1' });
send({ type: 'text', part: { text: 'OpenCode ' } });
send({ type: 'tool_use', part: { id: 'prt_opencode', callID: 'tool-opencode', tool: 'bash', state: { input: { command: 'pwd' }, status: 'completed', output: { text: 'ok' } } } });
send({ type: 'step_finish', sessionID: 'opencode-session-1', part: { tokens: { input: 5, output: 6, cache: { read: 1, write: 2 } } } });
`);
  const backend = createOpenCodeBackend(binaryPath, {
    FAKE_OPENCODE_ARGS_PATH: argsPath,
    FAKE_OPENCODE_ENV_PATH: envPath,
  });
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_opencode',
      runtime: { ...runtime, provider: 'opencode', binaryPath },
      prompt: 'hello opencode',
      systemPrompt: 'system opencode',
      cwd: base,
      model: 'opencode-model',
      resumeSessionId: 'opencode-old',
      env: { OAC_TEST_MARKER: 'opencode-env', OPENCODE_PERMISSION: '{}' },
      extraArgs: ['--format', 'text', '--debug'],
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
  assert.deepEqual(args.slice(0, 3), ['run', '--format', 'json']);
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('opencode-model'));
  assert.ok(args.includes('--prompt'));
  assert.ok(args.includes('system opencode'));
  assert.ok(args.includes('--session'));
  assert.ok(args.includes('opencode-old'));
  assert.ok(args.includes('--debug'));
  assert.equal(args.includes('text'), false);
  assert.equal(args.at(-1), 'hello opencode');
  const envSnapshot = JSON.parse(await fs.readFile(envPath, 'utf8'));
  await assertSameRealpath(envSnapshot.cwd, base);
  assert.equal(envSnapshot.marker, 'opencode-env');
  assert.equal(envSnapshot.permission, '{"*":"allow"}');
  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'OpenCode ');
  assert.equal(result.providerSessionId, 'opencode-session-1');
  assert.equal(result.usage['opencode-model'].inputTokens, 5);
  assert.equal(result.usage['opencode-model'].cacheWriteTokens, 2);
  assert.equal(events.some((event) => event.type === 'tool_use' && event.tool === 'bash'), true);
  assert.equal(events.some((event) => event.type === 'tool_use' && event.callId === 'tool-opencode' && event.input.command === 'pwd'), true);
  assert.equal(events.some((event) => event.type === 'tool_result' && event.output.includes('ok')), true);
});

test('OpenCode backend surfaces structured error data messages', async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-opencode-structured-error.js', `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'error', error: { name: 'ProviderError', data: { message: 'opencode structured failure' } } }) + '\\n');
process.exit(1);
`);
  const backend = createOpenCodeBackend(binaryPath);
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_opencode',
      runtime: { ...runtime, provider: 'opencode', binaryPath },
      prompt: 'structured opencode error',
      cwd: base,
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  assert.equal(result.status, 'failed');
  assert.match(result.error, /opencode structured failure/);
  assert.equal(events.some((event) => event.type === 'error' && /opencode structured failure/.test(event.message)), true);
});

test('Gemini backend launches stream-json mode and normalizes assistant/tool/stats events', async () => {
  const base = await createTempDir();
  const argsPath = path.join(base, 'args.json');
  const cwdPath = path.join(base, 'cwd.txt');
  const binaryPath = await writeExecutableScript(base, 'fake-gemini.js', `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.FAKE_GEMINI_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(process.env.FAKE_GEMINI_CWD_PATH, process.cwd());
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
send({ type: 'init', session_id: 'gemini-session-1' });
send({ type: 'message', role: 'assistant', content: 'Gemini ' });
send({ type: 'message', role: 'user', content: 'ignored' });
send({ type: 'tool_use', tool_id: 'tool-gemini', tool_name: 'read_file', parameters: { path: 'README.md' } });
send({ type: 'tool_result', tool_id: 'tool-gemini', output: 'ok' });
send({ type: 'result', status: 'completed', stats: { models: { 'gemini-model': { input_tokens: 8, output_tokens: 9, cached: 3 } } } });
`);
  const backend = createGeminiBackend(binaryPath, { FAKE_GEMINI_ARGS_PATH: argsPath, FAKE_GEMINI_CWD_PATH: cwdPath });
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_gemini',
      runtime: { ...runtime, provider: 'gemini', binaryPath },
      prompt: 'hello gemini',
      cwd: base,
      model: 'gemini-model',
      resumeSessionId: 'gemini-old',
      extraArgs: ['-p', 'blocked', '-o', 'text', '--yolo', '--debug'],
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
  assert.deepEqual(args.slice(0, 2), ['-p', 'hello gemini']);
  assert.ok(args.includes('--yolo'));
  assert.ok(args.includes('-o'));
  assert.ok(args.includes('stream-json'));
  assert.ok(args.includes('-m'));
  assert.ok(args.includes('gemini-model'));
  assert.ok(args.includes('-r'));
  assert.ok(args.includes('gemini-old'));
  assert.ok(args.includes('--debug'));
  assert.equal(args.filter((arg) => arg === '--yolo').length, 1);
  assert.equal(args.includes('blocked'), false);
  assert.equal(args.includes('text'), false);
  await assertSameRealpath(await fs.readFile(cwdPath, 'utf8'), base);
  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'Gemini ');
  assert.equal(result.providerSessionId, 'gemini-session-1');
  assert.equal(result.usage['gemini-model'].outputTokens, 9);
  assert.equal(result.usage['gemini-model'].cacheReadTokens, 3);
  assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.content), ['Gemini ']);
  assert.equal(events.some((event) => event.type === 'tool_use' && event.tool === 'read_file'), true);
  assert.equal(events.some((event) => event.type === 'tool_use' && event.callId === 'tool-gemini' && event.input.path === 'README.md'), true);
  assert.equal(events.some((event) => event.type === 'tool_result' && event.output === 'ok'), true);
});

test('Gemini backend surfaces structured result error messages', async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-gemini-result-error.js', `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'result', status: 'error', error: { message: 'gemini quota exceeded' } }) + '\\n');
process.exit(1);
`);
  const backend = createGeminiBackend(binaryPath);
  const result = await backend.execute(
    {
      runtimeId: 'llm_gemini',
      runtime: { ...runtime, provider: 'gemini', binaryPath },
      prompt: 'gemini error',
      cwd: base,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  assert.equal(result.status, 'failed');
  assert.match(result.error, /gemini quota exceeded/);
});

test('Pi backend creates OAC session files and normalizes JSONL agent events', async () => {
  const base = await createTempDir();
  const home = path.join(base, 'home');
  await fs.mkdir(home, { recursive: true });
  const argsPath = path.join(base, 'args.json');
  const sessionExistsPath = path.join(base, 'session-exists.txt');
  const binaryPath = await writeExecutableScript(base, 'fake-pi.js', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.FAKE_PI_ARGS_PATH, JSON.stringify(args));
const sessionPath = args[args.indexOf('--session') + 1];
fs.writeFileSync(process.env.FAKE_PI_SESSION_EXISTS_PATH, fs.existsSync(sessionPath) ? sessionPath : '');
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
send({ type: 'agent_start', session_id: sessionPath });
send({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'pi thinking' } });
send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Pi ' } });
send({ type: 'tool_execution_start', toolCallId: 'tool-pi', toolName: 'bash', args: { command: 'pwd' } });
send({ type: 'tool_execution_end', toolCallId: 'tool-pi', toolName: 'bash', result: 'ok' });
send({ type: 'turn_end', message: { model: 'anthropic/sonnet', usage: { input_tokens: 11, output_tokens: 12 } } });
`);
  const backend = createPiBackend(binaryPath, {
    HOME: home,
    FAKE_PI_ARGS_PATH: argsPath,
    FAKE_PI_SESSION_EXISTS_PATH: sessionExistsPath,
  });
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_pi',
      runtime: { ...runtime, provider: 'pi', binaryPath },
      prompt: 'hello pi',
      systemPrompt: 'system pi',
      cwd: base,
      model: 'anthropic/sonnet',
      extraArgs: ['-p', '--print', '--mode', 'text', '--debug'],
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
  assert.deepEqual(args.slice(0, 3), ['-p', '--mode', 'json']);
  const sessionPath = args[args.indexOf('--session') + 1];
  assert.match(sessionPath, new RegExp(`${home.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}/\\.metabot/runtime/pi-sessions/.+\\.jsonl`));
  assert.equal(await fs.readFile(sessionExistsPath, 'utf8'), sessionPath);
  assert.ok(args.includes('--provider'));
  assert.ok(args.includes('anthropic'));
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('sonnet'));
  assert.ok(args.includes('--tools'));
  assert.ok(args.includes('read,bash,edit,write,grep,find,ls'));
  assert.ok(args.includes('--append-system-prompt'));
  assert.ok(args.includes('system pi'));
  assert.ok(args.includes('--debug'));
  assert.equal(args.filter((arg) => arg === '-p').length, 1);
  assert.equal(args.includes('--print'), false);
  assert.equal(args.includes('text'), false);
  assert.equal(args.at(-1), 'hello pi');
  assert.equal(result.status, 'completed');
  assert.equal(result.providerSessionId, sessionPath);
  assert.equal(result.output, 'Pi ');
  assert.equal(result.usage['anthropic/sonnet'].inputTokens, 11);
  assert.equal(events.some((event) => event.type === 'thinking' && event.content === 'pi thinking'), true);
  assert.equal(events.some((event) => event.type === 'tool_use' && event.tool === 'bash'), true);
  assert.equal(events.some((event) => event.type === 'tool_use' && event.callId === 'tool-pi' && event.input.command === 'pwd'), true);
  assert.equal(events.some((event) => event.type === 'tool_result' && event.output === 'ok'), true);
});

test('Pi backend creates missing resume session files before launch', async () => {
  const base = await createTempDir();
  const home = path.join(base, 'home');
  await fs.mkdir(home, { recursive: true });
  const argsPath = path.join(base, 'args.json');
  const resumePath = path.join(home, '.metabot', 'runtime', 'pi-sessions', 'resume.jsonl');
  const sessionExistsPath = path.join(base, 'resume-session-exists.txt');
  const binaryPath = await writeExecutableScript(base, 'fake-pi-resume.js', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.FAKE_PI_ARGS_PATH, JSON.stringify(args));
const sessionPath = args[args.indexOf('--session') + 1];
fs.writeFileSync(process.env.FAKE_PI_SESSION_EXISTS_PATH, fs.existsSync(sessionPath) ? 'yes' : 'no');
process.stdout.write(JSON.stringify({ type: 'agent_start', session_id: sessionPath }) + '\\n');
`);
  const backend = createPiBackend(binaryPath, {
    HOME: home,
    FAKE_PI_ARGS_PATH: argsPath,
    FAKE_PI_SESSION_EXISTS_PATH: sessionExistsPath,
  });

  const result = await backend.execute(
    {
      runtimeId: 'llm_pi',
      runtime: { ...runtime, provider: 'pi', binaryPath },
      prompt: 'resume pi',
      cwd: base,
      resumeSessionId: resumePath,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
  assert.equal(args[args.indexOf('--session') + 1], resumePath);
  assert.equal(await fs.readFile(sessionExistsPath, 'utf8'), 'yes');
  assert.equal(result.status, 'completed');
  assert.equal(result.providerSessionId, resumePath);
});

test('Pi backend preserves existing resume session files before launch', async () => {
  const base = await createTempDir();
  const home = path.join(base, 'home');
  const resumePath = path.join(home, '.metabot', 'runtime', 'pi-sessions', 'resume.jsonl');
  await fs.mkdir(path.dirname(resumePath), { recursive: true });
  await fs.writeFile(resumePath, 'existing session history', 'utf8');
  const sessionContentPath = path.join(base, 'resume-session-content.txt');
  const binaryPath = await writeExecutableScript(base, 'fake-pi-existing-resume.js', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const sessionPath = args[args.indexOf('--session') + 1];
fs.writeFileSync(process.env.FAKE_PI_SESSION_CONTENT_PATH, fs.readFileSync(sessionPath, 'utf8'));
process.stdout.write(JSON.stringify({ type: 'agent_start', session_id: sessionPath }) + '\\n');
`);
  const backend = createPiBackend(binaryPath, {
    HOME: home,
    FAKE_PI_SESSION_CONTENT_PATH: sessionContentPath,
  });

  const result = await backend.execute(
    {
      runtimeId: 'llm_pi',
      runtime: { ...runtime, provider: 'pi', binaryPath },
      prompt: 'resume existing pi',
      cwd: base,
      resumeSessionId: resumePath,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  assert.equal(await fs.readFile(sessionContentPath, 'utf8'), 'existing session history');
  assert.equal(result.status, 'completed');
  assert.equal(result.providerSessionId, resumePath);
});

test('Cursor backend launches stream-json chat mode and normalizes prefixed events', async () => {
  const base = await createTempDir();
  const argsPath = path.join(base, 'args.json');
  const cwdPath = path.join(base, 'cwd.txt');
  const binaryPath = await writeExecutableScript(base, 'fake-cursor.js', `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.FAKE_CURSOR_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(process.env.FAKE_CURSOR_CWD_PATH, process.cwd());
function send(message, prefix = '') {
  process.stdout.write(prefix + JSON.stringify(message) + '\\n');
}
send({ type: 'system', subtype: 'init', session_id: 'cursor-session-1' }, 'stdout:');
send({ type: 'assistant', message: { content: [
  { type: 'thinking', text: 'cursor thinking' },
  { type: 'output_text', text: 'Cursor ' },
  { type: 'tool_use', id: 'tool-cursor', name: 'grep', input: { pattern: 'x' } }
] } });
send({ type: 'tool_result', tool_id: 'tool-cursor', output: 'ok' }, 'stderr:');
send({ type: 'step_finish', part: { tokens: { input: 1, output: 1 } } });
send({ type: 'result', session_id: 'cursor-session-result', result: 'Cursor done', usage: { input_tokens: 13, output_tokens: 14 } });
`);
  const backend = createCursorBackend(binaryPath, { FAKE_CURSOR_ARGS_PATH: argsPath, FAKE_CURSOR_CWD_PATH: cwdPath });
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_cursor',
      runtime: { ...runtime, provider: 'cursor', binaryPath },
      prompt: 'hello cursor',
      cwd: base,
      model: 'cursor-model',
      resumeSessionId: 'cursor-old',
      extraArgs: ['--output-format', 'text', '--yolo', '--debug'],
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
  assert.deepEqual(args.slice(0, 3), ['chat', '-p', 'hello cursor']);
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('stream-json'));
  assert.ok(args.includes('--yolo'));
  assert.ok(args.includes('--workspace'));
  await assertSameRealpath(args[args.indexOf('--workspace') + 1], base);
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('cursor-model'));
  assert.ok(args.includes('--resume'));
  assert.ok(args.includes('cursor-old'));
  assert.ok(args.includes('--debug'));
  assert.equal(args.filter((arg) => arg === '--yolo').length, 1);
  assert.equal(args.includes('text'), false);
  await assertSameRealpath(await fs.readFile(cwdPath, 'utf8'), base);
  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'Cursor ');
  assert.equal(result.providerSessionId, 'cursor-session-result');
  assert.equal(result.usage.cursor.inputTokens, 13);
  assert.equal(result.usage.cursor.outputTokens, 14);
  assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.content), ['Cursor ']);
  assert.equal(events.some((event) => event.type === 'thinking' && event.content === 'cursor thinking'), true);
  assert.equal(events.some((event) => event.type === 'tool_use' && event.tool === 'grep'), true);
  assert.equal(events.some((event) => event.type === 'tool_result' && event.output === 'ok'), true);
});

test('Cursor backend uses result usage by model without double-counting step usage', async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-cursor-result-usage.js', `#!/usr/bin/env node
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
send({ type: 'system', subtype: 'init', session_id: 'cursor-usage-session' });
send({ type: 'step_finish', model: 'step-model', part: { tokens: { input: 1, output: 2, cache: { read: 3, write: 4 } } } });
send({ type: 'result', model: 'result-model', session_id: 'cursor-usage-result', result: 'done', usage: { input_tokens: 10, output_tokens: 20, cached_input_tokens: 5 } });
`);
  const backend = createCursorBackend(binaryPath);
  const result = await backend.execute(
    {
      runtimeId: 'llm_cursor',
      runtime: { ...runtime, provider: 'cursor', binaryPath },
      prompt: 'cursor usage',
      cwd: base,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'done');
  assert.equal(result.usage['result-model'].inputTokens, 10);
  assert.equal(result.usage['result-model'].outputTokens, 20);
  assert.equal(result.usage['result-model'].cacheReadTokens, 5);
  assert.equal(result.usage['step-model'], undefined);
  assert.equal(result.usage.cursor, undefined);
});

test('Cursor backend falls back to step usage by model with cache tokens', async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-cursor-step-usage.js', `#!/usr/bin/env node
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
send({ type: 'system', subtype: 'init', session_id: 'cursor-step-session' });
send({ type: 'step_finish', model: 'cursor-step-model', part: { tokens: { input: 3, output: 4, cache: { read: 5, write: 6 } } } });
`);
  const backend = createCursorBackend(binaryPath);
  const result = await backend.execute(
    {
      runtimeId: 'llm_cursor',
      runtime: { ...runtime, provider: 'cursor', binaryPath },
      prompt: 'cursor step usage',
      cwd: base,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.usage['cursor-step-model'].inputTokens, 3);
  assert.equal(result.usage['cursor-step-model'].outputTokens, 4);
  assert.equal(result.usage['cursor-step-model'].cacheReadTokens, 5);
  assert.equal(result.usage['cursor-step-model'].cacheWriteTokens, 6);
});

test('Codex backend speaks app-server JSON-RPC, filters blocked args, and returns streamed output', async () => {
  const base = await createTempDir();
  const argsPath = path.join(base, 'args.json');
  const binaryPath = await writeExecutableScript(base, 'fake-codex.js', `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
fs.writeFileSync(process.env.FAKE_CODEX_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
const rl = readline.createInterface({ input: process.stdin });
const threadId = 'thread-codex-1';
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
rl.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 'test' } });
    return;
  }
  if (request.method === 'thread/start') {
    send({ jsonrpc: '2.0', id: request.id, result: { thread: { id: threadId } } });
    return;
  }
  if (request.method === 'turn/start') {
    send({ jsonrpc: '2.0', id: request.id, result: { turn: { id: 'turn-1' } } });
    send({ jsonrpc: '2.0', method: 'turn/started', params: { threadId, turn: { id: 'turn-1' } } });
    send({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId, itemId: 'msg-1', delta: 'Hello ' } });
    send({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId, itemId: 'msg-1', delta: 'Codex' } });
    send({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', status: 'completed', usage: { input_tokens: 4, output_tokens: 2, cache_read_tokens: 1 } } } });
    setTimeout(() => process.exit(0), 10);
  }
});
`);

  const backend = createCodexBackend(binaryPath, { FAKE_CODEX_ARGS_PATH: argsPath });
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_codex',
      runtime: { ...runtime, provider: 'codex', binaryPath },
      prompt: 'hello codex',
      cwd: base,
      systemPrompt: 'Be terse.',
      extraArgs: ['--listen', 'tcp://127.0.0.1:9999', '--experimental-test-flag'],
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
  assert.deepEqual(args.slice(0, 3), ['app-server', '--listen', 'stdio://']);
  assert.ok(args.includes('--experimental-test-flag'));
  assert.equal(args.includes('tcp://127.0.0.1:9999'), false);
  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'Hello Codex');
  assert.equal(result.providerSessionId, 'thread-codex-1');
  assert.equal(result.usage.codex.inputTokens, 4);
  assert.equal(result.usage.codex.cacheReadTokens, 1);
  assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.content), ['Hello ', 'Codex']);
});

test('Codex backend marks early process exit before turn completion as failed', async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-codex-crash.js', `#!/usr/bin/env node
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
rl.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 'test' } });
    return;
  }
  if (request.method === 'thread/start') {
    send({ jsonrpc: '2.0', id: request.id, result: { thread: { id: 'thread-crash' } } });
    return;
  }
  if (request.method === 'turn/start') {
    send({ jsonrpc: '2.0', id: request.id, result: { turn: { id: 'turn-crash' } } });
    process.exit(0);
  }
});
`);

  const backend = createCodexBackend(binaryPath);
  const result = await backend.execute(
    {
      runtimeId: 'llm_codex',
      runtime: { ...runtime, provider: 'codex', binaryPath },
      prompt: 'hello codex',
      cwd: base,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  assert.equal(result.status, 'failed');
  assert.match(result.error, /exited before turn completion/i);
});

test('Codex backend treats agentMessage final_answer completion as turn completion', async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-codex-final-answer.js', `#!/usr/bin/env node
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const threadId = 'thread-final-answer';
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
rl.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 'test' } });
    return;
  }
  if (request.method === 'thread/start') {
    send({ jsonrpc: '2.0', id: request.id, result: { thread: { id: threadId } } });
    return;
  }
  if (request.method === 'turn/start') {
    send({ jsonrpc: '2.0', id: request.id, result: { turn: { id: 'turn-final-answer' } } });
    send({ jsonrpc: '2.0', method: 'turn/started', params: { threadId, turn: { id: 'turn-final-answer' } } });
    send({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId, itemId: 'msg-1', delta: 'Done' } });
    send({ jsonrpc: '2.0', method: 'item/completed', params: { threadId, item: { id: 'msg-1', type: 'agentMessage', phase: 'final_answer' } } });
    setTimeout(() => process.exit(0), 20);
  }
});
`);

  const backend = createCodexBackend(binaryPath);
  const result = await backend.execute(
    {
      runtimeId: 'llm_codex',
      runtime: { ...runtime, provider: 'codex', binaryPath },
      prompt: 'hello codex',
      cwd: base,
      timeout: 1_000,
      semanticInactivityTimeout: 1_000,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'Done');
});

test('Codex backend returns timeout promptly when the child ignores SIGTERM', { timeout: 4_000 }, async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-codex-ignore-sigterm.js', `#!/usr/bin/env node
const readline = require('node:readline');
process.on('SIGTERM', () => {});
const keepAlive = setInterval(() => {}, 100);
const rl = readline.createInterface({ input: process.stdin });
const threadId = 'thread-timeout';
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
rl.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 'test' } });
    return;
  }
  if (request.method === 'thread/start') {
    send({ jsonrpc: '2.0', id: request.id, result: { thread: { id: threadId } } });
    return;
  }
  if (request.method === 'turn/start') {
    send({ jsonrpc: '2.0', id: request.id, result: { turn: { id: 'turn-timeout' } } });
    send({ jsonrpc: '2.0', method: 'turn/started', params: { threadId, turn: { id: 'turn-timeout' } } });
    setTimeout(() => {
      clearInterval(keepAlive);
      process.exit(0);
    }, 2_000);
  }
});
`);

  const backend = createCodexBackend(binaryPath);
  const startedAt = Date.now();
  const result = await backend.execute(
    {
      runtimeId: 'llm_codex',
      runtime: { ...runtime, provider: 'codex', binaryPath },
      prompt: 'timeout',
      cwd: base,
      timeout: 300,
      semanticInactivityTimeout: 1_000,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  assert.equal(result.status, 'timeout');
  assert.match(result.error, /timed out/i);
  assert.ok(Date.now() - startedAt < 1_000);
});

test('Codex backend returns failed session result when spawn emits an error', async () => {
  const base = await createTempDir();
  const missingBinary = path.join(base, 'missing-codex');
  const backend = createCodexBackend(missingBinary);

  const result = await backend.execute(
    {
      runtimeId: 'llm_codex',
      runtime: { ...runtime, provider: 'codex', binaryPath: missingBinary },
      prompt: 'spawn should fail',
      cwd: base,
      timeout: 500,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  assert.equal(result.status, 'failed');
  assert.match(result.error, /ENOENT|spawn/i);
});

test('Claude backend speaks stream-json, filters blocked args, and returns streamed output', async () => {
  const base = await createTempDir();
  const argsPath = path.join(base, 'args.json');
  const inputPath = path.join(base, 'input.jsonl');
  const binaryPath = await writeExecutableScript(base, 'fake-claude.js', `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
const rl = readline.createInterface({ input: process.stdin });
rl.once('line', (line) => {
  fs.writeFileSync(process.env.FAKE_CLAUDE_INPUT_PATH, line + '\\n');
  function send(message) {
    process.stdout.write(JSON.stringify(message) + '\\n');
  }
  send({ type: 'system', session_id: 'claude-session-1' });
  send({ type: 'assistant', message: { usage: { input_tokens: 5, output_tokens: 1 }, content: [
    { type: 'thinking', thinking: 'checking' },
    { type: 'text', text: 'Hello ' },
    { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file: 'README.md' } }
  ] } });
  send({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }
  ] } });
  send({ type: 'assistant', message: { content: [
    { type: 'text', text: 'Claude' }
  ] } });
  send({ type: 'result', session_id: 'claude-session-1', result: 'Hello Claude', duration_ms: 123 });
  setTimeout(() => process.exit(0), 10);
});
`);

  const backend = createClaudeBackend(binaryPath, {
    FAKE_CLAUDE_ARGS_PATH: argsPath,
    FAKE_CLAUDE_INPUT_PATH: inputPath,
  });
  const events = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_claude',
      runtime: { ...runtime, provider: 'claude-code', binaryPath },
      prompt: 'hello claude',
      cwd: base,
      systemPrompt: 'Be useful.',
      maxTurns: 3,
      model: 'sonnet-test',
      extraArgs: ['--permission-mode', 'ask', '--debug'],
    },
    { emit: (event) => events.push(event) },
    new AbortController().signal,
  );

  const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('stream-json'));
  assert.ok(args.includes('--max-turns'));
  assert.ok(args.includes('3'));
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('sonnet-test'));
  assert.ok(args.includes('--debug'));
  assert.equal(args.includes('ask'), false);

  const input = JSON.parse((await fs.readFile(inputPath, 'utf8')).trim());
  assert.equal(input.type, 'user');
  assert.equal(input.message.content[0].text, 'hello claude');

  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'Hello Claude');
  assert.equal(result.providerSessionId, 'claude-session-1');
  assert.equal(result.durationMs, 123);
  assert.equal(result.usage['claude-code'].inputTokens, 5);
  assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.content), ['Hello ', 'Claude']);
  assert.equal(events.some((event) => event.type === 'thinking' && event.content === 'checking'), true);
  assert.equal(events.some((event) => event.type === 'tool_use' && event.tool === 'Read'), true);
  assert.equal(events.some((event) => event.type === 'tool_result' && event.output === 'ok'), true);
});

test('Claude backend allows control_request messages before closing stdin', async () => {
  const base = await createTempDir();
  const responsesPath = path.join(base, 'responses.jsonl');
  const binaryPath = await writeExecutableScript(base, 'fake-claude-control.js', `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}
let sawUser = false;
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'user') {
    sawUser = true;
    send({ type: 'system', session_id: 'claude-control-session' });
    send({ type: 'control_request', request_id: 'control-1', request: { subtype: 'tool_use', tool_name: 'Bash', input: { command: 'pwd' } } });
    return;
  }
  if (message.type === 'control_response') {
    fs.appendFileSync(process.env.FAKE_CLAUDE_RESPONSES_PATH, line + '\\n');
    send({ type: 'assistant', message: { content: [{ type: 'text', text: 'Allowed' }] } });
    send({ type: 'result', session_id: 'claude-control-session', result: 'Allowed', duration_ms: 12 });
    setTimeout(() => process.exit(0), 10);
  }
});
setTimeout(() => {
  if (sawUser) process.exit(2);
}, 600);
`);

  const backend = createClaudeBackend(binaryPath, { FAKE_CLAUDE_RESPONSES_PATH: responsesPath });
  const result = await backend.execute(
    {
      runtimeId: 'llm_claude',
      runtime: { ...runtime, provider: 'claude-code', binaryPath },
      prompt: 'needs approval',
      cwd: base,
      timeout: 2_000,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  const response = JSON.parse((await fs.readFile(responsesPath, 'utf8')).trim());
  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'Allowed');
  assert.equal(response.type, 'control_response');
  assert.equal(response.response.request_id, 'control-1');
  assert.equal(response.response.response.behavior, 'allow');
  assert.deepEqual(response.response.response.updatedInput, { command: 'pwd' });
});

test('Claude backend returns timeout promptly when the child ignores SIGTERM', { timeout: 4_000 }, async () => {
  const base = await createTempDir();
  const binaryPath = await writeExecutableScript(base, 'fake-claude-ignore-sigterm.js', `#!/usr/bin/env node
const readline = require('node:readline');
process.on('SIGTERM', () => {});
const keepAlive = setInterval(() => {}, 100);
const rl = readline.createInterface({ input: process.stdin });
rl.once('line', () => {
  process.stdout.write(JSON.stringify({ type: 'system', session_id: 'claude-timeout-session' }) + '\\n');
  setTimeout(() => {
    clearInterval(keepAlive);
    process.exit(0);
  }, 2_000);
});
`);

  const backend = createClaudeBackend(binaryPath);
  const startedAt = Date.now();
  const result = await backend.execute(
    {
      runtimeId: 'llm_claude',
      runtime: { ...runtime, provider: 'claude-code', binaryPath },
      prompt: 'timeout',
      cwd: base,
      timeout: 300,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  assert.equal(result.status, 'timeout');
  assert.match(result.error, /timed out/i);
  assert.ok(Date.now() - startedAt < 1_000);
});

const acpProviderCases = [
  {
    label: 'Hermes',
    provider: 'hermes',
    createBackend: createHermesBackend,
    expectedArgs: ['acp', '--debug'],
    resumeMethod: 'session/resume',
    toolTitle: 'terminal: pwd',
    expectedTool: 'terminal',
    expectsYoloEnv: true,
  },
  {
    label: 'Kimi',
    provider: 'kimi',
    createBackend: createKimiBackend,
    expectedArgs: ['acp', '--debug'],
    resumeMethod: 'session/resume',
    toolTitle: 'Run command: pwd',
    expectedTool: 'terminal',
    expectsYoloEnv: false,
  },
  {
    label: 'Kiro',
    provider: 'kiro',
    createBackend: createKiroBackend,
    expectedArgs: ['acp', '--trust-all-tools', '--debug'],
    resumeMethod: 'session/load',
    toolTitle: 'Run command: pwd',
    expectedTool: 'terminal',
    expectsYoloEnv: false,
  },
];

test('ACP backends launch, create sessions, set model, prompt, stream events, and approve permissions', async () => {
  for (const providerCase of acpProviderCases) {
    const base = await createTempDir();
    const recordPath = path.join(base, `${providerCase.provider}-record.json`);
    const binaryPath = await writeExecutableScript(base, `fake-${providerCase.provider}-acp.js`, fakeAcpServerSource());
    const backend = providerCase.createBackend(binaryPath, {
      FAKE_ACP_RECORD_PATH: recordPath,
      FAKE_ACP_PROVIDER: providerCase.provider,
      FAKE_ACP_TOOL_TITLE: providerCase.toolTitle,
      FAKE_ACP_SESSION_ID: `${providerCase.provider}-session-new`,
    });
    const events = [];
    const result = await backend.execute(
      {
        runtimeId: `llm_${providerCase.provider}`,
        runtime: { ...runtime, provider: providerCase.provider, binaryPath },
        prompt: `${providerCase.provider} prompt`,
        systemPrompt: `${providerCase.provider} system`,
        cwd: base,
        model: `${providerCase.provider}-model`,
        extraArgs: providerCase.provider === 'kiro'
          ? ['acp', '--trust-all-tools', '--trust-tools', 'blocked', '-a', '--debug']
          : ['acp', '--debug'],
      },
      { emit: (event) => events.push(event) },
      new AbortController().signal,
    );

    const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
    assert.deepEqual(record.argv, providerCase.expectedArgs);
    assert.equal(record.env.HERMES_YOLO_MODE, providerCase.expectsYoloEnv ? '1' : '');

    const initialize = record.requests.find((entry) => entry.method === 'initialize');
    assert.equal(initialize.params.protocolVersion, 1);
    assert.equal(initialize.params.clientInfo.name, 'multica-agent-sdk');

    const sessionNew = record.requests.find((entry) => entry.method === 'session/new');
    assert.ok(sessionNew);
    await assertSameRealpath(sessionNew.params.cwd, base);
    assert.deepEqual(sessionNew.params.mcpServers, []);
    if (providerCase.provider === 'hermes') {
      assert.equal(sessionNew.params.model, `${providerCase.provider}-model`);
    } else {
      assert.equal(sessionNew.params.model, undefined);
    }

    const setModel = record.requests.find((entry) => entry.method === 'session/set_model');
    assert.equal(setModel.params.sessionId, `${providerCase.provider}-session-new`);
    assert.equal(setModel.params.modelId, `${providerCase.provider}-model`);

    const prompt = record.requests.find((entry) => entry.method === 'session/prompt');
    assert.equal(prompt.params.sessionId, `${providerCase.provider}-session-new`);
    assert.match(prompt.params.prompt[0].text, new RegExp(`${providerCase.provider} system\\n\\n---\\n\\n${providerCase.provider} prompt`));
    if (providerCase.provider === 'kiro') {
      assert.deepEqual(prompt.params.content, prompt.params.prompt);
    }

    assert.equal(record.permissionResponses[0].outcome.optionId, 'approve_for_session');
    assert.equal(result.status, 'completed');
    assert.equal(result.output, `${providerCase.provider} text `);
    assert.equal(result.providerSessionId, `${providerCase.provider}-session-new`);
    assert.equal(result.usage[`${providerCase.provider}-model`].inputTokens, 6);
    assert.equal(result.usage[`${providerCase.provider}-model`].outputTokens, 8);
    assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.content), [`${providerCase.provider} text `]);
    assert.equal(events.some((event) => event.type === 'thinking' && event.content === `${providerCase.provider} thinking`), true);
    assert.equal(events.some((event) => event.type === 'tool_use' && event.tool === providerCase.expectedTool && event.callId === 'tool-acp' && event.input.command === 'pwd'), true);
    assert.equal(events.some((event) => event.type === 'tool_result' && event.callId === 'tool-acp' && event.output === 'tool ok'), true);
  }
});

test('ACP backends resume sessions with provider-specific methods', async () => {
  for (const providerCase of acpProviderCases) {
    const base = await createTempDir();
    const recordPath = path.join(base, `${providerCase.provider}-resume-record.json`);
    const binaryPath = await writeExecutableScript(base, `fake-${providerCase.provider}-resume-acp.js`, fakeAcpServerSource());
    const backend = providerCase.createBackend(binaryPath, {
      FAKE_ACP_RECORD_PATH: recordPath,
      FAKE_ACP_PROVIDER: providerCase.provider,
      FAKE_ACP_TOOL_TITLE: providerCase.toolTitle,
    });
    const result = await backend.execute(
      {
        runtimeId: `llm_${providerCase.provider}`,
        runtime: { ...runtime, provider: providerCase.provider, binaryPath },
        prompt: `${providerCase.provider} resume`,
        cwd: base,
        resumeSessionId: `${providerCase.provider}-existing-session`,
      },
      { emit: () => {} },
      new AbortController().signal,
    );

    const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
    const resume = record.requests.find((entry) => entry.method === providerCase.resumeMethod);
    assert.ok(resume, `${providerCase.provider} should call ${providerCase.resumeMethod}`);
    assert.equal(resume.params.sessionId, `${providerCase.provider}-existing-session`);
    if (providerCase.provider === 'kiro') {
      assert.deepEqual(resume.params.mcpServers, []);
    }
    assert.equal(record.requests.some((entry) => entry.method === 'session/set_model'), false);
    assert.equal(result.status, 'completed');
    assert.equal(result.providerSessionId, `${providerCase.provider}-existing-session`);
  }
});

test('ACP backend fails when session model switch is rejected', async () => {
  const base = await createTempDir();
  const recordPath = path.join(base, 'hermes-set-model-fail-record.json');
  const binaryPath = await writeExecutableScript(base, 'fake-hermes-set-model-fail.js', fakeAcpServerSource());
  const backend = createHermesBackend(binaryPath, {
    FAKE_ACP_RECORD_PATH: recordPath,
    FAKE_ACP_PROVIDER: 'hermes',
    FAKE_ACP_FAIL_SET_MODEL: '1',
  });
  const result = await backend.execute(
    {
      runtimeId: 'llm_hermes',
      runtime: { ...runtime, provider: 'hermes', binaryPath },
      prompt: 'prompt',
      cwd: base,
      model: 'bad-model',
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  assert.equal(record.requests.some((entry) => entry.method === 'session/prompt'), false);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /bad-model/);
  assert.equal(result.providerSessionId, 'hermes-session-new');
});

test('ACP backend surfaces provider stderr errors when output is empty', async () => {
  const base = await createTempDir();
  const recordPath = path.join(base, 'hermes-stderr-record.json');
  const binaryPath = await writeExecutableScript(base, 'fake-hermes-stderr-error.js', fakeAcpServerSource());
  const backend = createHermesBackend(binaryPath, {
    FAKE_ACP_RECORD_PATH: recordPath,
    FAKE_ACP_PROVIDER: 'hermes',
    FAKE_ACP_STDERR_ONLY_ERROR: '1',
  });
  const result = await backend.execute(
    {
      runtimeId: 'llm_hermes',
      runtime: { ...runtime, provider: 'hermes', binaryPath },
      prompt: 'stderr error',
      cwd: base,
    },
    { emit: () => {} },
    new AbortController().signal,
  );

  assert.equal(result.status, 'failed');
  assert.match(result.error, /HTTP 400/);
});
