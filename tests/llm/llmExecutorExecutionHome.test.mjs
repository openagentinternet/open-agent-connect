import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);

const {
  LlmExecutor,
  prepareProviderExecutionHome,
} = require('../../dist/core/llm/executor/index.js');

function makeRuntime(provider) {
  const now = new Date().toISOString();
  return {
    id: `llm_${provider}_execution_home_test`,
    provider,
    displayName: provider,
    binaryPath: '/bin/true',
    authState: 'authenticated',
    health: 'healthy',
    capabilities: [],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function captureBackend(captured) {
  return () => ({
    provider: 'capture',
    async execute(request) {
      captured.requestEnv = request.env;
      return { status: 'completed', output: 'ok', durationMs: 1, providerSessionId: 'provider-thread-1' };
    },
  });
}

async function waitForResult(executor, sessionId) {
  for (let i = 0; i < 100; i += 1) {
    const session = await executor.getSession(sessionId);
    if (session?.result) return session;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`LLM session did not finish: ${sessionId}`);
}

async function writeSourceHome(sourceHome, entries) {
  for (const [relativePath, content] of Object.entries(entries)) {
    const target = path.join(sourceHome, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
}

async function runExecution({ provider, envName, sourceEntries, requestExtra, executorEnv }) {
  const base = await mkdtempTempRoot('metabot-llm-exec-home-');
  const sourceHome = path.join(base, 'source-home');
  await writeSourceHome(sourceHome, sourceEntries);
  const captured = {};
  const executor = new LlmExecutor({
    sessionsRoot: path.join(base, 'llm', 'sessions'),
    transcriptsRoot: path.join(base, 'llm', 'transcripts'),
    skillsRoot: path.join(base, 'skills'),
    env: { ...(executorEnv ?? {}), ...(envName ? { [envName]: sourceHome } : {}) },
    backends: { [provider]: captureBackend(captured) },
  });
  const sessionId = await executor.execute({
    runtimeId: 'runtime-execution-home',
    runtime: makeRuntime(provider),
    prompt: 'hello',
    ...(requestExtra ?? {}),
  });
  const session = await waitForResult(executor, sessionId);
  return {
    base,
    captured,
    session,
    sourceHome,
    expectedHome: path.join(base, 'llm', 'provider-homes', provider),
  };
}

test('kimi executions redirect KIMI_CODE_HOME into an isolated, seeded provider home', async () => {
  const { captured, session, sourceHome, expectedHome } = await runExecution({
    provider: 'kimi',
    envName: 'KIMI_CODE_HOME',
    sourceEntries: {
      'config.toml': 'model = "k2"\n',
      'credentials/kimi-code.json': '{"token":"secret"}\n',
      'oauth/kimi-code': '',
      'mcp.json': '{"mcpServers":{}}\n',
      'workspace-trust/wd_example/config.json': '{}\n',
    },
  });

  assert.equal(captured.requestEnv.KIMI_CODE_HOME, expectedHome);
  assert.equal(session.providerStateHome, expectedHome);
  assert.equal(session.status, 'completed');
  // Auth/config entries are seeded from the source home (symlink or copy).
  assert.equal(await fs.readFile(path.join(expectedHome, 'config.toml'), 'utf8'), 'model = "k2"\n');
  assert.equal(
    await fs.readFile(path.join(expectedHome, 'credentials', 'kimi-code.json'), 'utf8'),
    '{"token":"secret"}\n',
  );
  assert.equal(
    await fs.readFile(path.join(expectedHome, 'mcp.json'), 'utf8'),
    '{"mcpServers":{}}\n',
  );
  if (process.platform !== 'win32') {
    const seedLink = await fs.lstat(path.join(expectedHome, 'config.toml'));
    assert.ok(seedLink.isSymbolicLink(), 'seeded entries should be symlinks so credential/config updates stay shared');
    assert.equal(await fs.realpath(path.join(expectedHome, 'config.toml')), await fs.realpath(path.join(sourceHome, 'config.toml')));
  }
});

test('claude-code executions redirect CLAUDE_CONFIG_DIR and codex executions redirect CODEX_HOME', async () => {
  const claude = await runExecution({
    provider: 'claude-code',
    envName: 'CLAUDE_CONFIG_DIR',
    sourceEntries: {
      '.credentials.json': '{"token":"claude"}\n',
      'settings.json': '{"model":"sonnet"}\n',
      'CLAUDE.md': '# memory\n',
    },
  });
  assert.equal(claude.captured.requestEnv.CLAUDE_CONFIG_DIR, claude.expectedHome);
  assert.equal(claude.session.providerStateHome, claude.expectedHome);
  assert.equal(await fs.readFile(path.join(claude.expectedHome, 'settings.json'), 'utf8'), '{"model":"sonnet"}\n');
  assert.equal(await fs.readFile(path.join(claude.expectedHome, 'CLAUDE.md'), 'utf8'), '# memory\n');

  const codex = await runExecution({
    provider: 'codex',
    envName: 'CODEX_HOME',
    sourceEntries: {
      'auth.json': '{"token":"codex"}\n',
      'config.toml': 'model = "gpt-5"\n',
    },
  });
  assert.equal(codex.captured.requestEnv.CODEX_HOME, codex.expectedHome);
  assert.equal(codex.session.providerStateHome, codex.expectedHome);
  assert.equal(await fs.readFile(path.join(codex.expectedHome, 'auth.json'), 'utf8'), '{"token":"codex"}\n');
});

test('resumed sessions run against the real provider home (no redirection)', async () => {
  const { captured, session, sourceHome } = await runExecution({
    provider: 'kimi',
    envName: 'KIMI_CODE_HOME',
    sourceEntries: { 'config.toml': 'model = "k2"\n' },
    requestExtra: { resumeSessionId: 'session_caller_owned' },
  });

  assert.equal(captured.requestEnv.KIMI_CODE_HOME, sourceHome);
  assert.equal(session.providerStateHome, undefined);
});

test('resuming an executor-created session redirects back into its isolated provider home', async () => {
  const base = await mkdtempTempRoot('metabot-llm-exec-home-resume-');
  const sourceHome = path.join(base, 'source-home');
  await writeSourceHome(sourceHome, { 'config.toml': 'model = "k2"\n' });
  const captured = {};
  const executor = new LlmExecutor({
    sessionsRoot: path.join(base, 'llm', 'sessions'),
    transcriptsRoot: path.join(base, 'llm', 'transcripts'),
    skillsRoot: path.join(base, 'skills'),
    env: { KIMI_CODE_HOME: sourceHome },
    backends: { kimi: captureBackend(captured) },
  });
  const expectedHome = path.join(base, 'llm', 'provider-homes', 'kimi');

  const firstId = await executor.execute({ runtimeId: 'r', runtime: makeRuntime('kimi'), prompt: 'one' });
  const first = await waitForResult(executor, firstId);
  assert.equal(first.providerStateHome, expectedHome);
  assert.equal(first.providerSessionId, 'provider-thread-1');

  // Resume by executor session id: the recorded providerStateHome is reused.
  const secondId = await executor.execute({
    runtimeId: 'r', runtime: makeRuntime('kimi'), prompt: 'two', resumeSessionId: first.sessionId,
  });
  const second = await waitForResult(executor, secondId);
  assert.equal(second.providerStateHome, expectedHome);
  assert.equal(captured.requestEnv.KIMI_CODE_HOME, expectedHome);

  // Resume by provider thread id: matched through the session record list.
  const thirdId = await executor.execute({
    runtimeId: 'r', runtime: makeRuntime('kimi'), prompt: 'three', resumeSessionId: first.providerSessionId,
  });
  const third = await waitForResult(executor, thirdId);
  assert.equal(third.providerStateHome, expectedHome);
  assert.equal(captured.requestEnv.KIMI_CODE_HOME, expectedHome);
});

test('a caller-provided state-home env var is respected as an explicit override', async () => {
  const { captured, session } = await runExecution({
    provider: 'kimi',
    envName: 'KIMI_CODE_HOME',
    sourceEntries: { 'config.toml': 'model = "k2"\n' },
    requestExtra: { env: { KIMI_CODE_HOME: '/caller/owned/home' } },
  });

  assert.equal(captured.requestEnv.KIMI_CODE_HOME, '/caller/owned/home');
  assert.equal(session.providerStateHome, undefined);
});

test('providers without an execution-home policy run unredirected', async () => {
  const { captured, session, expectedHome } = await runExecution({
    provider: 'gemini',
    envName: undefined,
    sourceEntries: {},
  });

  assert.equal(
    Object.values(captured.requestEnv).includes(expectedHome),
    false,
    'no env var should point at a provider execution home',
  );
  assert.equal(session.providerStateHome, undefined);
  await assert.rejects(fs.access(expectedHome), 'no provider home directory should be created');
});

test('prepareProviderExecutionHome keeps existing execution-home entries on later runs', async () => {
  const base = await mkdtempTempRoot('metabot-llm-exec-home-');
  const sourceHome = path.join(base, 'source-home');
  await writeSourceHome(sourceHome, { 'config.toml': 'model = "k2"\n' });
  const homesRoot = path.join(base, 'provider-homes');
  const baseEnv = { KIMI_CODE_HOME: sourceHome };

  const first = await prepareProviderExecutionHome({ provider: 'kimi', homesRoot, baseEnv });
  assert.ok(first);
  assert.equal(first.env.KIMI_CODE_HOME, path.join(homesRoot, 'kimi'));
  assert.deepEqual(first.warnings, []);

  // The CLI replaced the seeded config with its own file; later runs must not
  // clobber it with a stale copy from the source home.
  const shadowConfig = path.join(first.home, 'config.toml');
  await fs.rm(shadowConfig, { force: true });
  await fs.writeFile(shadowConfig, 'model = "k2-new"\n', 'utf8');

  const second = await prepareProviderExecutionHome({ provider: 'kimi', homesRoot, baseEnv });
  assert.ok(second);
  assert.equal(await fs.readFile(shadowConfig, 'utf8'), 'model = "k2-new"\n');

  assert.equal(await prepareProviderExecutionHome({ provider: 'custom', homesRoot, baseEnv }), null);
  const resumeHome = path.join(base, 'elsewhere', 'kimi-resume');
  const resumed = await prepareProviderExecutionHome({ provider: 'kimi', homesRoot, baseEnv, resumeStateHome: resumeHome });
  assert.ok(resumed);
  assert.equal(resumed.home, resumeHome);
  assert.equal(resumed.env.KIMI_CODE_HOME, resumeHome);
  assert.equal(
    await prepareProviderExecutionHome({ provider: 'kimi', homesRoot, baseEnv, requestEnv: { KIMI_CODE_HOME: '/x' } }),
    null,
  );
});
