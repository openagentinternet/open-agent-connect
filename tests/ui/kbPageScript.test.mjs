import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildKbPageDefinition } = require('../../dist/ui/pages/kb/app.js');
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
    selected: false,
    className: 'status-msg',
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
    '[data-kb-status]': makeElement(),
    '[data-kb-refresh]': makeElement(),
    '[data-kb-list]': makeElement(),
    '[data-kb-create-form]': makeElement('form'),
    '[data-kb-create-name]': makeElement('input'),
    '[data-kb-create-description]': makeElement('input'),
    '[data-kb-create-submit]': makeElement('button'),
    '[data-kb-create-status]': makeElement(),
    '[data-kb-detail]': makeElement('article'),
    '[data-kb-query-form]': makeElement('form'),
    '[data-kb-query-select]': makeElement('select'),
    '[data-kb-query-input]': makeElement('input'),
    '[data-kb-query-submit]': makeElement('button'),
    '[data-kb-query-results]': makeElement('div'),
    '[data-kb-query-status]': makeElement(),
    '[data-kb-study-form]': makeElement('form'),
    '[data-kb-study-topic]': makeElement('input'),
    '[data-kb-study-budget]': makeElement('input'),
    '[data-kb-study-submit]': makeElement('button'),
    '[data-kb-study-table]': makeElement('div'),
    '[data-kb-study-status]': makeElement(),
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

const listPayload = {
  ok: true,
  state: 'success',
  data: {
    knowledgeBases: [
      {
        id: 'kb-default',
        metabotSlug: 'alice',
        name: 'Default',
        description: '',
        rawDir: '/tmp/kb-default/raw',
        isDefault: true,
        autoLearn: true,
        docCount: 3,
        chunkCount: 9,
        lastLearnedAt: Date.now() - 7200_000,
        lastAutoLearnDate: null,
        createdAt: Date.now() - 86_400_000,
        updatedAt: Date.now() - 7200_000,
      },
      {
        id: 'kb-research',
        metabotSlug: 'alice',
        name: 'Research',
        description: 'MetaWeb protocols',
        rawDir: '/tmp/kb-research/raw',
        isDefault: false,
        autoLearn: false,
        docCount: 0,
        chunkCount: 0,
        lastLearnedAt: null,
        lastAutoLearnDate: null,
        createdAt: Date.now() - 172_800_000,
        updatedAt: Date.now() - 172_800_000,
      },
    ],
  },
};

const studyPayload = {
  ok: true,
  state: 'success',
  data: {
    jobs: [
      {
        id: 'study-1',
        metabotSlug: 'alice',
        kind: 'topic',
        topic: 'skill packages',
        status: 'failed',
        budgetPins: 10,
        processedPinIds: ['pin-a'],
        runCount: 2,
        consecutiveFailures: 2,
        lastRunAt: Date.now() - 3600_000,
        summary: null,
        error: 'read timeout',
        createdAt: Date.now() - 86_400_000,
        updatedAt: Date.now() - 3600_000,
      },
    ],
  },
};

test('kb page renders list, detail, and study table from api payloads', async () => {
  const harness = createHarness(async (url) => {
    if (url === '/api/kb/list') return jsonResponse(listPayload);
    if (url === '/api/kb/study/status') return jsonResponse(studyPayload);
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildKbPageDefinition().script, harness.context);
  await new Promise((resolve) => setImmediate(resolve));

  const { elements } = harness;
  assert.equal(elements['[data-kb-status]'].textContent, 'Knowledge bases loaded.');
  // List shows both knowledge bases with the Default badge.
  assert.match(elements['[data-kb-list]'].innerHTML, /data-kb-id="kb-default"/);
  assert.match(elements['[data-kb-list]'].innerHTML, /data-kb-id="kb-research"/);
  assert.match(elements['[data-kb-list]'].innerHTML, /Default/);
  // First knowledge base auto-selected: detail shows name, meta, doc form, learn action.
  assert.match(elements['[data-kb-detail]'].innerHTML, /data-kb-doc-form/);
  assert.match(elements['[data-kb-detail]'].innerHTML, /Learn now/);
  // Study table shows the failed job with retry affordance and error note.
  assert.match(elements['[data-kb-study-table]'].innerHTML, /skill packages/);
  assert.match(elements['[data-kb-study-table]'].innerHTML, /status-failure/);
  assert.match(elements['[data-kb-study-table]'].innerHTML, /data-kb-job-retry="study-1"/);
  assert.match(elements['[data-kb-study-table]'].innerHTML, /read timeout/);
});

test('kb page validates the create form before posting', async () => {
  const harness = createHarness(async (url, options = {}) => {
    if (url === '/api/kb/list') return jsonResponse(listPayload);
    if (url === '/api/kb/study/status') return jsonResponse(studyPayload);
    if (url === '/api/kb/create') {
      return jsonResponse({ ok: true, state: 'success', data: { knowledgeBase: { id: 'kb-new' } } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildKbPageDefinition().script, harness.context);
  await new Promise((resolve) => setImmediate(resolve));

  const { elements } = harness;
  const submit = elements['[data-kb-create-form]'].listener('submit');
  elements['[data-kb-create-name]'].value = '   ';
  await submit({ preventDefault() {} });
  assert.match(elements['[data-kb-create-status]'].textContent, /Failed to create/);
  assert.equal(harness.calls.filter((call) => call.url === '/api/kb/create').length, 0);

  elements['[data-kb-create-name]'].value = 'Protocols';
  elements['[data-kb-create-description]'].value = 'MetaWeb study notes';
  await submit({ preventDefault() {} });
  const createCall = harness.calls.find((call) => call.url === '/api/kb/create');
  assert.ok(createCall, 'create endpoint should be called');
  assert.deepEqual(JSON.parse(createCall.options.body), { name: 'Protocols', description: 'MetaWeb study notes' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements['[data-kb-create-status]'].textContent, 'Knowledge base created.');
});

test('kb page runs the query tester and renders hit groups', async () => {
  const harness = createHarness(async (url, options = {}) => {
    if (url === '/api/kb/list') return jsonResponse(listPayload);
    if (url === '/api/kb/study/status') return jsonResponse(studyPayload);
    if (url === '/api/kb/query') {
      assert.deepEqual(JSON.parse(options.body), { text: 'surf protocols', id: 'kb-research' });
      return jsonResponse({
        ok: true,
        state: 'success',
        data: {
          results: [
            {
              knowledgeBaseId: 'kb-research',
              knowledgeBaseName: 'Research',
              hits: [
                { docRelPath: 'raw/a.md', ord: 0, snippet: 'The surf protocol lists…', score: 0.91, title: 'Surf protocol' },
              ],
            },
          ],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildKbPageDefinition().script, harness.context);
  await new Promise((resolve) => setImmediate(resolve));

  const { elements } = harness;
  elements['[data-kb-query-select]'].value = 'kb-research';
  elements['[data-kb-query-input]'].value = 'surf protocols';
  const submit = elements['[data-kb-query-form]'].listener('submit');
  await submit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(elements['[data-kb-query-results]'].innerHTML, /kb-query-group/);
  assert.match(elements['[data-kb-query-results]'].innerHTML, /The surf protocol lists/);
  assert.match(elements['[data-kb-query-results]'].innerHTML, /score 0.91/);
  assert.match(elements['[data-kb-query-results]'].innerHTML, /1 results/);
});

test('kb page enqueues a study job and refreshes the job list', async () => {
  const harness = createHarness(async (url, options = {}) => {
    if (url === '/api/kb/list') return jsonResponse(listPayload);
    if (url === '/api/kb/study/status') return jsonResponse(studyPayload);
    if (url === '/api/kb/study/enqueue') {
      assert.deepEqual(JSON.parse(options.body), { topic: 'dream diaries', budgetPins: 7 });
      return jsonResponse({ ok: true, state: 'success', data: { job: { id: 'study-2' }, created: true } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildKbPageDefinition().script, harness.context);
  await new Promise((resolve) => setImmediate(resolve));

  const { elements } = harness;
  elements['[data-kb-study-topic]'].value = 'dream diaries';
  elements['[data-kb-study-budget]'].value = '7';
  const submit = elements['[data-kb-study-form]'].listener('submit');
  await submit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(harness.calls.some((call) => call.url === '/api/kb/study/enqueue'));
  assert.equal(elements['[data-kb-study-status]'].textContent, 'Study job enqueued.');
});

test('kb page surfaces a fixable error when the list endpoint fails', async () => {
  const harness = createHarness(async () => {
    throw new Error('profile missing');
  });
  vm.runInNewContext(buildKbPageDefinition().script, harness.context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.elements['[data-kb-status]'].textContent, 'profile missing');
});
