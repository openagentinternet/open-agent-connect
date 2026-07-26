import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');

const VALID_PIN_ID = `${'a1b2c3d4'.repeat(8)}i0`;

async function runMetaAppCli(args, context = {}) {
  const stdout = [];
  const exitCode = await runCli(args, {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    ...context,
  });
  return {
    exitCode,
    envelope: stdout.length ? JSON.parse(stdout.join('').trim()) : null,
  };
}

test('runCli dispatches `metabot metaapp search` with parsed filters and default limit', async () => {
  const calls = [];
  const { exitCode, envelope } = await runMetaAppCli([
    'metaapp',
    'search',
    '--query', 'mini game',
    '--tag', 'simplebuzz',
    '--publisher', 'gmid-publisher',
    '--runtime', 'browser',
    '--chain', 'MVC',
    '--cursor', 'cursor-1',
  ], {
    dependencies: {
      metaapp: {
        search: async (input) => {
          calls.push(input);
          return commandSuccess({ items: [], hasMore: false, nextCursor: null });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.state, 'success');
  assert.deepEqual(envelope.data, { items: [], hasMore: false, nextCursor: null });
  assert.deepEqual(calls, [{
    query: 'mini game',
    tag: 'simplebuzz',
    publisher: 'gmid-publisher',
    runtime: 'browser',
    chain: 'mvc',
    limit: 8,
    cursor: 'cursor-1',
  }]);
});

test('runCli converts `metabot metaapp search` day flags to unix-second bounds', async () => {
  const calls = [];
  const beforeSeconds = Math.floor(Date.now() / 1000);
  const { exitCode } = await runMetaAppCli([
    'metaapp',
    'search',
    '--since-days', '7',
    '--until-days', '1',
    '--limit', '20',
  ], {
    dependencies: {
      metaapp: {
        search: async (input) => {
          calls.push(input);
          return commandSuccess({ items: [], hasMore: false, nextCursor: null });
        },
      },
    },
  });
  const afterSeconds = Math.floor(Date.now() / 1000);

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].limit, 20);
  assert.ok(calls[0].since >= beforeSeconds - 7 * 86_400);
  assert.ok(calls[0].since <= afterSeconds - 7 * 86_400);
  assert.ok(calls[0].until >= beforeSeconds - 1 * 86_400);
  assert.ok(calls[0].until <= afterSeconds - 1 * 86_400);
});

test('runCli omits time bounds when `metabot metaapp search` day flags are absent', async () => {
  const calls = [];
  const { exitCode } = await runMetaAppCli(['metaapp', 'search'], {
    dependencies: {
      metaapp: {
        search: async (input) => {
          calls.push(input);
          return commandSuccess({ items: [], hasMore: false, nextCursor: null });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ limit: 8 }]);
});

test('runCli rejects invalid `metabot metaapp search` limit and day flags before handler lookup', async () => {
  const invalidArgSets = [
    ['--limit', '0'],
    ['--limit', '21'],
    ['--limit', 'abc'],
    ['--since-days', '0'],
    ['--since-days', 'seven'],
    ['--until-days', '-1'],
  ];
  for (const extra of invalidArgSets) {
    let searchCalled = false;
    const { exitCode, envelope } = await runMetaAppCli(['metaapp', 'search', ...extra], {
      dependencies: {
        metaapp: {
          search: async () => {
            searchCalled = true;
            return commandSuccess({ shouldNotRun: true });
          },
        },
      },
    });

    assert.equal(exitCode, 1, `expected failure for ${extra.join(' ')}`);
    assert.equal(envelope.code, 'invalid_flag', `expected invalid_flag for ${extra.join(' ')}`);
    assert.equal(searchCalled, false, `handler must not run for ${extra.join(' ')}`);
  }
});

test('runCli dispatches `metabot metaapp forks` with a normalized bare pinId', async () => {
  const calls = [];
  for (const pinIdInput of [VALID_PIN_ID, `metaapp://${VALID_PIN_ID}`]) {
    calls.length = 0;
    const { exitCode, envelope } = await runMetaAppCli([
      'metaapp',
      'forks',
      '--pin-id', pinIdInput,
      '--limit', '5',
      '--cursor', 'cursor-2',
    ], {
      dependencies: {
        metaapp: {
          forks: async (input) => {
            calls.push(input);
            return commandSuccess({ items: [], hasMore: true, nextCursor: 'next-1' });
          },
        },
      },
    });

    assert.equal(exitCode, 0, `expected success for ${pinIdInput}`);
    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.data, { items: [], hasMore: true, nextCursor: 'next-1' });
    assert.deepEqual(calls, [{ pinId: VALID_PIN_ID, limit: 5, cursor: 'cursor-2' }]);
  }
});

test('runCli requires a valid `metabot metaapp forks --pin-id`', async () => {
  const missing = await runMetaAppCli(['metaapp', 'forks'], {
    dependencies: {
      metaapp: { forks: async () => commandSuccess({ shouldNotRun: true }) },
    },
  });
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.envelope.code, 'missing_flag');

  for (const bad of ['not-a-pin', 'metaapp://', `${VALID_PIN_ID}/extra`]) {
    let forksCalled = false;
    const { exitCode, envelope } = await runMetaAppCli(['metaapp', 'forks', '--pin-id', bad], {
      dependencies: {
        metaapp: {
          forks: async () => {
            forksCalled = true;
            return commandSuccess({ shouldNotRun: true });
          },
        },
      },
    });
    assert.equal(exitCode, 1, `expected failure for ${bad}`);
    assert.equal(envelope.code, 'invalid_flag', `expected invalid_flag for ${bad}`);
    assert.equal(forksCalled, false, `handler must not run for ${bad}`);
  }
});

// --- Default runtime handler tests (no dependency stubs; HTTP stubbed locally) ---

async function withStubAggregationServer(respond, run) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const { status, body } = respond(req.url);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function stubbedSearchItem(overrides = {}) {
  return {
    pinId: VALID_PIN_ID,
    sourcePinId: VALID_PIN_ID,
    chainName: 'mvc',
    title: 'Pomodoro',
    appName: 'pomodoro',
    intro: 'Minimal pomodoro timer',
    tags: ['tool'],
    runtime: 'browser',
    version: '1.0.0',
    content: 'metafile://content.zip',
    indexFile: 'index.html',
    forkedFrom: '',
    disabled: false,
    publisherGlobalMetaId: 'gmid-own-123',
    publisherMetaId: 'mid-own',
    publisherAddress: 'address-own',
    publisherName: 'Alice',
    publisherAvatarId: 'avatar-pin-i0',
    createdAt: 1768284841,
    updatedAt: 1768284842,
    ...overrides,
  };
}

test('runCli default `metabot metaapp search` handler trims items and marks own publishers', async () => {
  const systemHome = await mkdtempTempRoot('oac-cli-metaapp-search-');
  await upsertIdentityProfile({
    systemHomeDir: systemHome,
    name: 'alice',
    homeDir: `${systemHome}/.metabot/profiles/alice`,
    globalMetaId: 'gmid-own-123',
  });

  await withStubAggregationServer(() => ({
    status: 200,
    body: {
      code: 0,
      data: {
        items: [
          stubbedSearchItem(),
          stubbedSearchItem({ pinId: `${'b2c3d4e5'.repeat(8)}i0`, publisherGlobalMetaId: 'gmid-other', publisherName: 'Bob' }),
        ],
        nextCursor: 'cursor-next',
        hasMore: true,
      },
    },
  }), async ({ baseUrl, requests }) => {
    const { exitCode, envelope } = await runMetaAppCli([
      'metaapp',
      'search',
      '--query', 'pomodoro',
    ], {
      env: { HOME: systemHome, METASO_P2P_BASE_URL: baseUrl },
    });

    assert.equal(exitCode, 0);
    assert.equal(requests.length, 1);
    assert.ok(requests[0].startsWith('/api/metaapp/list?'));
    assert.ok(requests[0].includes('keyword=pomodoro'));
    assert.ok(requests[0].includes('size=8'));

    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.hasMore, true);
    assert.equal(envelope.data.nextCursor, 'cursor-next');
    assert.equal(envelope.data.items.length, 2);

    const own = envelope.data.items[0];
    assert.deepEqual(Object.keys(own).sort(), [
      'appName',
      'forkedFrom',
      'intro',
      'isOwn',
      'pinId',
      'publisherAvatarId',
      'publisherGlobalMetaId',
      'publisherName',
      'runtime',
      'tags',
      'title',
      'updatedAt',
      'version',
    ]);
    assert.equal(own.isOwn, true);
    assert.equal(own.publisherName, 'Alice');
    assert.equal(envelope.data.items[1].isOwn, false);
  });
});

test('runCli default `metabot metaapp forks` handler queries forks and maps not-found', async () => {
  const systemHome = await mkdtempTempRoot('oac-cli-metaapp-forks-');

  await withStubAggregationServer((url) => (
    url.includes('/forks/') && !url.includes('00000000')
      ? { status: 200, body: { code: 0, data: { items: [stubbedSearchItem()], nextCursor: null, hasMore: false } } }
      : { status: 200, body: { code: 40400, message: 'app not found' } }
  ), async ({ baseUrl, requests }) => {
    const env = { HOME: systemHome, METASO_P2P_BASE_URL: baseUrl };

    const found = await runMetaAppCli(['metaapp', 'forks', '--pin-id', VALID_PIN_ID], { env });
    assert.equal(found.exitCode, 0);
    assert.ok(requests[0].startsWith(`/api/metaapp/forks/${VALID_PIN_ID}`));
    assert.equal(found.envelope.data.items.length, 1);
    assert.equal(found.envelope.data.items[0].isOwn, false);

    requests.length = 0;
    const missingPinId = `${'00000000'.repeat(8)}i0`;
    const missing = await runMetaAppCli(['metaapp', 'forks', '--pin-id', missingPinId], { env });
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.envelope.code, 'metaapp_not_found');
  });
});

test('runCli default `metabot metaapp search` handler maps usage and internal API errors', async () => {
  const systemHome = await mkdtempTempRoot('oac-cli-metaapp-search-errors-');

  await withStubAggregationServer((url) => {
    if (url.includes('cursor=bogus')) {
      return { status: 200, body: { code: 40000, message: 'invalid cursor' } };
    }
    return { status: 200, body: { code: 50000, message: 'boom' } };
  }, async ({ baseUrl }) => {
    const env = { HOME: systemHome, METASO_P2P_BASE_URL: baseUrl };

    const usage = await runMetaAppCli(['metaapp', 'search', '--cursor', 'bogus'], { env });
    assert.equal(usage.exitCode, 1);
    assert.equal(usage.envelope.code, 'invalid_argument');

    const internal = await runMetaAppCli(['metaapp', 'search'], { env });
    assert.equal(internal.exitCode, 1);
    assert.equal(internal.envelope.code, 'metaapp_search_failed');
  });
});
