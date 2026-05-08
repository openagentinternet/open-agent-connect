import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const {
  createPlatformSkillCatalog,
  isSafeProviderSkillName,
} = require('../../dist/core/services/platformSkillCatalog.js');

async function createProfileHome(slug = 'provider-profile') {
  const systemHome = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-platform-skill-catalog-'));
  const profileRoot = path.join(systemHome, '.metabot', 'profiles', slug);
  await fs.mkdir(path.join(systemHome, '.metabot', 'manager'), { recursive: true });
  await fs.mkdir(path.join(systemHome, '.metabot', 'LLM'), { recursive: true });
  await fs.mkdir(profileRoot, { recursive: true });
  return { systemHome, profileRoot, slug };
}

function runtime(id, provider, health = 'healthy', options = {}) {
  const now = '2026-05-07T00:00:00.000Z';
  const row = {
    id,
    provider,
    displayName: `${provider} runtime`,
    binaryPath: `/bin/${provider}`,
    version: '1.0.0',
    authState: 'authenticated',
    health,
    capabilities: ['tool-use'],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
  if (options.binaryPath === null) {
    delete row.binaryPath;
  } else if (typeof options.binaryPath === 'string') {
    row.binaryPath = options.binaryPath;
  }
  return row;
}

function binding(id, slug, runtimeId, role, priority = 0, enabled = true) {
  const now = '2026-05-07T00:00:00.000Z';
  return {
    id,
    metaBotSlug: slug,
    llmRuntimeId: runtimeId,
    role,
    priority,
    enabled,
    createdAt: now,
    updatedAt: now,
  };
}

async function writeSkill(root, name, body = '# Skill\n') {
  await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(path.join(root, name, 'SKILL.md'), body, 'utf8');
}

test('safe provider skill names reject path traversal and separators', () => {
  assert.equal(isSafeProviderSkillName('metabot-weather'), true);
  assert.equal(isSafeProviderSkillName(' weather '), true);
  assert.equal(isSafeProviderSkillName(''), false);
  assert.equal(isSafeProviderSkillName('   '), false);
  assert.equal(isSafeProviderSkillName('skills/metabot-weather'), false);
  assert.equal(isSafeProviderSkillName('skills\\metabot-weather'), false);
  assert.equal(isSafeProviderSkillName('..'), false);
  assert.equal(isSafeProviderSkillName('metabot-..-weather'), false);
});

test('primary runtime catalog lists only primary provider skills and excludes fallback-only skills', async () => {
  const { systemHome, profileRoot, slug } = await createProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.write({
    version: 1,
    runtimes: [
      runtime('runtime-codex', 'codex'),
      runtime('runtime-claude', 'claude-code'),
    ],
  });
  await bindingStore.write({
    version: 1,
    bindings: [
      binding('binding-codex-primary', slug, 'runtime-codex', 'primary'),
      binding('binding-claude-fallback', slug, 'runtime-claude', 'fallback'),
    ],
  });

  await writeSkill(path.join(systemHome, '.codex', 'skills'), 'metabot-weather', [
    '---',
    'name: metabot-weather',
    'description: Returns weather for one location.',
    '---',
    '# Weather',
    '',
  ].join('\n'));
  await writeSkill(path.join(profileRoot, '.codex', 'skills'), 'metabot-project');
  await writeSkill(path.join(systemHome, '.claude', 'skills'), 'metabot-claude-only');

  const catalog = createPlatformSkillCatalog({
    runtimeStore,
    bindingStore,
    systemHomeDir: systemHome,
    projectRoot: profileRoot,
    env: {},
  });
  const result = await catalog.listPrimaryRuntimeSkills({ metaBotSlug: slug });

  assert.equal(result.ok, true);
  assert.equal(result.runtime.id, 'runtime-codex');
  assert.equal(result.platform.id, 'codex');
  assert.deepEqual(
    result.skills.map((skill) => skill.skillName).sort(),
    ['metabot-project', 'metabot-weather'],
  );
  assert.equal(result.skills.some((skill) => skill.skillName === 'metabot-claude-only'), false);
  const weather = result.skills.find((skill) => skill.skillName === 'metabot-weather');
  assert.equal(weather.description, 'Returns weather for one location.');
  assert.equal(weather.platformId, 'codex');
  assert.equal(result.rootDiagnostics.some((entry) => entry.rootId === 'codex-home' && entry.status === 'readable'), true);
});

test('catalog deduplicates skills by deterministic root precedence', async () => {
  const { systemHome, profileRoot, slug } = await createProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  await runtimeStore.write({ version: 1, runtimes: [runtime('runtime-codex', 'codex')] });
  await bindingStore.write({ version: 1, bindings: [binding('binding-primary', slug, 'runtime-codex', 'primary')] });

  await writeSkill(path.join(systemHome, '.codex', 'skills'), 'metabot-shared', '---\ndescription: global copy\n---\n');
  await writeSkill(path.join(profileRoot, '.codex', 'skills'), 'metabot-shared', '---\ndescription: project copy\n---\n');

  const catalog = createPlatformSkillCatalog({
    runtimeStore,
    bindingStore,
    systemHomeDir: systemHome,
    projectRoot: profileRoot,
    env: {},
  });
  const result = await catalog.listPrimaryRuntimeSkills({ metaBotSlug: slug });

  assert.equal(result.ok, true);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].skillName, 'metabot-shared');
  assert.equal(result.skills[0].description, 'global copy');
  assert.equal(result.skills[0].rootId, 'codex-home');
});

test('catalog reports missing primary binding and unavailable primary runtime with stable codes', async () => {
  const { systemHome, profileRoot, slug } = await createProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  const catalog = createPlatformSkillCatalog({
    runtimeStore,
    bindingStore,
    systemHomeDir: systemHome,
    projectRoot: profileRoot,
    env: {},
  });

  const missing = await catalog.listPrimaryRuntimeSkills({ metaBotSlug: slug });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'primary_runtime_missing');

  await runtimeStore.write({ version: 1, runtimes: [runtime('runtime-codex', 'codex', 'unavailable')] });
  await bindingStore.write({ version: 1, bindings: [binding('binding-primary', slug, 'runtime-codex', 'primary')] });
  const unavailable = await catalog.listPrimaryRuntimeSkills({ metaBotSlug: slug });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, 'primary_runtime_unavailable');

  await runtimeStore.write({ version: 1, runtimes: [runtime('runtime-codex', 'codex', 'degraded')] });
  const degraded = await catalog.listPrimaryRuntimeSkills({ metaBotSlug: slug });
  assert.equal(degraded.ok, false);
  assert.equal(degraded.code, 'primary_runtime_unavailable');

  await runtimeStore.write({ version: 1, runtimes: [runtime('runtime-codex', 'codex', 'healthy', { binaryPath: null })] });
  const missingBinary = await catalog.listPrimaryRuntimeSkills({ metaBotSlug: slug });
  assert.equal(missingBinary.ok, false);
  assert.equal(missingBinary.code, 'primary_runtime_unavailable');
});
