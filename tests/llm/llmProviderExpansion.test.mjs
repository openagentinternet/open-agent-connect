import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  HOST_BINARY_MAP,
  HOST_SEARCH_ORDER,
  PROVIDER_DISPLAY_NAMES,
  SUPPORTED_LLM_PROVIDERS,
  isLlmProvider,
} = require('../../dist/core/llm/llmTypes.js');
const {
  discoverLlmRuntimes,
} = require('../../dist/core/llm/llmRuntimeDiscovery.js');

test('supported provider metadata includes all managed host providers and custom guard compatibility', () => {
  assert.deepEqual(SUPPORTED_LLM_PROVIDERS, [
    'claude-code',
    'codex',
    'copilot',
    'opencode',
    'openclaw',
    'hermes',
    'gemini',
    'pi',
    'cursor',
    'kimi',
    'kiro',
  ]);
  assert.deepEqual(HOST_SEARCH_ORDER, SUPPORTED_LLM_PROVIDERS);
  assert.equal(HOST_BINARY_MAP.copilot, 'gh');
  assert.equal(HOST_BINARY_MAP.cursor, 'cursor-agent');
  assert.equal(HOST_BINARY_MAP.kiro, 'kiro-cli');
  assert.equal(PROVIDER_DISPLAY_NAMES.gemini, 'Gemini CLI');

  for (const provider of [...SUPPORTED_LLM_PROVIDERS, 'custom']) {
    assert.equal(isLlmProvider(provider), true, provider);
  }
  assert.equal(isLlmProvider('unknown-provider'), false);
});

test('runtime discovery uses expanded provider metadata and environment auth checks', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-discovery-'));
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const geminiPath = path.join(binDir, 'gemini');
  const opencodePath = path.join(binDir, 'opencode');
  await writeFile(geminiPath, '#!/bin/sh\necho "gemini 2.3.4"\n', 'utf8');
  await writeFile(opencodePath, '#!/bin/sh\necho "opencode 0.9.1"\n', 'utf8');
  await chmod(geminiPath, 0o755);
  await chmod(opencodePath, 0o755);

  const result = await discoverLlmRuntimes({
    env: {
      PATH: binDir,
      GEMINI_API_KEY: 'test-gemini-key',
      OPENAI_API_KEY: 'test-openai-key',
    },
    now: () => '2026-05-06T00:00:00.000Z',
  });

  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.runtimes.map((runtime) => runtime.provider),
    ['opencode', 'gemini'],
  );

  const gemini = result.runtimes.find((runtime) => runtime.provider === 'gemini');
  assert.equal(gemini.displayName, 'Gemini CLI');
  assert.equal(gemini.binaryPath, geminiPath);
  assert.equal(gemini.version, '2.3.4');
  assert.equal(gemini.authState, 'authenticated');
  assert.equal(gemini.health, 'healthy');

  const opencode = result.runtimes.find((runtime) => runtime.provider === 'opencode');
  assert.equal(opencode.displayName, 'OpenCode');
  assert.equal(opencode.authState, 'authenticated');
});
