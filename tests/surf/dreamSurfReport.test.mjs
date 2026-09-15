// Dream ↔ surf integration: gatherActivity feeds the latest finished surf
// report of the day window; the dream prompt renders it; a surf report alone
// counts as day activity (skip-empty gate).
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMetawebSurfStore } = require('../../dist/core/surf/store.js');
const { createDreamStore } = require('../../dist/core/memory/dreamStore.js');
const { buildDreamPrompt } = require('../../dist/core/memory/dreamPrompt.js');

async function createTempProfileHome(label) {
  const base = await mkdtempTempRoot(`metabot-surf-dream-${label}-`);
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

test('gatherActivity carries the day window\'s latest finished surf report', async () => {
  const paths = await createTempProfileHome('gather');
  const store = createMetawebSurfStore(paths);
  // A finished run inside the window, an older one outside, a failed one inside.
  const dayStart = Date.parse('2026-09-15T00:00:00Z');
  const dayEnd = Date.parse('2026-09-16T00:00:00Z');
  await store.createRun({ id: 'old-done', trigger: 'manual-ui', nowIso: '2026-09-13T20:00:00Z' });
  await store.finishRun('old-done', {
    status: 'done',
    stats: { fetched: 1 },
    reportMarkdown: '# old report',
    finishedAtIso: '2026-09-13T21:00:00Z',
  });
  await store.createRun({ id: 'failed-in-window', trigger: 'pre-dream', nowIso: '2026-09-15T21:00:00Z' });
  await store.finishRun('failed-in-window', {
    status: 'failed',
    stats: { fetched: 2 },
    error: 'llm died',
    finishedAtIso: '2026-09-15T21:30:00Z',
  });
  await store.createRun({ id: 'done-in-window', trigger: 'pre-dream', nowIso: '2026-09-15T22:00:00Z' });
  await store.finishRun('done-in-window', {
    status: 'done',
    stats: { fetched: 12, liked: 3 },
    reportMarkdown: '# Surf report\nLearned about agentpedia tonight.',
    finishedAtIso: '2026-09-15T22:35:00Z',
  });

  const dreamStore = createDreamStore(paths);
  const activity = await dreamStore.gatherActivity({ startMs: dayStart, endMs: dayEnd });
  assert.equal(activity.surfReport, '# Surf report\nLearned about agentpedia tonight.');
});

test('no finished surf in the window → null surfReport (never yesterday\'s)', async () => {
  const paths = await createTempProfileHome('none');
  const store = createMetawebSurfStore(paths);
  await store.createRun({ id: 'yesterday', trigger: 'pre-dream', nowIso: '2026-09-14T22:00:00Z' });
  await store.finishRun('yesterday', {
    status: 'done',
    stats: { fetched: 1 },
    reportMarkdown: '# yesterday',
    finishedAtIso: '2026-09-14T23:00:00Z',
  });
  const dreamStore = createDreamStore(paths);
  const activity = await dreamStore.gatherActivity({
    startMs: Date.parse('2026-09-15T00:00:00Z'),
    endMs: Date.parse('2026-09-16T00:00:00Z'),
  });
  assert.equal(activity.surfReport, null);
});

test('dream prompt renders the surf report section, truncated to 2000 chars', () => {
  const { user: prompt } = buildDreamPrompt({
    botName: 'Bot',
    role: 'helper',
    soul: '',
    date: '2026-09-15',
    activity: {
      sessions: [],
      taskRuns: [],
      orderCount: 0,
      groupTasks: [],
      surfReport: `# Surf report\n${'x'.repeat(5000)}`,
    },
  });
  assert.match(prompt, /今夜做梦前的 AI 互联网冲浪报告/);
  // The 5000-char body was truncated to the 2000-char cap (with the ellipsis).
  assert.ok(!prompt.includes('x'.repeat(2100)), 'surf report body not truncated');
  assert.ok(prompt.includes('x'.repeat(1900)), 'surf report body missing');
});
