import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

const {
  LlmExecutor,
  createClaudeBackend,
  createCodexBackend,
  createFileSessionManager,
  createOpenClawBackend,
  injectSkills,
} = require('../../dist/core/llm/executor/index.js');

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

test('OpenClaw backend is a safe unsupported stub for Phase 1', async () => {
  const backend = createOpenClawBackend('/bin/openclaw');
  const emitted = [];
  const result = await backend.execute(
    {
      runtimeId: 'llm_openclaw',
      runtime: { ...runtime, provider: 'openclaw', binaryPath: '/bin/openclaw' },
      prompt: 'hello',
    },
    { emit: (event) => emitted.push(event) },
    new AbortController().signal,
  );

  assert.equal(result.status, 'failed');
  assert.match(result.error, /not implemented/i);
  assert.equal(emitted.at(-1).type, 'error');
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
