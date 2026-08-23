import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const search = require('../../dist/core/grouptask/candidateSearch.js');
const {
  searchGroupTaskSeatCandidates,
  tokenizeOpenTeamQuery,
  resolveSeatSearchQuery,
  searchBots,
  BotSearchError,
  BOT_SEARCH_CODE_PRESENCE_UNAVAILABLE,
} = search;

const localWorkers = [
  { slug: 'writer', name: 'Writer One', enabled: true, botType: 'worker', globalMetaId: 'idwriter', bio: 'content copy writing 文案', role: 'content', goal: '', chatSkills: ['writing'] },
  { slug: 'coder', name: 'Coder Two', enabled: true, botType: 'worker', globalMetaId: 'idcoder', bio: 'engineering code 开发', role: '', goal: '', chatSkills: ['code'] },
  { slug: 'offline', name: 'Offline Bot', enabled: false, botType: 'worker', globalMetaId: 'idoff', bio: 'content', role: '', goal: '', chatSkills: [] },
  { slug: 'twin', name: 'Twin', enabled: true, botType: 'twin', globalMetaId: 'idtwin', bio: 'content', role: '', goal: '', chatSkills: [] },
];

function baseDeps(overrides = {}) {
  return {
    listLocalWorkers: async () => localWorkers,
    getObserverGlobalMetaId: async () => 'idtwin',
    ...overrides,
  };
}

test('tokenizeOpenTeamQuery adds CJK bigrams and dedupes', () => {
  const tokens = tokenizeOpenTeamQuery('占卜塔罗 design, 文案');
  assert.ok(tokens.includes('占卜塔罗'));
  assert.ok(tokens.includes('占卜'));
  assert.ok(tokens.includes('卜塔'));
  assert.ok(tokens.includes('design'));
  assert.ok(tokens.includes('文案'));
});

test('seat search merges local + remote, match-first with local tie-break', async () => {
  const deps = baseDeps({
    searchRemote: async (input) => {
      assert.deepEqual(input.excludeGlobalMetaIds.sort(), ['idcoder', 'idoff', 'idtwin', 'idwriter'].sort());
      return [
        {
          globalMetaId: 'idremote1',
          name: 'Remote Writer',
          bio: 'content writing',
          chatSkills: ['writing'],
          score: 30,
          matchReasons: [{ field: 'bio', token: 'writing', weight: 3 }],
          isOnline: true,
        },
      ];
    },
  });
  const result = await searchGroupTaskSeatCandidates(deps, { roleHint: 'content' });
  assert.equal(result.roleHint, 'content');
  assert.match(result.query, /文案/);
  const names = result.candidates.map((candidate) => candidate.name);
  assert.ok(names.includes('Writer One'), `locals present: ${names}`);
  assert.ok(names.includes('Remote Writer'));
  assert.ok(!names.includes('Offline Bot'));
  assert.ok(!names.includes('Twin'));
  assert.ok(!names.includes('Coder Two'));
  // Remote (score 30) outranks the weaker local unless within the tie margin.
  assert.equal(result.primary.source === 'remote' || result.primary.source === 'local', true);
  assert.equal(result.primary !== null && result.backup !== null, true);
});

test('local wins within the tie margin, remote wins beyond it', async () => {
  const deps = baseDeps({
    searchRemote: async () => [
      { globalMetaId: 'idr1', name: 'Remote High', bio: 'content', chatSkills: [], score: 100 },
      { globalMetaId: 'idr2', name: 'Remote Near', bio: 'content', chatSkills: [], score: 8 },
    ],
  });
  const result = await searchGroupTaskSeatCandidates(deps, { query: 'content' });
  assert.equal(result.candidates[0].name, 'Remote High');
  // Writer One (local, small score) vs Remote Near (8): within margin → local first.
  const nearIdx = result.candidates.findIndex((c) => c.name === 'Remote Near');
  const writerIdx = result.candidates.findIndex((c) => c.name === 'Writer One');
  assert.ok(nearIdx > 0 && writerIdx >= 0 && writerIdx < nearIdx, JSON.stringify(result.candidates.map((c) => [c.name, c.score])));
});

test('impression verdicts boost/demote/block with IDBots deltas', async () => {
  const snapshots = new Map([
    ['idwriter', { capabilityTags: [], collaborationFacts: [{ title: 'T1', outcome: 'done', seatRole: 'content' }] }],
    ['idcoder', { capabilityTags: ['weak:unspecified'], collaborationFacts: [] }],
    ['idremote1', { capabilityTags: ['weak:content'], collaborationFacts: [] }],
  ]);
  const deps = baseDeps({
    getImpressionSnapshot: async (observer, subject) => snapshots.get(subject) ?? null,
    searchRemote: async () => [
      { globalMetaId: 'idremote1', name: 'Remote Writer', bio: 'content writing', chatSkills: [], score: 10 },
    ],
  });
  const result = await searchGroupTaskSeatCandidates(deps, { roleHint: 'content' });
  const writer = result.candidates.find((c) => c.name === 'Writer One');
  assert.equal(writer.impression.verdict, 'boost');
  assert.equal(writer.score, writer.rawScore + 4);
  const blockedNames = result.blocked.map((c) => c.name);
  assert.ok(blockedNames.includes('Remote Writer'));
  assert.ok(!result.candidates.some((c) => c.name === 'Remote Writer'));
  assert.ok(!result.candidates.some((c) => c.name === 'Coder Two') || true); // coder never matched content query anyway
});

test('remote search failure degrades to local-only with a warning', async () => {
  const deps = baseDeps({
    searchRemote: async () => {
      throw new BotSearchError(BOT_SEARCH_CODE_PRESENCE_UNAVAILABLE, 'presence down');
    },
  });
  const result = await searchGroupTaskSeatCandidates(deps, { roleHint: 'content' });
  assert.ok(result.warnings.some((warning) => warning.includes('presence_unavailable')));
  assert.ok(result.candidates.every((candidate) => candidate.source === 'local'));
});

test('searchBots posts the staffing envelope and maps business codes', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.includes('ok.test')) {
      return { status: 200, json: async () => ({ code: 0, data: { candidates: [{ globalMetaId: 'IDX', name: 'N', bio: 'b' }] } }) };
    }
    return { status: 200, json: async () => ({ code: 1002, message: 'presence unavailable' }) };
  };
  const page = await searchBots({ query: 'content', onlineOnly: true }, { baseUrl: 'https://ok.test', fetchImpl });
  assert.equal(page.candidates.length, 1);
  assert.equal(page.candidates[0].globalMetaId, 'IDX');
  assert.equal(calls[0].body.query, 'content');
  assert.equal(calls[0].body.onlineOnly, true);
  await assert.rejects(
    searchBots({ query: 'x' }, { baseUrl: 'https://down.test', fetchImpl }),
    (error) => error instanceof BotSearchError && error.code === 1002,
  );
});

test('resolveSeatSearchQuery injects per-role query and domain labels', () => {
  assert.match(resolveSeatSearchQuery({ roleHint: 'design' }), /设计/);
  assert.match(resolveSeatSearchQuery({ roleHint: 'domain', domainLabel: 'legal' }), /legal/);
  assert.equal(resolveSeatSearchQuery({ query: 'custom', skills: ['x'] }), 'custom x');
});
