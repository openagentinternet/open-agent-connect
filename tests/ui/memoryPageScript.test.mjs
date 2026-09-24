import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildMemoryPageDefinition } = require('../../dist/ui/pages/memory/app.js');
const { translate } = require('../../dist/ui/i18n.js');

function makeElement(tag = 'div') {
  const listeners = new Map();
  const children = new Map();
  const stubLists = new Map();
  const attributes = new Map();
  return {
    tagName: tag.toUpperCase(),
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    checked: false,
    className: '',
    addEventListener: (eventName, handler) => listeners.set(eventName, handler),
    listener: (eventName) => listeners.get(eventName),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    setStubList: (selector, stubs) => stubLists.set(selector, stubs),
    querySelector: (selector) => {
      if (!children.has(selector)) children.set(selector, makeElement());
      return children.get(selector);
    },
    querySelectorAll: (selector) => stubLists.get(selector) ?? [],
  };
}

function createHarness(fetchImpl, options = {}) {
  const elements = {
    '[data-memory-status]': makeElement(),
    '[data-memory-refresh]': makeElement('button'),
    '[data-memory-tabs]': makeElement('div'),
    '[data-memory-panel]': makeElement('div'),
  };
  const calls = [];
  const listeners = new Map();
  const context = {
    URLSearchParams,
    fetch: async (url, fetchOptions) => {
      calls.push({ url, options: fetchOptions });
      return fetchImpl(url, fetchOptions);
    },
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    document: {
      querySelector: (selector) => elements[selector] ?? null,
      activeElement: null,
    },
    window: {
      location: { search: options.search ?? '', href: 'http://127.0.0.1/ui/memory' },
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

const ok = (data) => jsonResponse({ ok: true, state: 'success', data });

const knowledgeListPayload = ok({
  entries: [
    {
      id: 'kp-1',
      topic: 'MetaApp publishing',
      summary: 'Build the app, pin it, then publish.',
      kind: 'know_how',
      version: 2,
      status: 'active',
      updatedAt: new Date(Date.now() - 3600_000).toISOString(),
    },
  ],
});

const factsListPayload = ok({
  entries: [
    {
      id: 'mem-1',
      text: 'User prefers short answers.',
      usageClass: 'preference',
      origin: 'conversation',
      status: 'created',
      archivedAt: null,
      updatedAt: new Date(Date.now() - 7200_000).toISOString(),
    },
    {
      id: 'mem-2',
      text: 'I am a careful dreamer.',
      usageClass: 'self_identity',
      origin: 'dream',
      status: 'created',
      archivedAt: null,
      updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
    {
      id: 'mem-arch',
      text: 'An old dream-time fact.',
      usageClass: 'profile_fact',
      origin: 'dream',
      status: 'stale',
      archivedAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ],
});

const policyPayload = ok({
  effective: {
    memoryEnabled: true,
    memoryImplicitUpdateEnabled: true,
    memoryLlmJudgeEnabled: false,
    dreamEnabled: true,
    memoryGuardLevel: 'strict',
    memoryUserMemoriesMaxItems: 20,
    memoryPromptMaxChars: 12000,
  },
  override: {},
});

const hygieneStatusPayload = ok({
  config: {
    enabled: true,
    observationRetentionDays: 90,
    observationAnchorsPerPair: 8,
    episodeArchiveDays: 180,
    memoryDecayDays: 180,
    tombstonePurgeDays: 365,
    knowledgeRevisionKeep: 5,
    dreamRunRetentionDays: 90,
    deepConsolidationEnabled: true,
    deepConsolidationIntervalDays: 7,
  },
  lastRun: {
    dateKey: '2026-09-20',
    ranAt: Date.now() - 86_400_000,
    trigger: 'manual',
    counts: { memoriesArchived: 3, observationsSuperseded: 5 },
    errors: [],
  },
  deepConsolidationLastRunAt: Date.now() - 86_400_000,
  due: false,
});

const dreamStatusPayload = ok({
  runs: [
    {
      dreamDate: '2026-09-22',
      status: 'failed',
      attemptCount: 2,
      error: 'llm timeout',
      startedAt: Date.now() - 3_600_000,
      nextRetryAt: Date.now() + 3_600_000,
    },
  ],
  summaryCount: 1,
  latestSummaryDate: '2026-09-21',
  hasSelfIdentity: true,
});

const dreamDuePayload = ok({ dueDates: ['2026-09-22'], repairDates: [] });

const dreamSummariesPayload = ok({
  summaries: [
    {
      summaryDate: '2026-09-21',
      summaryText: 'A quiet day of reading protocols.',
      stats: { sessionCount: 2, messageCount: 12 },
      sections: { mood: 'calm' },
      sessionRefs: [{ sessionId: 'sess-1' }],
    },
  ],
});

const selfIdentityPayload = ok({
  text: 'I am a helpful bot.',
  updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
});

const capabilitiesPayload = ok({
  drafts: [
    {
      id: 'cap-1',
      dreamDate: '2026-09-21',
      title: 'Pin summarizer',
      description: 'Summarize long pins on request.',
      capabilityType: 'skill',
      status: 'draft',
      createdAt: Date.now() - 86_400_000,
    },
  ],
});

const contactsListPayload = ok({
  observerGlobalMetaId: 'idq1alice',
  snapshots: [
    {
      subjectGlobalMetaId: 'idq1bob',
      subjectName: 'Bob',
      interactionCount: 7,
      summaryText: 'Bob likes terse updates.',
      styleDescriptors: ['terse'],
      relationshipTemperature: 'warm',
      communicationGuidance: null,
      uncertaintyText: null,
    },
  ],
});

const contactsShowPayload = ok({
  observerGlobalMetaId: 'idq1alice',
  subject: 'idq1bob',
  snapshot: {
    subjectGlobalMetaId: 'idq1bob',
    subjectName: 'Bob',
    summaryText: 'Bob likes terse updates.',
    styleDescriptors: ['terse'],
    relationshipTemperature: 'warm',
    communicationGuidance: 'Lead with the outcome.',
    uncertaintyText: 'Unclear which chain he prefers.',
  },
  observations: [
    {
      id: 'obs-1',
      observationText: 'Bob asked about pinning.',
      interpretationText: 'He is exploring publishing.',
      dreamDate: '2026-09-20',
      status: 'active',
    },
  ],
});

async function settle(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Switch to a tab: inject a stub tab button, re-render to bind it, click it. */
async function switchTab(harness, name) {
  const tab = makeElement('button');
  tab.setAttribute('data-memory-tab', name);
  harness.elements['[data-memory-tabs]'].setStubList('[data-memory-tab]', [tab]);
  harness.listeners.get('oac:i18n-changed')();
  tab.listener('click')();
  await settle();
}

test('memory page loads the knowledge tab and saves a new knowledge point', async () => {
  const calls = [];
  const harness = createHarness(async (url, options = {}) => {
    if (url === '/api/memory/knowledge/list?status=active&limit=200') return knowledgeListPayload;
    if (url === '/api/memory/knowledge/upsert') {
      calls.push(JSON.parse(options.body));
      return ok({ entry: { id: 'kp-2' }, created: true });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildMemoryPageDefinition().script, harness.context);
  await settle();

  const panel = harness.elements['[data-memory-panel]'];
  assert.equal(harness.elements['[data-memory-status]'].textContent, 'Memory loaded.');
  assert.match(panel.innerHTML, /MetaApp publishing/);
  assert.match(panel.innerHTML, /v2/);
  assert.match(harness.elements['[data-memory-tabs]'].innerHTML, /data-memory-tab/);

  const topicInput = panel.querySelector('[data-memory-knowledge-topic]');
  const summaryInput = panel.querySelector('[data-memory-knowledge-summary]');
  topicInput.value = 'Surf reports';
  topicInput.listener('input')();
  summaryInput.value = 'Read them every morning.';
  summaryInput.listener('input')();
  const submit = panel.querySelector('[data-memory-knowledge-add]').listener('submit');
  await submit({ preventDefault() {} });
  await settle();

  assert.deepEqual(calls, [{ topic: 'Surf reports', summary: 'Read them every morning.', kind: 'know_how' }]);
  assert.equal(
    panel.querySelector('[data-memory-knowledge-add] .status-msg').textContent,
    'Knowledge point saved.',
  );
});

test('memory page facts tab lists active and archived facts and restores an archived one', async () => {
  const restoreCalls = [];
  const harness = createHarness(async (url, options = {}) => {
    if (url === '/api/memory/knowledge/list?status=active&limit=200') return knowledgeListPayload;
    if (url === '/api/memory/list?limit=200&includeArchived=true') return factsListPayload;
    if (url === '/api/memory/unarchive') {
      restoreCalls.push(JSON.parse(options.body));
      return ok({ restored: 1 });
    }
    if (url === '/api/memory/list?limit=200&includeArchived=true&status=stale') return factsListPayload;
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildMemoryPageDefinition().script, harness.context);
  await settle();
  await switchTab(harness, 'facts');

  const panel = harness.elements['[data-memory-panel]'];
  assert.match(panel.innerHTML, /User prefers short answers\./);
  assert.match(panel.innerHTML, /Self-identity entries are protected\./);
  assert.match(panel.innerHTML, /Archived facts/);
  assert.match(panel.innerHTML, /An old dream-time fact\./);

  const restore = makeElement('button');
  restore.setAttribute('data-memory-facts-restore', 'mem-arch');
  panel.setStubList('[data-memory-facts-restore]', [restore]);
  harness.listeners.get('oac:i18n-changed')();
  await settle();
  restore.listener('click')();
  await settle();

  assert.deepEqual(restoreCalls, [{ id: 'mem-arch' }]);
  assert.equal(
    panel.querySelector('[data-memory-facts-add] .status-msg').textContent,
    'Fact restored.',
  );
});

test('memory page contacts tab opens a contact detail with dream observations', async () => {
  const harness = createHarness(async (url) => {
    if (url === '/api/memory/knowledge/list?status=active&limit=200') return knowledgeListPayload;
    if (url === '/api/memory/impressions/list') return contactsListPayload;
    if (url === '/api/memory/impressions/show?subject=idq1bob') return contactsShowPayload;
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildMemoryPageDefinition().script, harness.context);
  await settle();
  await switchTab(harness, 'contacts');

  const panel = harness.elements['[data-memory-panel]'];
  assert.match(panel.innerHTML, /Bob likes terse updates\./);
  assert.match(panel.innerHTML, /7 interactions/);

  const contact = makeElement('button');
  contact.setAttribute('data-memory-contact', 'idq1bob');
  panel.setStubList('[data-memory-contact]', [contact]);
  harness.listeners.get('oac:i18n-changed')();
  await settle();
  contact.listener('click')();
  await settle();

  assert.match(panel.innerHTML, /Bob asked about pinning\./);
  assert.match(panel.innerHTML, /He is exploring publishing\./);
  assert.match(panel.innerHTML, /Back to contacts/);
});

test('memory page dream tab reads diaries and posts a manual dream run', async () => {
  const runCalls = [];
  const harness = createHarness(async (url, options = {}) => {
    if (url === '/api/memory/knowledge/list?status=active&limit=200') return knowledgeListPayload;
    if (url === '/api/dream/status') return dreamStatusPayload;
    if (url === '/api/dream/due') return dreamDuePayload;
    if (url === '/api/dream/summaries?limit=30') return dreamSummariesPayload;
    if (url === '/api/dream/self-identity') return selfIdentityPayload;
    if (url === '/api/dream/capabilities?limit=50') return capabilitiesPayload;
    if (url === '/api/memory/policy') return policyPayload;
    if (url === '/api/dream/run') {
      runCalls.push(JSON.parse(options.body));
      return ok({ date: '2026-09-23', status: 'running', wait: false });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildMemoryPageDefinition().script, harness.context);
  await settle();
  await switchTab(harness, 'dream');

  const panel = harness.elements['[data-memory-panel]'];
  assert.match(panel.innerHTML, /Dream diaries/);
  assert.match(panel.innerHTML, /1 diaries/);
  assert.match(panel.innerHTML, /I am a helpful bot\./);
  assert.match(panel.innerHTML, /Pin summarizer/);
  assert.match(panel.innerHTML, /llm timeout/);
  assert.match(panel.innerHTML, /Set up surf before dream/);

  const toggle = makeElement('button');
  toggle.setAttribute('data-memory-diary-toggle', '2026-09-21');
  panel.setStubList('[data-memory-diary-toggle]', [toggle]);
  harness.listeners.get('oac:i18n-changed')();
  await settle();
  toggle.listener('click')();
  assert.match(panel.innerHTML, /A quiet day of reading protocols\./);

  const dateInput = panel.querySelector('[data-memory-dream-date]');
  dateInput.value = '2026-09-23';
  dateInput.listener('change')();
  const runForm = panel.querySelector('[data-memory-dream-run-form]');
  await runForm.listener('submit')({ preventDefault() {} });
  await settle();

  assert.deepEqual(runCalls, [{ date: '2026-09-23' }]);
  assert.equal(
    panel.querySelector('[data-memory-dream-run-form] .status-msg').textContent,
    'Dream run started. The diary appears when the run finishes.',
  );
});

test('memory page settings tab saves the policy override and runs hygiene', async () => {
  const postCalls = [];
  const harness = createHarness(async (url, options = {}) => {
    if (url === '/api/memory/knowledge/list?status=active&limit=200') return knowledgeListPayload;
    if (url === '/api/memory/policy') {
      if (options && options.method === 'POST') postCalls.push({ url, body: JSON.parse(options.body) });
      return policyPayload;
    }
    if (url === '/api/memory/hygiene/status') return hygieneStatusPayload;
    if (url === '/api/memory/hygiene/run') {
      postCalls.push({ url, body: JSON.parse(options.body) });
      return ok({ dateKey: '2026-09-24', counts: {}, errors: [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildMemoryPageDefinition().script, harness.context);
  await settle();
  await switchTab(harness, 'settings');

  const panel = harness.elements['[data-memory-panel]'];
  assert.match(panel.innerHTML, /Memory policy/);
  assert.match(panel.innerHTML, /Memory hygiene/);
  assert.match(panel.innerHTML, /Use host defaults/);

  const overrideToggle = panel.querySelector('[data-memory-policy-override]');
  overrideToggle.checked = true;
  overrideToggle.listener('change')();
  assert.match(panel.innerHTML, /Save policy/);

  const save = makeElement('button');
  panel.setStubList('[data-memory-policy-save]', [save]);
  harness.listeners.get('oac:i18n-changed')();
  await settle();
  save.listener('click')();
  await settle();

  const policyCall = postCalls.find((call) => call.url === '/api/memory/policy');
  assert.ok(policyCall, 'policy endpoint should be called');
  assert.deepEqual(policyCall.body, {
    memoryEnabled: true,
    memoryImplicitUpdateEnabled: true,
    memoryLlmJudgeEnabled: false,
    dreamEnabled: true,
    memoryGuardLevel: 'strict',
    memoryUserMemoriesMaxItems: 20,
    memoryPromptMaxChars: 12000,
  });
  assert.equal(
    panel.querySelector('[data-memory-policy-card] .status-msg').textContent,
    'Policy saved.',
  );

  const run = makeElement('button');
  panel.setStubList('[data-memory-hygiene-run]', [run]);
  harness.listeners.get('oac:i18n-changed')();
  await settle();
  run.listener('click')();
  await settle();

  const hygieneCall = postCalls.find((call) => call.url === '/api/memory/hygiene/run');
  assert.ok(hygieneCall, 'hygiene run endpoint should be called');
  assert.deepEqual(hygieneCall.body, {});
  assert.equal(
    panel.querySelector('[data-memory-hygiene-card] .status-msg').textContent,
    'Hygiene run finished.',
  );
});

test('memory page shows a fixable error and still invites the next action when loading fails', async () => {
  const harness = createHarness(async () => {
    throw new Error('daemon offline');
  });
  vm.runInNewContext(buildMemoryPageDefinition().script, harness.context);
  await settle();

  assert.equal(harness.elements['[data-memory-status]'].textContent, 'daemon offline');
  assert.match(harness.elements['[data-memory-panel]'].innerHTML, /No knowledge points yet/);
  assert.match(harness.elements['[data-memory-panel]'].innerHTML, /Add the first thing this Bot should know\./);
});
