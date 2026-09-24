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
    readTextFile: async () => '{}',
    dependencies,
  };
}

test('runCli dispatches knowledge-base subcommands to the kb dependency group', async () => {
  const calls = [];
  const record = (name) => async (input) => {
    calls.push([name, input]);
    return commandSuccess({});
  };
  const dependencies = {
    knowledgeBase: {
      list: record('list'),
      create: record('create'),
      update: record('update'),
      remove: record('remove'),
      query: record('query'),
      addDocument: record('addDocument'),
      learn: record('learn'),
    },
  };
  const run = (args) => runCli(args, makeContext(dependencies));

  assert.equal(await run(['knowledge-base', 'list', '--from', 'alice']), 0);
  assert.equal(await run(['knowledge-base', 'create', '--name', 'Law', '--description', '法规', '--autolearn', 'off']), 0);
  assert.equal(await run(['knowledge-base', 'update', '--id', 'kb1', '--autolearn', 'on']), 0);
  assert.equal(await run(['knowledge-base', 'remove', '--id', 'kb1']), 1, 'remove without --confirm refuses');
  assert.equal(await run(['knowledge-base', 'remove', '--id', 'kb1', '--confirm']), 0);
  assert.equal(await run(['knowledge-base', 'query', '--text', '民法 合同', '--top-k', '3']), 0);
  assert.equal(await run(['knowledge-base', 'add-document', '--title', 'Doc', '--content', 'Body text', '--source-type', 'metaweb', '--pin-id', 'p1', '--tags', 'a,b']), 0);
  assert.equal(await run(['knowledge-base', 'learn', '--full']), 0);
  assert.equal(await run(['knowledge-base', 'nope']), 1, 'unknown subcommand fails');

  assert.deepEqual(calls.map(([name]) => name), [
    'list', 'create', 'update', 'remove', 'query', 'addDocument', 'learn',
  ]);
  assert.deepEqual(calls[0][1], { from: 'alice' });
  assert.equal(calls[1][1].name, 'Law');
  assert.equal(calls[1][1].autoLearn, false);
  assert.deepEqual(calls[2][1], { from: undefined, id: 'kb1', autoLearn: true });
  assert.deepEqual(calls[3][1], { from: undefined, id: 'kb1' });
  assert.equal(calls[4][1].text, '民法 合同');
  assert.equal(calls[4][1].topK, 3);
  assert.deepEqual(calls[5][1], {
    from: undefined,
    title: 'Doc',
    content: 'Body text',
    sourceType: 'metaweb',
    pinId: 'p1',
    tags: ['a', 'b'],
  });
  assert.deepEqual(calls[6][1], { from: undefined, full: true });
});

test('knowledge-base add-document reads --content-file and rejects both content flags', async () => {
  const calls = [];
  const dependencies = {
    knowledgeBase: {
      addDocument: async (input) => { calls.push(input); return commandSuccess({}); },
    },
  };
  const context = {
    stdout: { write: () => true },
    stderr: { write: () => true },
    // The CLI content-file path reads the file itself; provide an existing file.
    dependencies,
  };
  const { mkdtempTempRootSync } = await import('../helpers/tempRoots.mjs');
  const { writeFileSync } = await import('node:fs');
  const path = await import('node:path');
  const dir = mkdtempTempRootSync('metabot-kb-cli-');
  const contentFile = path.join(dir, 'doc.md');
  writeFileSync(contentFile, '# Title body');

  const run = (args) => runCli(args, context);
  assert.equal(await run(['knowledge-base', 'add-document', '--title', 'T', '--content-file', contentFile]), 0);
  assert.equal(calls[0].content, '# Title body');
  assert.equal(await run(['knowledge-base', 'add-document', '--title', 'T', '--content', 'a', '--content-file', contentFile]), 1);
  assert.equal(calls.length, 1, 'both-flags call never reaches the handler');
});

test('runCli dispatches knowledge-base study subcommands to the study handlers', async () => {
  const calls = [];
  const record = (name) => async (input) => {
    calls.push([name, input]);
    return commandSuccess({});
  };
  const dependencies = {
    knowledgeBase: {
      studyList: record('studyList'),
      studyEnqueue: record('studyEnqueue'),
      studyRetry: record('studyRetry'),
    },
  };
  const run = (args) => runCli(args, makeContext(dependencies));

  assert.equal(await run(['knowledge-base', 'study', 'enqueue', '--from', 'alice', '--topic', 'MetaID 协议', '--budget-pins', '10']), 0);
  assert.equal(await run(['knowledge-base', 'study', 'enqueue', '--topic', 'x', '--budget-pins', 'abc']), 1, 'non-numeric --budget-pins fails');
  assert.equal(await run(['knowledge-base', 'study', 'enqueue']), 1, 'missing --topic fails');
  assert.equal(await run(['knowledge-base', 'study', 'status', '--from', 'alice']), 0);
  assert.equal(await run(['knowledge-base', 'study', 'retry', '--from', 'alice']), 0);
  assert.equal(await run(['knowledge-base', 'study', 'retry', '--job-id', 'study-1']), 0);
  assert.equal(await run(['knowledge-base', 'study', 'retry', '--topic', 'metaid']), 0);
  assert.equal(await run(['knowledge-base', 'study', 'frobnicate']), 1, 'unknown study verb fails');

  assert.deepEqual(calls.map(([name]) => name), [
    'studyEnqueue', 'studyList', 'studyRetry', 'studyRetry', 'studyRetry',
  ]);
  assert.deepEqual(calls[0][1], { from: 'alice', topic: 'MetaID 协议', budgetPins: 10 });
  assert.deepEqual(calls[1][1], { from: 'alice' });
  assert.deepEqual(calls[2][1], { from: 'alice' });
  assert.deepEqual(calls[3][1], { from: undefined, jobId: 'study-1' });
  assert.deepEqual(calls[4][1], { from: undefined, topic: 'metaid' });
});

async function readHelpJson(args) {
  const stdout = [];
  const exitCode = await runCli([...args, '--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  return { exitCode, payload: JSON.parse(stdout.join('')) };
}

test('knowledge-base subcommand help resolves the verb spec instead of the parent help', async () => {
  const parent = await readHelpJson(['knowledge-base']);
  assert.equal(parent.exitCode, 0);
  assert.deepEqual(parent.payload.commandPath, ['knowledge-base']);

  const expected = [
    ['list', 'metabot knowledge-base list [--from <bot-slug>]', ['knowledgeBases']],
    ['create', 'metabot knowledge-base create --name <name> [--description <text>] [--raw-dir <path>] [--autolearn <on|off>] [--from <bot-slug>]', ['knowledgeBase']],
    ['update', 'metabot knowledge-base update --id <kb-id> [--name <name>] [--description <text>] [--autolearn <on|off>] [--from <bot-slug>]', ['knowledgeBase']],
    ['remove', 'metabot knowledge-base remove --id <kb-id> --confirm [--from <bot-slug>]', ['removed', 'knowledgeBaseId']],
    ['add-document', 'metabot knowledge-base add-document --title <text> --content <text>|--content-file <path> [--id <kb-id>] [--source-type <web|metaweb|manual>] [--url <url>] [--pin-id <pinId>] [--tags <a,b>] [--from <bot-slug>]', ['knowledgeBase', 'relPath', 'indexed']],
    ['query', 'metabot knowledge-base query --text <query> [--id <kb-id>] [--top-k <n>] [--min-score <f>] [--from <bot-slug>]', ['results']],
    ['learn', 'metabot knowledge-base learn [--id <kb-id>] [--full] [--from <bot-slug>]', ['knowledgeBase']],
  ];

  for (const [verb, usage, successFields] of expected) {
    const { exitCode, payload } = await readHelpJson(['knowledge-base', verb]);
    assert.equal(exitCode, 0);
    assert.deepEqual(payload.commandPath, ['knowledge-base', verb], `${verb} help should not fall back to the parent spec`);
    assert.equal(payload.usage, usage, `${verb} usage should name the verb`);
    for (const field of successFields) {
      assert.ok(
        payload.successFields.some((entry) => entry === field || entry.startsWith(`${field} `)),
        `${verb} success shape should list ${field}`,
      );
    }
  }
});

test('knowledge-base subcommand help documents the flags the commands actually read', async () => {
  const documentedFlags = async (verb) => {
    const { payload } = await readHelpJson(['knowledge-base', verb]);
    return [...payload.requiredFlags, ...payload.optionalFlags].map((entry) => entry.flag);
  };

  assert.deepEqual(await documentedFlags('list'), ['--from', '--json']);
  assert.deepEqual(
    await documentedFlags('create'),
    ['--name', '--description', '--raw-dir', '--autolearn', '--from', '--json'],
  );
  assert.deepEqual(
    await documentedFlags('update'),
    ['--id', '--name', '--description', '--autolearn', '--from', '--json'],
  );
  assert.deepEqual(await documentedFlags('remove'), ['--id', '--confirm', '--from', '--json']);
  assert.deepEqual(
    await documentedFlags('add-document'),
    ['--title', '--content', '--content-file', '--id', '--source-type', '--url', '--pin-id', '--tags', '--from', '--json'],
  );

  // The query verb's flag is --text; --query is not a flag anywhere.
  const query = await documentedFlags('query');
  assert.ok(query.includes('--text'));
  assert.equal(query.includes('--query'), false);

  const study = (await readHelpJson(['knowledge-base', 'study'])).payload;
  assert.equal(study.usage, 'metabot knowledge-base study <enqueue|status|retry> [--from <bot-slug>]');
  assert.ok(
    study.successFields.includes('localUiUrl (study status only — the /ui/kb page; omitted when no daemon base URL is resolvable)'),
    'study help should document the localUiUrl on study status',
  );
});
