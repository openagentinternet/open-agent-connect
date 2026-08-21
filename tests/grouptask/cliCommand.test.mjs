import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

async function runGroupTask(argv, grouptaskDeps) {
  const stdout = [];
  const exitCode = await runCli(['grouptask', ...argv], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: { grouptask: grouptaskDeps },
  });
  const raw = stdout.join('').trim();
  return { exitCode, result: raw ? JSON.parse(raw) : null };
}

test('grouptask create parses flags and dispatches', async () => {
  const calls = [];
  const { exitCode } = await runGroupTask(
    [
      'create',
      '--title', 'Haiku sprint',
      '--goal', 'One haiku',
      '--acceptance', '5-7-5',
      '--workers', 'alice, bob,',
      '--chair', 'twin',
    ],
    { create: async (input) => { calls.push(input); return commandSuccess({ task: { id: 1 } }); } },
  );
  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    title: 'Haiku sprint',
    goal: 'One haiku',
    acceptanceCriteria: '5-7-5',
    workerSlugs: ['alice', 'bob'],
    chairSlug: 'twin',
  }]);
});

test('grouptask create requires --title and --goal', async () => {
  const first = await runGroupTask(['create', '--goal', 'g'], { create: async () => commandSuccess({}) });
  assert.notEqual(first.exitCode, 0);
  assert.equal(first.result.code, 'missing_flag');

  const second = await runGroupTask(['create', '--title', 't'], { create: async () => commandSuccess({}) });
  assert.notEqual(second.exitCode, 0);
  assert.equal(second.result.code, 'missing_flag');
});

test('grouptask list validates --tab and passes --include-archived', async () => {
  const calls = [];
  const ok = await runGroupTask(
    ['list', '--tab', 'active', '--include-archived'],
    { list: async (input) => { calls.push(input); return commandSuccess({ tasks: [] }); } },
  );
  assert.equal(ok.exitCode, 0);
  assert.deepEqual(calls, [{ tab: 'active', includeArchived: true }]);

  const bad = await runGroupTask(['list', '--tab', 'bogus'], { list: async () => commandSuccess({}) });
  assert.notEqual(bad.exitCode, 0);
  assert.equal(bad.result.code, 'invalid_flag');
});

test('grouptask detail/messages require --chair and a positive --task', async () => {
  const calls = [];
  const deps = {
    detail: async (input) => { calls.push(['detail', input]); return commandSuccess({}); },
    messages: async (input) => { calls.push(['messages', input]); return commandSuccess({}); },
  };

  const missingChair = await runGroupTask(['detail', '--task', '1'], deps);
  assert.equal(missingChair.result.code, 'missing_flag');

  const badTask = await runGroupTask(['detail', '--chair', 'twin', '--task', 'zero'], deps);
  assert.equal(badTask.result.code, 'invalid_flag');

  const okDetail = await runGroupTask(['detail', '--chair', 'twin', '--task', '3', '--view', 'summary'], deps);
  assert.equal(okDetail.exitCode, 0);

  const okMessages = await runGroupTask(
    ['messages', '--chair', 'twin', '--task', '3', '--limit', '10', '--before-index', '40', '--no-sync'],
    deps,
  );
  assert.equal(okMessages.exitCode, 0);

  assert.deepEqual(calls, [
    ['detail', { chair: 'twin', taskId: 3, view: 'summary', sync: undefined }],
    ['messages', { chair: 'twin', taskId: 3, limit: 10, beforeIndex: 40, sync: false }],
  ]);
});

test('grouptask post rejects --as with --as-owner and forwards mention list', async () => {
  const calls = [];
  const deps = { postMessage: async (input) => { calls.push(input); return commandSuccess({ pinId: 'p1' }); } };

  const conflict = await runGroupTask(
    ['post', '--chair', 'twin', '--task', '1', '--content', 'x', '--as', 'alice', '--as-owner'],
    deps,
  );
  assert.equal(conflict.result.code, 'invalid_flag');

  const ok = await runGroupTask(
    ['post', '--chair', 'twin', '--task', '1', '--content', 'hello', '--as-owner', '--mention', 'id1,id2'],
    deps,
  );
  assert.equal(ok.exitCode, 0);
  assert.deepEqual(calls, [{
    chair: 'twin',
    taskId: 1,
    content: 'hello',
    asSlug: undefined,
    asOwner: true,
    replyPin: undefined,
    mention: ['id1', 'id2'],
  }]);
});

test('grouptask close validates outcome and rating', async () => {
  const calls = [];
  const deps = { close: async (input) => { calls.push(input); return commandSuccess({}); } };

  const badOutcome = await runGroupTask(['close', '--chair', 'twin', '--task', '1', '--outcome', 'finished'], deps);
  assert.equal(badOutcome.result.code, 'invalid_flag');

  const ok = await runGroupTask(
    ['close', '--chair', 'twin', '--task', '1', '--outcome', 'done', '--rating', '5', '--comment', 'nice'],
    deps,
  );
  assert.equal(ok.exitCode, 0);
  assert.deepEqual(calls, [{
    chair: 'twin',
    taskId: 1,
    outcome: 'done',
    rating: 5,
    ratingComment: 'nice',
    reason: undefined,
  }]);
});

test('grouptask kick requires a member reference', async () => {
  const deps = { kickMember: async () => commandSuccess({}) };
  const missing = await runGroupTask(['kick', '--chair', 'twin', '--task', '1'], deps);
  assert.equal(missing.result.code, 'invalid_flag');

  const calls = [];
  const ok = await runGroupTask(
    ['kick', '--chair', 'twin', '--task', '1', '--member', 'alice', '--reason', 'inactive'],
    { kickMember: async (input) => { calls.push(input); return commandSuccess({}); } },
  );
  assert.equal(ok.exitCode, 0);
  assert.deepEqual(calls, [{
    chair: 'twin',
    taskId: 1,
    slug: 'alice',
    globalMetaId: undefined,
    reason: 'inactive',
  }]);
});

test('grouptask pin/unpin/archive/unarchive map to boolean setters', async () => {
  const calls = [];
  const deps = {
    setPinned: async (input) => { calls.push(['pinned', input.pinned]); return commandSuccess({}); },
    setArchived: async (input) => { calls.push(['archived', input.archived]); return commandSuccess({}); },
  };
  for (const verb of ['pin', 'unpin', 'archive', 'unarchive']) {
    const { exitCode } = await runGroupTask([verb, '--chair', 'twin', '--task', '1'], deps);
    assert.equal(exitCode, 0);
  }
  assert.deepEqual(calls, [
    ['pinned', true],
    ['pinned', false],
    ['archived', true],
    ['archived', false],
  ]);
});

test('grouptask unknown subcommand fails cleanly', async () => {
  const { exitCode, result } = await runGroupTask(['bogus'], {});
  assert.notEqual(exitCode, 0);
  assert.equal(result.code, 'unknown_command');
});
