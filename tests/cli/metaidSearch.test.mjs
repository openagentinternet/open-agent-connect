import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');

async function runMetaIdCli(args, context = {}) {
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

test('runCli dispatches `metabot metaid search` with parsed filters and default limit', async () => {
  const calls = [];
  const { exitCode, envelope } = await runMetaIdCli([
    'metaid',
    'search',
    '--query', 'cheerful music',
    '--skill', 'translate',
    '--chain', 'MVC',
    '--chat-pubkey',
    '--homepage',
    '--cursor', 'cursor-1',
  ], {
    dependencies: {
      metaid: {
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
    query: 'cheerful music',
    skill: 'translate',
    chain: 'mvc',
    chatPubkey: true,
    homepage: true,
    limit: 8,
    cursor: 'cursor-1',
  }]);
});

test('runCli converts `metabot metaid search` day flags to unix-second bounds', async () => {
  const calls = [];
  const beforeSeconds = Math.floor(Date.now() / 1000);
  const { exitCode } = await runMetaIdCli([
    'metaid',
    'search',
    '--since-days', '7',
    '--until-days', '1',
    '--limit', '20',
  ], {
    dependencies: {
      metaid: {
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

test('runCli omits filters and time bounds when `metabot metaid search` flags are absent', async () => {
  const calls = [];
  const { exitCode } = await runMetaIdCli(['metaid', 'search'], {
    dependencies: {
      metaid: {
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

test('runCli rejects invalid `metabot metaid search` limit and day flags before handler lookup', async () => {
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
    const { exitCode, envelope } = await runMetaIdCli(['metaid', 'search', ...extra], {
      dependencies: {
        metaid: {
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

test('runCli dispatches `metabot metaid detail` with the given identity', async () => {
  const calls = [];
  const { exitCode, envelope } = await runMetaIdCli([
    'metaid',
    'detail',
    '--identity', 'gmid-alice',
  ], {
    dependencies: {
      metaid: {
        detail: async (input) => {
          calls.push(input);
          return commandSuccess({ globalMetaId: 'gmid-alice', name: 'Alice' });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, { globalMetaId: 'gmid-alice', name: 'Alice' });
  assert.deepEqual(calls, [{ identity: 'gmid-alice' }]);
});

test('runCli requires `metabot metaid detail --identity`', async () => {
  let detailCalled = false;
  const { exitCode, envelope } = await runMetaIdCli(['metaid', 'detail'], {
    dependencies: {
      metaid: {
        detail: async () => {
          detailCalled = true;
          return commandSuccess({ shouldNotRun: true });
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(envelope.code, 'missing_flag');
  assert.equal(detailCalled, false);
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
    globalMetaId: 'gmid-own-123',
    metaId: 'mid-own',
    address: 'address-own',
    chainName: 'mvc',
    name: 'Alice',
    avatarId: 'avatar-pin-i0',
    bio: '链上生活记录者',
    chatSkills: ['translate', 'draw'],
    hasChatPubkey: true,
    hasHomepage: true,
    createdAt: 1768284841,
    updatedAt: 1768284842,
    ...overrides,
  };
}

test('runCli default `metabot metaid search` handler trims items and marks own identities', async () => {
  const systemHome = await mkdtempTempRoot('oac-cli-metaid-search-');
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
          stubbedSearchItem({ globalMetaId: 'gmid-other', name: 'Bob' }),
        ],
        nextCursor: 'cursor-next',
        hasMore: true,
      },
    },
  }), async ({ baseUrl, requests }) => {
    const { exitCode, envelope } = await runMetaIdCli([
      'metaid',
      'search',
      '--query', 'music',
      '--skill', 'translate',
      '--chat-pubkey',
    ], {
      env: { HOME: systemHome, METASO_P2P_BASE_URL: baseUrl },
    });

    assert.equal(exitCode, 0);
    assert.equal(requests.length, 1);
    assert.ok(requests[0].startsWith('/api/metaid/list?'));
    assert.ok(requests[0].includes('keyword=music'));
    assert.ok(requests[0].includes('skill=translate'));
    assert.ok(requests[0].includes('hasChatPubkey=1'));
    assert.ok(requests[0].includes('size=8'));

    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.hasMore, true);
    assert.equal(envelope.data.nextCursor, 'cursor-next');
    assert.equal(envelope.data.items.length, 2);

    const own = envelope.data.items[0];
    assert.deepEqual(Object.keys(own).sort(), [
      'address',
      'avatarId',
      'bio',
      'chainName',
      'chatSkills',
      'globalMetaId',
      'hasChatPubkey',
      'hasHomepage',
      'isOwn',
      'metaId',
      'name',
      'updatedAt',
    ]);
    assert.equal(own.isOwn, true);
    assert.equal(own.name, 'Alice');
    assert.equal(envelope.data.items[1].isOwn, false);
  });
});

test('runCli default `metabot metaid search` handler attaches clickable links when a daemon base URL is configured', async () => {
  const systemHome = await mkdtempTempRoot('oac-cli-metaid-search-links-');
  const daemonBaseUrl = 'http://127.0.0.1:10001';

  await withStubAggregationServer(() => ({
    status: 200,
    body: {
      code: 0,
      data: {
        items: [
          stubbedSearchItem(),
          stubbedSearchItem({ globalMetaId: 'gmid-other', name: 'Bob', avatarId: '' }),
        ],
        nextCursor: null,
        hasMore: false,
      },
    },
  }), async ({ baseUrl }) => {
    const { exitCode, envelope } = await runMetaIdCli([
      'metaid',
      'search',
      '--query', 'music',
    ], {
      env: { HOME: systemHome, METASO_P2P_BASE_URL: baseUrl, METABOT_DAEMON_BASE_URL: daemonBaseUrl },
    });

    assert.equal(exitCode, 0);
    const linked = envelope.data.items[0];
    assert.equal(linked.localUiUrl, `${daemonBaseUrl}/browser/metaid/gmid-own-123`);
    assert.equal(linked.avatarLocalUiUrl, `${daemonBaseUrl}/browser/metafile/avatar-pin-i0`);

    // No avatar id means no avatar link; the Bot page link is always present.
    const noAvatar = envelope.data.items[1];
    assert.equal(noAvatar.localUiUrl, `${daemonBaseUrl}/browser/metaid/gmid-other`);
    assert.equal('avatarLocalUiUrl' in noAvatar, false);
  });
});

test('runCli default `metabot metaid detail` handler returns the profile, decorates links, and maps not-found', async () => {
  const systemHome = await mkdtempTempRoot('oac-cli-metaid-detail-');
  const daemonBaseUrl = 'http://127.0.0.1:10001';
  const homepagePinId = `${'c3d4e5f6'.repeat(8)}i0`;

  await withStubAggregationServer((url) => (
    url.includes('/detail/') && !url.includes('gmid-missing')
      ? {
        status: 200,
        body: {
          code: 0,
          data: {
            ...stubbedSearchItem(),
            avatarContentType: 'image/png',
            role: 'companion',
            soul: 'warm',
            goal: 'help humans',
            persona: { mood: 'sunny' },
            llm: { provider: 'openai', model: 'gpt-x', name: 'helper' },
            homepage: { uri: `metaapp://${homepagePinId}`, renderer: 'auto' },
            background: '/content/bg-pin-i0',
            chatPubkey: 'pubkey-1',
            fieldPins: { name: 'name-pin-i0', avatar: 'avatar-pin-i0' },
          },
        },
      }
      : { status: 200, body: { code: 40400, message: 'identity not found' } }
  ), async ({ baseUrl, requests }) => {
    const env = { HOME: systemHome, METASO_P2P_BASE_URL: baseUrl, METABOT_DAEMON_BASE_URL: daemonBaseUrl };

    const found = await runMetaIdCli(['metaid', 'detail', '--identity', 'gmid-own-123'], { env });
    assert.equal(found.exitCode, 0);
    assert.ok(requests[0].startsWith('/api/metaid/detail/gmid-own-123'));
    assert.equal(found.envelope.data.globalMetaId, 'gmid-own-123');
    assert.deepEqual(found.envelope.data.persona, { mood: 'sunny' });
    assert.deepEqual(found.envelope.data.llm, { provider: 'openai', model: 'gpt-x', name: 'helper' });
    assert.equal(found.envelope.data.chatPubkey, 'pubkey-1');
    assert.equal(found.envelope.data.localUiUrl, `${daemonBaseUrl}/browser/metaid/gmid-own-123`);
    assert.equal(found.envelope.data.avatarLocalUiUrl, `${daemonBaseUrl}/browser/metafile/avatar-pin-i0`);
    assert.equal(found.envelope.data.homepageLocalUiUrl, `${daemonBaseUrl}/browser/metaapp/${homepagePinId}`);

    const missing = await runMetaIdCli(['metaid', 'detail', '--identity', 'gmid-missing'], { env });
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.envelope.code, 'metaid_not_found');
  });
});

test('runCli default `metabot metaid search` handler maps usage and internal API errors', async () => {
  const systemHome = await mkdtempTempRoot('oac-cli-metaid-search-errors-');

  await withStubAggregationServer((url) => {
    if (url.includes('cursor=bogus')) {
      return { status: 200, body: { code: 40000, message: 'invalid cursor' } };
    }
    return { status: 200, body: { code: 50000, message: 'boom' } };
  }, async ({ baseUrl }) => {
    const env = { HOME: systemHome, METASO_P2P_BASE_URL: baseUrl };

    const usage = await runMetaIdCli(['metaid', 'search', '--cursor', 'bogus'], { env });
    assert.equal(usage.exitCode, 1);
    assert.equal(usage.envelope.code, 'invalid_argument');

    const internal = await runMetaIdCli(['metaid', 'search'], { env });
    assert.equal(internal.exitCode, 1);
    assert.equal(internal.envelope.code, 'metaid_search_failed');
  });
});
