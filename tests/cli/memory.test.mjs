import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

function makeContext(dependencies) {
  return {
    stdout: { write: () => true },
    stderr: { write: () => true },
    readTextFile: async () => JSON.stringify({
      text: '我喜欢喝美式咖啡',
      id: 'mem_1',
      sessionId: 'sess-1',
      role: 'user',
      userText: '请记住：我喜欢美式咖啡',
      assistantText: '好的',
      query: '咖啡',
    }),
    dependencies,
  };
}

test('runCli dispatches memory CRUD and reads to the memory dependency group', async () => {
  const calls = [];
  const record = (name) => async (input) => {
    calls.push([name, input]);
    return commandSuccess({});
  };
  const dependencies = {
    memory: {
      list: record('list'),
      add: record('add'),
      update: record('update'),
      delete: record('delete'),
      unarchive: record('unarchive'),
      blocks: record('blocks'),
      extract: record('extract'),
      policyGet: record('policyGet'),
      policySet: record('policySet'),
      policyDelete: record('policyDelete'),
      scopes: record('scopes'),
      stats: record('stats'),
      transcriptAppend: record('transcriptAppend'),
      transcriptRead: record('transcriptRead'),
      chats: record('chats'),
      search: record('search'),
      hygieneStatus: record('hygieneStatus'),
      hygieneDue: record('hygieneDue'),
      hygieneRun: record('hygieneRun'),
      hygieneConfigGet: record('hygieneConfigGet'),
      hygieneConfigSet: record('hygieneConfigSet'),
    },
  };

  const run = (args) => runCli(args, makeContext(dependencies));

  assert.equal(await run(['memory', 'list', '--from', 'alice', '--query', '咖啡', '--limit', '5', '--include-archived']), 0);
  assert.equal(await run(['memory', 'add', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['memory', 'update', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['memory', 'delete', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['memory', 'unarchive', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['memory', 'blocks', '--from', 'alice']), 0);
  assert.equal(await run(['memory', 'extract', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['memory', 'policy', 'get', '--from', 'alice']), 0);
  assert.equal(await run(['memory', 'policy', 'set', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['memory', 'policy', 'delete', '--from', 'alice']), 0);
  assert.equal(await run(['memory', 'scopes', '--from', 'alice']), 0);
  assert.equal(await run(['memory', 'stats', '--from', 'alice']), 0);
  assert.equal(await run(['memory', 'transcript', 'append', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['memory', 'transcript', 'read', '--from', 'alice', '--session', 'session-1', '--any-bot', '--limit', '2']), 0);
  assert.equal(await run(['memory', 'chats', '--from', 'alice', '--sort-order', 'asc']), 0);
  assert.equal(await run(['memory', 'search', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['memory', 'hygiene', 'status', '--from', 'alice']), 0);
  assert.equal(await run(['memory', 'hygiene', 'due', '--from', 'alice']), 0);
  assert.equal(await run(['memory', 'hygiene', 'run', '--from', 'alice', '--no-deep']), 0);
  assert.equal(await run(['memory', 'hygiene', 'config', 'get', '--from', 'alice']), 0);
  assert.equal(await run(['memory', 'hygiene', 'config', 'set', '--from', 'alice', '--payload-file', 'p.json']), 0);

  assert.deepEqual(calls.map(([name]) => name), [
    'list', 'add', 'update', 'delete', 'unarchive', 'blocks', 'extract',
    'policyGet', 'policySet', 'policyDelete', 'scopes', 'stats',
    'transcriptAppend', 'transcriptRead', 'chats', 'search',
    'hygieneStatus', 'hygieneDue', 'hygieneRun', 'hygieneConfigGet', 'hygieneConfigSet',
  ]);
  assert.deepEqual(calls[0][1], { from: 'alice', query: '咖啡', limit: 5, includeDeleted: false, includeArchived: true, scopeKind: undefined, scopeKey: undefined, usageClass: undefined, status: undefined, origin: undefined });
  assert.deepEqual(calls[13][1], { from: 'alice', session: 'session-1', anyBot: true, limit: 2 });
  assert.equal(calls[14][1].sortOrder, 'asc');
  assert.deepEqual(calls[18][1], { from: 'alice', noDeep: true });
});

test('runCli rejects malformed memory invocations', async () => {
  const dependencies = {
    memory: {
      add: async () => commandSuccess({}),
      update: async () => commandSuccess({}),
      extract: async () => commandSuccess({}),
      search: async () => commandSuccess({}),
    },
  };
  // Payload file that parses but lacks every required field.
  const context = {
    ...makeContext(dependencies),
    readTextFile: async () => '{}',
  };
  const run = (args) => runCli(args, context);

  // add without --payload-file
  assert.equal(await run(['memory', 'add', '--from', 'alice']), 1);
  // add with a payload missing text
  assert.equal(await run(['memory', 'add', '--payload-file', 'p.json']), 1);
  // update with a payload missing id
  assert.equal(await run(['memory', 'update', '--payload-file', 'p.json']), 1);
  // extract with a payload missing userText/assistantText
  assert.equal(await run(['memory', 'extract', '--payload-file', 'p.json']), 1);
  // search with a payload missing query
  assert.equal(await run(['memory', 'search', '--payload-file', 'p.json']), 1);
  // unknown subcommand
  assert.equal(await run(['memory', 'frobnicate']), 1);
  // unknown policy nested subcommand
  assert.equal(await run(['memory', 'policy', 'frobnicate']), 1);
  // invalid --limit
  assert.equal(await run(['memory', 'list', '--limit', 'abc']), 1);
  // invalid --sort-order
  assert.equal(await run(['memory', 'chats', '--sort-order', 'sideways']), 1);
  // unknown hygiene subcommand
  assert.equal(await run(['memory', 'hygiene', 'frobnicate']), 1);
  // unknown hygiene config subcommand
  assert.equal(await run(['memory', 'hygiene', 'config', 'frobnicate']), 1);
  // config set without --payload-file
  assert.equal(await run(['memory', 'hygiene', 'config', 'set', '--from', 'alice']), 1);
});

test('runCli dispatches memory procedure subcommands to the procedure handlers', async () => {
  const calls = [];
  const record = (name) => async (input) => {
    calls.push([name, input]);
    return commandSuccess({});
  };
  const dependencies = {
    memory: {
      procedureList: record('procedureList'),
      procedureRecall: record('procedureRecall'),
      procedureSave: record('procedureSave'),
      procedureArchive: record('procedureArchive'),
    },
  };
  const context = {
    stdout: { write: () => true },
    stderr: { write: () => true },
    readTextFile: async () => JSON.stringify({ title: 'Publish a chain article', steps: ['draft', 'publish'] }),
    dependencies,
  };
  const run = (args) => runCli(args, context);

  assert.equal(await run(['memory', 'procedure', 'list', '--from', 'alice']), 0);
  assert.equal(await run(['memory', 'procedure', 'list', '--status', 'archived', '--limit', '5']), 0);
  assert.equal(await run(['memory', 'procedure', 'list', '--status', 'sideways']), 1, 'bad --status fails');
  assert.equal(await run(['memory', 'procedure', 'recall', '--from', 'alice', '--query', 'publish article']), 0);
  assert.equal(await run(['memory', 'procedure', 'recall', '--from', 'alice']), 1, 'recall without --query fails');
  assert.equal(await run(['memory', 'procedure', 'save', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['memory', 'procedure', 'archive', '--from', 'alice', '--title', 'Publish a chain article']), 0);
  assert.equal(await run(['memory', 'procedure', 'archive', '--from', 'alice']), 1, 'archive without --title fails');
  assert.equal(await run(['memory', 'procedure', 'frobnicate']), 1, 'unknown nested subcommand fails');

  assert.deepEqual(calls.map(([name]) => name), [
    'procedureList', 'procedureList', 'procedureRecall', 'procedureSave', 'procedureArchive',
  ]);
  assert.deepEqual(calls[0][1], { from: 'alice' });
  assert.deepEqual(calls[1][1], { from: undefined, status: 'archived', limit: 5 });
  assert.deepEqual(calls[2][1], { from: 'alice', query: 'publish article' });
  assert.equal(calls[3][1].payload.title, 'Publish a chain article');
  assert.deepEqual(calls[3][1].payload.steps, ['draft', 'publish']);
  assert.deepEqual(calls[4][1], { from: 'alice', title: 'Publish a chain article' });
});
