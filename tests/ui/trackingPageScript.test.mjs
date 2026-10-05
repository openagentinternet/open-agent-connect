import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildTrackingPageDefinition } = require('../../dist/ui/pages/tracking/app.js');
const { edgePath, raceTip } = require('../../dist/ui/pages/tracking/chainview.js');

/**
 * Tracking page (P6): vm-sandbox test of the page IIFE (stub DOM + fetch,
 * assert endpoint URLs, board rendering, detail rendering, back navigation)
 * plus unit tests for the pure chainview geometry helpers.
 */

function makeElement(tag = 'div') {
  const listeners = new Map();
  const children = new Map();
  return {
    tagName: tag,
    textContent: '',
    innerHTML: '',
    disabled: false,
    hidden: false,
    className: '',
    style: {},
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    addEventListener: (eventName, handler) => listeners.set(eventName, handler),
    listener: (eventName) => listeners.get(eventName),
    querySelector: (selector) => {
      if (!children.has(selector)) children.set(selector, makeElement());
      return children.get(selector);
    },
    querySelectorAll: () => [],
  };
}

function createHarness(fetchUrls) {
  const board = makeElement('div');
  const boardCards = [];
  // Selector-specific element sets: each selector match set is distinct so a
  // stub element never receives handlers meant for another selector (the
  // real DOM matches each selector against distinct elements).
  const boardSets = new Map();
  const boardSetFor = (selector) => {
    if (!boardSets.has(selector)) boardSets.set(selector, []);
    return boardSets.get(selector);
  };
  boardSetFor('[data-tracking-open]');
  boardSetFor('[data-mt-view]');
  // One participate button, pre-created so the page wires its click handler
  // onto this exact element during renderBoard.
  const participateButton = makeElement('button');
  participateButton.setAttribute(
    'data-tracking-participate',
    'fad848f86d360fb61f3308b4b9eae7f6c9816eeb8eef86f2bf911c70ab8bed10i0'
  );
  boardSetFor('[data-tracking-participate]').push(participateButton);
  const boardButtons = [participateButton];
  board.querySelectorAll = (selector) => boardSetFor(String(selector));
  const elements = {
    '[data-tracking-status]': makeElement('p'),
    '[data-tracking-refresh]': makeElement('button'),
    '[data-tracking-activation]': makeElement('p'),
    '[data-tracking-board]': board,
    '[data-tracking-detail]': Object.assign(makeElement('div'), { hidden: true }),
    '[data-tracking-drawer]': Object.assign(makeElement('div'), { hidden: true }),
    '[data-tracking-tab-metatask]': makeElement('button'),
    '[data-tracking-draft]': Object.assign(makeElement('div'), { hidden: true }),
    '[data-tracking-draft-title]': makeElement('h2'),
    '[data-tracking-draft-hint]': makeElement('p'),
    '[data-tracking-draft-text]': Object.assign(makeElement('textarea'), { value: '' }),
    '[data-tracking-draft-copy]': makeElement('button'),
    '[data-tracking-draft-close]': makeElement('button'),
  };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    for (const [prefix, payload] of fetchUrls) {
      if (String(url).startsWith(prefix)) {
        return { ok: true, status: 200, json: async () => payload };
      }
    }
    return { ok: false, status: 404, json: async () => ({ ok: false, state: 'failed', message: `no stub for ${url}` }) };
  };
  const document = {
    querySelector: (selector) => elements[selector] ?? makeElement(),
    addEventListener: () => undefined,
    hidden: false,
  };
  const timers = [];
  const sandbox = {
    document,
    window: {
      setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearInterval: () => undefined,
      addEventListener: () => undefined,
      setTimeout: (fn) => { timers.push({ fn, ms: 0 }); return timers.length; },
      __oacI18n: undefined,
    },
    fetch: fetchImpl,
    console,
    encodeURIComponent,
    Object,
    String,
    Number,
    Math,
    Promise,
    JSON,
  };
  return {
    elements,
    requests,
    boardCards: boardSetFor('[data-tracking-open]'),
    participateButton,
    timers,
    run: async () => {
      const definition = buildTrackingPageDefinition();
      vm.runInNewContext(definition.script, sandbox);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const boardPayload = {
  ok: true,
  state: 'success',
  data: {
    localRosterMetaIds: [],
    tasks: [
      {
        rootPinId: 'fad848f86d360fb61f3308b4b9eae7f6c9816eeb8eef86f2bf911c70ab8bed10i0',
        title: 'MetaTask v1.3 pilot',
        brief: 'Cross-language replay-engine conformance suite',
        publisher: 'idq1publisherx',
        mode: 'competitive',
        taskComplete: true,
        progress: { total: 7, verified: 7, claimed: 0, open: 0, disputed: 0, satisfied: 7 },
        participantCount: 6,
        lastActivityMs: 1,
        freshness: { boundaryBlock: 192278, evaluatedAtMs: 1, eventCount: 79 },
        myRoles: [],
        myStats: null,
        settlementFinalized: false,
      },
    ],
    identities: { idq1publisherx: { name: 'Pilot Publisher', avatar: null } },
    alerts: [],
    activation: { hAct2: 191500, hAct3: 192800 },
    refresh: { lastRefreshAtMs: 1, lastOkAtMs: 1, lastError: null, boundaryBlock: 192278, refreshing: false },
  },
};

const draftPayload = {
  ok: true,
  state: 'success',
  data: {
    lang: 'en',
    mode: 'competitive',
    node: 'S1',
    text: 'Please have the local MetaBot join the on-chain COMPETITIVE task…',
  },
};

const taskPayload = {
  ok: true,
  state: 'success',
  data: {
    rootPinId: 'fad848f86d360fb61f3308b4b9eae7f6c9816eeb8eef86f2bf911c70ab8bed10i0',
    title: 'MetaTask v1.3 pilot',
    brief: '',
    publisher: 'idq1publisherx',
    tags: [],
    policy: { mode: 'competitive', finalNode: 'S5', claimTtlHours: 0, verifyQuorum: 2, verifyWindowHours: 0, rewardSat: 0, challengeTtlDays: 14, submitterShareBP: 8000, rosterid: null },
    nodes: [],
    amendHead: '',
    nodeStates: {
      S1: { id: 'S1', parent: null, title: 'lint', kind: 'proof', weight: 1500, params: null, specid: null, deps: [], status: 'verified', disputed: false, holder: null, submission: { pinId: 'sub1', submitter: 'idq1worker', atMs: 1, result: null, hash: null, contentType: null, attachment: null }, passVotes: 2, failVotes: 0, votes: [], cycleCount: 0 },
    },
    progress: { total: 7, verified: 7, claimed: 0, open: 0, disputed: 0, satisfied: 7 },
    taskComplete: true,
    participants: [],
    identities: { idq1publisherx: { name: 'Pilot Publisher', avatar: null }, idq1worker: { name: 'Worker', avatar: null } },
    settlement: {
      taskid: 'root', boundaryBlock: 192278, eventSetHash: 'd131', engineAlgoVersion: 'idbots-metatask-engine/1.3.0',
      shares: [{ metaId: 'idq1worker', shareBP: 3600, from: { submittedBP: 3600, reviewedBP: 0 } }],
      unpaidHistory: [], disputed: [], weightsTableHash: 'w', mode: 'competitive',
      winningChain: ['sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'sub6', 'sub7'],
    },
    freshness: { boundaryBlock: 192278, evaluatedAtMs: 1, eventCount: 79, eventSetHash: 'd131', expiryApplied: false },
    lastActivityMs: 1,
    ignoredEvents: [{ pinId: 'badpin0000000000000000000000000000000000000000000000000000i0', reason: 'invalid_reference' }],
  },
};

test('tracking page: board load hits /api/metatask/board and renders task cards', async () => {
  const harness = createHarness([['/api/metatask/board', boardPayload]]);
  await harness.run();
  assert.ok(harness.requests.some((request) => request.url === '/api/metatask/board'), 'board endpoint fetched');
  const boardHtml = harness.elements['[data-tracking-board]'].innerHTML;
  assert.match(boardHtml, /MetaTask v1\.3 pilot/);
  assert.match(boardHtml, /7\/7/);
  assert.match(boardHtml, /Pilot Publisher/);
  assert.match(boardHtml, /192278/);
  // Boundary reached H_ACT3? 192278 < 192800 → activation notice visible.
  assert.equal(harness.elements['[data-tracking-activation]'].hidden, false);
});

test('tracking page: empty board renders the empty state', async () => {
  const empty = { ...boardPayload, data: { ...boardPayload.data, tasks: [] } };
  const harness = createHarness([['/api/metatask/board', empty]]);
  await harness.run();
  assert.match(harness.elements['[data-tracking-board]'].innerHTML, /No on-chain tasks yet/);
});

test('tracking page: refresh button posts /api/metatask/refresh then reloads', async () => {
  const harness = createHarness([
    ['/api/metatask/board', boardPayload],
    ['/api/metatask/refresh', { ok: true, state: 'success', data: boardPayload.data }],
  ]);
  await harness.run();
  const boardFetchesBefore = harness.requests.filter((r) => r.url === '/api/metatask/board').length;
  const refresh = harness.elements['[data-tracking-refresh]'].listener('click');
  await refresh();
  const refreshCall = harness.requests.find((r) => r.url === '/api/metatask/refresh');
  assert.ok(refreshCall, 'refresh posted');
  assert.equal(refreshCall.options.method, 'POST');
  assert.ok(
    harness.requests.filter((r) => r.url === '/api/metatask/board').length > boardFetchesBefore,
    'board reloaded after refresh'
  );
});

test('chainview: edgePath builds the mock bezier between two rects', () => {
  const path = edgePath({ left: 0, top: 0, width: 200, height: 60 }, { left: 300, top: 120, width: 200, height: 60 });
  assert.match(path, /^M 200 30 C 250 30, 250 150, 300 150$/);
});

test('chainview: raceTip picks max coverage, then passVotes, then earliest', () => {
  const cand = (pinId, parentrefs, extra = {}) => ({
    pinId, verified: false, failed: false, superseded: false, parentrefs, passVotes: 0, atMs: 1, ...extra,
  });
  const shallow = cand('shallow', {});
  const deep = cand('deep', { a: 'shallow' }, { passVotes: 1 });
  const deepTie = cand('deepTie', { a: 'shallow' }, { passVotes: 1, atMs: 0 });
  const verified = cand('done', null, { verified: true });
  const failed = cand('dead', null, { failed: true });
  // deep and deepTie tie on coverage(1) and passVotes(1): earliest atMs wins.
  assert.equal(raceTip([shallow, deep, deepTie, verified, failed]).pinId, 'deepTie');
  // Nothing live → null.
  assert.equal(raceTip([verified]), null);
});


test('tracking page: participate button posts /api/metatask/draft and shows the copyable draft', async () => {
  const harness = createHarness([
    ['/api/metatask/board', boardPayload],
    ['/api/metatask/draft', draftPayload],
  ]);
  await harness.run();
  const boardHtml = harness.elements['[data-tracking-board]'].innerHTML;
  assert.match(boardHtml, /data-tracking-participate=/, 'unsettled card carries a participate button');
  assert.match(boardHtml, /Have my bot join/);

  // Click the wired participate button (the page registered the listener on
  // this element during renderBoard); the click flow must fetch the draft and
  // surface it in the copyable overlay.
  const click = harness.participateButton.listener('click');
  assert.ok(click, 'participate click handler wired');
  await click({ stopPropagation: () => undefined });
  const participateFetch = harness.requests.find((request) => request.url === '/api/metatask/draft');
  assert.ok(participateFetch, 'draft endpoint called');
  assert.equal(participateFetch.options.method, 'POST');
  const draftBody = String(participateFetch.options.body);
  assert.match(draftBody, /"lang":"en"/);
  assert.match(draftBody, /fad848f86d360fb6/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.elements['[data-tracking-draft]'].hidden, false, 'draft overlay shown');
  assert.match(harness.elements['[data-tracking-draft-text]'].value, /COMPETITIVE task/);
});
test('tracking page: competitive detail renders the ported fidelity blocks', async () => {
  const card = makeElement('article');
  card.setAttribute('data-tracking-open', 'fad848f86d360fb61f3308b4b9eae7f6c9816eeb8eef86f2bf911c70ab8bed10i0');
  const harness = createHarness([
    ['/api/metatask/board', boardPayload],
    ['/api/metatask/task', taskPayload],
  ]);
  harness.boardCards.push(card);
  await harness.run();
  const click = card.listener('click');
  assert.ok(click, 'card click handler wired');
  await click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const detailHtml = harness.elements['[data-tracking-detail]'].innerHTML;
  assert.match(detailHtml, /oac-mt-detail-head/, 'detail header block');
  assert.match(detailHtml, /MetaTask v1\.3 pilot/);
  assert.match(detailHtml, /oac-mt-badge-id/, 'identity badge with name/avatar');
  assert.match(detailHtml, /Pilot Publisher/);
  assert.match(detailHtml, /data-mt-chain-canvas/, 'chain canvas for edge overlay');
  assert.match(detailHtml, /oac-mt-nodesection/, 'node requirement sections');
  assert.match(detailHtml, /oac-mt-table/, 'roster/settlement tables');
  assert.match(detailHtml, /oac-mt-cand /, 'chain candidate cards');
  assert.match(detailHtml, /oac-mt-badge-settled/, 'completed task hides the participate button');
});

test('tracking page: tree detail renders the structure map and branch node table', async () => {
  const treeBoard = {
    ...boardPayload,
    data: {
      ...boardPayload.data,
      tasks: [{
        ...boardPayload.data.tasks[0],
        rootPinId: 'treeRoot1',
        mode: 'tree',
        title: 'Tree pilot',
      }],
    },
  };
  const treeTask = {
    ok: true,
    state: 'success',
    data: {
      rootPinId: 'treeRoot1',
      title: 'Tree pilot',
      brief: '',
      publisher: 'idq1publisherx',
      tags: [],
      policy: { mode: 'tree', finalNode: null, claimTtlHours: 24, verifyQuorum: 2, verifyWindowHours: 0, rewardSat: 0, challengeTtlDays: 14, submitterShareBP: 8000, rosterid: null },
      nodes: [],
      amendHead: '',
      nodeStates: {
        '0': { id: '0', parent: null, title: 'root aggregate', kind: 'aggregate', weight: null, params: null, specid: null, deps: [], status: 'open', disputed: false, holder: null, submission: null, passVotes: 0, failVotes: 0, votes: [], cycleCount: 0 },
        m1: { id: 'm1', parent: '0', title: 'group one', kind: 'math', weight: 5000, params: { rubric: ['prove it'] }, specid: null, deps: [], status: 'open', disputed: false, holder: null, submission: null, passVotes: 0, failVotes: 0, votes: [], cycleCount: 0 },
        t1: { id: 't1', parent: 'm1', title: 'leaf one', kind: 'math', weight: 2500, params: null, specid: null, deps: [], status: 'claimed', disputed: true, holder: { pinId: 'c1', claimant: 'idq1worker', sinceMs: 1 }, submission: null, passVotes: 0, failVotes: 0, votes: [], cycleCount: 0 },
      },
      progress: { total: 3, verified: 0, claimed: 1, open: 2, disputed: 1, satisfied: 0 },
      taskComplete: false,
      participants: [],
      identities: { idq1publisherx: { name: 'Pilot Publisher', avatar: null }, idq1worker: { name: 'Worker', avatar: null } },
      settlement: null,
      estimation: { basis: 'x', shares: [] },
      freshness: { boundaryBlock: 192278, evaluatedAtMs: 1, eventCount: 12, eventSetHash: 'h', expiryApplied: false },
      lastActivityMs: 1,
      ignoredEvents: [],
    },
  };
  const card = makeElement('article');
  card.setAttribute('data-tracking-open', 'treeRoot1');
  const harness = createHarness([
    ['/api/metatask/board', treeBoard],
    ['/api/metatask/task', treeTask],
  ]);
  harness.boardCards.push(card);
  await harness.run();
  await card.listener('click')();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const detailHtml = harness.elements['[data-tracking-detail]'].innerHTML;
  assert.match(detailHtml, /oac-mt-treemap-card/, 'task structure map card');
  assert.match(detailHtml, /oac-mt-treemap-group/, 'group card in the map');
  assert.match(detailHtml, /oac-tm-dot-claimed/, 'status dot in the map');
  assert.match(detailHtml, /oac-mt-treetable/, 'branch node table');
  assert.match(detailHtml, /oac-mt-node-m1/, 'group row anchor');
  assert.match(detailHtml, /oac-mt-nodestatus-claimed/, 'node status tone');
  assert.match(detailHtml, /oac-mt-checklist/, 'pending settlement checklist');
});
