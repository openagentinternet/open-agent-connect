import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { formatExperienceTimelineFallback } = require('../../dist/core/memory/experiencePromptBlocks.js');

test('timeline fallback leads with the positive episode count and defers the missing summaries (D4)', () => {
  const text = formatExperienceTimelineFallback({
    dateFrom: '2026-09-01',
    dateTo: '2026-09-02',
    episodes: [
      { startedAt: Date.UTC(2026, 8, 1, 3, 0), sourceChannel: 'dsh', episodeType: 'chat', title: 'Wallet recovery' },
      { startedAt: Date.UTC(2026, 8, 2, 4, 0), sourceChannel: 'metaweb', episodeType: 'buzz', title: null },
    ],
  });
  assert.ok(text.startsWith('Raw activity timeline shows 2 episode(s) for 2026-09-01..2026-09-02'), text.split('\n')[0]);
  assert.match(text, /dream summaries not yet consolidated/);
  assert.match(text, /granularity=day/);
  assert.ok(!text.startsWith('No dream summaries'), 'the affirmative episode count leads');
  assert.match(text, /Wallet recovery/);
  assert.match(text, /metaweb\/buzz/, 'untitled episodes fall back to channel/type');
});

test('timeline fallback with no episodes keeps the "no activity" wording and is distinguishable (D4)', () => {
  const empty = formatExperienceTimelineFallback({ dateFrom: '2026-09-01', dateTo: '2026-09-03', episodes: [] });
  assert.match(empty, /No raw episodes found for 2026-09-01\.\.2026-09-03/);
  assert.match(empty, /no activity in that window/);
  assert.doesNotMatch(empty, /Raw activity timeline shows/);
});
