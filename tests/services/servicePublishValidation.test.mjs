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
  validateServicePublishProviderSkill,
} = require('../../dist/core/services/servicePublishValidation.js');

async function createProfileHome(slug = 'provider-profile') {
  const systemHome = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-service-publish-validation-'));
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

async function writeSkill(root, name) {
  await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(path.join(root, name, 'SKILL.md'), `# ${name}\n`, 'utf8');
}

async function createValidationContext(options = {}) {
  const { systemHome, profileRoot, slug } = await createProfileHome();
  const paths = resolveMetabotPaths(profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  const bindingStore = createLlmBindingStore(paths);
  if (options.withRuntime !== false) {
    await runtimeStore.write({
      version: 1,
      runtimes: [
        runtime('runtime-codex', 'codex', options.health || 'healthy', {
          binaryPath: Object.prototype.hasOwnProperty.call(options, 'binaryPath')
            ? options.binaryPath
            : undefined,
        }),
        runtime('runtime-claude', 'claude-code'),
      ],
    });
  }
  if (options.withBinding !== false) {
    await bindingStore.write({
      version: 1,
      bindings: [
        binding('binding-codex-primary', slug, 'runtime-codex', 'primary'),
        binding('binding-claude-fallback', slug, 'runtime-claude', 'fallback'),
      ],
    });
  }
  if (options.withSkill !== false) {
    await writeSkill(path.join(systemHome, '.codex', 'skills'), 'metabot-weather');
  }
  return { systemHome, profileRoot, slug, runtimeStore, bindingStore };
}

test('publish validation succeeds for a matching primary runtime skill', async () => {
  const context = await createValidationContext();
  const result = await validateServicePublishProviderSkill({
    metaBotSlug: context.slug,
    providerSkill: 'metabot-weather',
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.skill.skillName, 'metabot-weather');
  assert.equal(result.runtime.id, 'runtime-codex');
  assert.equal(result.platform.id, 'codex');
  assert.equal(Array.isArray(result.rootDiagnostics), true);
  assert.equal(result.rootDiagnostics.some((entry) => entry.absolutePath.includes('.claude')), false);
});

test('publish validation rejects unsafe providerSkill names before scanning', async () => {
  const context = await createValidationContext();
  const result = await validateServicePublishProviderSkill({
    metaBotSlug: context.slug,
    providerSkill: '../metabot-weather',
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_provider_skill');
});

test('publish validation fails when primary runtime binding is missing', async () => {
  const context = await createValidationContext({ withBinding: false });
  const result = await validateServicePublishProviderSkill({
    metaBotSlug: context.slug,
    providerSkill: 'metabot-weather',
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'primary_runtime_missing');
});

test('publish validation fails when primary runtime is unavailable', async () => {
  const context = await createValidationContext({ health: 'unavailable' });
  const result = await validateServicePublishProviderSkill({
    metaBotSlug: context.slug,
    providerSkill: 'metabot-weather',
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'primary_runtime_unavailable');
});

test('publish validation fails when primary runtime is degraded', async () => {
  const context = await createValidationContext({ health: 'degraded' });
  const result = await validateServicePublishProviderSkill({
    metaBotSlug: context.slug,
    providerSkill: 'metabot-weather',
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'primary_runtime_unavailable');
});

test('publish validation fails when primary runtime has no binary path', async () => {
  const context = await createValidationContext({ binaryPath: null });
  const result = await validateServicePublishProviderSkill({
    metaBotSlug: context.slug,
    providerSkill: 'metabot-weather',
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'primary_runtime_unavailable');
});

test('publish validation fails when the skill exists only on fallback runtime roots', async () => {
  const context = await createValidationContext({ withSkill: false });
  await writeSkill(path.join(context.systemHome, '.claude', 'skills'), 'metabot-weather');

  const result = await validateServicePublishProviderSkill({
    metaBotSlug: context.slug,
    providerSkill: 'metabot-weather',
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'provider_skill_missing');
});
