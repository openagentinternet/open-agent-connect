import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { handleGroupTaskRoutes } = require('../../dist/daemon/routes/grouptask.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

function createContext({ method, pathname, search = '', body = {}, handlers = {} }) {
  const sent = [];
  const methodNotAllowed = [];
  return {
    context: {
      req: { method },
      url: new URL(`http://127.0.0.1${pathname}${search}`),
      handlers,
      readJsonBody: async () => body,
      sendJson: (status, payload) => { sent.push({ status, payload }); },
      sendMethodNotAllowed: (allowed) => { methodNotAllowed.push(allowed); },
    },
    sent,
    methodNotAllowed,
  };
}

test('grouptask routes ignore non-grouptask paths', async () => {
  const { context } = createContext({ method: 'GET', pathname: '/api/chat/private' });
  assert.equal(await handleGroupTaskRoutes(context), false);
  const unknown = createContext({ method: 'GET', pathname: '/api/grouptask/nope' });
  assert.equal(await handleGroupTaskRoutes(unknown.context), false);
});

test('grouptask GET routes pass query params to the handler', async () => {
  const calls = [];
  const { context, sent } = createContext({
    method: 'GET',
    pathname: '/api/grouptask/detail',
    search: '?chair=twin&taskId=3&view=summary',
    handlers: {
      grouptask: {
        detail: async (input) => { calls.push(input); return commandSuccess({ id: 3 }); },
      },
    },
  });
  assert.equal(await handleGroupTaskRoutes(context), true);
  assert.deepEqual(calls, [{ chair: 'twin', taskId: '3', view: 'summary' }]);
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.data.id, 3);
});

test('grouptask POST routes pass the JSON body to the handler', async () => {
  const calls = [];
  const { context, sent } = createContext({
    method: 'POST',
    pathname: '/api/grouptask/create',
    body: { title: 'T', goal: 'G', workerSlugs: ['a'] },
    handlers: {
      grouptask: {
        create: async (input) => { calls.push(input); return commandSuccess({ task: { id: 1 } }); },
      },
    },
  });
  assert.equal(await handleGroupTaskRoutes(context), true);
  assert.deepEqual(calls, [{ title: 'T', goal: 'G', workerSlugs: ['a'] }]);
  assert.equal(sent[0].payload.ok, true);
});

test('grouptask routes enforce methods and report missing handlers', async () => {
  const wrongMethod = createContext({ method: 'GET', pathname: '/api/grouptask/create' });
  assert.equal(await handleGroupTaskRoutes(wrongMethod.context), true);
  assert.deepEqual(wrongMethod.methodNotAllowed, [['POST']]);

  const notConfigured = createContext({
    method: 'POST',
    pathname: '/api/grouptask/member/kick',
    handlers: { grouptask: {} },
  });
  assert.equal(await handleGroupTaskRoutes(notConfigured.context), true);
  assert.equal(notConfigured.sent[0].status, 501);
  assert.equal(notConfigured.sent[0].payload.code, 'not_implemented');
});

test('every advertised grouptask endpoint dispatches to its verb', async () => {
  const verbsHit = [];
  const record = (name) => async () => { verbsHit.push(name); return commandSuccess({}); };
  const handlers = {
    grouptask: {
      create: record('create'),
      list: record('list'),
      detail: record('detail'),
      messages: record('messages'),
      postMessage: record('postMessage'),
      close: record('close'),
      reopen: record('reopen'),
      kickMember: record('kickMember'),
      setMemberStatus: record('setMemberStatus'),
      rename: record('rename'),
      setPinned: record('setPinned'),
      setArchived: record('setArchived'),
    },
  };
  const posts = [
    '/api/grouptask/create',
    '/api/grouptask/message',
    '/api/grouptask/close',
    '/api/grouptask/reopen',
    '/api/grouptask/member/kick',
    '/api/grouptask/member/status',
    '/api/grouptask/rename',
    '/api/grouptask/pin',
    '/api/grouptask/archive',
  ];
  const gets = ['/api/grouptask/list', '/api/grouptask/detail', '/api/grouptask/messages'];
  for (const pathname of posts) {
    const { context } = createContext({ method: 'POST', pathname, handlers });
    assert.equal(await handleGroupTaskRoutes(context), true, pathname);
  }
  for (const pathname of gets) {
    const { context } = createContext({ method: 'GET', pathname, handlers });
    assert.equal(await handleGroupTaskRoutes(context), true, pathname);
  }
  assert.deepEqual(verbsHit.sort(), [
    'close', 'create', 'detail', 'kickMember', 'list', 'messages',
    'postMessage', 'rename', 'reopen', 'setArchived', 'setMemberStatus', 'setPinned',
  ]);
});
