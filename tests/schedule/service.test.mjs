import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMemoryStore } = require('../../dist/core/memory/memoryStore.js');
const { createScheduleStore } = require('../../dist/core/schedule/store.js');
const { buildScheduleSystemPrompt, runScheduledTask } = require('../../dist/core/schedule/service.js');

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-schedule-svc-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

test('buildScheduleSystemPrompt carries the shared identity block including the goal', async () => {
  const paths = await createTempProfileHome();
  await fs.writeFile(path.join(paths.profileRoot, 'ROLE.md'), '# Role\n调度员。', 'utf8');
  await fs.writeFile(path.join(paths.profileRoot, 'GOAL.md'), '# Goal\n把每天的总结写好。', 'utf8');

  const systemPrompt = await buildScheduleSystemPrompt(paths);
  assert.match(systemPrompt, /scheduled task that fired for you/);
  assert.match(systemPrompt, /<metabot_identity>/);
  assert.match(systemPrompt, /<role>调度员。<\/role>/);
  assert.match(systemPrompt, /<goal>把每天的总结写好。<\/goal>/);
  assert.match(systemPrompt, /strictly adhere/);
});

test('runScheduledTask injects the owner-scope memory into the task prompt', async () => {
  const paths = await createTempProfileHome();
  await createMemoryStore(paths).create({ text: 'OWNER_PREF_汇报用要点式', isExplicit: true });
  const store = createScheduleStore(paths);
  const task = await store.createTask({
    name: 'daily summary',
    prompt: '总结今天的链上动态。',
    schedule: { type: 'interval', intervalMs: 3_600_000 },
  });

  const seen = [];
  const result = await runScheduledTask(paths, { taskId: task.id, trigger: 'manual', executor: null }, {
    runLlm: async (turn) => {
      seen.push(turn);
      return { ok: true, output: 'done' };
    },
  });
  assert.equal(result.kind, 'completed');
  assert.equal(seen.length, 1);
  assert.ok(seen[0].prompt.startsWith('总结今天的链上动态。'));
  assert.ok(seen[0].prompt.includes('## Scoped Memory & Experience'), 'memory section injected into the task prompt');
  assert.ok(seen[0].prompt.includes('OWNER_PREF_汇报用要点式'), 'owner memory present for local scheduled work');
  assert.ok(seen[0].systemPrompt.includes('<metabot_identity>'));
});
