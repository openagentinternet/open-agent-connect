import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createMetabotProfile, updateMetabotProfile } = require('../../dist/core/bot/metabotProfileManager.js');
const { createPrivateChatAllowedSkillsResolver } = require('../../dist/core/chat/privateChatAllowedSkills.js');
const { createLlmBindingStore } = require('../../dist/core/llm/llmBindingStore.js');
const { createLlmRuntimeStore } = require('../../dist/core/llm/llmRuntimeStore.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

function runtime(id, provider, health = 'healthy') {
  const now = '2026-05-07T00:00:00.000Z';
  return {
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

async function createProfileContext(t, name = 'Policy Bot') {
  const systemHomeDir = await mkdtempTempRoot('oac-private-chat-allowed-');
  t.after(async () => {
    await fs.rm(systemHomeDir, { recursive: true, force: true });
  });
  const profile = await createMetabotProfile(systemHomeDir, { name });
  const paths = resolveMetabotPaths(profile.homeDir);
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
      binding('binding-codex-primary', profile.slug, 'runtime-codex', 'primary'),
      binding('binding-claude-fallback', profile.slug, 'runtime-claude', 'fallback'),
    ],
  });
  return { systemHomeDir, profile, paths, runtimeStore, bindingStore };
}

test('private chat allowed skills resolver returns exact executable skills and source paths', async (t) => {
  const context = await createProfileContext(t);
  await updateMetabotProfile(context.systemHomeDir, context.profile.slug, {
    allowChatSkills: ['metabot-weather', 'metabot-missing'],
  });
  await writeSkill(path.join(context.systemHomeDir, '.codex', 'skills'), 'metabot-weather');

  const resolver = createPrivateChatAllowedSkillsResolver({
    paths: context.paths,
    metaBotSlug: context.profile.slug,
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    env: {},
  });

  const result = await resolver();

  assert.deepEqual(result.skills, ['metabot-weather']);
  assert.match(result.skillSourcePaths['metabot-weather'], /\.codex[/\\]skills[/\\]metabot-weather$/);
  assert.equal(result.skillDetails.length, 1);
  assert.equal(result.skillDetails[0].name, 'metabot-weather');
  assert.equal(result.skillDetails[0].description, null);
  assert.match(result.skillDetails[0].location, /\.codex[/\\]skills[/\\]metabot-weather[/\\]SKILL\.md$/);
  assert.deepEqual(result.skippedSkills, ['metabot-missing']);
});

test('private chat allowed skills resolver returns empty scope for profiles with no allowChatSkills', async (t) => {
  const context = await createProfileContext(t, 'No Policy Bot');

  const resolver = createPrivateChatAllowedSkillsResolver({
    paths: context.paths,
    metaBotSlug: context.profile.slug,
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    env: {},
  });

  const result = await resolver();

  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.skillSourcePaths, {});
  assert.deepEqual(result.skillDetails, []);
  assert.deepEqual(result.skippedSkills, []);
  assert.equal(result.warning, null);
});

test('private chat allowed skills resolver persists the last resolution outcome', async (t) => {
  const context = await createProfileContext(t, 'Resolution Record Bot');
  await updateMetabotProfile(context.systemHomeDir, context.profile.slug, {
    allowChatSkills: ['metabot-weather', 'metabot-missing'],
  });
  await writeSkill(path.join(context.systemHomeDir, '.codex', 'skills'), 'metabot-weather');

  const resolver = createPrivateChatAllowedSkillsResolver({
    paths: context.paths,
    metaBotSlug: context.profile.slug,
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    env: {},
  });

  await resolver();

  const record = JSON.parse(await fs.readFile(context.paths.chatSkillResolutionPath, 'utf8'));
  assert.deepEqual(record.resolved, ['metabot-weather']);
  assert.deepEqual(record.skipped, ['metabot-missing']);
  assert.match(record.warning, /metabot-missing/);
  assert.ok(record.checkedAt);

  // A follow-up resolve with a cleared policy overwrites the stale record.
  await updateMetabotProfile(context.systemHomeDir, context.profile.slug, {
    allowChatSkills: [],
  });
  await resolver();
  const cleared = JSON.parse(await fs.readFile(context.paths.chatSkillResolutionPath, 'utf8'));
  assert.deepEqual(cleared.resolved, []);
  assert.deepEqual(cleared.skipped, []);
  assert.equal(cleared.warning, null);
});

test('private chat allowed skills resolver keeps working when the resolution record write fails', async (t) => {
  const context = await createProfileContext(t, 'Resolution Write Fails Bot');
  await updateMetabotProfile(context.systemHomeDir, context.profile.slug, {
    allowChatSkills: ['metabot-weather', 'metabot-missing'],
  });
  await writeSkill(path.join(context.systemHomeDir, '.codex', 'skills'), 'metabot-weather');
  // Point the record path inside a regular file so the write always fails.
  const blockerPath = path.join(context.systemHomeDir, 'resolution-blocker');
  await fs.writeFile(blockerPath, 'not a directory', 'utf8');
  const paths = {
    ...context.paths,
    chatSkillResolutionPath: path.join(blockerPath, 'chat-skill-resolution.json'),
  };

  const resolver = createPrivateChatAllowedSkillsResolver({
    paths,
    metaBotSlug: context.profile.slug,
    runtimeStore: context.runtimeStore,
    bindingStore: context.bindingStore,
    env: {},
  });

  const result = await resolver();

  assert.deepEqual(result.skills, ['metabot-weather']);
  assert.deepEqual(result.skippedSkills, ['metabot-missing']);
});
