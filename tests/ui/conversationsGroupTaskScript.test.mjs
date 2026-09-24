import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildConversationsPageDefinition } = require('../../dist/ui/pages/conversations/app.js');

function makeElement(tagName = 'div') {
  return {
    tagName,
    _innerHTML: '',
    textContent: '',
    hidden: false,
    disabled: false,
    dataset: {},
    children: [],
    listeners: new Map(),
    classList: {
      classes: new Set(),
      add(name) { this.classes.add(name); },
      remove(name) { this.classes.delete(name); },
      toggle(name, force) {
        const next = force === undefined ? !this.classes.has(name) : Boolean(force);
        if (next) this.classes.add(name);
        else this.classes.delete(name);
      },
    },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(value) {
      this._innerHTML = String(value || '');
      this.children = [];
    },
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(name, value) { this[name] = String(value); },
    getAttribute(name) { return this[name] ?? null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function jsonResponse(data) {
  return { ok: true, json: async () => data };
}

function waitFor(condition, label, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

const TASK = {
  id: 7,
  chairSlug: 'twin-bot',
  title: 'Ship the parity wave',
  goal: 'Close the Codex DSH parity gap',
  status: 'executing',
  displayName: null,
  createdAt: 1_775_000_000_000,
  updatedAt: 1_775_000_100_000,
  openTeam: true,
  members: [],
  memberCount: 2,
};

const DETAIL = {
  ...TASK,
  members: [
    {
      slug: 'twin-bot',
      globalMetaId: 'idq1chair',
      displayName: 'Twin Bot',
      role: 'chair',
      status: 'working',
      workStatus: 'working',
      removedAt: null,
    },
    {
      slug: 'worker-1',
      globalMetaId: 'idq1worker',
      displayName: 'Worker One',
      role: 'worker',
      status: 'working',
      workStatus: 'idle',
      removedAt: null,
    },
  ],
  deliverables: [
    {
      id: 3,
      msgPinId: 'ab'.repeat(32) + 'i0',
      kind: 'report',
      uri: 'metafile://deadbeef',
      status: 'delivered',
      createdAt: 1_775_000_050_000,
    },
  ],
};

const MESSAGES = [
  {
    index: 1,
    pinId: 'cd'.repeat(32) + 'i0',
    senderName: 'Twin Bot',
    senderGlobalMetaId: 'idq1chair',
    content: 'Plan drafted.',
    chainTimestamp: 1_775_000_010,
    senderSuspect: false,
  },
  {
    index: 2,
    pinId: null,
    senderName: null,
    senderGlobalMetaId: 'idq1stranger',
    content: 'forged',
    chainTimestamp: null,
    senderSuspect: true,
  },
];

function createGroupTaskContext({ search = '?view=grouptask' } = {}) {
  const elements = {
    '[data-conversations-status]': makeElement(),
    '[data-conversations-refresh]': makeElement('button'),
    '[data-local-bot-picker]': makeElement(),
    '[data-local-bot-trigger]': makeElement('button'),
    '[data-local-bot-current]': makeElement(),
    '[data-local-bot-menu]': makeElement(),
    '[data-conversation-list]': makeElement(),
    '[data-conversation-detail-header]': makeElement(),
    '[data-conversation-messages]': makeElement(),
    '[data-conversation-guidance]': makeElement(),
    '[data-guidance-toggle]': makeElement('button'),
    '[data-guidance-form]': makeElement('form'),
    '[data-guidance-input]': makeElement('input'),
    '[data-guidance-send]': makeElement('button'),
    '[data-guidance-cancel]': makeElement('button'),
    '[data-guidance-status]': makeElement(),
    '[data-copy-toast]': makeElement(),
    '[data-grouptask-status]': makeElement(),
    '[data-grouptask-refresh]': makeElement('button'),
    '[data-grouptask-list]': makeElement(),
    '[data-grouptask-detail-header]': makeElement(),
    '[data-grouptask-detail-body]': makeElement(),
  };
  const conversationsToggle = makeElement('button');
  conversationsToggle.setAttribute('data-view-toggle', 'conversations');
  const grouptaskToggle = makeElement('button');
  grouptaskToggle.setAttribute('data-view-toggle', 'grouptask');
  const toggles = [conversationsToggle, grouptaskToggle];

  const fetchCalls = [];
  const fetchImpl = async (url) => {
    const target = String(url);
    fetchCalls.push(target);
    if (target.startsWith('/api/bot/profiles')) {
      return jsonResponse({ ok: true, data: { profiles: [] } });
    }
    if (target.startsWith('/api/grouptask/list')) {
      return jsonResponse({ ok: true, data: { tasks: [TASK] } });
    }
    if (target.startsWith('/api/grouptask/detail')) {
      return jsonResponse({ ok: true, data: DETAIL });
    }
    if (target.startsWith('/api/grouptask/messages')) {
      return jsonResponse({ ok: true, data: { messages: MESSAGES, total: 2 } });
    }
    return jsonResponse({ ok: false, code: 'unexpected', message: `unexpected fetch: ${target}` });
  };

  const history = [];
  const context = {
    document: {
      querySelector: (selector) => elements[selector] ?? null,
      querySelectorAll: (selector) => (selector === '[data-view-toggle]' ? toggles : []),
      createElement: (tag) => makeElement(tag),
      addEventListener() {},
    },
    window: {
      location: { search },
      history: {
        replaceState(_state, _title, url) { history.push(String(url)); },
      },
      addEventListener() {},
      open() { return null; },
    },
    fetch: fetchImpl,
    URL,
    URLSearchParams,
    EventSource: undefined,
  };
  return { context, elements, toggles, fetchCalls, history };
}

test('group-task section loads tasks and renders members, deliverables, and transcript', async () => {
  const { context, elements } = createGroupTaskContext();
  vm.runInNewContext(buildConversationsPageDefinition().script, context);

  await waitFor(
    () => elements['[data-grouptask-detail-body]'].innerHTML.includes('metafile://deadbeef'),
    'group task detail to render',
  );

  const listElement = elements['[data-grouptask-list]'];
  assert.equal(listElement.children.length, 1);
  const rowHtml = listElement.children[0].innerHTML;
  assert.match(rowHtml, /Ship the parity wave/);
  assert.match(rowHtml, /executing/);
  assert.equal(listElement.children[0].dataset.selected, 'true');

  const detailHtml = elements['[data-grouptask-detail-body]'].innerHTML;
  assert.match(detailHtml, /Twin Bot/);
  assert.match(detailHtml, /Worker One/);
  assert.match(detailHtml, /metafile:\/\/deadbeef/);
  assert.match(detailHtml, /Plan drafted\./);
  assert.match(detailHtml, /forged/);
  assert.match(detailHtml, /grouptask-msg-suspect/);

  const headerHtml = elements['[data-grouptask-detail-header]'].innerHTML;
  assert.match(headerHtml, /Mark done/);
  assert.match(headerHtml, /Cancel task/);
  assert.doesNotMatch(headerHtml, /Reopen/);
});

test('group-task terminal tasks offer Reopen instead of close actions', async () => {
  const doneTask = { ...TASK, id: 8, status: 'done', title: 'Finished task' };
  const { context, elements } = createGroupTaskContext();
  const originalFetch = context.fetch;
  context.fetch = async (url) => {
    if (String(url).startsWith('/api/grouptask/list')) {
      return jsonResponse({ ok: true, data: { tasks: [doneTask] } });
    }
    if (String(url).startsWith('/api/grouptask/detail')) {
      return jsonResponse({ ok: true, data: { ...DETAIL, id: 8, status: 'done' } });
    }
    return originalFetch(url);
  };
  vm.runInNewContext(buildConversationsPageDefinition().script, context);

  await waitFor(
    () => elements['[data-grouptask-detail-header]'].innerHTML.includes('Reopen'),
    'terminal task detail to render',
  );

  const headerHtml = elements['[data-grouptask-detail-header]'].innerHTML;
  assert.match(headerHtml, /Reopen/);
  assert.doesNotMatch(headerHtml, /Mark done/);
  assert.doesNotMatch(headerHtml, /Cancel task/);
});
