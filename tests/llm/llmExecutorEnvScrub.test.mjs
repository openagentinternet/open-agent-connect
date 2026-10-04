import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { scrubSensitiveEnvVars, buildProcessEnv } = require('../../dist/core/llm/executor/backends/backend.js');
const { LlmExecutor } = require('../../dist/core/llm/executor/index.js');

test('scrubSensitiveEnvVars drops sensitive families case-insensitively and keeps runtime vars', () => {
  const env = {
    PATH: '/usr/bin:/bin',
    HOME: '/home/owner',
    TMPDIR: '/tmp',
    SystemRoot: 'C:\\Windows',
    LANG: 'en_US.UTF-8',
    OPENAI_API_KEY: 'sk-openai',
    ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
    MY_TOKEN: 'my-token',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    GITHUB_TOKEN: 'gh-token',
    NPM_TOKEN: 'npm-token',
    npm_config_registry: 'https://registry.example',
    DB_PASSWORD: 'db-pass',
    db_password: 'db-pass-lower',
    Service_Private_Key: 'svc-key',
    DEPLOY_PASSPHRASE: 'deploy-pass',
    APP_CREDENTIALS: 'creds',
    BOT_AUTH: 'bot-auth',
  };
  const scrubbed = scrubSensitiveEnvVars(env);
  assert.equal(scrubbed.PATH, '/usr/bin:/bin');
  assert.equal(scrubbed.HOME, '/home/owner');
  assert.equal(scrubbed.TMPDIR, '/tmp');
  assert.equal(scrubbed.SystemRoot, 'C:\\Windows');
  assert.equal(scrubbed.LANG, 'en_US.UTF-8');
  for (const name of [
    'OPENAI_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'MY_TOKEN',
    'AWS_SECRET_ACCESS_KEY',
    'GITHUB_TOKEN',
    'NPM_TOKEN',
    'npm_config_registry',
    'DB_PASSWORD',
    'db_password',
    'Service_Private_Key',
    'DEPLOY_PASSPHRASE',
    'APP_CREDENTIALS',
    'BOT_AUTH',
  ]) {
    assert.equal(name in scrubbed, false, `${name} must be scrubbed`);
  }
});

test('buildProcessEnv scrubs the daemon process.env but keeps explicit base/request env', () => {
  const seeded = 'OAC_TEST_DAEMON_SECRET';
  process.env[seeded] = 'daemon-secret-value';
  try {
    const merged = buildProcessEnv(
      { OPENAI_API_KEY: 'explicit-base-key', PATH: '/explicit/bin' },
      { MY_TOKEN: 'explicit-request-token' },
    );
    assert.equal(seeded in merged, false, 'seeded daemon secret must not reach the child env');
    assert.equal(merged.OPENAI_API_KEY, 'explicit-base-key');
    assert.equal(merged.MY_TOKEN, 'explicit-request-token');
    assert.equal(merged.PATH, '/explicit/bin');
  } finally {
    delete process.env[seeded];
  }
});

test('LlmExecutor keeps daemon process.env secrets out of the backend env but keeps explicit env', async () => {
  const base = await mkdtempTempRoot('metabot-llm-executor-');
  const captured = [];
  const executor = new LlmExecutor({
    sessionsRoot: path.join(base, 'sessions'),
    transcriptsRoot: path.join(base, 'transcripts'),
    skillsRoot: path.join(base, 'skills'),
    env: { EXECUTOR_CFG_KEY: 'executor-config' },
    backends: {
      codex: (_binaryPath, env) => ({
        provider: 'codex',
        async execute(request) {
          captured.push({ factoryEnv: env, requestEnv: request.env });
          return { status: 'completed', output: 'ok', durationMs: 1 };
        },
      }),
    },
  });

  const seeded = 'OAC_TEST_DAEMON_SECRET';
  process.env[seeded] = 'daemon-secret-value';
  try {
    const sessionId = await executor.execute({
      runtimeId: 'runtime-env-scrub',
      runtime: {
        id: 'llm_env_scrub_runtime',
        provider: 'codex',
        displayName: 'Env Scrub Runtime',
        binaryPath: '/bin/codex',
        authState: 'authenticated',
        health: 'healthy',
        capabilities: ['streaming'],
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      prompt: 'hello',
      env: { REQUEST_LEVEL_TOKEN: 'request-token' },
    });
    for (let i = 0; i < 20; i += 1) {
      const session = await executor.getSession(sessionId);
      if (session?.result) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    delete process.env[seeded];
  }

  assert.equal(captured.length, 1);
  const { factoryEnv, requestEnv } = captured[0];
  assert.equal(factoryEnv[seeded], undefined, 'daemon process.env secret must not reach the backend env');
  assert.equal(factoryEnv.EXECUTOR_CFG_KEY, 'executor-config', 'executor config env is an explicit channel');
  assert.equal(factoryEnv.REQUEST_LEVEL_TOKEN, 'request-token', 'request env is an explicit channel');
  assert.ok(factoryEnv.PATH || factoryEnv.Path, 'runtime-required vars survive the scrub');
  assert.equal(requestEnv[seeded], undefined);
  assert.equal(requestEnv.REQUEST_LEVEL_TOKEN, 'request-token');
});
