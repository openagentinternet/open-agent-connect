import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

async function runMetaweb(argv, metawebDeps) {
  const stdout = [];
  const exitCode = await runCli(['metaweb', ...argv], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: { metaweb: metawebDeps },
  });
  const raw = stdout.join('').trim();
  return { exitCode, result: raw ? JSON.parse(raw) : null };
}

test('metaweb search parses filters and dispatches', async () => {
  const calls = [];
  const { exitCode, result } = await runMetaweb(
    ['search', '--query', '钓鱼', '--protocols', 'simplenote,metaapp', '--size', '3', '--newest', '--cursor', 'c1'],
    {
      search: async (input) => {
        calls.push(input);
        return commandSuccess({ items: [], hasMore: false, nextCursor: null, formatted: 'x' });
      },
    },
  );
  assert.equal(exitCode, 0);
  assert.equal(calls[0].query, '钓鱼');
  assert.equal(calls[0].protocols, 'simplenote,metaapp');
  assert.equal(calls[0].size, 3);
  assert.equal(calls[0].sort, 'newest');
  assert.equal(calls[0].cursor, 'c1');

  const missing = await runMetaweb(['search'], {
    search: async () => commandSuccess({}),
  });
  assert.equal(missing.result.code, 'missing_flag');
});

test('metaweb read requires --pin and dispatches', async () => {
  const calls = [];
  const { exitCode } = await runMetaweb(['read', '--pin', 'abcpin'], {
    read: async (input) => {
      calls.push(input);
      return commandSuccess({ pin: { pinId: 'abcpin' }, formatted: 'sheet' });
    },
  });
  assert.equal(exitCode, 0);
  assert.equal(calls[0].pinId, 'abcpin');

  const missing = await runMetaweb(['read'], { read: async () => commandSuccess({}) });
  assert.equal(missing.result.code, 'missing_flag');
  const bogus = await runMetaweb(['bogus'], {});
  assert.equal(bogus.result.code, 'unknown_subcommand');
});

test('runtime search handler formats bullets and guidance (fake node)', async () => {
  // Exercise the production runtime handler shape against a fake fetch by
  // calling the exported search core through the same formatting path used
  // by the CLI wiring.
  const { searchMetaweb } = require('../../dist/core/metaweb/search.js');
  const { formatMetawebSearchBullets } = require('../../dist/core/metaweb/format.js');
  const page = await searchMetaweb({ q: 'fishing' }, {
    baseUrl: 'https://so.test',
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          items: [{
            protocol: 'simplenote',
            pinId: 'f'.repeat(64) + 'i0',
            title: 'Fishing\nwith injected newline',
            summary: '  guide  ',
            tags: ['fish'],
            publisher: { globalMetaId: 'IDQ1', metaid: 'm', name: 'Fisher', avatar: '' },
            createdAt: 1787000000,
            score: 5,
          }],
        },
      }),
    }),
  });
  const bullets = formatMetawebSearchBullets(page.items);
  assert.match(bullets, /- \*\*\[Fishing with injected newline\]\(pin:\/\//);
  assert.match(bullets, /protocol: simplenote \| by Fisher/);
  assert.match(bullets, /pin: f{64}i0/);
});
