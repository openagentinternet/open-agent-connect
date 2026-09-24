import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildSurfPageDefinition } = require('../../dist/ui/pages/surf/app.js');
const { translate } = require('../../dist/ui/i18n.js');

function makeElement(tag = 'div') {
  const listeners = new Map();
  const children = new Map();
  return {
    tagName: tag,
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    checked: false,
    className: '',
    addEventListener: (eventName, handler) => listeners.set(eventName, handler),
    listener: (eventName) => listeners.get(eventName),
    querySelector: (selector) => {
      if (!children.has(selector)) children.set(selector, makeElement());
      return children.get(selector);
    },
    querySelectorAll: () => [],
  };
}

function createHarness(fetchImpl) {
  const elements = {
    '[data-surf-status]': makeElement(),
    '[data-surf-refresh]': makeElement(),
    '[data-surf-run]': makeElement('button'),
    '[data-surf-status-list]': makeElement('dl'),
    '[data-surf-enabled-hint]': makeElement(),
    '[data-surf-toggle]': makeElement('button'),
    '[data-surf-budget-form]': makeElement('form'),
    '[data-surf-budget-input]': makeElement('input'),
    '[data-surf-budget-save]': makeElement('button'),
    '[data-surf-settings-status]': makeElement(),
    '[data-surf-reports-meta]': makeElement(),
    '[data-surf-reports-table]': makeElement('div'),
    '[data-surf-report-viewer]': makeElement('article'),
  };
  const calls = [];
  const listeners = new Map();
  const context = {
    URLSearchParams,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetchImpl(url, options);
    },
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    document: {
      querySelector: (selector) => elements[selector] ?? null,
      activeElement: null,
    },
    window: {
      location: { search: '' },
      __oacLocalUiI18n: {
        t: (key, replacements = {}) => translate('en', key, replacements),
      },
      addEventListener: (eventName, handler) => listeners.set(eventName, handler),
    },
  };
  return { elements, calls, context, listeners };
}

const jsonResponse = (payload) => ({
  json: async () => payload,
});

const statusPayload = {
  ok: true,
  state: 'success',
  data: {
    botSlug: 'alice',
    running: false,
    surfBeforeDreamEnabled: true,
    interactionBudget: 25,
    preDreamDue: false,
    runs: [
      {
        id: 'run-2',
        trigger: 'manual-ui',
        status: 'done',
        stats: { fetched: 12, deepRead: 4, savedToKb: 2 },
        reportMarkdown: '# Morning surf\n\n- saw a protocol\n- saved a wiki',
        reportJson: null,
        error: null,
        startedAt: new Date(Date.now() - 3600_000).toISOString(),
        finishedAt: new Date(Date.now() - 3500_000).toISOString(),
        createdAt: new Date(Date.now() - 3600_000).toISOString(),
        updatedAt: new Date(Date.now() - 3500_000).toISOString(),
      },
      {
        id: 'run-1',
        trigger: 'pre-dream',
        status: 'failed',
        stats: { fetched: 0, deepRead: 0, savedToKb: 0 },
        reportMarkdown: null,
        reportJson: null,
        error: 'metaweb unreachable',
        startedAt: new Date(Date.now() - 86_400_000).toISOString(),
        finishedAt: new Date(Date.now() - 86_400_000 + 60_000).toISOString(),
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        updatedAt: new Date(Date.now() - 86_400_000 + 60_000).toISOString(),
      },
    ],
  },
};

test('surf page renders status card, reports table, and markdown report viewer', async () => {
  const harness = createHarness(async (url) => {
    assert.equal(url, '/api/surf/status');
    return jsonResponse(statusPayload);
  });
  vm.runInNewContext(buildSurfPageDefinition().script, harness.context);
  await new Promise((resolve) => setImmediate(resolve));

  const { elements } = harness;
  assert.equal(elements['[data-surf-status]'].textContent, 'Surf status loaded.');
  // Status card: enabled pill, budget, last/next run rows.
  assert.match(elements['[data-surf-status-list]'].innerHTML, /status-online/);
  assert.match(elements['[data-surf-status-list]'].innerHTML, /Tonight, before the dream/);
  assert.match(elements['[data-surf-status-list]'].innerHTML, /<dd>25<\/dd>/);
  // Reports table lists both runs and marks the failed one.
  assert.match(elements['[data-surf-reports-table]'].innerHTML, /data-view-report="run-2"/);
  assert.match(elements['[data-surf-reports-table]'].innerHTML, /data-view-report="run-1"/);
  assert.match(elements['[data-surf-reports-table]'].innerHTML, /status-failure/);
  assert.match(elements['[data-surf-reports-table]'].innerHTML, /fetched 12 · deep-read 4 · saved 2/);
  // Newest run auto-selected; markdown report rendered into the viewer.
  assert.match(elements['[data-surf-report-viewer]'].innerHTML, /<h1>Morning surf<\/h1>/);
  assert.match(elements['[data-surf-report-viewer]'].innerHTML, /<li>saw a protocol<\/li>/);
});

test('surf page validates the budget before saving and posts budget updates', async () => {
  const harness = createHarness(async (url, options = {}) => {
    if (url === '/api/surf/status') return jsonResponse(statusPayload);
    if (url === '/api/surf/budget') return jsonResponse({ ok: true, state: 'success', data: { interactionBudget: 40 } });
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildSurfPageDefinition().script, harness.context);
  await new Promise((resolve) => setImmediate(resolve));

  const { elements } = harness;
  const submit = elements['[data-surf-budget-form]'].listener('submit');
  assert.equal(typeof submit, 'function');

  elements['[data-surf-budget-input]'].value = 'abc';
  await submit({ preventDefault() {} });
  assert.equal(elements['[data-surf-settings-status]'].textContent, 'Enter a whole number of 1 or more.');
  assert.ok(elements['[data-surf-settings-status]'].className.includes('error'));
  assert.equal(harness.calls.filter((call) => call.url === '/api/surf/budget').length, 0);

  elements['[data-surf-budget-input]'].value = '40';
  await submit({ preventDefault() {} });
  const budgetCall = harness.calls.find((call) => call.url === '/api/surf/budget');
  assert.ok(budgetCall, 'budget endpoint should be called');
  assert.deepEqual(JSON.parse(budgetCall.options.body), { budget: 40 });
  assert.equal(elements['[data-surf-settings-status]'].textContent, 'Surf setting saved.');
});

test('surf page posts a manual-ui run and surfaces the started status', async () => {
  const harness = createHarness(async (url, options = {}) => {
    if (url === '/api/surf/status') return jsonResponse(statusPayload);
    if (url === '/api/surf/run') {
      assert.deepEqual(JSON.parse(options.body), { trigger: 'manual-ui' });
      return jsonResponse({ ok: true, state: 'success', data: { runId: 'run-3', trigger: 'manual-ui', status: 'running' } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildSurfPageDefinition().script, harness.context);
  await new Promise((resolve) => setImmediate(resolve));

  const { elements } = harness;
  const runHandler = elements['[data-surf-run]'].listener('click');
  await runHandler();
  assert.equal(elements['[data-surf-status]'].textContent, 'Surf run started. The report appears when the run finishes.');
  assert.ok(harness.calls.some((call) => call.url === '/api/surf/run'));
});

test('surf page shows a fixable error when the status endpoint fails', async () => {
  const harness = createHarness(async () => {
    throw new Error('daemon offline');
  });
  vm.runInNewContext(buildSurfPageDefinition().script, harness.context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.elements['[data-surf-status]'].textContent, 'daemon offline');
  // Empty report state still invites the user to act.
  assert.match(harness.elements['[data-surf-reports-table]'].innerHTML, /No surf runs yet/);
  assert.match(harness.elements['[data-surf-report-viewer]'].innerHTML, /Select a run to read its report/);
});
