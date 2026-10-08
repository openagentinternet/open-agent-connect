import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const pluginRoot = path.join(here, '..');

const read = (relative) => readFileSync(path.join(pluginRoot, relative), 'utf8');

const META_LOGIC_EXPORTS = [
  'candidateState',
  'candidatesByPin',
  'raceFrontTip',
  'raceFrontPath',
  'candidateArtifactOf',
  'metafileViewUrl',
  'taskLifecycleOf',
  'shortPin',
  'shortMetaId',
];

test('metatask logic: shared pure module exports the display contract', () => {
  const source = read('src/metatask-logic.ts');
  for (const name of META_LOGIC_EXPORTS) {
    assert.match(source, new RegExp(`export (const|function|type) ${name}\\b`), `${name} must be exported`);
  }
});

test('metatask logic: candidateState maps engine flags per §4.1', async () => {
  const logic = require(path.join(pluginRoot, 'lib', 'metatask-logic.js'));
  const byPin = new Map([
    ['parentDead', { pinId: 'parentDead', verified: true, chainValid: true, superseded: true, failed: false, parentrefs: null }],
    ['parentOk', { pinId: 'parentOk', verified: true, chainValid: true, superseded: false, failed: false, parentrefs: null }],
  ]);
  const node = { id: 'a', status: 'claimed', submission: { pinId: 'lead' }, submissions: [] };
  const base = { verified: true, chainValid: true, superseded: false, failed: false, parentrefs: null };
  assert.equal(logic.candidateState(node, { ...base, failed: true, verified: false }, byPin, null), 'rejected');
  assert.equal(logic.candidateState(node, { ...base, superseded: true }, byPin, null), 'replaced');
  assert.equal(logic.candidateState(node, { ...base, pinId: 'lead' }, byPin, new Set(['lead'])), 'winner');
  assert.equal(logic.candidateState(node, { ...base, pinId: 'lead' }, byPin, null), 'leading');
  assert.equal(logic.candidateState(node, { ...base, pinId: 'other' }, byPin, null), 'behind');
  const stalled = { ...base, pinId: 'child', verified: false, parentrefs: { a: 'parentDead' } };
  assert.equal(logic.candidateState(node, stalled, byPin, null), 'stalled');
  const awaiting = { ...base, chainValid: false, pinId: 'x' };
  assert.equal(logic.candidateState(node, awaiting, byPin, null), 'awaitingDeps');
  const inReview = { ...base, verified: false, chainValid: false, pinId: 'y', parentrefs: { a: 'parentOk' } };
  assert.equal(logic.candidateState(node, inReview, byPin, null), 'inReview');
  const optimistic = { ...base, verified: false, chainValid: false, pinId: 'z', parentrefs: { a: 'parentDead' }, failed: false, superseded: false };
  // parentDead is superseded → stalled, not optimistic; use an unknown parent for optimistic.
  const optimistic2 = { ...optimistic, parentrefs: { a: 'ghost' } };
  assert.equal(logic.candidateState(node, optimistic2, byPin, null), 'optimistic');
});

test('metatask panel: registration id/order/icon/width per the UI contract', () => {
  const index = read('src/client/index.ts');
  assert.match(index, /id: 'oac-tracking',\n\s+order: 21,/, 'section id oac-tracking at order 21');
  assert.match(index, /label: \(\) => t\('navTracking'\)/, 'nav label uses the navTracking key');
  assert.match(index, /import \{ TrackingTasksPanel \} from '\.\/TrackingTasksPanel\.tsx'/, 'panel import');
  assert.match(index, /TRACKING_CSS/, 'tracking styles join the injection');

  const botsPage = read('src/client/bots-page.tsx');
  assert.match(botsPage, /'oac-tracking': Icon\w+16/, 'section icon registered');

  const styles = read('src/client/styles.ts');
  assert.match(
    styles,
    /\.oac-bots-page-content > \[role='tabpanel'\]:has\(\.oac-track-shell\) \{ max-width: none; \}/,
    'the :has() rule lifts the 720px cap for the tracking shell only'
  );
  assert.match(styles, /\.oac-track-shell \{ width: 100%;/, 'shell takes full width');
});

test('metatask panel: the shell is NOT capped by .oac-panel', () => {
  const panel = read('src/client/TrackingTasksPanel.tsx');
  assert.match(panel, /className="oac-track-shell"/, 'panel root uses the track shell class');
  assert.doesNotMatch(panel, /className="oac-panel"/, 'the 720px-capping .oac-panel class must not wrap the shell');
});

test('metatask locale: en/zh dictionaries stay key-parity including the mt* block', () => {
  const source = read('src/client/locale.ts');
  const keys = (block) => [...block.matchAll(/^  ([a-zA-Z_][a-zA-Z0-9_]*):/gm)].map((match) => match[1]);
  const en = source.slice(source.indexOf('export const en = {'), source.indexOf('export const zh = {'));
  const zh = source.slice(source.indexOf('export const zh = {'));
  assert.deepEqual(keys(en).sort(), keys(zh).sort(), 'en and zh must carry the same keys');
  const enKeys = keys(en);
  for (const key of ['navTracking', 'trackingTabMetatask', 'mtViewSquare', 'mtCand_winner', 'mtCand_stalled', 'mtSettleTitle']) {
    assert.ok(enKeys.includes(key), `${key} present`);
  }
});

test('metatask host routes: dispatcher bridges the CLI verbs', async () => {
  const { dispatchMetaTaskRoutes } = require(path.join(pluginRoot, 'lib', 'metatask-routes.js'));
  const calls = [];
  const run = async (args) => { calls.push(args); return { ok: true, state: 'success', data: {} }; };
  assert.equal(await dispatchMetaTaskRoutes('other/thing', {}, { run }), undefined, 'non-metatask falls through');
  await dispatchMetaTaskRoutes('metatask/board', {}, { run });
  await dispatchMetaTaskRoutes('metatask/task', { root: 'abc' }, { run });
  await dispatchMetaTaskRoutes('metatask/replay', { root: 'abc' }, { run });
  await dispatchMetaTaskRoutes('metatask/refresh', {}, { run });
  await dispatchMetaTaskRoutes('metatask/board', { refresh: true }, { run });
  assert.deepEqual(calls[0], ['metatask', 'list']);
  assert.deepEqual(calls[1], ['metatask', 'get', '--root', 'abc']);
  assert.deepEqual(calls[2], ['metatask', 'replay', '--root', 'abc']);
  assert.deepEqual(calls[3], ['metatask', 'refresh']);
  assert.deepEqual(calls[4], ['metatask', 'list', '--refresh']);
  const refused = await dispatchMetaTaskRoutes('metatask/task', {}, { run });
  assert.equal(refused.ok, false, 'missing root refused');
});

test('metatask plugin index: the dispatcher is chained into the host API', () => {
  const hostIndex = read('src/index.ts');
  assert.match(hostIndex, /import \{ dispatchMetaTaskRoutes \} from '\.\/metatask-routes\.js'/);
  assert.match(hostIndex, /const metatask = await dispatchMetaTaskRoutes\(method, payload\)/);
  assert.match(hostIndex, /if \(metatask !== undefined\) return metatask/);
});


test('metatask F13: participate draft ships on the DSH surface (api + control + locale)', () => {
  const api = read('src/client/api.ts');
  assert.match(api, /metataskDraft: async \(root: string, lang\?: 'en' \| 'zh'\)/, 'client api method');
  const board = read('src/client/metatask/MetataskBoard.tsx');
  assert.match(board, /props\.metataskDraft/, 'board consumes the draft api');
  assert.match(board, /mtParticipate/, 'cards/alerts carry the participate control');
  assert.match(board, /oac-mt-draftbox/, 'draft dialog rendered');
  const injected = read('src/client/index.ts');
  assert.match(injected, /metataskDraft: \(root: string, lang\?: 'en' \| 'zh'\) => api\.metataskDraft/);
  const locale = read('src/client/locale.ts');
  for (const key of ['mtParticipate', 'mtDraftTitle', 'mtDraftHint']) {
    assert.match(locale, new RegExp(`  ${key}: '`), `locale key ${key}`);
  }
});

test('metatask F13: the daemon serves POST /api/metatask/draft', () => {
  const routes = read('../src/daemon/routes/metatask.ts');
  assert.match(routes, /'\/api\/metatask\/draft': 'draft'/, 'route registered');
  const handlers = read('../src/daemon/metataskHandlers.ts');
  assert.match(handlers, /buildParticipateDraft/, 'handler builds the draft');
});
