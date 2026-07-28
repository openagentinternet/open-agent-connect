import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  DEFAULT_METAAPP_SEARCH_BASE_URL,
  MetaAppSearchApiError,
  MetaAppSearchNotFoundError,
  listMetaAppForks,
  searchMetaApps,
  trimMetaAppSearchItems,
} = require('../dist/core/metaapp/metaAppSearchApi.js');

const PIN_ID = 'A1b2C3d4'.repeat(8) + 'i0';

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
    pinId: 'pin-1',
    sourcePinId: 'pin-1',
    chainName: 'mvc',
    title: 'Pomodoro',
    appName: 'pomodoro',
    intro: 'Minimal pomodoro timer',
    tags: ['tool', 'timer'],
    runtime: 'browser',
    version: '1.0.0',
    content: 'metafile://content-pin.zip',
    indexFile: 'app.html',
    forkedFrom: 'parent-pin',
    disabled: false,
    publisherGlobalMetaId: 'gmid-publisher',
    publisherMetaId: 'mid-publisher',
    publisherAddress: 'address-publisher',
    publisherName: 'Alice',
    publisherAvatarId: 'avatar-pin-i0',
    createdAt: 1768284841,
    updatedAt: 1768284842,
  };
}

test('searchMetaApps builds the list URL with all supported params', async () => {
  const { calls, fetchFn } = captureFetch({ code: 0, data: { items: [], nextCursor: 'next-1', hasMore: true } });
  const page = await searchMetaApps({
    keyword: 'mini game',
    tag: 'simplebuzz',
    chainName: 'mvc',
    runtime: 'browser',
    publisher: 'alice',
    since: 1768284841.9,
    until: 1768289999.2,
    includeDisabled: true,
    size: 250,
    cursor: 'cursor-1',
  }, { baseUrl: 'https://so.example.com/', fetchFn });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://so.example.com/api/metaapp/list');
  assert.equal(url.searchParams.get('keyword'), 'mini game');
  assert.equal(url.searchParams.get('tag'), 'simplebuzz');
  assert.equal(url.searchParams.get('chainName'), 'mvc');
  assert.equal(url.searchParams.get('runtime'), 'browser');
  assert.equal(url.searchParams.get('publisher'), 'alice');
  assert.equal(url.searchParams.get('since'), '1768284841');
  assert.equal(url.searchParams.get('until'), '1768289999');
  assert.equal(url.searchParams.get('includeDisabled'), '1');
  assert.equal(url.searchParams.get('size'), '100');
  assert.equal(url.searchParams.get('cursor'), 'cursor-1');
  assert.equal(page.nextCursor, 'next-1');
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.items, []);
});

test('searchMetaApps with empty params requests the bare list endpoint', async () => {
  const { calls, fetchFn } = captureFetch({ code: 0, data: { items: [] } });
  const page = await searchMetaApps({}, { baseUrl: 'https://so.example.com', fetchFn });

  assert.equal(calls[0].url, 'https://so.example.com/api/metaapp/list');
  assert.equal(page.nextCursor, null);
  assert.equal(page.hasMore, false);
});

test('searchMetaApps normalizes items including production-only publisher fields', async () => {
  const { fetchFn } = captureFetch({
    code: 0,
    data: {
      items: [
        sampleItem(),
        { pinId: 'pin-2', disabled: 'true', tags: ['a', 1, ''], updatedAt: '1768284800' },
      ],
    },
  });
  const page = await searchMetaApps({}, { baseUrl: 'https://so.example.com', fetchFn });

  assert.equal(page.items.length, 2);
  const first = page.items[0];
  assert.equal(first.pinId, 'pin-1');
  assert.equal(first.title, 'Pomodoro');
  assert.equal(first.publisherName, 'Alice');
  assert.equal(first.publisherAvatarId, 'avatar-pin-i0');
  assert.equal(first.forkedFrom, 'parent-pin');
  assert.equal(first.updatedAt, 1768284842);

  const second = page.items[1];
  assert.equal(second.disabled, true);
  assert.deepEqual(second.tags, ['a', '1']);
  assert.equal(second.indexFile, 'index.html');
  assert.equal(second.publisherName, '');
  assert.equal(second.publisherAvatarId, '');
  assert.equal(second.updatedAt, 1768284800);
});

test('searchMetaApps maps envelope error codes to typed errors', async () => {
  const usage = captureFetch({ code: 40000, message: 'bad cursor' });
  await assert.rejects(
    () => searchMetaApps({ cursor: 'bogus' }, { baseUrl: 'https://so.example.com', fetchFn: usage.fetchFn }),
    (error) => {
      assert.ok(error instanceof MetaAppSearchApiError);
      assert.equal(error.apiCode, 40000);
      assert.match(error.message, /40000: bad cursor/);
      return true;
    },
  );

  const internal = captureFetch({ code: 50000, message: 'boom' });
  await assert.rejects(
    () => searchMetaApps({}, { baseUrl: 'https://so.example.com', fetchFn: internal.fetchFn }),
    (error) => {
      assert.ok(error instanceof MetaAppSearchApiError);
      assert.equal(error.apiCode, 50000);
      return true;
    },
  );

  const notFound = captureFetch({ code: 40400, message: 'app not found' });
  await assert.rejects(
    () => searchMetaApps({}, { baseUrl: 'https://so.example.com', fetchFn: notFound.fetchFn }),
    (error) => {
      assert.ok(error instanceof MetaAppSearchNotFoundError);
      assert.ok(error instanceof MetaAppSearchApiError);
      assert.equal(error.apiCode, 40400);
      return true;
    },
  );
});

test('searchMetaApps rejects non-object response bodies', async () => {
  const fetchFn = async () => ({
    ok: true,
    status: 502,
    json: async () => {
      throw new Error('not json');
    },
  });
  await assert.rejects(
    () => searchMetaApps({}, { baseUrl: 'https://so.example.com', fetchFn }),
    /invalid response \(HTTP 502\)/,
  );
});

test('searchMetaApps defaults to the production base URL and honors the env override', async () => {
  const previous = process.env.METASO_P2P_BASE_URL;
  try {
    delete process.env.METASO_P2P_BASE_URL;
    const fallback = captureFetch({ code: 0, data: { items: [] } });
    await searchMetaApps({}, { fetchFn: fallback.fetchFn });
    assert.equal(fallback.calls[0].url, `${DEFAULT_METAAPP_SEARCH_BASE_URL}/api/metaapp/list`);

    process.env.METASO_P2P_BASE_URL = 'https://so-env.example.com/';
    const fromEnv = captureFetch({ code: 0, data: { items: [] } });
    await searchMetaApps({}, { fetchFn: fromEnv.fetchFn });
    assert.equal(fromEnv.calls[0].url, 'https://so-env.example.com/api/metaapp/list');

    const explicit = captureFetch({ code: 0, data: { items: [] } });
    await searchMetaApps({}, { baseUrl: 'https://so-explicit.example.com', fetchFn: explicit.fetchFn });
    assert.equal(explicit.calls[0].url, 'https://so-explicit.example.com/api/metaapp/list');
  } finally {
    if (previous === undefined) {
      delete process.env.METASO_P2P_BASE_URL;
    } else {
      process.env.METASO_P2P_BASE_URL = previous;
    }
  }
});

test('searchMetaApps passes an abort signal with the configured timeout', async () => {
  const { calls, fetchFn } = captureFetch({ code: 0, data: { items: [] } });
  await searchMetaApps({}, { baseUrl: 'https://so.example.com', fetchFn, timeoutMs: 1234 });

  assert.equal(calls.length, 1);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[0].init.signal.aborted, false);
  assert.equal(calls[0].init.headers.accept, 'application/json');
});

test('listMetaAppForks lowercases and URL-encodes the pinId and forwards pagination', async () => {
  const { calls, fetchFn } = captureFetch({ code: 0, data: { items: [sampleItem()], nextCursor: 'fork-cursor', hasMore: true } });
  const page = await listMetaAppForks(
    { pinId: ` ${PIN_ID} `, size: 7, cursor: 'cursor-9' },
    { baseUrl: 'https://so.example.com', fetchFn },
  );

  assert.equal(
    calls[0].url,
    `https://so.example.com/api/metaapp/forks/${encodeURIComponent(PIN_ID.toLowerCase())}?size=7&cursor=cursor-9`,
  );
  assert.equal(page.items.length, 1);
  assert.equal(page.nextCursor, 'fork-cursor');
  assert.equal(page.hasMore, true);
});

test('listMetaAppForks without pagination requests the bare forks endpoint', async () => {
  const { calls, fetchFn } = captureFetch({ code: 0, data: { items: [] } });
  await listMetaAppForks({ pinId: PIN_ID }, { baseUrl: 'https://so.example.com', fetchFn });

  assert.equal(calls[0].url, `https://so.example.com/api/metaapp/forks/${encodeURIComponent(PIN_ID.toLowerCase())}`);
});

test('listMetaAppForks requires a pinId', async () => {
  const { calls, fetchFn } = captureFetch({ code: 0, data: { items: [] } });
  await assert.rejects(
    () => listMetaAppForks({ pinId: '   ' }, { baseUrl: 'https://so.example.com', fetchFn }),
    /pinId is required/,
  );
  assert.equal(calls.length, 0);
});

test('listMetaAppForks maps 40400 to MetaAppSearchNotFoundError', async () => {
  const { fetchFn } = captureFetch({ code: 40400, message: 'parent app not found' });
  await assert.rejects(
    () => listMetaAppForks({ pinId: PIN_ID }, { baseUrl: 'https://so.example.com', fetchFn }),
    (error) => {
      assert.ok(error instanceof MetaAppSearchNotFoundError);
      assert.match(error.message, /parent app not found/);
      return true;
    },
  );
});

test('trimMetaAppSearchItems projects the CLI fields and marks own publishers case-insensitively', async () => {
  const ownIds = new Set(['GMID-Publisher']);
  const { fetchFn } = captureFetch({
    code: 0,
    data: {
      items: [
        sampleItem(),
        { ...sampleItem(), pinId: 'pin-2', publisherGlobalMetaId: 'gmid-other', publisherName: 'Bob' },
        { ...sampleItem(), pinId: 'pin-3', publisherGlobalMetaId: '' },
      ],
    },
  });
  const page = await searchMetaApps({}, { baseUrl: 'https://so.example.com', fetchFn });
  const trimmed = trimMetaAppSearchItems(page.items, ownIds);

  assert.equal(trimmed.length, 3);
  assert.deepEqual(Object.keys(trimmed[0]), [
    'pinId',
    'title',
    'appName',
    'intro',
    'tags',
    'runtime',
    'version',
    'updatedAt',
    'publisherGlobalMetaId',
    'publisherName',
    'publisherAvatarId',
    'forkedFrom',
    'isOwn',
  ]);
  assert.equal(trimmed[0].isOwn, true);
  assert.equal(trimmed[1].isOwn, false);
  assert.equal(trimmed[2].isOwn, false);
  assert.equal(trimmed[0].publisherName, 'Alice');
  assert.equal(trimmed[0].forkedFrom, 'parent-pin');
});
