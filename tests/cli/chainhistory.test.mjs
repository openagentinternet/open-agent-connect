import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { runChainhistoryCommand } = require('../../dist/cli/commands/chainhistory.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');
const { createChainHistoryStore } = require('../../dist/core/chainhistory/store.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { getDayBoundsMs } = require('../../dist/core/memory/dreamPrompt.js');

const READ_PAYLOAD = JSON.stringify({
  pinId: 'pin-cli-1',
  path: '/protocols/simplenote',
  protocol: 'simplenote',
  title: 'CLI Note',
  authorGlobalMetaId: 'gm-author',
  contentText: 'full text body',
  source: 'read_metaweb_pin',
});

function makeContext(dependencies, payload = READ_PAYLOAD) {
  return {
    stdout: { write: () => true },
    stderr: { write: () => true },
    cwd: '/tmp',
    readTextFile: async () => payload,
    dependencies,
  };
}

test('runCli dispatches chainhistory read record to the chainhistory dependency group', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      recordRead: async (input) => {
        calls.push(input);
        return commandSuccess({ recorded: true });
      },
    },
  };

  const exitCode = await runCli(
    ['chainhistory', 'read', 'record', '--from', 'alice', '--payload-file', 'p.json'],
    makeContext(dependencies),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    input: {
      pinId: 'pin-cli-1',
      path: '/protocols/simplenote',
      protocol: 'simplenote',
      title: 'CLI Note',
      authorGlobalMetaId: 'gm-author',
      contentText: 'full text body',
      source: 'read_metaweb_pin',
    },
  }]);
});

test('chainhistory read record without a handler fails not_implemented', async () => {
  // Direct invocation: runCli always merges runtime defaults, so the missing-
  // handler branch is only reachable with a bare context.
  const result = await runChainhistoryCommand(
    ['read', 'record', '--from', 'alice', '--payload-file', 'p.json'],
    makeContext({}),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_implemented');
});

test('chainhistory read record rejects malformed invocations', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      recordRead: async (input) => {
        calls.push(input);
        return commandSuccess({ recorded: true });
      },
    },
  };

  // Missing --payload-file.
  let result = await runChainhistoryCommand(['read', 'record', '--from', 'alice'], makeContext(dependencies));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing_flag');

  // Payload without pinId.
  result = await runChainhistoryCommand(
    ['read', 'record', '--payload-file', 'p.json'],
    makeContext(dependencies, '{}'),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_payload');

  // Non-object payload file content.
  result = await runChainhistoryCommand(
    ['read', 'record', '--payload-file', 'p.json'],
    makeContext(dependencies, '[1,2]'),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_payload');

  // Unknown subcommands.
  result = await runChainhistoryCommand(['write', 'record'], makeContext(dependencies));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unknown_command');
  result = await runChainhistoryCommand(['read', 'frobnicate'], makeContext(dependencies));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unknown_command');

  assert.deepEqual(calls, [], 'no malformed invocation reaches the handler');

  // runCli surfaces the same failures as non-zero exit codes.
  assert.equal(await runCli(['chainhistory', 'read', 'record'], makeContext(dependencies)), 1);
  assert.equal(await runCli(['chainhistory', 'read', 'record', '--payload-file', 'p.json'], makeContext(dependencies, '{}')), 1);
  assert.equal(await runCli(['chainhistory', 'frobnicate'], makeContext(dependencies)), 1);
});

test('chainhistory read record keeps only string payload fields', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      recordRead: async (input) => {
        calls.push(input);
        return commandSuccess({ recorded: true });
      },
    },
  };
  const payload = JSON.stringify({
    pinId: 'pin-cli-2',
    title: 42,
    path: '',
    contentText: 'kept verbatim  ',
    extra: 'dropped',
  });

  const exitCode = await runCli(
    ['chainhistory', 'read', 'record', '--payload-file', 'p.json'],
    makeContext(dependencies, payload),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: undefined,
    input: { pinId: 'pin-cli-2', contentText: 'kept verbatim  ' },
  }]);
});

test('runCli dispatches chainhistory summary pending with an optional limit', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      summaryPending: async (input) => {
        calls.push(input);
        return commandSuccess({ items: [], summarizedToday: 0 });
      },
    },
  };

  assert.equal(
    await runCli(['chainhistory', 'summary', 'pending', '--from', 'alice', '--limit', '5'], makeContext(dependencies)),
    0,
  );
  assert.equal(
    await runCli(['chainhistory', 'summary', 'pending'], makeContext(dependencies)),
    0,
  );
  assert.deepEqual(calls, [
    { from: 'alice', limit: 5 },
    { from: undefined },
  ]);
});

test('chainhistory summary pending rejects a non-positive --limit', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      summaryPending: async (input) => {
        calls.push(input);
        return commandSuccess({ items: [], summarizedToday: 0 });
      },
    },
  };

  for (const args of [
    ['summary', 'pending', '--limit', '0'],
    ['summary', 'pending', '--limit', '-3'],
    ['summary', 'pending', '--limit', 'abc'],
  ]) {
    const result = await runChainhistoryCommand(args, makeContext(dependencies));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_flag');
  }
  assert.equal(await runCli(['chainhistory', 'summary', 'pending', '--limit', '0'], makeContext(dependencies)), 1);
  assert.deepEqual(calls, [], 'no invalid --limit reaches the handler');
});

test('runCli dispatches chainhistory summary apply with a validated payload', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      summaryApply: async (input) => {
        calls.push(input);
        return commandSuccess({ applied: true });
      },
    },
  };
  const payload = JSON.stringify({
    kind: 'write',
    pinId: 'pin-sum-1',
    outcome: 'done',
    summary: 'two sentences',
  });

  const exitCode = await runCli(
    ['chainhistory', 'summary', 'apply', '--from', 'alice', '--payload-file', 'p.json'],
    makeContext(dependencies, payload),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    kind: 'write',
    pinId: 'pin-sum-1',
    outcome: 'done',
    summary: 'two sentences',
  }]);

  // outcome failed needs no summary.
  const failedPayload = JSON.stringify({ kind: 'read', pinId: 'pin-sum-2', outcome: 'failed' });
  assert.equal(
    await runCli(['chainhistory', 'summary', 'apply', '--payload-file', 'p.json'], makeContext(dependencies, failedPayload)),
    0,
  );
  assert.deepEqual(calls[1], { from: undefined, kind: 'read', pinId: 'pin-sum-2', outcome: 'failed' });
});

test('chainhistory summary apply rejects malformed payloads', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      summaryApply: async (input) => {
        calls.push(input);
        return commandSuccess({ applied: true });
      },
    },
  };

  // Missing --payload-file.
  let result = await runChainhistoryCommand(['summary', 'apply', '--from', 'alice'], makeContext(dependencies));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing_flag');

  const invalidPayloads = [
    ['{}', 'invalid_payload'], // no kind/pinId/outcome
    [JSON.stringify({ kind: 'delete', pinId: 'p', outcome: 'done', summary: 's' }), 'invalid_payload'],
    [JSON.stringify({ kind: 'write', outcome: 'done', summary: 's' }), 'invalid_payload'], // no pinId
    [JSON.stringify({ kind: 'write', pinId: 'p', outcome: 'unknown' }), 'invalid_payload'],
    [JSON.stringify({ kind: 'write', pinId: 'p', outcome: 'done' }), 'invalid_payload'], // done without summary
    [JSON.stringify({ kind: 'write', pinId: 'p', outcome: 'done', summary: '   ' }), 'invalid_payload'], // blank summary
    ['[1,2]', 'invalid_payload'], // non-object payload
  ];
  for (const [payload, code] of invalidPayloads) {
    result = await runChainhistoryCommand(['summary', 'apply', '--payload-file', 'p.json'], makeContext(dependencies, payload));
    assert.equal(result.ok, false, `payload ${payload} should fail`);
    assert.equal(result.code, code);
  }
  assert.deepEqual(calls, [], 'no malformed invocation reaches the handler');
});

test('chainhistory summary verbs without handlers fail not_implemented', async () => {
  // Direct invocation: runCli always merges runtime defaults, so the missing-
  // handler branch is only reachable with a bare context.
  let result = await runChainhistoryCommand(['summary', 'pending', '--from', 'alice'], makeContext({}));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_implemented');
  result = await runChainhistoryCommand(['summary', 'apply', '--from', 'alice', '--payload-file', 'p.json'], makeContext({}));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_implemented');
});

test('chainhistory summary unknown nested subcommand fails unknown_command', async () => {
  const result = await runChainhistoryCommand(['summary', 'frobnicate'], makeContext({}));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unknown_command');
  assert.equal(await runCli(['chainhistory', 'summary', 'frobnicate'], makeContext({})), 1);
});

test('runCli dispatches chainhistory recall with parsed flags', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      recall: async (input) => {
        calls.push(input);
        return commandSuccess({ writes: [], reads: [] });
      },
    },
  };

  const exitCode = await runCli(
    ['chainhistory', 'recall', '--from', 'alice', '--query', ' metaweb ', '--kind', 'read',
      '--from-date', '2026-09-01', '--to-date', '2026-09-02', '--limit', '5'],
    makeContext(dependencies),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    query: 'metaweb',
    kind: 'read',
    fromDate: '2026-09-01',
    toDate: '2026-09-02',
    limit: 5,
  }]);

  // Bare recall: every flag is optional; the store's default 90-day window
  // applies downstream when no dates are forwarded.
  assert.equal(await runCli(['chainhistory', 'recall'], makeContext(dependencies)), 0);
  assert.deepEqual(calls[1], { from: undefined });
});

test('chainhistory recall rejects invalid flags before reaching the handler', async () => {
  const calls = [];
  const dependencies = {
    chainhistory: {
      recall: async (input) => {
        calls.push(input);
        return commandSuccess({ writes: [], reads: [] });
      },
    },
  };

  for (const args of [
    ['recall', '--from-date', 'yesterday'],
    ['recall', '--from-date', '2026/09/01'],
    ['recall', '--to-date', '2026-9-1'],
    ['recall', '--from-date', '2026-09-03', '--to-date', '2026-09-01'],
    ['recall', '--kind', 'bogus'],
    ['recall', '--limit', '0'],
    ['recall', '--limit', '-3'],
    ['recall', '--limit', 'abc'],
  ]) {
    const result = await runChainhistoryCommand(args, makeContext(dependencies));
    assert.equal(result.ok, false, args.join(' '));
    assert.equal(result.code, 'invalid_flag', args.join(' '));
  }
  assert.deepEqual(calls, [], 'no invalid invocation reaches the handler');
  assert.equal(await runCli(['chainhistory', 'recall', '--kind', 'bogus'], makeContext(dependencies)), 1);
});

test('chainhistory recall without a handler fails not_implemented', async () => {
  // Direct invocation: runCli always merges runtime defaults, so the missing-
  // handler branch is only reachable with a bare context.
  const result = await runChainhistoryCommand(['recall', '--from', 'alice'], makeContext({}));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_implemented');
});

const DAY_MS = 24 * 60 * 60 * 1000;

function localDateString(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function createProfileHome(prefix, slug = 'alice') {
  const systemHome = await mkdtempTempRoot(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(managerRoot, { recursive: true });
  const now = Date.now();
  await fs.writeFile(
    path.join(managerRoot, 'identity-profiles.json'),
    `${JSON.stringify({
      profiles: [
        { name: slug, slug, aliases: [slug], homeDir, globalMetaId: '', mvcAddress: '', createdAt: now, updatedAt: now },
      ],
    }, null, 2)}\n`,
    'utf8',
  );
  return { homeDir, systemHome };
}

async function runRecallCli(homeDir, systemHome, args) {
  const stdout = [];
  const exitCode = await runCli(['chainhistory', 'recall', ...args], {
    env: { ...process.env, HOME: systemHome, METABOT_HOME: homeDir },
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  const raw = stdout.join('').trim();
  return { exitCode, result: raw ? JSON.parse(raw) : null };
}

test('chainhistory recall searches the real store with kind routing, query, and date windows', async () => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-chainhistory-recall-');
  const store = createChainHistoryStore(resolveMetabotPaths(homeDir));
  const now = Date.now();
  const dayA = localDateString(now - 10 * DAY_MS);
  const dayB = localDateString(now - 2 * DAY_MS);
  // Seed one hour after local midnight so the records stay inside their local
  // day regardless of the host timezone.
  await store.recordWrite({
    pinId: 'w-recent', path: '/protocols/simplebuzz', operation: 'create',
    contentText: 'hello metaweb world', occurredAtMs: getDayBoundsMs(dayA).startMs + 3_600_000,
  });
  await store.recordWrite({
    pinId: 'w-old', path: '/protocols/simplebuzz', operation: 'create',
    contentText: 'ancient post', occurredAtMs: now - 200 * DAY_MS,
  });
  await store.recordRead({
    pinId: 'r-recent', path: '/protocols/simplenote', protocol: 'simplenote',
    title: 'MetaWeb 指南', authorGlobalMetaId: 'gm-author', contentText: 'guide body',
    readAtMs: getDayBoundsMs(dayB).startMs + 3_600_000,
  });
  await store.recordRead({
    pinId: 'r-old', path: '/protocols/simplenote', protocol: 'simplenote',
    title: 'Old note', contentText: 'old body', readAtMs: now - 200 * DAY_MS,
  });

  // Bare recall: the store's 90-day default window keeps recent records only.
  let run = await runRecallCli(homeDir, systemHome, ['--from', 'alice']);
  assert.equal(run.exitCode, 0);
  assert.equal(run.result.ok, true);
  assert.deepEqual(run.result.data.writes.map((write) => write.pinId), ['w-recent']);
  assert.deepEqual(run.result.data.reads.map((read) => read.pinId), ['r-recent']);
  assert.deepEqual(
    Object.keys(run.result.data.writes[0]).sort(),
    ['contentText', 'occurredAtMs', 'operation', 'path', 'pinId', 'summary'],
  );
  assert.deepEqual(
    Object.keys(run.result.data.reads[0]).sort(),
    ['authorGlobalMetaId', 'contentExcerpt', 'lastReadAtMs', 'path', 'pinId', 'protocol', 'readCount', 'savedToKb', 'summary', 'title'],
  );

  // Kind routing.
  run = await runRecallCli(homeDir, systemHome, ['--from', 'alice', '--kind', 'write']);
  assert.deepEqual(run.result.data.writes.map((write) => write.pinId), ['w-recent']);
  assert.deepEqual(run.result.data.reads, []);
  run = await runRecallCli(homeDir, systemHome, ['--from', 'alice', '--kind', 'read']);
  assert.deepEqual(run.result.data.writes, []);
  assert.deepEqual(run.result.data.reads.map((read) => read.pinId), ['r-recent']);

  // Query filter (matches the read title only).
  run = await runRecallCli(homeDir, systemHome, ['--from', 'alice', '--query', '指南']);
  assert.deepEqual(run.result.data.writes, []);
  assert.deepEqual(run.result.data.reads.map((read) => read.pinId), ['r-recent']);

  // Explicit local-day windows.
  run = await runRecallCli(homeDir, systemHome, ['--from', 'alice', '--from-date', dayA, '--to-date', dayA]);
  assert.deepEqual(run.result.data.writes.map((write) => write.pinId), ['w-recent']);
  assert.deepEqual(run.result.data.reads, []);
  run = await runRecallCli(homeDir, systemHome, ['--from', 'alice', '--from-date', dayB, '--to-date', dayB]);
  assert.deepEqual(run.result.data.writes, []);
  assert.deepEqual(run.result.data.reads.map((read) => read.pinId), ['r-recent']);

  // --limit is forwarded into the store clamp (1..50).
  run = await runRecallCli(homeDir, systemHome, ['--from', 'alice', '--limit', '1']);
  assert.equal(run.result.data.writes.length + run.result.data.reads.length, 2, 'limit applies per kind');
});
