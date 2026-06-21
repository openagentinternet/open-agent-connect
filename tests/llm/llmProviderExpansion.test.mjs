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
  readinessSemanticInactivityTimeoutForProvider,
  testLlmRuntimeReadiness,
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

async function withDefaultExecutablePathsDisabled(callback) {
  const originals = PLATFORM_DEFINITIONS
    .filter((platform) => platform.runtime)
    .map((platform) => [platform, [...(platform.runtime.defaultExecutablePaths ?? [])]]);
  for (const [platform] of originals) {
    platform.runtime.defaultExecutablePaths = [];
  }
  try {
    return await callback();
  } finally {
    for (const [platform, defaultExecutablePaths] of originals) {
      platform.runtime.defaultExecutablePaths = defaultExecutablePaths;
    }
  }
}

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
    'codebuddy',
    'zcode',
    'workbuddy',
  ]);
  assert.deepEqual(HOST_SEARCH_ORDER, SUPPORTED_LLM_PROVIDERS);
  assert.equal(HOST_BINARY_MAP.copilot, 'copilot');
  assert.equal(HOST_BINARY_MAP.cursor, 'cursor-agent');
  assert.equal(HOST_BINARY_MAP.kiro, 'kiro-cli');
  assert.equal(HOST_BINARY_MAP.codebuddy, 'codebuddy');
  assert.equal(HOST_BINARY_MAP.zcode, 'zcode');
  assert.equal(HOST_BINARY_MAP.workbuddy, 'codebuddy');
  assert.equal(PROVIDER_DISPLAY_NAMES.gemini, 'Gemini CLI');
  assert.equal(PROVIDER_DISPLAY_NAMES.codebuddy, 'CodeBuddy');
  assert.equal(PROVIDER_DISPLAY_NAMES.zcode, 'ZCode');
  assert.equal(PROVIDER_DISPLAY_NAMES.workbuddy, 'WorkBuddy');
  assert.deepEqual(SUPPORTED_PLATFORM_IDS, SUPPORTED_LLM_PROVIDERS);
  assert.deepEqual(getPlatformSearchOrder(), HOST_SEARCH_ORDER);
  assert.deepEqual(getPlatformBinaryMap(), HOST_BINARY_MAP);
  assert.deepEqual(getPlatformDisplayNames(), PROVIDER_DISPLAY_NAMES);

  for (const provider of [...SUPPORTED_LLM_PROVIDERS, 'custom']) {
    assert.equal(isLlmProvider(provider), true, provider);
  }
  assert.equal(isLlmProvider('unknown-provider'), false);
  assert.equal(isLlmProvider('trae'), false);
  assert.equal(isLlmProvider('codebuddy'), true);
  assert.equal(isLlmProvider('zcode'), true);
  assert.equal(isLlmProvider('workbuddy'), true);
});

test('platform registry defines managed runtime metadata and install skill roots', () => {
  assert.equal(PLATFORM_DEFINITIONS.length, 14);
  assert.deepEqual(
    PLATFORM_DEFINITIONS.map((platform) => platform.id),
    SUPPORTED_LLM_PROVIDERS,
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
  assert.equal(PLATFORM_DEFINITIONS.find((platform) => platform.id === 'codebuddy').executor.backendFactoryExport, 'codeBuddyBackendFactory');
  assert.equal(PLATFORM_DEFINITIONS.find((platform) => platform.id === 'zcode').executor.backendFactoryExport, 'zcodeBackendFactory');
  const workbuddy = PLATFORM_DEFINITIONS.find((platform) => platform.id === 'workbuddy');
  assert.equal(workbuddy.executor.backendFactoryExport, 'codeBuddyBackendFactory');
  assert.deepEqual(workbuddy.runtime.authEnv, ['WORKBUDDY_API_KEY']);
  assert.deepEqual(workbuddy.runtime.envAliases, []);
  assert.deepEqual(workbuddy.runtime.pathSearchBinaryNames, []);
  assert.ok(getInstallSkillRoots().some((root) => root.platformId === 'codex'));
  assert.ok(getInstallSkillRoots().some((root) => root.platformId === 'codebuddy' && root.path === '~/.codebuddy/skills'));
  assert.ok(getInstallSkillRoots().some((root) => root.platformId === 'zcode' && root.path === '~/.zcode/skills'));
  assert.ok(getInstallSkillRoots().some((root) => root.platformId === 'workbuddy' && root.path === '~/.workbuddy/skills'));
  assert.ok(getInstallSkillRoots().some((root) => root.platformId === 'workbuddy' && root.path === '~/.codebuddy/skills'));
  assert.ok(getInstallSkillRoots().some((root) => root.platformId === 'shared-agents'));
});

test('runtime discovery uses expanded provider metadata and environment auth checks', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-discovery-'));
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const copilotPath = path.join(binDir, 'copilot');
    const cursorPath = path.join(binDir, 'cursor-agent');
    const geminiPath = path.join(binDir, 'gemini');
    const kiroPath = path.join(binDir, 'kiro-cli');
    const opencodePath = path.join(binDir, 'opencode');
    const codeBuddyPath = path.join(binDir, 'codebuddy');
    const zcodePath = path.join(binDir, 'zcode');
    await writeFile(copilotPath, '#!/bin/sh\necho "copilot 1.2.3"\n', 'utf8');
    await writeFile(cursorPath, '#!/bin/sh\necho "cursor-agent 3.4.5"\n', 'utf8');
    await writeFile(geminiPath, '#!/bin/sh\necho "gemini 2.3.4"\n', 'utf8');
    await writeFile(kiroPath, '#!/bin/sh\necho "kiro-cli 5.6.7"\n', 'utf8');
    await writeFile(opencodePath, '#!/bin/sh\necho "opencode 0.9.1"\n', 'utf8');
    await writeFile(codeBuddyPath, '#!/bin/sh\necho "CodeBuddy 2.0.0"\n', 'utf8');
    await writeFile(zcodePath, '#!/bin/sh\necho "0.14.8"\n', 'utf8');
    await chmod(copilotPath, 0o755);
    await chmod(cursorPath, 0o755);
    await chmod(geminiPath, 0o755);
    await chmod(kiroPath, 0o755);
    await chmod(opencodePath, 0o755);
    await chmod(codeBuddyPath, 0o755);
    await chmod(zcodePath, 0o755);

    const result = await discoverLlmRuntimes({
      env: {
        PATH: binDir,
        GEMINI_API_KEY: 'test-gemini-key',
        GITHUB_TOKEN: 'test-github-token',
        OPENAI_API_KEY: 'test-openai-key',
      },
      now: () => '2026-05-06T00:00:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(
      result.runtimes.map((runtime) => runtime.provider),
      ['copilot', 'opencode', 'gemini', 'cursor', 'kiro', 'codebuddy', 'zcode'],
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

    const codebuddy = result.runtimes.find((runtime) => runtime.provider === 'codebuddy');
    assert.equal(codebuddy.binaryPath, codeBuddyPath);
    assert.equal(codebuddy.version, '2.0.0');

    const zcode = result.runtimes.find((runtime) => runtime.provider === 'zcode');
    assert.equal(zcode.binaryPath, zcodePath);
    assert.equal(zcode.version, '0.14.8');

    assert.equal(result.runtimes.some((runtime) => runtime.provider === 'workbuddy'), false);
  });
});

test('runtime discovery can use registry default executable paths for app-bundled CLIs', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-app-default-'));
  const zcodePath = path.join(tempRoot, 'ZCode.app', 'Contents', 'Resources', 'glm', 'zcode.cjs');
  const workbuddyPath = path.join(tempRoot, 'WorkBuddy.app', 'Contents', 'Resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
  await mkdir(path.dirname(zcodePath), { recursive: true });
  await mkdir(path.dirname(workbuddyPath), { recursive: true });
  await writeFile(zcodePath, '#!/bin/sh\necho "0.14.8"\n', 'utf8');
  await writeFile(workbuddyPath, '#!/bin/sh\necho "2.103.3"\n', 'utf8');
  await chmod(zcodePath, 0o755);
  await chmod(workbuddyPath, 0o755);

  const zcodePlatform = PLATFORM_DEFINITIONS.find((platform) => platform.id === 'zcode');
  const workbuddyPlatform = PLATFORM_DEFINITIONS.find((platform) => platform.id === 'workbuddy');
  const originalZCodeDefaults = [...zcodePlatform.runtime.defaultExecutablePaths];
  const originalWorkBuddyDefaults = [...workbuddyPlatform.runtime.defaultExecutablePaths];
  zcodePlatform.runtime.defaultExecutablePaths = [zcodePath];
  workbuddyPlatform.runtime.defaultExecutablePaths = [workbuddyPath];
  try {
    const result = await discoverLlmRuntimes({
      env: { PATH: '' },
      now: () => '2026-06-21T00:00:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
      shellResolvedExecutables: {},
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(
      result.runtimes.map((runtime) => runtime.provider),
      ['zcode', 'workbuddy'],
    );
    assert.equal(result.runtimes.find((runtime) => runtime.provider === 'zcode').binaryPath, zcodePath);
    assert.equal(result.runtimes.find((runtime) => runtime.provider === 'workbuddy').binaryPath, workbuddyPath);
  } finally {
    zcodePlatform.runtime.defaultExecutablePaths = originalZCodeDefaults;
    workbuddyPlatform.runtime.defaultExecutablePaths = originalWorkBuddyDefaults;
  }
});

test('runtime discovery tries multiple registry binary names in order', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
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
        readinessProbe: async () => ({ ok: true, output: 'OK' }),
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
});

test('runtime discovery honors explicit provider path environment overrides outside PATH', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-env-path-'));
    const binDir = path.join(tempRoot, 'external-bin');
    await mkdir(binDir, { recursive: true });
    const opencodePath = path.join(binDir, 'opencode');
    await writeFile(opencodePath, '#!/bin/sh\necho "opencode 0.9.1"\n', 'utf8');
    await chmod(opencodePath, 0o755);

    const result = await discoverLlmRuntimes({
      env: {
        PATH: '',
        OAC_OPENCODE_PATH: opencodePath,
        METABOT_OPENCODE_MODEL: 'opencode-default-model',
      },
      now: () => '2026-05-22T03:00:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'opencode');
    assert.equal(result.runtimes[0].binaryPath, opencodePath);
    assert.equal(result.runtimes[0].model, 'opencode-default-model');
    assert.equal(result.runtimes[0].health, 'healthy');
  });
});

test('runtime discovery keeps WorkBuddy independent from CodeBuddy path aliases', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-workbuddy-path-'));
    const binDir = path.join(tempRoot, 'external-bin');
    await mkdir(binDir, { recursive: true });
    const codebuddyPath = path.join(binDir, 'codebuddy');
    const workbuddyPath = path.join(binDir, 'workbuddy-codebuddy');
    await writeFile(codebuddyPath, '#!/bin/sh\necho "CodeBuddy 2.0.0"\n', 'utf8');
    await writeFile(workbuddyPath, '#!/bin/sh\necho "2.103.3"\n', 'utf8');
    await chmod(codebuddyPath, 0o755);
    await chmod(workbuddyPath, 0o755);

    const codeBuddyOnly = await discoverLlmRuntimes({
      env: {
        PATH: '',
        OAC_CODEBUDDY_PATH: codebuddyPath,
        OAC_CODEBUDDY_MODEL: 'codebuddy-model',
        CODEBUDDY_API_KEY: 'codebuddy-key',
      },
      now: () => '2026-06-21T03:00:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(codeBuddyOnly.errors.length, 0);
    assert.deepEqual(codeBuddyOnly.runtimes.map((runtime) => runtime.provider), ['codebuddy']);
    assert.equal(codeBuddyOnly.runtimes[0].binaryPath, codebuddyPath);
    assert.equal(codeBuddyOnly.runtimes[0].model, 'codebuddy-model');
    assert.equal(codeBuddyOnly.runtimes[0].authState, 'authenticated');

    const withWorkBuddy = await discoverLlmRuntimes({
      env: {
        PATH: '',
        OAC_CODEBUDDY_PATH: codebuddyPath,
        OAC_WORKBUDDY_PATH: workbuddyPath,
        OAC_CODEBUDDY_MODEL: 'codebuddy-model',
        OAC_WORKBUDDY_MODEL: 'workbuddy-model',
        CODEBUDDY_API_KEY: 'codebuddy-key',
        WORKBUDDY_API_KEY: 'workbuddy-key',
      },
      now: () => '2026-06-21T03:05:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(withWorkBuddy.errors.length, 0);
    assert.deepEqual(withWorkBuddy.runtimes.map((runtime) => runtime.provider), ['codebuddy', 'workbuddy']);
    assert.equal(withWorkBuddy.runtimes[0].binaryPath, codebuddyPath);
    assert.equal(withWorkBuddy.runtimes[0].model, 'codebuddy-model');
    assert.equal(withWorkBuddy.runtimes[0].authState, 'authenticated');
    assert.equal(withWorkBuddy.runtimes[1].binaryPath, workbuddyPath);
    assert.equal(withWorkBuddy.runtimes[1].model, 'workbuddy-model');
    assert.equal(withWorkBuddy.runtimes[1].authState, 'authenticated');
  });
});

test('runtime discovery uses login-shell resolved executables when daemon PATH misses a provider', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-shell-path-'));
    const binDir = path.join(tempRoot, 'login-shell-bin');
    await mkdir(binDir, { recursive: true });
    const codebuddyPath = path.join(binDir, 'codebuddy');
    await writeFile(codebuddyPath, '#!/bin/sh\necho "CodeBuddy 2.0.0"\n', 'utf8');
    await chmod(codebuddyPath, 0o755);

    const result = await discoverLlmRuntimes({
      env: { PATH: '' },
      shellResolvedExecutables: { codebuddy: codebuddyPath },
      now: () => '2026-05-22T03:30:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.runtimes.map((runtime) => runtime.provider), ['codebuddy']);
    assert.equal(result.runtimes[0].binaryPath, codebuddyPath);
    assert.equal(result.runtimes[0].health, 'healthy');
  });
});

test('runtime discovery ignores a broken PATH shadow when a later binary is healthy', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-path-shadow-'));
    const brokenBinDir = path.join(tempRoot, 'broken-bin');
    const healthyBinDir = path.join(tempRoot, 'healthy-bin');
    await mkdir(brokenBinDir, { recursive: true });
    await mkdir(healthyBinDir, { recursive: true });
    const brokenCodexPath = path.join(brokenBinDir, 'codex');
    const healthyCodexPath = path.join(healthyBinDir, 'codex');
    await writeFile(brokenCodexPath, [
      '#!/bin/sh',
      'echo "Error: spawn missing vendor codex ENOENT" >&2',
      'exit 1',
    ].join('\n'), 'utf8');
    await writeFile(healthyCodexPath, '#!/bin/sh\necho "codex-cli 0.131.0-alpha.9"\n', 'utf8');
    await chmod(brokenCodexPath, 0o755);
    await chmod(healthyCodexPath, 0o755);

    const result = await discoverLlmRuntimes({
      env: { PATH: [brokenBinDir, healthyBinDir].join(path.delimiter) },
      now: () => '2026-05-20T00:00:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'codex');
    assert.equal(result.runtimes[0].binaryPath, healthyCodexPath);
    assert.equal(result.runtimes[0].health, 'healthy');
    assert.equal(result.runtimes[0].version, '0.131.0-alpha.9');
  });
});

test('runtime discovery marks a binary unavailable when version probe exits non-zero', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-bad-version-'));
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, 'codex');
    await writeFile(codexPath, [
      '#!/bin/sh',
      'echo "Error: spawn /tmp/node/v20.20.0/lib/node_modules/@openai/codex/vendor/codex ENOENT" >&2',
      'exit 1',
    ].join('\n'), 'utf8');
    await chmod(codexPath, 0o755);

    const result = await discoverLlmRuntimes({
      env: { PATH: binDir },
      now: () => '2026-05-06T00:00:00.000Z',
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'codex');
    assert.equal(result.runtimes[0].binaryPath, codexPath);
    assert.equal(result.runtimes[0].health, 'unavailable');
    assert.equal(result.runtimes[0].version, undefined);
  });
});

test('runtime discovery marks version-only binaries as detected until readiness succeeds', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-detected-readiness-'));
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, 'codex');
    await writeFile(codexPath, '#!/bin/sh\necho "codex-cli 0.133.0"\n', 'utf8');
    await chmod(codexPath, 0o755);

    const result = await discoverLlmRuntimes({
      env: { PATH: binDir },
      now: () => '2026-05-22T00:00:00.000Z',
      readinessProbe: async () => ({ ok: false, message: 'readiness prompt returned no output' }),
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'codex');
    assert.equal(result.runtimes[0].binaryPath, codexPath);
    assert.equal(result.runtimes[0].version, '0.133.0');
    assert.equal(result.runtimes[0].health, 'detected');
    assert.equal(result.runtimes[0].healthReason, 'readiness prompt returned no output');
    assert.equal(result.runtimes[0].healthCheckedAt, '2026-05-22T00:00:00.000Z');
  });
});

test('runtime discovery marks binaries healthy only after readiness returns non-empty output', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-healthy-readiness-'));
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const geminiPath = path.join(binDir, 'gemini');
    await writeFile(geminiPath, '#!/bin/sh\necho "gemini 0.40.1"\n', 'utf8');
    await chmod(geminiPath, 0o755);

    const result = await discoverLlmRuntimes({
      env: { PATH: binDir },
      now: () => '2026-05-22T01:00:00.000Z',
      readinessProbe: async ({ runtime }) => {
        assert.equal(runtime.provider, 'gemini');
        assert.equal(runtime.health, 'detected');
        return { ok: true, output: 'OK' };
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'gemini');
    assert.equal(result.runtimes[0].binaryPath, geminiPath);
    assert.equal(result.runtimes[0].health, 'healthy');
    assert.equal(result.runtimes[0].healthReason, undefined);
    assert.equal(result.runtimes[0].healthCheckedAt, '2026-05-22T01:00:00.000Z');
  });
});

test('runtime discovery gives slow-start providers an extended readiness window', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-readiness-timeout-'));
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const cursorPath = path.join(binDir, 'cursor-agent');
    await writeFile(cursorPath, '#!/bin/sh\necho "cursor-agent 2026.05.16"\n', 'utf8');
    await chmod(cursorPath, 0o755);

    let observedTimeoutMs = 0;
    const result = await discoverLlmRuntimes({
      env: { PATH: binDir },
      now: () => '2026-05-22T04:00:00.000Z',
      readinessProbe: async ({ timeoutMs }) => {
        observedTimeoutMs = timeoutMs;
        return { ok: true, output: 'OK' };
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'cursor');
    assert.equal(result.runtimes[0].health, 'healthy');
    assert.equal(observedTimeoutMs, 45_000);
  });
});

test('runtime discovery uses the full readiness window as semantic inactivity for slow-start providers', () => {
  assert.equal(readinessSemanticInactivityTimeoutForProvider('codex', 45_000), 45_000);
  assert.equal(readinessSemanticInactivityTimeoutForProvider('cursor', 45_000), 45_000);
  assert.equal(readinessSemanticInactivityTimeoutForProvider('claude-code', 45_000), 45_000);
  assert.equal(readinessSemanticInactivityTimeoutForProvider('zcode', 45_000), 45_000);
  assert.equal(readinessSemanticInactivityTimeoutForProvider('openclaw', 30_000), 15_000);
});

test('runtime discovery keeps scanning when an earlier binary is only detected', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'oac-provider-readiness-fallback-'));
    const detectedBinDir = path.join(tempRoot, 'detected-bin');
    const healthyBinDir = path.join(tempRoot, 'healthy-bin');
    await mkdir(detectedBinDir, { recursive: true });
    await mkdir(healthyBinDir, { recursive: true });
    const detectedCodexPath = path.join(detectedBinDir, 'codex');
    const healthyCodexPath = path.join(healthyBinDir, 'codex');
    await writeFile(detectedCodexPath, '#!/bin/sh\necho "codex-cli 0.133.0"\n', 'utf8');
    await writeFile(healthyCodexPath, '#!/bin/sh\necho "codex-cli 0.133.1"\n', 'utf8');
    await chmod(detectedCodexPath, 0o755);
    await chmod(healthyCodexPath, 0o755);

    const result = await discoverLlmRuntimes({
      env: { PATH: [detectedBinDir, healthyBinDir].join(path.delimiter) },
      now: () => '2026-05-22T02:00:00.000Z',
      readinessProbe: async ({ runtime }) => (
        runtime.binaryPath === healthyCodexPath
          ? { ok: true, output: 'OK' }
          : { ok: false, message: 'first binary could not answer' }
      ),
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'codex');
    assert.equal(result.runtimes[0].binaryPath, healthyCodexPath);
    assert.equal(result.runtimes[0].health, 'healthy');
    assert.equal(result.runtimes[0].version, '0.133.1');
  });
});

function testRuntimeFixture(overrides = {}) {
  const now = '2026-05-22T05:00:00.000Z';
  return {
    id: 'llm_codex_test',
    provider: 'codex',
    displayName: 'Codex',
    binaryPath: overrides.binaryPath ?? '/tmp/codex',
    version: '0.132.0',
    logoPath: '/ui/assets/platforms/codex.svg',
    authState: 'authenticated',
    health: 'detected',
    model: 'gpt-5.5-codex',
    capabilities: ['streaming'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function writeVersionProbeBin(rootPrefix, body) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), rootPrefix));
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const codexPath = path.join(binDir, 'codex');
  await writeFile(codexPath, body, 'utf8');
  await chmod(codexPath, 0o755);
  return codexPath;
}

test('testLlmRuntimeReadiness returns healthy when version and readiness succeed', async () => {
  const codexPath = await writeVersionProbeBin(
    'oac-runtime-test-healthy-',
    '#!/bin/sh\necho "codex-cli 0.133.1"\n',
  );

  const result = await testLlmRuntimeReadiness(testRuntimeFixture({ binaryPath: codexPath }), {
    env: { PATH: path.dirname(codexPath) },
    now: () => '2026-05-22T06:00:00.000Z',
    readinessProbe: async ({ runtime }) => {
      assert.equal(runtime.binaryPath, codexPath);
      assert.equal(runtime.health, 'detected');
      return { ok: true, output: 'OK' };
    },
  });

  assert.equal(result.health, 'healthy');
  assert.equal(result.healthReason, undefined);
  assert.equal(result.version, '0.133.1');
  assert.equal(result.model, 'gpt-5.5-codex');
  assert.equal(result.lastSeenAt, '2026-05-22T06:00:00.000Z');
  assert.equal(result.healthCheckedAt, '2026-05-22T06:00:00.000Z');
});

test('testLlmRuntimeReadiness returns detected when readiness output is empty', async () => {
  const codexPath = await writeVersionProbeBin(
    'oac-runtime-test-detected-',
    '#!/bin/sh\necho "codex-cli 0.133.2"\n',
  );

  const result = await testLlmRuntimeReadiness(testRuntimeFixture({ binaryPath: codexPath }), {
    env: { PATH: path.dirname(codexPath) },
    now: () => '2026-05-22T06:05:00.000Z',
    readinessProbe: async () => ({ ok: true, output: '   ' }),
  });

  assert.equal(result.health, 'detected');
  assert.equal(result.healthReason, 'Readiness probe completed without returning output.');
  assert.equal(result.version, '0.133.2');
  assert.equal(result.healthCheckedAt, '2026-05-22T06:05:00.000Z');
});

test('testLlmRuntimeReadiness returns unavailable when version probing fails', async () => {
  const codexPath = await writeVersionProbeBin(
    'oac-runtime-test-unavailable-',
    '#!/bin/sh\necho "permission denied" >&2\nexit 2\n',
  );
  let readinessCalled = false;

  const result = await testLlmRuntimeReadiness(testRuntimeFixture({ binaryPath: codexPath }), {
    env: { PATH: path.dirname(codexPath) },
    now: () => '2026-05-22T06:10:00.000Z',
    readinessProbe: async () => {
      readinessCalled = true;
      return { ok: true, output: 'OK' };
    },
  });

  assert.equal(result.health, 'unavailable');
  assert.match(result.healthReason, /permission denied|Version probe exited/);
  assert.equal(result.healthCheckedAt, '2026-05-22T06:10:00.000Z');
  assert.equal(readinessCalled, false);
});
