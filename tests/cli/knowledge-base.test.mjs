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
