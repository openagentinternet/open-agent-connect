import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  DEFAULT_METAID_SEARCH_BASE_URL,
  MetaIdSearchApiError,
  MetaIdSearchNotFoundError,
  getMetaIdDetail,
  searchMetaIds,
  trimMetaIdSearchItems,
} = require('../dist/core/metaid/metaIdSearchApi.js');

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function captureFetch(body) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(body);
  };
  return { calls, fetchFn };
}

function sampleItem() {
  return {
    globalMetaId: 'gmid-alice',
    metaId: 'mid-alice',
    address: 'address-alice',
    chainName: 'mvc',
    name: 'Alice',
    avatarId: 'avatar-pin-i0',
    bio: '链上生活记录者',
    chatSkills: ['translate', 'draw'],
    hasChatPubkey: true,
    hasHomepage: true,
    createdAt: 1768284841,
    updatedAt: 1768284842,
  };
}

test('searchMetaIds builds the list URL with all supported params', async () => {
  const { calls, fetchFn } = captureFetch({ code: 0, data: { items: [], nextCursor: 'next-1', hasMore: true } });
  const page = await searchMetaIds({
    keyword: 'cheerful music',
    skill: 'translate',
    chainName: 'mvc',
    hasChatPubkey: true,
    hasHomepage: true,
    since: 1768284841.9,
    until: 1768289999.2,
    size: 250,
    cursor: 'cursor-1',
  }, { baseUrl: 'https://so.example.com/', fetchFn });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://so.example.com/api/metaid/list');
  assert.equal(url.searchParams.get('keyword'), 'cheerful music');
  assert.equal(url.searchParams.get('skill'), 'translate');
  assert.equal(url.searchParams.get('chainName'), 'mvc');
  assert.equal(url.searchParams.get('hasChatPubkey'), '1');
  assert.equal(url.searchParams.get('hasHomepage'), '1');
  assert.equal(url.searchParams.get('since'), '1768284841');
  assert.equal(url.searchParams.get('until'), '1768289999');
  assert.equal(url.searchParams.get('size'), '100');
  assert.equal(url.searchParams.get('cursor'), 'cursor-1');
  assert.equal(page.nextCursor, 'next-1');
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.items, []);
});

test('searchMetaIds with empty params requests the bare list endpoint', async () => {
  const { calls, fetchFn } = captureFetch({ code: 0, data: { items: [] } });
  const page = await searchMetaIds({}, { baseUrl: 'https://so.example.com', fetchFn });

  assert.equal(calls[0].url, 'https://so.example.com/api/metaid/list');
  assert.equal(page.nextCursor, null);
  assert.equal(page.hasMore, false);
});

test('searchMetaIds normalizes items including lenient flag and skill shapes', async () => {
  const { fetchFn } = captureFetch({
    code: 0,
    data: {
      items: [
        sampleItem(),
        { globalMetaId: 'gmid-bob', chatSkills: ['a', 1, ''], hasChatPubkey: 1, hasHomepage: 'true', updatedAt: '1768284800' },
      ],
    },
  });
  const page = await searchMetaIds({}, { baseUrl: 'https://so.example.com', fetchFn });

  assert.equal(page.items.length, 2);
  const first = page.items[0];
  assert.equal(first.globalMetaId, 'gmid-alice');
  assert.equal(first.name, 'Alice');
  assert.deepEqual(first.chatSkills, ['translate', 'draw']);
  assert.equal(first.hasChatPubkey, true);
  assert.equal(first.hasHomepage, true);
  assert.equal(first.updatedAt, 1768284842);

  const second = page.items[1];
  assert.equal(second.name, '');
  assert.deepEqual(second.chatSkills, ['a', '1']);
  assert.equal(second.hasChatPubkey, true);
  assert.equal(second.hasHomepage, true);
  assert.equal(second.updatedAt, 1768284800);
});

test('searchMetaIds maps envelope error codes to typed errors', async () => {
  const usage = captureFetch({ code: 40000, message: 'bad cursor' });
  await assert.rejects(
    () => searchMetaIds({ cursor: 'bogus' }, { baseUrl: 'https://so.example.com', fetchFn: usage.fetchFn }),
    (error) => {
      assert.ok(error instanceof MetaIdSearchApiError);
      assert.equal(error.apiCode, 40000);
      assert.match(error.message, /40000: bad cursor/);
      return true;
    },
  );

  const internal = captureFetch({ code: 50000, message: 'boom' });
  await assert.rejects(
    () => searchMetaIds({}, { baseUrl: 'https://so.example.com', fetchFn: internal.fetchFn }),
    (error) => {
      assert.ok(error instanceof MetaIdSearchApiError);
      assert.equal(error.apiCode, 50000);
      return true;
    },
  );

  const notFound = captureFetch({ code: 40400, message: 'identity not found' });
  await assert.rejects(
    () => searchMetaIds({}, { baseUrl: 'https://so.example.com', fetchFn: notFound.fetchFn }),
    (error) => {
      assert.ok(error instanceof MetaIdSearchNotFoundError);
      assert.ok(error instanceof MetaIdSearchApiError);
      assert.equal(error.apiCode, 40400);
      return true;
    },
  );
});

test('searchMetaIds rejects non-object response bodies', async () => {
  const fetchFn = async () => ({
    ok: true,
    status: 502,
    json: async () => {
      throw new Error('not json');
    },
  });
  await assert.rejects(
    () => searchMetaIds({}, { baseUrl: 'https://so.example.com', fetchFn }),
    /invalid response \(HTTP 502\)/,
  );
});

test('searchMetaIds defaults to the production base URL and honors the env override', async () => {
  const previous = process.env.METASO_P2P_BASE_URL;
  try {
    delete process.env.METASO_P2P_BASE_URL;
    const fallback = captureFetch({ code: 0, data: { items: [] } });
    await searchMetaIds({}, { fetchFn: fallback.fetchFn });
    assert.equal(fallback.calls[0].url, `${DEFAULT_METAID_SEARCH_BASE_URL}/api/metaid/list`);

    process.env.METASO_P2P_BASE_URL = 'https://so-env.example.com/';
    const fromEnv = captureFetch({ code: 0, data: { items: [] } });
    await searchMetaIds({}, { fetchFn: fromEnv.fetchFn });
    assert.equal(fromEnv.calls[0].url, 'https://so-env.example.com/api/metaid/list');

    const explicit = captureFetch({ code: 0, data: { items: [] } });
    await searchMetaIds({}, { baseUrl: 'https://so-explicit.example.com', fetchFn: explicit.fetchFn });
    assert.equal(explicit.calls[0].url, 'https://so-explicit.example.com/api/metaid/list');
  } finally {
    if (previous === undefined) {
      delete process.env.METASO_P2P_BASE_URL;
    } else {
      process.env.METASO_P2P_BASE_URL = previous;
    }
  }
});

test('searchMetaIds passes an abort signal with the configured timeout', async () => {
  const { calls, fetchFn } = captureFetch({ code: 0, data: { items: [] } });
  await searchMetaIds({}, { baseUrl: 'https://so.example.com', fetchFn, timeoutMs: 1234 });

  assert.equal(calls.length, 1);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[0].init.signal.aborted, false);
  assert.equal(calls[0].init.headers.accept, 'application/json');
});

test('getMetaIdDetail URL-encodes the identity and normalizes the detail record', async () => {
  const detailBody = {
    ...sampleItem(),
    avatarContentType: 'image/png',
    role: 'companion',
    soul: 'warm',
    goal: 'help humans',
    persona: { mood: 'sunny', traits: ['cheerful'] },
    llm: { provider: 'openai', model: 'gpt-x', name: 'helper' },
    homepage: { uri: 'metaapp://homepage-pin-i0', renderer: 'auto' },
    background: '/content/bg-pin-i0',
    chatPubkey: 'pubkey-1',
    fieldPins: { name: 'name-pin-i0', avatar: 'avatar-pin-i0', empty: '' },
  };
  const { calls, fetchFn } = captureFetch({ code: 0, data: detailBody });
  const detail = await getMetaIdDetail(' gmid alice/ ', { baseUrl: 'https://so.example.com', fetchFn });

  assert.equal(calls[0].url, `https://so.example.com/api/metaid/detail/${encodeURIComponent('gmid alice/')}`);
  assert.equal(detail.globalMetaId, 'gmid-alice');
  assert.equal(detail.role, 'companion');
  assert.deepEqual(detail.persona, { mood: 'sunny', traits: ['cheerful'] });
  assert.deepEqual(detail.llm, { provider: 'openai', model: 'gpt-x', name: 'helper' });
  assert.deepEqual(detail.homepage, { uri: 'metaapp://homepage-pin-i0', renderer: 'auto' });
  assert.equal(detail.background, '/content/bg-pin-i0');
  assert.equal(detail.chatPubkey, 'pubkey-1');
  assert.deepEqual(detail.fieldPins, { name: 'name-pin-i0', avatar: 'avatar-pin-i0' });
});

test('getMetaIdDetail requires an identity', async () => {
  const { calls, fetchFn } = captureFetch({ code: 0, data: {} });
  await assert.rejects(
    () => getMetaIdDetail('   ', { baseUrl: 'https://so.example.com', fetchFn }),
    /identity is required/,
  );
  assert.equal(calls.length, 0);
});

test('getMetaIdDetail maps 40400 to MetaIdSearchNotFoundError', async () => {
  const { fetchFn } = captureFetch({ code: 40400, message: 'identity not found' });
  await assert.rejects(
    () => getMetaIdDetail('gmid-missing', { baseUrl: 'https://so.example.com', fetchFn }),
    (error) => {
      assert.ok(error instanceof MetaIdSearchNotFoundError);
      assert.match(error.message, /identity not found/);
      return true;
    },
  );
});

test('trimMetaIdSearchItems projects the CLI fields and marks own identities case-insensitively', async () => {
  const ownIds = new Set(['GMID-Alice']);
  const { fetchFn } = captureFetch({
    code: 0,
    data: {
      items: [
        sampleItem(),
        { ...sampleItem(), globalMetaId: 'gmid-bob', name: 'Bob' },
        { ...sampleItem(), globalMetaId: '' },
      ],
    },
  });
  const page = await searchMetaIds({}, { baseUrl: 'https://so.example.com', fetchFn });
  const trimmed = trimMetaIdSearchItems(page.items, ownIds);

  assert.equal(trimmed.length, 3);
  assert.deepEqual(Object.keys(trimmed[0]), [
    'globalMetaId',
    'metaId',
    'address',
    'chainName',
    'name',
    'avatarId',
    'bio',
    'chatSkills',
    'hasChatPubkey',
    'hasHomepage',
    'updatedAt',
    'isOwn',
  ]);
  assert.equal(trimmed[0].isOwn, true);
  assert.equal(trimmed[1].isOwn, false);
  assert.equal(trimmed[2].isOwn, false);
  assert.equal(trimmed[0].name, 'Alice');
  assert.deepEqual(trimmed[0].chatSkills, ['translate', 'draw']);
});
