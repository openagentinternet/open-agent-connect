import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

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
  probeExecutableVersion,
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
  getPlatformSkillRoots,
  getRuntimePlatforms,
  resolvePlatformSkillRootPath,
} = require('../../dist/core/platform/platformRegistry.js');
const { resolveProviderProcessEnv } = require('../../dist/core/llm/providerProcessEnv.js');

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

async function reserveThenCloseLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
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
  assert.deepEqual(PLATFORM_DEFINITIONS.find((platform) => platform.id === 'gemini').runtime.authEnv, [
    'GEMINI_API_KEY',
    'GOOGLE_GENAI_USE_VERTEXAI',
    'GOOGLE_GENAI_USE_GCA',
  ]);
  assert.equal(PLATFORM_DEFINITIONS.find((platform) => platform.id === 'codebuddy').executor.backendFactoryExport, 'codeBuddyBackendFactory');
  assert.equal(PLATFORM_DEFINITIONS.find((platform) => platform.id === 'zcode').executor.backendFactoryExport, 'zcodeBackendFactory');
  assert.equal(PLATFORM_DEFINITIONS.find((platform) => platform.id === 'openclaw').runtime.nodeRuntime.minimumVersion, '22.14.0');
  assert.equal(PLATFORM_DEFINITIONS.find((platform) => platform.id === 'zcode').runtime.nodeRuntime.minimumVersion, '22.5.0');
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

test('kimi platform exposes a Kimi Work Desktop skill root with cross-platform paths', () => {
  const kimiRoots = getPlatformSkillRoots('kimi');
  const workDesktopRoot = kimiRoots.find((root) => root.id === 'kimi-work-desktop');
  assert.ok(workDesktopRoot, 'kimi platform should declare a kimi-work-desktop root');
  assert.equal(workDesktopRoot.kind, 'global');
  assert.equal(workDesktopRoot.autoBind, 'when-parent-exists');
  assert.equal(
    workDesktopRoot.path,
    '~/Library/Application Support/kimi-desktop/daimon-share/daimon/skills',
  );
  assert.equal(
    workDesktopRoot.windowsPath,
    '~/AppData/Roaming/kimi-desktop/daimon-share/daimon/skills',
  );
  assert.ok(
    getInstallSkillRoots().some((root) => root.platformId === 'kimi' && root.id === 'kimi-work-desktop'),
    'kimi-work-desktop root should be part of the install skill roots',
  );
});

test('resolvePlatformSkillRootPath resolves Kimi Work Desktop under %APPDATA% on win32', () => {
  const root = getPlatformSkillRoots('kimi').find((candidate) => candidate.id === 'kimi-work-desktop');
  const originalPlatform = process.platform;
  const fakeSystemHome = '/Users/tester';
  const appData = 'C:\\Users\\tester\\AppData\\Roaming';

  try {
    // Non-win32: macOS path is resolved under the system home dir.
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const macOSPath = resolvePlatformSkillRootPath(root, fakeSystemHome, {});
    assert.equal(
      macOSPath,
      path.resolve(fakeSystemHome, 'Library/Application Support/kimi-desktop/daimon-share/daimon/skills'),
    );

    // win32: windowsPath is resolved against %APPDATA% when set.
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const windowsPath = resolvePlatformSkillRootPath(root, fakeSystemHome, { APPDATA: appData });
    assert.equal(
      windowsPath,
      path.resolve(appData, 'kimi-desktop/daimon-share/daimon/skills'),
    );

    // win32 without %APPDATA%: falls back to the home-relative POSIX path.
    const windowsFallback = resolvePlatformSkillRootPath(root, fakeSystemHome, {});
    assert.equal(
      windowsFallback,
      path.resolve(fakeSystemHome, 'AppData/Roaming/kimi-desktop/daimon-share/daimon/skills'),
    );
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }
});

test('platform registry assigns provider-specific LLM icons for every managed runtime', () => {
  assert.deepEqual(
    Object.fromEntries(PLATFORM_DEFINITIONS.map((platform) => [platform.id, platform.logoPath])),
    {
      'claude-code': '/ui/assets/platforms/claude-code.svg',
      codex: '/ui/assets/platforms/codex.svg',
      copilot: '/ui/assets/platforms/copilot.svg',
      opencode: '/ui/assets/platforms/opencode.svg',
      openclaw: '/ui/assets/platforms/openclaw.svg',
      hermes: '/ui/assets/platforms/hermes.svg',
      gemini: '/ui/assets/platforms/gemini.svg',
      pi: '/ui/assets/platforms/pi.svg',
      cursor: '/ui/assets/platforms/cursor.svg',
      kimi: '/ui/assets/platforms/kimi.svg',
      kiro: '/ui/assets/platforms/kiro.svg',
      codebuddy: '/ui/assets/platforms/codebuddy.svg',
      zcode: '/ui/assets/platforms/zcode.svg',
      workbuddy: '/ui/assets/platforms/codebuddy.svg',
    },
  );

  for (const platform of PLATFORM_DEFINITIONS) {
    assert.notEqual(platform.logoPath, '/ui/assets/platforms/generic.svg', platform.id);
    assert.equal(
      existsSync(path.resolve(process.cwd(), 'src', platform.logoPath.replace(/^\/ui\//, 'ui/'))),
      true,
      platform.id,
    );
  }
});

test('runtime discovery uses expanded provider metadata and environment auth checks', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-discovery-');
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
  const tempRoot = await mkdtempTempRoot('oac-provider-app-default-');
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
    const tempRoot = await mkdtempTempRoot('oac-provider-binary-fallback-');
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
    const tempRoot = await mkdtempTempRoot('oac-provider-env-path-');
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
    const tempRoot = await mkdtempTempRoot('oac-provider-workbuddy-path-');
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

test('runtime discovery limits a requested host probe to that host provider', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-targeted-discovery-');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, 'codex');
    const claudePath = path.join(binDir, 'claude');
    await writeFile(codexPath, '#!/bin/sh\necho "codex 1.0.0"\n', 'utf8');
    await writeFile(claudePath, '#!/bin/sh\necho "claude 1.0.0"\n', 'utf8');
    await chmod(codexPath, 0o755);
    await chmod(claudePath, 0o755);

    const result = await discoverLlmRuntimes({
      env: { PATH: binDir },
      providers: ['codex'],
      now: () => '2026-07-18T00:00:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.runtimes.map((runtime) => runtime.provider), ['codex']);
  });
});

test('runtime discovery uses login-shell resolved executables when daemon PATH misses a provider', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-shell-path-');
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
    const tempRoot = await mkdtempTempRoot('oac-provider-path-shadow-');
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

test('Node-shebang providers use a compatible Node later in PATH', async () => {
  const tempRoot = await mkdtempTempRoot('oac-provider-node-runtime-');
  const oldBinDir = path.join(tempRoot, 'node-20', 'bin');
  const compatibleBinDir = path.join(tempRoot, 'node-24', 'bin');
  const providerDir = path.join(tempRoot, 'provider');
  await mkdir(oldBinDir, { recursive: true });
  await mkdir(compatibleBinDir, { recursive: true });
  await mkdir(providerDir, { recursive: true });

  const oldNodePath = path.join(oldBinDir, 'node');
  const compatibleNodePath = path.join(compatibleBinDir, 'node');
  const zcodePath = path.join(providerDir, 'zcode.cjs');
  await writeFile(oldNodePath, '#!/bin/sh\necho v20.20.0\n', 'utf8');
  await writeFile(compatibleNodePath, '#!/bin/sh\necho v24.13.1\n', 'utf8');
  await writeFile(zcodePath, '#!/usr/bin/env node\nconsole.log("zcode 0.15.2")\n', 'utf8');
  await chmod(oldNodePath, 0o755);
  await chmod(compatibleNodePath, 0o755);
  await chmod(zcodePath, 0o755);

  const resolution = await resolveProviderProcessEnv('zcode', zcodePath, {
    PATH: [oldBinDir, compatibleBinDir].join(path.delimiter),
  });

  assert.equal(resolution.error, undefined);
  assert.equal(resolution.nodePath, compatibleNodePath);
  assert.equal(resolution.env.PATH.split(path.delimiter)[0], compatibleBinDir);
});

test('provider process env neutralizes refused numeric loopback proxies and preserves other proxies', async () => {
  const refusedPort = await reserveThenCloseLoopbackPort();
  const refusedProxy = `http://127.0.0.1:${refusedPort}`;
  const remoteProxy = 'http://proxy.example.test:8080';
  const ambiguousLocalhostProxy = `http://localhost:${refusedPort}`;

  const resolution = await resolveProviderProcessEnv('cursor', '/bin/sh', {
    HTTP_PROXY: refusedProxy,
    HTTPS_PROXY: refusedProxy,
    http_proxy: refusedProxy,
    https_proxy: refusedProxy,
    ALL_PROXY: remoteProxy,
    all_proxy: ambiguousLocalhostProxy,
  });

  assert.equal(resolution.error, undefined);
  assert.equal(resolution.env.HTTP_PROXY, '');
  assert.equal(resolution.env.HTTPS_PROXY, '');
  assert.equal(resolution.env.http_proxy, '');
  assert.equal(resolution.env.https_proxy, '');
  assert.equal(resolution.env.ALL_PROXY, remoteProxy);
  assert.equal(resolution.env.all_proxy, ambiguousLocalhostProxy);
});

test('provider process env preserves a reachable numeric loopback proxy', async (t) => {
  const server = createServer();
  t.after(() => {
    if (server.listening) server.close();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const reachableProxy = `http://127.0.0.1:${address.port}`;

  const resolution = await resolveProviderProcessEnv('cursor', '/bin/sh', {
    HTTP_PROXY: reachableProxy,
    HTTPS_PROXY: reachableProxy,
  });

  assert.equal(resolution.error, undefined);
  assert.equal(resolution.env.HTTP_PROXY, reachableProxy);
  assert.equal(resolution.env.HTTPS_PROXY, reachableProxy);
});

test('Cursor readiness succeeds when the daemon inherited a refused loopback proxy', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-cursor-refused-proxy-');
    const cursorPath = path.join(tempRoot, 'cursor-agent');
    const refusedPort = await reserveThenCloseLoopbackPort();
    const refusedProxy = `http://127.0.0.1:${refusedPort}`;
    await writeFile(cursorPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "cursor-agent 2026.07.23"
  exit 0
fi
if [ -n "$HTTP_PROXY$HTTPS_PROXY$ALL_PROXY$http_proxy$https_proxy$all_proxy" ]; then
  echo "Error: [unavailable] connect ECONNREFUSED 127.0.0.1:${refusedPort}" >&2
  exit 1
fi
echo '{"type":"result","result":"OK"}'
`, 'utf8');
    await chmod(cursorPath, 0o755);

    const result = await discoverLlmRuntimes({
      env: {
        PATH: tempRoot,
        OAC_CURSOR_PATH: cursorPath,
        HTTP_PROXY: refusedProxy,
        HTTPS_PROXY: refusedProxy,
        ALL_PROXY: refusedProxy,
        http_proxy: refusedProxy,
        https_proxy: refusedProxy,
        all_proxy: refusedProxy,
      },
      providers: ['cursor'],
      readinessTimeoutMs: 1_000,
      now: () => '2026-07-31T00:00:00.000Z',
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'cursor');
    assert.equal(result.runtimes[0].health, 'healthy');
    assert.equal(result.runtimes[0].healthReason, undefined);
  });
});

test('runtime discovery reports a clear error when a Node-shebang provider has no compatible Node', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-node-runtime-missing-');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const nodePath = path.join(binDir, 'node');
    const zcodePath = path.join(binDir, 'zcode');
    await writeFile(nodePath, '#!/bin/sh\necho v20.20.0\n', 'utf8');
    await writeFile(zcodePath, '#!/usr/bin/env node\nconsole.log("zcode 0.15.2")\n', 'utf8');
    await chmod(nodePath, 0o755);
    await chmod(zcodePath, 0o755);

    const zcode = PLATFORM_DEFINITIONS.find((platform) => platform.id === 'zcode');
    const originalMinimumVersion = zcode.runtime.nodeRuntime.minimumVersion;
    let result;
    try {
      zcode.runtime.nodeRuntime.minimumVersion = '99.0.0';
      result = await discoverLlmRuntimes({
        providers: ['zcode'],
        env: { PATH: binDir, OAC_NODE_PATH: nodePath },
        shellResolvedExecutables: {},
      });
    } finally {
      zcode.runtime.nodeRuntime.minimumVersion = originalMinimumVersion;
    }

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'zcode');
    assert.equal(result.runtimes[0].health, 'unavailable');
    assert.match(result.runtimes[0].healthReason, /requires Node\.js >=99\.0\.0/);
    assert.match(result.runtimes[0].healthReason, /v20\.20\.0/);
  });
});

test('runtime discovery marks a binary unavailable when version probe exits non-zero', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-bad-version-');
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
    const tempRoot = await mkdtempTempRoot('oac-provider-detected-readiness-');
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
    const tempRoot = await mkdtempTempRoot('oac-provider-healthy-readiness-');
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
    const tempRoot = await mkdtempTempRoot('oac-provider-readiness-timeout-');
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

test('runtime discovery probes different providers concurrently', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-concurrent-');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, 'codex');
    const opencodePath = path.join(binDir, 'opencode');
    await writeFile(codexPath, '#!/bin/sh\necho "codex-cli 0.133.0"\n', 'utf8');
    await writeFile(opencodePath, '#!/bin/sh\necho "opencode 0.9.1"\n', 'utf8');
    await chmod(codexPath, 0o755);
    await chmod(opencodePath, 0o755);

    let readinessProbeStarts = 0;
    let firstProbeObservedOverlap = false;
    let notifySecondProbeStarted;
    const secondProbeStarted = new Promise((resolve) => {
      notifySecondProbeStarted = resolve;
    });
    const result = await discoverLlmRuntimes({
      env: { PATH: binDir },
      now: () => '2026-05-22T04:02:00.000Z',
      readinessProbe: async () => {
        readinessProbeStarts += 1;
        if (readinessProbeStarts === 1) {
          firstProbeObservedOverlap = await Promise.race([
            secondProbeStarted.then(() => true),
            new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
          ]);
        } else {
          notifySecondProbeStarted();
        }
        return { ok: true, output: 'OK' };
      },
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.runtimes.map((runtime) => runtime.provider), ['codex', 'opencode']);
    assert.equal(firstProbeObservedOverlap, true);
  });
});

test('runtime discovery skips readiness for recently healthy known runtimes', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-known-healthy-');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, 'codex');
    await writeFile(codexPath, '#!/bin/sh\necho "codex-cli 0.133.0"\n', 'utf8');
    await chmod(codexPath, 0o755);

    let readinessCalled = false;
    const result = await discoverLlmRuntimes({
      env: { PATH: binDir },
      now: () => '2026-05-22T04:20:00.000Z',
      knownRuntimes: [
        testRuntimeFixture({
          id: `llm_codex_${codexPath}`,
          binaryPath: codexPath,
          health: 'healthy',
          healthCheckedAt: '2026-05-22T04:10:00.000Z',
          updatedAt: '2026-05-22T04:10:00.000Z',
        }),
      ],
      readinessProbe: async () => {
        readinessCalled = true;
        return { ok: true, output: 'OK' };
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'codex');
    assert.equal(result.runtimes[0].health, 'healthy');
    assert.equal(result.runtimes[0].healthCheckedAt, '2026-05-22T04:10:00.000Z');
    assert.equal(readinessCalled, false);
  });
});

test('runtime discovery lets slow Cursor version probes complete before readiness', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-version-timeout-');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const cursorPath = path.join(binDir, 'cursor-agent');
    await writeFile(cursorPath, '#!/bin/sh\n/bin/sleep 6\necho "cursor-agent 2026.06.19"\n', 'utf8');
    await chmod(cursorPath, 0o755);

    let readinessCalled = false;
    const result = await discoverLlmRuntimes({
      env: { PATH: binDir },
      now: () => '2026-05-22T04:05:00.000Z',
      readinessProbe: async () => {
        readinessCalled = true;
        return { ok: true, output: 'OK' };
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'cursor');
    assert.equal(result.runtimes[0].version, '2026.06.19');
    assert.equal(result.runtimes[0].health, 'healthy');
    assert.equal(readinessCalled, true);
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
    const tempRoot = await mkdtempTempRoot('oac-provider-readiness-fallback-');
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
  const tempRoot = await mkdtempTempRoot(rootPrefix);
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


test('platform registry carries probe hints for slow-start providers', () => {
  const hints = Object.fromEntries(
    PLATFORM_DEFINITIONS.map((platform) => [platform.id, platform.runtime?.probeHints]),
  );
  assert.deepEqual(hints.codex, { readinessTimeoutMs: 45_000, semanticInactivityTimeoutMs: 45_000 });
  assert.deepEqual(hints.cursor, { readinessTimeoutMs: 45_000, versionProbeTimeoutMs: 20_000, semanticInactivityTimeoutMs: 45_000 });
  assert.deepEqual(hints['claude-code'], { readinessTimeoutMs: 45_000, semanticInactivityTimeoutMs: 45_000 });
  assert.deepEqual(hints.zcode, { readinessTimeoutMs: 45_000, semanticInactivityTimeoutMs: 45_000 });
  assert.deepEqual(hints.workbuddy, { readinessTimeoutMs: 45_000, versionProbeTimeoutMs: 20_000, semanticInactivityTimeoutMs: 45_000 });
  assert.equal(hints.opencode, undefined);
});

test('runtime discovery resolves probe timeouts from registry probe hints', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-probe-hints-');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const workbuddyPath = path.join(binDir, 'workbuddy-cli');
    const openclawPath = path.join(binDir, 'openclaw');
    await writeFile(workbuddyPath, '#!/bin/sh\necho "2.103.3"\n', 'utf8');
    await writeFile(openclawPath, '#!/bin/sh\necho "openclaw 1.2.3"\n', 'utf8');
    await chmod(workbuddyPath, 0o755);
    await chmod(openclawPath, 0o755);

    const observedTimeouts = {};
    const result = await discoverLlmRuntimes({
      env: { PATH: binDir, OAC_WORKBUDDY_PATH: workbuddyPath },
      providers: ['workbuddy', 'openclaw'],
      now: () => '2026-07-23T00:00:00.000Z',
      readinessProbe: async ({ runtime, timeoutMs }) => {
        observedTimeouts[runtime.provider] = timeoutMs;
        return { ok: true, output: 'OK' };
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(observedTimeouts.workbuddy, 45_000);
    assert.equal(observedTimeouts.openclaw, 30_000);
    assert.equal(readinessSemanticInactivityTimeoutForProvider('workbuddy', 45_000), 45_000);
    assert.equal(readinessSemanticInactivityTimeoutForProvider('openclaw', 30_000), 15_000);
  });
});

test('runtime discovery lets slow WorkBuddy version probes complete before readiness', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-workbuddy-version-');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const workbuddyPath = path.join(binDir, 'workbuddy-cli');
    await writeFile(workbuddyPath, '#!/bin/sh\n/bin/sleep 6\necho "2.103.3"\n', 'utf8');
    await chmod(workbuddyPath, 0o755);

    let readinessCalled = false;
    const result = await discoverLlmRuntimes({
      env: { PATH: '', OAC_WORKBUDDY_PATH: workbuddyPath },
      providers: ['workbuddy'],
      now: () => '2026-07-23T00:05:00.000Z',
      readinessProbe: async () => {
        readinessCalled = true;
        return { ok: true, output: 'OK' };
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].provider, 'workbuddy');
    assert.equal(result.runtimes[0].version, '2.103.3');
    assert.equal(result.runtimes[0].health, 'healthy');
    assert.equal(readinessCalled, true);
  });
});

test('WorkBuddy readiness timeout preserves stderr diagnostics from the CLI', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-workbuddy-readiness-error-');
    const workbuddyPath = path.join(tempRoot, 'workbuddy-cli');
    await writeFile(workbuddyPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "2.115.0"
  exit 0
fi
echo "Unhandled rejection Error: listen EADDRINUSE: address already in use 127.0.0.1:64403" >&2
while :; do :; done
`, 'utf8');
    await chmod(workbuddyPath, 0o755);

    const result = await discoverLlmRuntimes({
      env: { ...process.env, OAC_WORKBUDDY_PATH: workbuddyPath },
      providers: ['workbuddy'],
      readinessTimeoutMs: 50,
      now: () => '2026-07-31T00:00:00.000Z',
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].health, 'detected');
    assert.match(result.runtimes[0].healthReason, /Readiness probe timed out after 50ms\./);
    assert.match(result.runtimes[0].healthReason, /EADDRINUSE/);
    assert.match(result.runtimes[0].healthReason, /127\.0\.0\.1:64403/);
    assert.doesNotMatch(result.runtimes[0].healthReason, /Unhandled rejection/);
  });
});

test('non-WorkBuddy readiness timeouts keep generic diagnostics', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-codex-readiness-error-');
    const codexPath = path.join(tempRoot, 'codex-cli');
    await writeFile(codexPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "codex-cli 1.0.0"
  exit 0
fi
echo "sensitive provider stderr: EADDRINUSE 127.0.0.1:64403" >&2
while :; do :; done
`, 'utf8');
    await chmod(codexPath, 0o755);

    const result = await discoverLlmRuntimes({
      env: { ...process.env, OAC_CODEX_PATH: codexPath },
      providers: ['codex'],
      readinessTimeoutMs: 50,
      now: () => '2026-07-31T00:00:00.000Z',
    });

    assert.equal(result.runtimes.length, 1);
    assert.equal(result.runtimes[0].health, 'detected');
    assert.equal(result.runtimes[0].healthReason, 'Readiness probe timed out after 50ms.');
  });
});

async function writeFakeLoginShell(tempRoot, resolvedLines = []) {
  const shellDir = path.join(tempRoot, 'fake-shell');
  await mkdir(shellDir, { recursive: true });
  const shellPath = path.join(shellDir, 'bash');
  await writeFile(shellPath, [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" > "$LOGIN_SHELL_MARKER"',
    ...resolvedLines,
  ].join('\n'), 'utf8');
  await chmod(shellPath, 0o755);
  return shellPath;
}

test('runtime discovery skips the login shell when every provider resolves cheaply', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-shell-skip-');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, 'codex');
    const opencodePath = path.join(binDir, 'opencode');
    await writeFile(codexPath, '#!/bin/sh\necho "codex 1.0.0"\n', 'utf8');
    await writeFile(opencodePath, '#!/bin/sh\necho "opencode 0.9.1"\n', 'utf8');
    await chmod(codexPath, 0o755);
    await chmod(opencodePath, 0o755);
    const shellPath = await writeFakeLoginShell(tempRoot);
    const markerPath = path.join(tempRoot, 'shell-marker');

    const result = await discoverLlmRuntimes({
      env: { PATH: binDir, SHELL: shellPath, LOGIN_SHELL_MARKER: markerPath },
      providers: ['codex', 'opencode'],
      now: () => '2026-07-23T02:00:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.runtimes.map((runtime) => runtime.provider), ['codex', 'opencode']);
    assert.equal(existsSync(markerPath), false, 'login shell must not spawn when nothing is missed');
  });
});

test('runtime discovery does not spawn a login shell for env-override-only providers', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-shell-env-only-');
    const binDir = path.join(tempRoot, 'external-bin');
    await mkdir(binDir, { recursive: true });
    const geminiPath = path.join(binDir, 'gemini');
    await writeFile(geminiPath, '#!/bin/sh\necho "gemini 9.9.9"\n', 'utf8');
    await chmod(geminiPath, 0o755);
    const shellPath = await writeFakeLoginShell(tempRoot);
    const markerPath = path.join(tempRoot, 'shell-marker');

    const result = await discoverLlmRuntimes({
      env: { PATH: '', OAC_GEMINI_PATH: geminiPath, SHELL: shellPath, LOGIN_SHELL_MARKER: markerPath },
      providers: ['gemini'],
      now: () => '2026-07-23T02:05:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.runtimes.map((runtime) => runtime.provider), ['gemini']);
    assert.equal(result.runtimes[0].binaryPath, geminiPath);
    assert.equal(existsSync(markerPath), false, 'env-override-only providers must not trigger a shell spawn');
  });
});

test('runtime discovery resolves only missed binary names through the login shell', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-shell-missed-');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, 'codex');
    await writeFile(codexPath, '#!/bin/sh\necho "codex 1.0.0"\n', 'utf8');
    await chmod(codexPath, 0o755);
    const shellPath = await writeFakeLoginShell(tempRoot);
    const markerPath = path.join(tempRoot, 'shell-marker');

    const result = await discoverLlmRuntimes({
      env: { PATH: binDir, SHELL: shellPath, LOGIN_SHELL_MARKER: markerPath },
      now: () => '2026-07-23T02:10:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.runtimes.map((runtime) => runtime.provider), ['codex']);
    assert.equal(existsSync(markerPath), true, 'login shell should run for missed providers');
    const invocation = await readFile(markerPath, 'utf8');
    assert.match(invocation, /for n in /);
    assert.ok(invocation.includes('gemini'), 'missed provider binary names are queried');
    assert.ok(invocation.includes('cursor-agent'), 'missed provider binary names are queried');
    assert.ok(!invocation.includes('codex'), 'already-resolved providers are not queried');
  });
});

test('runtime discovery rejects shell-resolved paths that are not executable', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-shell-stale-');
    const shellPath = await writeFakeLoginShell(tempRoot, [
      'printf \'gemini\\t%s\\n\' "$RESOLVED_GEMINI"',
    ]);
    const markerPath = path.join(tempRoot, 'shell-marker');
    const stalePath = path.join(tempRoot, 'vanished', 'gemini');

    const result = await discoverLlmRuntimes({
      env: { PATH: '', SHELL: shellPath, LOGIN_SHELL_MARKER: markerPath, RESOLVED_GEMINI: stalePath },
      providers: ['gemini'],
      now: () => '2026-07-23T02:20:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 0, 'stale shell-resolved paths must be re-verified away');
  });
});

test('runtime discovery lazily resolves missed providers through the login shell', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-shell-lazy-');
    const binDir = path.join(tempRoot, 'login-only-bin');
    await mkdir(binDir, { recursive: true });
    const geminiPath = path.join(binDir, 'gemini');
    await writeFile(geminiPath, '#!/bin/sh\necho "gemini 9.9.9"\n', 'utf8');
    await chmod(geminiPath, 0o755);
    const shellPath = await writeFakeLoginShell(tempRoot, [
      'printf \'gemini\\t%s\\n\' "$RESOLVED_GEMINI"',
    ]);
    const markerPath = path.join(tempRoot, 'shell-marker');

    const result = await discoverLlmRuntimes({
      env: { PATH: '', SHELL: shellPath, LOGIN_SHELL_MARKER: markerPath, RESOLVED_GEMINI: geminiPath },
      providers: ['gemini'],
      now: () => '2026-07-23T02:30:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.runtimes.map((runtime) => runtime.provider), ['gemini']);
    assert.equal(result.runtimes[0].binaryPath, geminiPath);
    assert.equal(result.runtimes[0].health, 'healthy');
  });
});

test('runtime discovery injection of shellResolvedExecutables skips lazy shell resolution', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-shell-inject-');
    const shellPath = await writeFakeLoginShell(tempRoot);
    const markerPath = path.join(tempRoot, 'shell-marker');

    const result = await discoverLlmRuntimes({
      env: { PATH: '', SHELL: shellPath, LOGIN_SHELL_MARKER: markerPath },
      shellResolvedExecutables: {},
      now: () => '2026-07-23T02:40:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.runtimes.length, 0);
    assert.equal(existsSync(markerPath), false, 'injected shell results must bypass the login shell');
  });
});

test('runtime discovery prioritizes known-runtime providers before others', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-tier-known-');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, 'codex');
    const geminiPath = path.join(binDir, 'gemini');
    const zcodePath = path.join(binDir, 'zcode');
    await writeFile(codexPath, '#!/bin/sh\necho "codex 1.0.0"\n', 'utf8');
    await writeFile(geminiPath, '#!/bin/sh\necho "gemini 2.0.0"\n', 'utf8');
    await writeFile(zcodePath, '#!/bin/sh\necho "0.14.8"\n', 'utf8');
    await chmod(codexPath, 0o755);
    await chmod(geminiPath, 0o755);
    await chmod(zcodePath, 0o755);

    const discoveredOrder = [];
    const result = await discoverLlmRuntimes({
      env: { PATH: binDir },
      now: () => '2026-07-23T01:00:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
      providerConcurrency: 1,
      knownRuntimes: [
        testRuntimeFixture({ id: 'llm_zcode_known', provider: 'zcode', binaryPath: zcodePath }),
      ],
      onRuntimeDiscovered: async (runtime) => {
        discoveredOrder.push(runtime.provider);
      },
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(discoveredOrder, ['zcode', 'codex', 'gemini']);
    assert.deepEqual(result.runtimes.map((runtime) => runtime.provider), ['zcode', 'codex', 'gemini']);
  });
});

test('runtime discovery prioritizes providers with existing default executable paths', async () => {
  const tempRoot = await mkdtempTempRoot('oac-provider-tier-defaults-');
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const codexPath = path.join(binDir, 'codex');
  const zcodePath = path.join(tempRoot, 'ZCode.app', 'Contents', 'Resources', 'glm', 'zcode.cjs');
  const workbuddyPath = path.join(tempRoot, 'WorkBuddy.app', 'Contents', 'Resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
  await mkdir(path.dirname(zcodePath), { recursive: true });
  await mkdir(path.dirname(workbuddyPath), { recursive: true });
  await writeFile(codexPath, '#!/bin/sh\necho "codex 1.0.0"\n', 'utf8');
  await writeFile(zcodePath, '#!/bin/sh\necho "0.14.8"\n', 'utf8');
  await writeFile(workbuddyPath, '#!/bin/sh\necho "2.103.3"\n', 'utf8');
  await chmod(codexPath, 0o755);
  await chmod(zcodePath, 0o755);
  await chmod(workbuddyPath, 0o755);

  const zcodePlatform = PLATFORM_DEFINITIONS.find((platform) => platform.id === 'zcode');
  const workbuddyPlatform = PLATFORM_DEFINITIONS.find((platform) => platform.id === 'workbuddy');
  const originalZCodeDefaults = [...zcodePlatform.runtime.defaultExecutablePaths];
  const originalWorkBuddyDefaults = [...workbuddyPlatform.runtime.defaultExecutablePaths];
  zcodePlatform.runtime.defaultExecutablePaths = [zcodePath];
  workbuddyPlatform.runtime.defaultExecutablePaths = [workbuddyPath];
  try {
    const discoveredOrder = [];
    const result = await discoverLlmRuntimes({
      env: { PATH: binDir },
      providers: ['codex', 'zcode', 'workbuddy'],
      now: () => '2026-07-23T01:10:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
      providerConcurrency: 1,
      onRuntimeDiscovered: async (runtime) => {
        discoveredOrder.push(runtime.provider);
      },
    });

    assert.equal(result.errors.length, 0);
    assert.deepEqual(discoveredOrder, ['zcode', 'workbuddy', 'codex']);
    assert.deepEqual(result.runtimes.map((runtime) => runtime.provider), ['zcode', 'workbuddy', 'codex']);
  } finally {
    zcodePlatform.runtime.defaultExecutablePaths = originalZCodeDefaults;
    workbuddyPlatform.runtime.defaultExecutablePaths = originalWorkBuddyDefaults;
  }
});

test('runtime discovery surfaces onRuntimeDiscovered failures without aborting the sweep', async () => {
  await withDefaultExecutablePathsDisabled(async () => {
    const tempRoot = await mkdtempTempRoot('oac-provider-callback-error-');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, 'codex');
    const opencodePath = path.join(binDir, 'opencode');
    await writeFile(codexPath, '#!/bin/sh\necho "codex 1.0.0"\n', 'utf8');
    await writeFile(opencodePath, '#!/bin/sh\necho "opencode 0.9.1"\n', 'utf8');
    await chmod(codexPath, 0o755);
    await chmod(opencodePath, 0o755);

    const result = await discoverLlmRuntimes({
      env: { PATH: binDir },
      providers: ['codex', 'opencode'],
      now: () => '2026-07-23T01:20:00.000Z',
      readinessProbe: async () => ({ ok: true, output: 'OK' }),
      onRuntimeDiscovered: async (runtime) => {
        if (runtime.provider === 'codex') throw new Error('upsert failed');
      },
    });

    assert.deepEqual(result.runtimes.map((runtime) => runtime.provider), ['codex', 'opencode']);
    assert.equal(result.errors.length, 1);
    assert.deepEqual(result.errors[0], { provider: 'codex', message: 'upsert failed' });
  });
});

test('version probe escalates and settles when an executable ignores SIGTERM', async () => {
  const tempRoot = await mkdtempTempRoot('oac-probe-kill-');
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const pidPath = path.join(tempRoot, 'child.pid');
  const wedgedPath = path.join(binDir, 'wedged');
  await writeFile(wedgedPath, [
    '#!/bin/sh',
    'trap "" TERM',
    'printf \'%s\' $$ > "$PID_PATH"',
    'while :; do printf \'x\\n\'; sleep 1; done',
  ].join('\n'), 'utf8');
  await chmod(wedgedPath, 0o755);

  const startedAt = Date.now();
  const probe = await probeExecutableVersion(wedgedPath, ['--version'], 500, { PATH: binDir, PID_PATH: pidPath });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(probe.ok, false);
  assert.equal(probe.message, 'Version probe timed out after 500ms.');
  assert.ok(elapsedMs >= 500, `probe must not settle before the timeout, took ${elapsedMs}ms`);
  assert.ok(elapsedMs < 15_000, `probe must settle shortly after the kill grace window, took ${elapsedMs}ms`);

  const childPid = Number(await readFile(pidPath, 'utf8'));
  assert.ok(Number.isInteger(childPid) && childPid > 0, 'wedged child should have recorded its pid');
  let childRunning = true;
  for (let attempt = 0; attempt < 50 && childRunning; attempt += 1) {
    try {
      process.kill(childPid, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      childRunning = false;
    }
  }
  assert.equal(childRunning, false, 'wedged probe child must be gone after escalation');
});
