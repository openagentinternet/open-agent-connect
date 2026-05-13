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
const {
  PLATFORM_DEFINITIONS,
  SUPPORTED_PLATFORM_IDS,
  getInstallSkillRoots,
  getPlatformBinaryMap,
  getPlatformDisplayNames,
  getPlatformSearchOrder,
  getRuntimePlatforms,
} = require('../../dist/core/platform/platformRegistry.js');

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
  assert.equal(HOST_BINARY_MAP.copilot, 'copilot');
  assert.equal(HOST_BINARY_MAP.cursor, 'cursor-agent');
  assert.equal(HOST_BINARY_MAP.kiro, 'kiro-cli');
  assert.equal(HOST_BINARY_MAP.codebuddy, undefined);
  assert.equal(PROVIDER_DISPLAY_NAMES.gemini, 'Gemini CLI');
  assert.deepEqual(SUPPORTED_PLATFORM_IDS, [...SUPPORTED_LLM_PROVIDERS, 'trae', 'codebuddy']);
  assert.deepEqual(getPlatformSearchOrder(), HOST_SEARCH_ORDER);
  assert.deepEqual(getPlatformBinaryMap(), HOST_BINARY_MAP);
  assert.deepEqual(getPlatformDisplayNames(), PROVIDER_DISPLAY_NAMES);

  for (const provider of [...SUPPORTED_LLM_PROVIDERS, 'custom']) {
    assert.equal(isLlmProvider(provider), true, provider);
  }
  assert.equal(isLlmProvider('unknown-provider'), false);
  assert.equal(isLlmProvider('trae'), false);
  assert.equal(isLlmProvider('codebuddy'), false);
});

test('platform registry defines managed runtime metadata and install skill roots', () => {
  assert.equal(PLATFORM_DEFINITIONS.length, 13);
  assert.deepEqual(
    PLATFORM_DEFINITIONS.map((platform) => platform.id),
    [...SUPPORTED_LLM_PROVIDERS, 'trae', 'codebuddy'],
  );
  assert.equal(PLATFORM_DEFINITIONS[0].id, 'claude-code');

  for (const platform of PLATFORM_DEFINITIONS) {
    assert.equal(typeof platform.displayName, 'string', platform.id);
    assert.ok(platform.displayName, platform.id);
    assert.match(platform.logoPath, /^\/ui\/assets\/platforms\/.+\.(svg|png|webp|jpg|jpeg)$/);
    if (platform.runtime) {
      assert.ok(Array.isArray(platform.runtime.binaryNames), platform.id);
      assert.ok(platform.runtime.binaryNames.length >= 1, platform.id);
      assert.ok(Array.isArray(platform.runtime.capabilities), platform.id);
      assert.ok(platform.runtime.capabilities.length >= 1, platform.id);
      assert.ok(platform.executor.kind, platform.id);
      assert.ok(platform.executor.backendFactoryExport, platform.id);
      assert.ok(platform.executor.launchCommand, platform.id);
      assert.match(platform.executor.multicaReferencePath, /^agent\/.+\.go$/);
    } else {
      assert.equal(platform.executor, undefined, platform.id);
    }
    assert.ok(Array.isArray(platform.skills.roots), platform.id);
    assert.ok(platform.skills.roots.length >= 1, platform.id);
  }

  assert.deepEqual(getRuntimePlatforms().map((platform) => platform.id), SUPPORTED_LLM_PROVIDERS);
  assert.equal(PLATFORM_DEFINITIONS.find((platform) => platform.id === 'trae').executor, undefined);
  assert.equal(PLATFORM_DEFINITIONS.find((platform) => platform.id === 'codebuddy').executor, undefined);
  assert.ok(getInstallSkillRoots().some((root) => root.platformId === 'codex'));
  assert.ok(getInstallSkillRoots().some((root) => root.platformId === 'trae' && root.path === '~/.trae/skills'));
  assert.ok(getInstallSkillRoots().some((root) => root.platformId === 'codebuddy' && root.path === '~/.codebuddy/skills'));
  assert.ok(getInstallSkillRoots().some((root) => root.platformId === 'shared-agents'));
});

test('runtime discovery uses expanded provider metadata and environment auth checks', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-discovery-'));
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const copilotPath = path.join(binDir, 'copilot');
  const cursorPath = path.join(binDir, 'cursor-agent');
  const geminiPath = path.join(binDir, 'gemini');
  const kiroPath = path.join(binDir, 'kiro-cli');
  const opencodePath = path.join(binDir, 'opencode');
  await writeFile(copilotPath, '#!/bin/sh\necho "copilot 1.2.3"\n', 'utf8');
  await writeFile(cursorPath, '#!/bin/sh\necho "cursor-agent 3.4.5"\n', 'utf8');
  await writeFile(geminiPath, '#!/bin/sh\necho "gemini 2.3.4"\n', 'utf8');
  await writeFile(kiroPath, '#!/bin/sh\necho "kiro-cli 5.6.7"\n', 'utf8');
  await writeFile(opencodePath, '#!/bin/sh\necho "opencode 0.9.1"\n', 'utf8');
  await chmod(copilotPath, 0o755);
  await chmod(cursorPath, 0o755);
  await chmod(geminiPath, 0o755);
  await chmod(kiroPath, 0o755);
  await chmod(opencodePath, 0o755);

  const result = await discoverLlmRuntimes({
    env: {
      PATH: binDir,
      GEMINI_API_KEY: 'test-gemini-key',
      GITHUB_TOKEN: 'test-github-token',
      OPENAI_API_KEY: 'test-openai-key',
    },
    now: () => '2026-05-06T00:00:00.000Z',
  });

  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.runtimes.map((runtime) => runtime.provider),
    ['copilot', 'opencode', 'gemini', 'cursor', 'kiro'],
  );

  for (const runtime of result.runtimes) {
    assert.ok(runtime.displayName);
    assert.match(runtime.logoPath, /^\/ui\/assets\/platforms\/.+\.svg$/);
    assert.ok(Array.isArray(runtime.capabilities));
    assert.ok(runtime.capabilities.length >= 1);
    assert.ok(runtime.version);
    assert.ok(['unknown', 'authenticated', 'unauthenticated'].includes(runtime.authState));
  }

  const gemini = result.runtimes.find((runtime) => runtime.provider === 'gemini');
  assert.equal(gemini.displayName, 'Gemini CLI');
  assert.equal(gemini.binaryPath, geminiPath);
  assert.equal(gemini.version, '2.3.4');
  assert.equal(gemini.authState, 'authenticated');
  assert.equal(gemini.health, 'healthy');

  const opencode = result.runtimes.find((runtime) => runtime.provider === 'opencode');
  assert.equal(opencode.displayName, 'OpenCode');
  assert.equal(opencode.authState, 'authenticated');

  const copilot = result.runtimes.find((runtime) => runtime.provider === 'copilot');
  assert.equal(copilot.binaryPath, copilotPath);
  assert.equal(copilot.authState, 'authenticated');

  const cursor = result.runtimes.find((runtime) => runtime.provider === 'cursor');
  assert.equal(cursor.binaryPath, cursorPath);

  const kiro = result.runtimes.find((runtime) => runtime.provider === 'kiro');
  assert.equal(kiro.binaryPath, kiroPath);
});

test('runtime discovery tries multiple registry binary names in order', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-binary-fallback-'));
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const fallbackPath = path.join(binDir, 'codex-fallback');
  await writeFile(fallbackPath, '#!/bin/sh\necho "codex-fallback 9.8.7"\n', 'utf8');
  await chmod(fallbackPath, 0o755);

  const codexPlatform = PLATFORM_DEFINITIONS.find((platform) => platform.id === 'codex');
  const originalBinaryNames = [...codexPlatform.runtime.binaryNames];
  codexPlatform.runtime.binaryNames = ['missing-codex-primary', 'codex-fallback'];
  try {
    const runtime = await discoverLlmRuntimes({
      env: { PATH: binDir },
      now: () => '2026-05-06T00:00:00.000Z',
    });

    assert.deepEqual(
      runtime.runtimes.map((entry) => entry.provider),
      ['codex'],
    );
    assert.equal(runtime.runtimes[0].binaryPath, fallbackPath);
    assert.equal(runtime.runtimes[0].version, '9.8.7');
  } finally {
    codexPlatform.runtime.binaryNames = originalBinaryNames;
  }
});
