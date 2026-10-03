import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMemoryStore } = require('../../dist/core/memory/memoryStore.js');
const { createMemoryPolicyStore } = require('../../dist/core/memory/memoryPolicy.js');
const { buildPersonaSessionSystemPrompt } = require('../../dist/core/prompt/sessionSystemPrompt.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-session-prompt-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

test('buildPersonaSessionSystemPrompt composes scenario + identity + experience hot layer', async () => {
  const paths = await createTempProfileHome();
  await fs.writeFile(path.join(paths.profileRoot, 'ROLE.md'), '# Role\n夜间冲浪研究员。', 'utf8');
  const store = createMemoryStore(paths);
  await store.create({
    text: '我是一个克制、只在有价值时互动的 MetaBot。',
    usageClass: 'self_identity',
    origin: 'dream',
  });
  await store.create({ text: 'OWNER_ONLY_私人偏好', isExplicit: true });

  const prompt = await buildPersonaSessionSystemPrompt(paths, {
    scenario: 'You are a MetaBot running an unattended MetaWeb surf session.',
  });
  assert.ok(prompt.startsWith('You are a MetaBot running an unattended MetaWeb surf session.'));
  assert.match(prompt, /<metabot_identity>/);
  assert.match(prompt, /<role>夜间冲浪研究员。?<\/role>/);
  assert.match(prompt, /<metabot_self_identity>/);
  assert.match(prompt, /克制、只在有价值时互动/);
  // Experience-only: scoped owner facts must not leak into public-facing sessions.
  assert.ok(!prompt.includes('OWNER_ONLY_私人偏好'));
});

test('buildPersonaSessionSystemPrompt keeps working when memory is disabled or absent', async () => {
  const paths = await createTempProfileHome();
  await createMemoryPolicyStore(paths).setOverride({ memoryEnabled: false });
  const prompt = await buildPersonaSessionSystemPrompt(paths, { scenario: 'Scenario line.' });
  assert.ok(prompt.startsWith('Scenario line.'));
  assert.match(prompt, /<metabot_identity>/);
  assert.ok(!prompt.includes('<metabot_self_identity>'));
});
