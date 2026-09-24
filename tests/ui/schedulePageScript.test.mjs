import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildSchedulePageDefinition } = require('../../dist/ui/pages/schedule/app.js');
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
    hidden: false,
    checked: false,
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

function makeActionButton(attribute, value) {
  const listeners = new Map();
  return {
    attrs: { [attribute]: value },
    disabled: false,
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    addEventListener: (eventName, handler) => listeners.set(eventName, handler),
    listener: (eventName) => listeners.get(eventName),
  };
}

function createHarness(fetchImpl) {
  const taskTable = makeElement('div');
  const buttonRegistry = new Map();
  taskTable.querySelectorAll = (selector) => buttonRegistry.get(selector) ?? [];
  const elements = {
    '[data-schedule-status]': makeElement(),
    '[data-schedule-refresh]': makeElement('button'),
    '[data-schedule-new]': makeElement('button'),
    '[data-schedule-context]': makeElement(),
    '[data-schedule-bot-select]': makeElement('select'),
    '[data-schedule-bot-hint]': makeElement(),
    '[data-schedule-no-bots]': makeElement(),
    '[data-schedule-editor]': makeElement('article'),
    '[data-schedule-editor-title]': makeElement('h2'),
    '[data-schedule-form]': makeElement('form'),
    '[data-schedule-name]': makeElement('input'),
    '[data-schedule-prompt]': makeElement('textarea'),
    '[data-schedule-kind]': makeElement('select'),
    '[data-schedule-at]': makeElement('input'),
    '[data-schedule-interval-row]': makeElement('div'),
    '[data-schedule-interval-value]': makeElement('input'),
    '[data-schedule-interval-unit]': makeElement('select'),
    '[data-schedule-cron]': makeElement('input'),
    '[data-schedule-channel]': makeElement('select'),
    '[data-schedule-editor-status]': makeElement(),
    '[data-schedule-submit]': makeElement('button'),
    '[data-schedule-cancel]': makeElement('button'),
    '[data-schedule-task-table]': taskTable,
    '[data-schedule-runs-card]': makeElement('article'),
    '[data-schedule-runs-title]': makeElement('h2'),
    '[data-schedule-runs-table]': makeElement('div'),
  };
  elements['[data-schedule-kind]'].value = 'interval';
  elements['[data-schedule-interval-unit]'].value = 'hour';
  elements['[data-schedule-channel]'].value = 'auto';
  const calls = [];
  const listeners = new Map();
  const context = {
    URLSearchParams,
    encodeURIComponent,
    // The run-now poll uses timers; tests stub them so the loop never fires.
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetchImpl(url, options);
    },
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
  return { elements, calls, context, listeners, buttonRegistry };
}

const jsonResponse = (payload) => ({
  json: async () => payload,
});

const hourFromNow = Date.now() + 3600_000;
const hourAgo = Date.now() - 3600_000;
const dayAgo = Date.now() - 86_400_000;

const listPayload = {
  ok: true,
  state: 'success',
  data: {
    tasks: [
      {
        id: 'task-1',
        name: 'Hourly brief',
        description: '',
        enabled: true,
        schedule: { type: 'interval', intervalMs: 3600_000 },
        prompt: 'Summarize the last hour of MetaWeb buzz',
        workingDirectory: '',
        channel: 'auto',
        expiresAt: null,
        state: {
          nextRunAtMs: hourFromNow,
          lastRunAtMs: hourAgo,
          lastStatus: 'success',
          lastError: null,
          lastDurationMs: 42_000,
          runningAtMs: null,
          consecutiveErrors: 0,
        },
        createdAt: new Date(dayAgo).toISOString(),
        updatedAt: new Date(hourAgo).toISOString(),
      },
      {
        id: 'task-2',
        name: 'Nightly digest',
        description: '',
        enabled: false,
        schedule: { type: 'cron', expression: '0 9 * * *' },
        prompt: 'Write a nightly digest',
        workingDirectory: '',
        channel: 'daemon',
        expiresAt: null,
        state: {
          nextRunAtMs: null,
          lastRunAtMs: dayAgo,
          lastStatus: 'error',
          lastError: 'LLM offline',
          lastDurationMs: null,
          runningAtMs: null,
          consecutiveErrors: 3,
        },
        createdAt: new Date(dayAgo).toISOString(),
        updatedAt: new Date(dayAgo).toISOString(),
      },
    ],
  },
};

function profilesPayload() {
  return {
    ok: true,
    state: 'success',
    data: {
      profiles: [
        { slug: 'alice', name: 'Alice', globalMetaId: 'idq1alice', isActive: true },
        { slug: 'bob', name: 'Bob', globalMetaId: 'idq1bob', isActive: false },
      ],
    },
  };
}

function createHarnessWithTasks() {
  return createHarness(async (url) => {
    if (url === '/api/bot/profiles') return jsonResponse(profilesPayload());
    if (url.startsWith('/api/schedule/list')) return jsonResponse(listPayload);
    if (url.startsWith('/api/schedule/runs')) {
      return jsonResponse({
        ok: true,
        state: 'success',
        data: {
          runs: [
            {
              id: 'run-1',
              taskId: 'task-2',
              status: 'error',
              trigger: 'scheduled',
              executor: 'daemon',
              startedAt: new Date(dayAgo).toISOString(),
              finishedAt: new Date(dayAgo + 60_000).toISOString(),
              durationMs: 60_000,
              error: 'LLM offline',
            },
            {
              id: 'run-2',
              taskId: 'task-2',
              status: 'success',
              trigger: 'manual',
              executor: null,
              startedAt: new Date(dayAgo + 3600_000).toISOString(),
              finishedAt: new Date(dayAgo + 3600_000 + 30_000).toISOString(),
              durationMs: 30_000,
              error: null,
            },
          ],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

test('schedule page loads profiles, lists tasks, and renders cadence, status, and next run', async () => {
  const harness = createHarnessWithTasks();
  vm.runInNewContext(buildSchedulePageDefinition().script, harness.context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const { elements } = harness;
  assert.equal(elements['[data-schedule-status]'].textContent, 'Scheduled tasks loaded.');
  // Bot picker resolved the Twin Bot and lists both profiles.
  assert.match(elements['[data-schedule-bot-select]'].innerHTML, /value="alice" selected/);
  assert.match(elements['[data-schedule-bot-select]'].innerHTML, /value="bob"/);
  // Both tasks render with cadence + status pills.
  const table = elements['[data-schedule-task-table]'].innerHTML;
  assert.match(table, /Hourly brief/);
  assert.match(table, /Every 1 hours/);
  assert.match(table, /0 9 \* \* \*/);
  assert.match(table, /status-completed/);
  assert.match(table, /status-offline/);
  assert.match(table, /3 consecutive failures/);
  assert.match(table, /Last error: LLM offline/);
  // Next run shows the cadence countdown; disabled task shows Off.
  assert.match(table, /in 1 hr/);
  assert.match(table, /<td class="mono">Off<\/td>/);
});

test('schedule page validates the form before creating an interval task', async () => {
  const calls = [];
  const h = createHarness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/bot/profiles') return jsonResponse(profilesPayload());
    if (url.startsWith('/api/schedule/list')) return jsonResponse(listPayload);
    if (url === '/api/schedule/create') return jsonResponse({ ok: true, state: 'success', data: { task: listPayload.data.tasks[0] } });
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildSchedulePageDefinition().script, h.context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const { elements } = h;
  // Open the editor via the New task button.
  const newHandler = elements['[data-schedule-new]'].listener('click');
  newHandler();
  assert.equal(elements['[data-schedule-editor]'].hidden, false);
  assert.equal(elements['[data-schedule-editor-title]'].textContent, 'New scheduled task');

  // Missing prompt fails client-side without a request.
  elements['[data-schedule-name]'].value = 'Standup summary';
  elements['[data-schedule-prompt]'].value = '';
  const submit = elements['[data-schedule-form]'].listener('submit');
  await submit({ preventDefault() {} });
  assert.equal(elements['[data-schedule-editor-status]'].textContent, 'A task name and prompt are required.');
  assert.equal(calls.filter((call) => call.url === '/api/schedule/create').length, 0);

  // Valid interval form posts a create with the explicit bot selector.
  elements['[data-schedule-prompt]'].value = 'Post the standup summary';
  elements['[data-schedule-kind]'].value = 'interval';
  elements['[data-schedule-interval-value]'].value = '30';
  elements['[data-schedule-interval-unit]'].value = 'minute';
  await submit({ preventDefault() {} });
  const createCall = calls.find((call) => call.url === '/api/schedule/create');
  assert.ok(createCall, 'create endpoint should be called');
  assert.deepEqual(JSON.parse(createCall.options.body), {
    from: 'alice',
    name: 'Standup summary',
    prompt: 'Post the standup summary',
    channel: 'auto',
    schedule: { type: 'interval', intervalMs: 1_800_000 },
  });
  assert.equal(elements['[data-schedule-status]'].textContent, 'Task created: Standup summary');
  assert.equal(elements['[data-schedule-editor]'].hidden, true);
});

test('schedule page toggles, two-step deletes, and views run history per task', async () => {
  const calls = [];
  const h = createHarness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/bot/profiles') return jsonResponse(profilesPayload());
    if (url.startsWith('/api/schedule/list')) return jsonResponse(listPayload);
    if (url.startsWith('/api/schedule/runs')) {
      return jsonResponse({
        ok: true,
        state: 'success',
        data: {
          runs: [
            {
              id: 'run-9',
              taskId: 'task-1',
              status: 'error',
              trigger: 'scheduled',
              executor: 'daemon',
              startedAt: new Date(hourAgo).toISOString(),
              finishedAt: new Date(hourAgo + 60_000).toISOString(),
              durationMs: 60_000,
              error: 'LLM offline',
            },
          ],
        },
      });
    }
    if (url === '/api/schedule/disable') return jsonResponse({ ok: true, state: 'success', data: { task: listPayload.data.tasks[0] } });
    if (url === '/api/schedule/delete') return jsonResponse({ ok: true, state: 'success', data: { deleted: true } });
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildSchedulePageDefinition().script, h.context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  // Wire row buttons the way the rendered table would.
  h.buttonRegistry.set('[data-toggle-task]', [makeActionButton('data-toggle-task', 'task-1')]);
  h.buttonRegistry.set('[data-delete-task]', [makeActionButton('data-delete-task', 'task-2')]);
  h.buttonRegistry.set('[data-confirm-delete]', [makeActionButton('data-confirm-delete', 'task-2')]);
  h.buttonRegistry.set('[data-view-runs]', [makeActionButton('data-view-runs', 'task-1')]);
  // Force a re-render so the page binds the registered buttons.
  const refreshHandler = h.elements['[data-schedule-refresh]'].listener('click');
  refreshHandler();
  await new Promise((resolve) => setImmediate(resolve));

  // Toggle disable on task-1.
  await h.buttonRegistry.get('[data-toggle-task]')[0].listener('click')();
  const toggleCall = calls.find((call) => call.url === '/api/schedule/disable');
  assert.ok(toggleCall, 'disable endpoint should be called');
  assert.deepEqual(JSON.parse(toggleCall.options.body), { from: 'alice', id: 'task-1' });

  // Delete task-2 requires the second confirm click.
  await h.buttonRegistry.get('[data-delete-task]')[0].listener('click')();
  assert.equal(calls.filter((call) => call.url === '/api/schedule/delete').length, 0);
  await h.buttonRegistry.get('[data-confirm-delete]')[0].listener('click')();
  const deleteCall = calls.find((call) => call.url === '/api/schedule/delete');
  assert.ok(deleteCall, 'delete endpoint should be called after confirm');
  assert.deepEqual(JSON.parse(deleteCall.options.body), { from: 'alice', id: 'task-2' });

  // Selecting a task opens its run history.
  await h.buttonRegistry.get('[data-view-runs]')[0].listener('click')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.elements['[data-schedule-runs-card]'].hidden, false);
  assert.equal(h.elements['[data-schedule-runs-title]'].textContent, 'Run history — Hourly brief');
  const runsTable = h.elements['[data-schedule-runs-table]'].innerHTML;
  assert.match(runsTable, /status-failure/);
  assert.match(runsTable, /LLM offline/);
});

test('schedule page scopes requests to the selected bot and surfaces list errors', async () => {
  const calls = [];
  const h = createHarness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/bot/profiles') return jsonResponse(profilesPayload());
    if (url.startsWith('/api/schedule/list?')) return jsonResponse(listPayload);
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildSchedulePageDefinition().script, h.context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.some((call) => call.url.startsWith('/api/schedule/list?from=alice')));

  // Switching the bot picker reloads tasks for that bot.
  const select = h.elements['[data-schedule-bot-select]'];
  select.value = 'bob';
  select.listener('change')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.some((call) => call.url.startsWith('/api/schedule/list?from=bob')));

  const failing = createHarness(async () => {
    throw new Error('daemon offline');
  });
  vm.runInNewContext(buildSchedulePageDefinition().script, failing.context);
  await new Promise((resolve) => setImmediate(resolve));
  // Profile load fails, so the status line carries the raw error.
  assert.equal(failing.elements['[data-schedule-status]'].textContent, 'daemon offline');
});

test('schedule page run-now posts to /api/schedule/run and reports the start', async () => {
  const calls = [];
  const h = createHarness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/bot/profiles') return jsonResponse(profilesPayload());
    if (url.startsWith('/api/schedule/list')) return jsonResponse(listPayload);
    if (url.startsWith('/api/schedule/runs')) {
      return jsonResponse({ ok: true, state: 'success', data: { runs: [] } });
    }
    if (url === '/api/schedule/run') {
      return jsonResponse({ ok: true, state: 'success', data: { taskId: 'task-1', status: 'running', wait: false } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildSchedulePageDefinition().script, h.context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  // Wire the row button the way the rendered table would.
  h.buttonRegistry.set('[data-run-task]', [makeActionButton('data-run-task', 'task-1')]);
  const refreshHandler = h.elements['[data-schedule-refresh]'].listener('click');
  refreshHandler();
  await new Promise((resolve) => setImmediate(resolve));

  await h.buttonRegistry.get('[data-run-task]')[0].listener('click')();
  const runCall = calls.find((call) => call.url === '/api/schedule/run');
  assert.ok(runCall, 'run endpoint should be called');
  assert.deepEqual(JSON.parse(runCall.options.body), { from: 'alice', id: 'task-1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    h.elements['[data-schedule-status]'].textContent,
    'Started "Hourly brief" — running in the daemon.',
  );
});

test('schedule page run-now surfaces the daemon error', async () => {
  const h = createHarness(async (url) => {
    if (url === '/api/bot/profiles') return jsonResponse(profilesPayload());
    if (url.startsWith('/api/schedule/list')) return jsonResponse(listPayload);
    if (url.startsWith('/api/schedule/runs')) {
      return jsonResponse({ ok: true, state: 'success', data: { runs: [] } });
    }
    if (url === '/api/schedule/run') {
      return jsonResponse({ ok: false, state: 'failed', code: 'already_running', message: 'Scheduled task is already running: task-1' });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildSchedulePageDefinition().script, h.context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  h.buttonRegistry.set('[data-run-task]', [makeActionButton('data-run-task', 'task-1')]);
  h.elements['[data-schedule-refresh]'].listener('click')();
  await new Promise((resolve) => setImmediate(resolve));

  await h.buttonRegistry.get('[data-run-task]')[0].listener('click')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    h.elements['[data-schedule-status]'].textContent,
    'Scheduled task is already running: task-1',
  );
});
