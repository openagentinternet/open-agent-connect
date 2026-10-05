import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  collectMetaTaskEvents,
  normalizeChainEvent,
  rosterPinsFromEvents,
} = require('../../dist/core/metatask/collector.js');
const { METATASK_COLLECTED_PATHS } = require('../../dist/core/metatask/engine/constants.js');

/**
 * MetaTask collector (M2) — OAC port of the IDBots collector tests. The fake
 * indexer answers the MANAPI pool route by query param (path-agnostic to the
 * pathname) and serves /content/ download URLs on demand; the so.metaid.io
 * recovery tier is disabled so the counts stay exactly the IDBots semantics,
 * with one dedicated test covering the tier-2 batch recovery.
 */

const P = 'idq1publisheraa';
const S = 'idq1submitterbb';

// ── roster round-trip through the collector's base64 decoding ────────────────

test('roster: normalizeChainEvent decodes the collector-shaped roster pin', () => {
  const rosterPinId = 'rosterpin00000000000000000000000000000000000000000000003i0';
  const rosterBody = {
    groups: [[S, 'idq1peerbotaa'], [P, 'idq1peerbotbb']],
    owner: 'local-roster',
    createdAt: 1_790_000_000_000,
  };
  const rosterEvent = normalizeChainEvent(
    rosterPinId,
    {
      id: rosterPinId,
      path: '/protocols/metatask-roster',
      globalMetaId: P,
      genesisHeight: 191_400,
      txIndex: 0,
      timestamp: 1_790_000_000_000,
      contentBody: Buffer.from(JSON.stringify(rosterBody)).toString('base64'),
    },
    null
  );
  assert.equal(rosterEvent.path, 'metatask-roster');
  assert.deepEqual(rosterEvent.body, rosterBody);
  const rosterPins = rosterPinsFromEvents([rosterEvent]);
  assert.deepEqual(Object.keys(rosterPins), [rosterPinId]);
});

// ── ten pools + manapi-safe page size ────────────────────────────────────────

test('collector: sweeps the ten pools (roster included) at page size 100', async () => {
  const rosterRawItem = {
    id: 'rosterpin00000000000000000000000000000000000000000000002i0',
    path: '/protocols/metatask-roster',
    globalMetaId: P,
    genesisHeight: 191_400,
    txIndex: 0,
    timestamp: 1_790_000_000_000,
    contentBody: Buffer.from(JSON.stringify({ groups: [[S]], owner: 'local-roster' })).toString('base64'),
  };
  const requestedPaths = new Set();
  const requestedSizes = new Set();
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/pins:batch')) {
      return new Response(JSON.stringify({ code: 0, data: { pins: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    requestedPaths.add(parsed.searchParams.get('path'));
    requestedSizes.add(parsed.searchParams.get('size'));
    const list = parsed.searchParams.get('path') === '/protocols/metatask-roster' ? [rosterRawItem] : [];
    return new Response(JSON.stringify({ code: 1, data: { list } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const collected = await collectMetaTaskEvents({ fetchImpl });
  assert.deepEqual(
    collected.perPath.map((entry) => entry.path),
    [...METATASK_COLLECTED_PATHS]
  );
  assert.equal(collected.perPath.length, 10);
  assert.ok(requestedPaths.has('/protocols/metatask-roster'));
  assert.ok(!requestedPaths.has('/protocols/metatask/roster'));
  assert.deepEqual([...requestedSizes], ['100']);
  assert.equal(collected.events.length, 1);
  assert.equal(collected.events[0].path, 'metatask-roster');
  assert.deepEqual(collected.events[0].body.groups, [[S]]);
  assert.deepEqual(Object.keys(rosterPinsFromEvents(collected.events)), [rosterRawItem.id]);
});

// ── content recovery (MAN-p2p f23e8ec truncated list rows) ───────────────────
// List rows carry a 4096-byte contentSummary, an empty contentBody and a
// `content` download URL. A truncated body silently drops every tree node, so
// the collector refetches exactly the rows that look truncated.

const CONTENT_HOST = 'https://manapi.metaid.io/content';

/** Fake indexer: serves one pool per path, plus the content URLs on demand. */
const collectWithIndexer = async (poolItems, contentBodies = {}) => {
  const calls = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('/content/')) {
      const pinId = href.split('/content/').pop();
      const served = contentBodies[pinId];
      if (served === undefined) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(served), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const parsed = new URL(href);
    const segment = (parsed.searchParams.get('path') ?? '').split('/').pop();
    const list = poolItems.filter((item) => String(item.path).split('/').pop() === segment);
    return new Response(JSON.stringify({ code: 1, data: { list } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const collected = await collectMetaTaskEvents({ fetchImpl, disableSurfRecovery: true });
  return { collected, contentCalls: () => calls.filter((href) => href.includes('/content/')) };
};

const truncatedTreeRow = (pinId, body, over = {}) => {
  const json = JSON.stringify(body);
  return {
    id: pinId,
    path: '/protocols/metatask/tree',
    globalMetaId: P,
    genesisHeight: 189_900,
    txIndex: 0,
    timestamp: 1_790_000_000_000,
    contentSummary: over.contentSummary ?? json.slice(0, 4096),
    contentBody: '',
    content: `${CONTENT_HOST}/${pinId}`,
    contentLength: over.contentLength ?? Buffer.byteLength(json, 'utf8'),
  };
};

const bigTreeBody = () => ({
  root: 'r1',
  nodes: [
    { id: 'r1', parent: null, title: 'root', kind: 'aggregate', specid: null, params: {}, deps: [], weight: 3000 },
    { id: 't1', parent: 'r1', title: 'leaf', kind: 'proof', specid: null, params: {}, deps: [], weight: 7000 },
  ],
  // Pushes the body past the 4096-byte summary window so the cut lands inside
  // this string and the truncated summary cannot parse.
  padding: 'x'.repeat(5_000),
});

test('collector: a truncated summary is recovered from the content URL (one request)', async () => {
  const full = bigTreeBody();
  const row = truncatedTreeRow('treebig0000001i0', full);
  const { collected, contentCalls } = await collectWithIndexer([row], { treebig0000001i0: full });

  const event = collected.events.find((candidate) => candidate.pinId === 'treebig0000001i0');
  assert.deepEqual(event.body, full, 'the full body replaced the truncated summary');
  assert.deepEqual(contentCalls(), [`${CONTENT_HOST}/treebig0000001i0`]);

  // A summary that still parses but is provably shorter than the declared body
  // is recovered too (same pin ids/heights, only the body differs).
  const shortRow = truncatedTreeRow('treeshort000001i0', full, {
    contentSummary: '{"root":"r1","nodes":[]}',
    contentLength: 18_660,
  });
  const second = await collectWithIndexer([shortRow], { treeshort000001i0: full });
  assert.deepEqual(second.collected.events[0].body, full);
  assert.equal(second.contentCalls().length, 1);
});

test('collector: a complete inline body costs zero content requests', async () => {
  const small = {
    root: 'r1',
    nodes: [{ id: 'r1', parent: null, title: 'root', kind: 'aggregate', specid: null, params: {}, deps: [], weight: 10_000 }],
  };
  const exact = truncatedTreeRow('treesmall00001i0', small, {
    contentSummary: JSON.stringify(small),
    contentLength: Buffer.byteLength(JSON.stringify(small), 'utf8'),
  });
  // JSON escaping can shift the byte count by a few bytes: inside the margin
  // the summary is still treated as complete.
  const withinMargin = truncatedTreeRow('treesmall00002i0', small, {
    contentSummary: JSON.stringify(small),
    contentLength: Buffer.byteLength(JSON.stringify(small), 'utf8') + 8,
  });
  // A pre-f23e8ec row carrying the full base64 body never qualifies either.
  const legacy = {
    id: 'treelegacy0001i0',
    path: '/protocols/metatask/tree',
    globalMetaId: P,
    genesisHeight: 189_900,
    txIndex: 0,
    timestamp: 1_790_000_000_000,
    contentSummary: JSON.stringify(small).slice(0, 10),
    contentBody: Buffer.from(JSON.stringify(small)).toString('base64'),
    content: `${CONTENT_HOST}/treelegacy0001i0`,
    contentLength: 5_000,
  };

  const { collected, contentCalls } = await collectWithIndexer([exact, withinMargin, legacy], {});
  assert.equal(contentCalls().length, 0, 'healthy rows never hit the content endpoint');
  for (const pinId of ['treesmall00001i0', 'treesmall00002i0', 'treelegacy0001i0']) {
    assert.deepEqual(
      collected.events.find((event) => event.pinId === pinId).body,
      small,
      `${pinId} parsed from its inline body`
    );
  }
});

test('collector: a failing content fetch keeps the inline body and the sweep completes', async () => {
  const row = truncatedTreeRow('treefail00001i0', bigTreeBody());
  const { collected, contentCalls } = await collectWithIndexer([row], {});

  assert.equal(contentCalls().length, 1, 'the recovery was attempted');
  const event = collected.events.find((candidate) => candidate.pinId === 'treefail00001i0');
  assert.deepEqual(event.body, {}, 'no body to keep — the truncated summary never parsed');
  assert.equal(collected.perPath.length, 10, 'the sweep still completed every pool');
});

// ── so.metaid.io batch recovery tier ─────────────────────────────────────────

test('collector: a contentless truncated row is recovered via the so.metaid.io batch', async () => {
  const full = bigTreeBody();
  // No `content` download URL and an empty contentBody: only the surf tier
  // can supply the full payload.
  const json = JSON.stringify(full);
  const row = {
    id: 'treesurf0001i0',
    path: '/protocols/metatask/tree',
    globalMetaId: P,
    genesisHeight: 189_900,
    txIndex: 0,
    timestamp: 1_790_000_000_000,
    contentSummary: json.slice(0, 100),
    contentBody: '',
    contentLength: Buffer.byteLength(json, 'utf8'),
  };
  let batchCalls = 0;
  const fetchImpl = async (url, init) => {
    const href = String(url);
    if (href.includes('/api/metaweb/pins:batch')) {
      batchCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}'));
      const pins = {};
      for (const pinId of body.pinIds ?? []) {
        pins[pinId] = {
          pinId,
          path: '/protocols/metatask/tree',
          operation: 'create',
          createdAt: 1_790_000_000,
          payload: full,
        };
      }
      return new Response(JSON.stringify({ code: 0, data: { pins } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const parsed = new URL(href);
    const segment = (parsed.searchParams.get('path') ?? '').split('/').pop();
    const list = segment === 'tree' ? [row] : [];
    return new Response(JSON.stringify({ code: 1, data: { list } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const collected = await collectMetaTaskEvents({ fetchImpl });
  assert.equal(batchCalls, 1, 'exactly one batch request for the one truncated row');
  const event = collected.events.find((candidate) => candidate.pinId === 'treesurf0001i0');
  assert.deepEqual(event.body, full, 'the never-truncated MetaWeb payload replaced the summary');
});
