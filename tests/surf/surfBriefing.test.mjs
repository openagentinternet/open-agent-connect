// Surf briefing cap semantics — OAC port of the IDBots surfBriefing tests:
// defer-not-drop caps, backlog cursors, ledger filtering, inbox/radar errors.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createMetawebSurfStore } = require('../../dist/core/surf/store.js');
const {
  buildSurfBriefing,
  renderSurfBriefingMarkdown,
  SURF_TOTAL_FETCH_LIMIT,
} = require('../../dist/core/surf/briefing.js');

async function createTempProfileHome(label) {
  const base = await mkdtempTempRoot(`metabot-surf-brief-${label}-`);
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

function descriptor(key, behavior = {}) {
  return {
    key,
    displayName: key,
    paths: [`/protocols/${key}`],
    interactions: ['like'],
    relevanceHint: '',
    fetchFresh: async ({ sinceTs, limit, backlogCursor }) => behavior.fetchFresh({ sinceTs, limit, backlogCursor }),
  };
}

function item(key, pinId, createdAt) {
  return {
    pinId,
    protocolKey: key,
    chainName: 'mvc',
    title: `t-${pinId}`,
    summary: '',
    authorName: '',
    authorGlobalMetaId: '',
    createdAt,
    likeCount: null,
    commentCount: null,
    extra: null,
  };
}

test('per-protocol caps hold; total cap defers crowded-out content (never drops)', async () => {
  const paths = await createTempProfileHome('caps');
  const store = createMetawebSurfStore(paths);
  // 2 protocols × 100 items each → global cap 150 keeps the newest 150.
  const registry = [
    descriptor('a', {
      fetchFresh: async ({ limit }) => ({
        items: Array.from({ length: 100 }, (_, index) => item('a', `a-${index}`, 1000 + index)),
        hasMore: false,
        nextCursor: null,
      }),
    }),
    descriptor('b', {
      fetchFresh: async () => ({
        items: Array.from({ length: 100 }, (_, index) => item('b', `b-${index}`, 1000 + index)),
        hasMore: false,
        nextCursor: null,
      }),
    }),
  ];
  const briefing = await buildSurfBriefing({ store, interactionBudget: 5, registry, nowMs: Date.parse('2026-09-15T10:00:00Z') });
  assert.equal(briefing.items.length, SURF_TOTAL_FETCH_LIMIT);
  const sectionA = briefing.protocols.find((section) => section.key === 'a');
  const inListA = briefing.items.filter((entry) => entry.protocolKey === 'a').length;
  assert.equal(sectionA.keptCount, 100);
  assert.equal(sectionA.droppedByTotalCap, 100 - inListA);
  assert.ok(sectionA.droppedByTotalCap > 0);
  // Watermark = oldest kept item of the section (deferral re-fetches it).
  const oldestKeptA = Math.min(...briefing.items.filter((entry) => entry.protocolKey === 'a').map((entry) => entry.createdAt));
  assert.equal(sectionA.nextWatermarkTs, oldestKeptA);
  // The digest markdown reports held-back content.
  const markdown = renderSurfBriefingMarkdown(briefing);
  assert.match(markdown, /held back by the run cap/);
});

test('first surf looks back 7 days; watermark filter is inclusive (>=)', async () => {
  const paths = await createTempProfileHome('lookback');
  const store = createMetawebSurfStore(paths);
  const nowMs = Date.parse('2026-09-15T10:00:00Z');
  let seenSince = null;
  const registry = [descriptor('a', {
    fetchFresh: async ({ sinceTs }) => {
      seenSince = sinceTs;
      return { items: [], hasMore: false, nextCursor: null };
    },
  })];
  await buildSurfBriefing({ store, interactionBudget: 5, registry, nowMs });
  assert.equal(seenSince, Math.floor(nowMs / 1000) - 7 * 24 * 60 * 60);

  // Watermark set → same-second items survive the >= filter.
  await store.advanceProtocolState('a', { lastSeenTs: 2000, nowIso: '2026-09-15T10:00:00Z' });
  const calls = [];
  const registry2 = [descriptor('a', {
    fetchFresh: async ({ sinceTs }) => {
      calls.push(sinceTs);
      return {
        items: [item('a', 'same-second', 2000), item('a', 'newer', 2001)],
        hasMore: false,
        nextCursor: null,
      };
    },
  })];
  const briefing = await buildSurfBriefing({ store, interactionBudget: 5, registry: registry2, nowMs });
  assert.equal(calls[0], 2000);
  assert.equal(briefing.items.length, 2);
});

test('ledger filters already-seen pins; all-seen advances watermark to newest', async () => {
  const paths = await createTempProfileHome('ledger');
  const store = createMetawebSurfStore(paths);
  await store.markSeen('seen-1', 'presented', '2026-09-14T10:00:00Z');
  await store.advanceProtocolState('a', { lastSeenTs: 1000, nowIso: '2026-09-14T10:00:00Z' });
  const registry = [descriptor('a', {
    fetchFresh: async () => ({
      items: [item('a', 'seen-1', 1500), item('a', 'fresh-1', 1600)],
      hasMore: false,
      nextCursor: null,
    }),
  })];
  const briefing = await buildSurfBriefing({ store, interactionBudget: 5, registry, nowMs: Date.parse('2026-09-15T10:00:00Z') });
  assert.deepEqual(briefing.items.map((entry) => entry.pinId), ['fresh-1']);
  const section = briefing.protocols[0];
  assert.equal(section.keptCount, 1);
  assert.equal(section.nextWatermarkTs, 1600);
});

test('hasMore registers backlog debt (store cursor); backlog pages never advance the watermark', async () => {
  const paths = await createTempProfileHome('backlog');
  const store = createMetawebSurfStore(paths);
  const registry = [descriptor('a', {
    fetchFresh: async ({ backlogCursor }) => {
      if (!backlogCursor) {
        return {
          items: [item('a', 'w-1', 2000)],
          hasMore: true,
          nextCursor: 'cursor-page-2',
        };
      }
      return {
        items: [item('a', 'b-1', 1500)],
        hasMore: false,
        nextCursor: null,
      };
    },
  })];
  // Window page with hasMore: debt registered, watermark advances to newest kept.
  let briefing = await buildSurfBriefing({ store, interactionBudget: 5, registry, nowMs: Date.parse('2026-09-15T10:00:00Z') });
  let section = briefing.protocols[0];
  assert.equal(section.backlogCursorAction, 'store');
  assert.equal(section.backlogCursor, 'cursor-page-2');
  assert.equal(section.nextWatermarkTs, 2000);

  // Backlog page (cursor set): items pass without since filter; watermark untouched.
  await store.advanceProtocolState('a', { lastSeenTs: 2000, nowIso: '2026-09-15T10:00:00Z', backlogCursor: 'cursor-page-2' });
  briefing = await buildSurfBriefing({ store, interactionBudget: 5, registry, nowMs: Date.parse('2026-09-15T11:00:00Z') });
  section = briefing.protocols[0];
  assert.equal(section.fetchedBacklog, true);
  assert.ok(briefing.items.some((entry) => entry.pinId === 'b-1'));
  assert.equal(section.nextWatermarkTs, null);
  assert.equal(section.backlogCursorAction, 'clear');
});

test('fetch errors land in the section error, never throw; inbox/radar ride along', async () => {
  const paths = await createTempProfileHome('errors');
  const store = createMetawebSurfStore(paths);
  const registry = [
    descriptor('bad', {
      fetchFresh: async () => {
        throw new Error('backend down');
      },
    }),
  ];
  const briefing = await buildSurfBriefing({
    store,
    interactionBudget: 7,
    registry,
    nowMs: Date.parse('2026-09-15T10:00:00Z'),
    fetchInbox: async () => {
      throw new Error('inbox sick');
    },
    fetchProtocolRadar: async () => ({
      items: [{ path: '/protocols/x', title: 'X', protocolName: 'x', intro: '', version: '1', authorName: '', createdAt: 123 }],
      rejectedCount: 2,
    }),
  });
  assert.equal(briefing.protocols[0].error, 'backend down');
  assert.equal(briefing.protocols[0].backlogCursorAction, 'preserve');
  assert.equal(briefing.inbox.error, 'inbox sick');
  assert.equal(briefing.protocolRadar.items.length, 1);
  assert.equal(briefing.protocolRadar.rejectedCount, 2);
});
