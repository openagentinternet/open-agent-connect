import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

function makeContext(dependencies, payload = {}) {
  return {
    stdout: { write: () => true },
    stderr: { write: () => true },
    readTextFile: async () => JSON.stringify(payload),
    dependencies,
  };
}

test('runCli dispatches twin subcommands', async () => {
  const calls = [];
  const record = (name) => async (input) => {
    calls.push([name, input]);
    return commandSuccess({});
  };
  const dependencies = {
    twin: {
      current: record('current'),
      workers: record('workers'),
      tasksCreate: record('tasksCreate'),
      tasksList: record('tasksList'),
      tasksShow: record('tasksShow'),
      tasksUpdate: record('tasksUpdate'),
    },
  };
  const run = (args) => runCli(args, makeContext(dependencies, { title: '发布准备', taskId: 'task_1' }));

  assert.equal(await run(['twin', 'current']), 0);
  assert.equal(await run(['twin', 'workers', '--from', 'alice']), 0);
  assert.equal(await run(['twin', 'tasks', 'create', '--from', 'alice', '--payload-file', 'p.json']), 0);
  assert.equal(await run(['twin', 'tasks', 'list', '--from', 'alice', '--status', 'running']), 0);
  assert.equal(await run(['twin', 'tasks', 'show', '--from', 'alice', '--task-id', 'task_1']), 0);
  assert.equal(await run(['twin', 'tasks', 'update', '--from', 'alice', '--payload-file', 'p.json']), 0);

  assert.deepEqual(calls.map(([name]) => name), [
    'current', 'workers', 'tasksCreate', 'tasksList', 'tasksShow', 'tasksUpdate',
  ]);
  assert.equal(calls[3][1].status, 'running');
});

test('runCli rejects malformed twin invocations', async () => {
  const dependencies = {
    twin: {
      tasksCreate: async () => commandSuccess({}),
      tasksUpdate: async () => commandSuccess({}),
    },
  };
  const run = (args) => runCli(args, makeContext(dependencies, {}));
  assert.equal(await run(['twin', 'tasks', 'create']), 1); // missing payload file
  assert.equal(await run(['twin', 'tasks', 'create', '--payload-file', 'p.json']), 1); // missing title
  assert.equal(await run(['twin', 'tasks', 'show']), 1); // missing --task-id
  assert.equal(await run(['twin', 'frobnicate']), 1);
});

test('runCli dispatches bot create --type and bind-owner', async () => {
  const calls = [];
  const dependencies = {
    bot: {
      createProfile: async (input) => {
        calls.push(['create', input]);
        return commandSuccess({});
      },
      bindOwner: async (input) => {
        calls.push(['bindOwner', input]);
        return commandSuccess({});
      },
    },
  };
  const run = (args) => runCli(args, makeContext(dependencies));

  assert.equal(await run(['bot', 'create', '--name', 'Alice', '--type', 'twin', '--owner', 'gm-owner']), 0);
  assert.equal(await run(['bot', 'bind-owner', '--from', 'alice']), 0);
  assert.equal(await run(['bot', 'bind-owner', '--from', 'alice', '--unbind']), 0);
  assert.equal(await run(['bot', 'create', '--name', 'Alice', '--type', 'boss']), 1);
  assert.equal(await run(['bot', 'bind-owner', '--from', 'alice', '--owner', 'gm-x', '--unbind']), 1);

  assert.equal(calls[0][1].botType, 'twin');
  assert.equal(calls[0][1].ownerGlobalMetaId, 'gm-owner');
  assert.deepEqual(calls[1][1], { slug: 'alice' });
  assert.deepEqual(calls[2][1], { slug: 'alice', unbind: true });
});
