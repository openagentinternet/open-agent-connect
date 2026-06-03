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
  normalizeAllowChatSkills,
  resolveAllowChatSkillsForRuntime,
  validateAllowChatSkills,
} = require('../../dist/core/services/chatSkillPolicy.js');

async function createProfileHome(slug = 'chat-profile') {
  const systemHome = await fs.mkdtemp(path.join(os.tmpdir(), 'oac-chat-skill-policy-'));
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

async function createPolicyContext(options = {}) {
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
  for (const skillName of options.skills || ['metabot-weather', 'metabot-post-buzz']) {
    await writeSkill(path.join(systemHome, '.codex', 'skills'), skillName);
  }
  return { systemHome, profileRoot, slug, runtimeStore, bindingStore };
}

function policyInput(context, allowChatSkills) {
  return {
    metaBotSlug: context.slug,
    allowChatSkills,
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    systemHomeDir: context.systemHome,
    projectRoot: context.profileRoot,
    env: {},
  };
}

test('normalizeAllowChatSkills trims, drops empty strings, and dedupes in first-seen order', () => {
  assert.deepEqual(
    normalizeAllowChatSkills([' metabot-weather ', '', 'metabot-post-buzz', 'metabot-weather', '   ']),
    ['metabot-weather', 'metabot-post-buzz'],
  );
});

test('normalizeAllowChatSkills rejects non-array input', () => {
  assert.throws(
    () => normalizeAllowChatSkills('metabot-weather'),
    /allowChatSkills must be an array/i,
  );
});

test('normalizeAllowChatSkills rejects non-string entries', () => {
  assert.throws(
    () => normalizeAllowChatSkills(['metabot-weather', 42]),
    /allowChatSkills entries must be strings/i,
  );
});

test('normalizeAllowChatSkills rejects unsafe skill names', () => {
  assert.throws(
    () => normalizeAllowChatSkills(['../metabot-weather']),
    /safe skill directory names/i,
  );
});

test('validateAllowChatSkills succeeds against the primary runtime catalog', async () => {
  const context = await createPolicyContext();
  const result = await validateAllowChatSkills(policyInput(context, [
    ' metabot-post-buzz ',
    'metabot-weather',
    'metabot-post-buzz',
  ]));

  assert.equal(result.ok, true);
  assert.deepEqual(result.allowChatSkills, ['metabot-post-buzz', 'metabot-weather']);
  assert.deepEqual(result.skills.map((entry) => entry.skillName), ['metabot-post-buzz', 'metabot-weather']);
  assert.deepEqual(result.skillSourcePaths, Object.fromEntries(
    result.skills.map((entry) => [entry.skillName, entry.absolutePath]),
  ));
  assert.equal(result.runtime.id, 'runtime-codex');
  assert.equal(result.platform.id, 'codex');
});

test('validateAllowChatSkills fails when a configured skill is missing', async () => {
  const context = await createPolicyContext();
  const result = await validateAllowChatSkills(policyInput(context, ['metabot-weather', 'missing-chat-skill']));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'chat_skill_missing');
  assert.match(result.message, /missing-chat-skill/);
});

test('validateAllowChatSkills fails when the primary runtime catalog is unavailable', async () => {
  const context = await createPolicyContext({ withBinding: false });
  const result = await validateAllowChatSkills(policyInput(context, ['metabot-weather']));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'primary_runtime_missing');
});

test('resolveAllowChatSkillsForRuntime excludes stale configured skills instead of failing open', async () => {
  const context = await createPolicyContext();
  const result = await resolveAllowChatSkillsForRuntime(policyInput(context, [
    'missing-chat-skill',
    'metabot-post-buzz',
    'metabot-weather',
  ]));

  assert.equal(result.ok, true);
  assert.deepEqual(result.allowChatSkills, ['metabot-post-buzz', 'metabot-weather']);
  assert.deepEqual(result.skippedSkills, ['missing-chat-skill']);
  assert.deepEqual(result.skills.map((entry) => entry.skillName), ['metabot-post-buzz', 'metabot-weather']);
  assert.deepEqual(result.skillSourcePaths, Object.fromEntries(
    result.skills.map((entry) => [entry.skillName, entry.absolutePath]),
  ));
  assert.match(result.warning, /missing-chat-skill/);
});

test('resolveAllowChatSkillsForRuntime returns no skills when the primary runtime catalog cannot be resolved', async () => {
  const context = await createPolicyContext({ withBinding: false });
  const result = await resolveAllowChatSkillsForRuntime(policyInput(context, ['metabot-weather', 'metabot-post-buzz']));

  assert.equal(result.ok, true);
  assert.deepEqual(result.allowChatSkills, []);
  assert.deepEqual(result.skippedSkills, ['metabot-weather', 'metabot-post-buzz']);
  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.skillSourcePaths, {});
  assert.match(result.warning, /primary runtime/i);
});
