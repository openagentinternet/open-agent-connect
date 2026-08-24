import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { searchMetaweb, DEFAULT_METAWEB_SEARCH_BASE_URL } = require('../../dist/core/metaweb/search.js');
const { readMetawebPin, MetawebPinNotFoundError } = require('../../dist/core/metaweb/pinRead.js');
const {
  buildPinBrowserUri,
  buildSearchItemBrowserUri,
  buildMetaIdBrowserUri,
  markdownSelfLink,
  METAWEB_CITATION_RULE,
} = require('../../dist/core/metaweb/uri.js');

function jsonResponse(body) {
  return { status: 200, ok: true, json: async () => body };
}

test('searchMetaweb builds the query and normalizes the page', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), signal: Boolean(init?.signal) });
    return jsonResponse({
      code: 0,
      data: {
        items: [
          {
            protocol: 'simplenote',
            pinId: 'a'.repeat(64) + 'i0',
            currentPinId: 'b'.repeat(64) + 'i0',
            chainName: 'mvc',
            title: '  How to fish  ',
            summary: 'A guide',
            tags: [' fishing ', 'guide'],
            publisher: { globalMetaId: 'IDQ1', metaid: 'm1', name: 'Fisher', avatar: 'metafile://x' },
            createdAt: 1787000000,
            score: 12.5,
            extra: { runtime: 'html' },
          },
        ],
        nextCursor: 'cur-2',
        hasMore: true,
      },
    });
  };
  const page = await searchMetaweb(
    { q: '钓鱼 guide', protocols: ['simplenote'], sort: 'newest', size: 60, cursor: 'cur-1' },
    { baseUrl: 'https://so.test/', fetchImpl, timeoutMs: 2000 },
  );
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/api/metaweb/search');
  assert.equal(url.searchParams.get('q'), '钓鱼 guide');
  assert.equal(url.searchParams.get('protocols'), 'simplenote');
  assert.equal(url.searchParams.get('sort'), 'newest');
  assert.equal(url.searchParams.get('size'), '50', 'size clamped to 50 client-side');
  assert.equal(url.searchParams.get('cursor'), 'cur-1');
  assert.ok(calls[0].signal, 'abort signal wired');

  const item = page.items[0];
  assert.equal(item.title, 'How to fish');
  assert.equal(item.currentPinId, 'b'.repeat(64) + 'i0');
  assert.deepEqual(item.tags, ['fishing', 'guide']);
  assert.equal(item.publisher.name, 'Fisher');
  assert.equal(page.nextCursor, 'cur-2');
  assert.equal(page.hasMore, true);

  await assert.rejects(searchMetaweb({ q: '  ' }, { fetchImpl }), /q is required/);
  await assert.rejects(
    searchMetaweb({ q: 'x' }, {
      fetchImpl: async () => jsonResponse({ code: 50000, message: 'boom' }),
    }),
    /MetaWeb search API error 50000: boom/,
  );
});

test('readMetawebPin normalizes the pin and maps 40400 to not-found', async () => {
  const fetchImpl = async (url) => {
    assert.equal(String(url).endsWith(`/api/metaweb/pin/${encodeURIComponent('c'.repeat(64) + 'i0')}`), true);
    return jsonResponse({
      code: 0,
      data: {
        pinId: 'c'.repeat(64) + 'i0',
        currentPinId: 'd'.repeat(64) + 'i0',
        protocol: 'simplenote',
        path: '/protocols/simplenote',
        chainName: 'mvc',
        operation: 'modify',
        creator: { globalMetaId: 'IDQ1', metaid: 'm1', name: '', address: '' },
        createdAt: 1787000100,
        contentType: 'application/json',
        payload: { title: 'T' },
        text: '# body',
        truncated: true,
        totalLength: 9000,
        meta: { title: 'T', summary: 'S', tags: ['x'] },
        attachments: [{ uri: 'metafile://a', url: 'https://cdn/a.png', contentType: 'image/png', size: null }],
        source: 'remote',
      },
    });
  };
  const pin = await readMetawebPin('c'.repeat(64) + 'i0', { baseUrl: 'https://so.test', fetchImpl });
  assert.equal(pin.currentPinId, 'd'.repeat(64) + 'i0');
  assert.equal(pin.text, '# body');
  assert.equal(pin.truncated, true);
  assert.equal(pin.totalLength, 9000);
  assert.equal(pin.attachments[0].size, null);
  assert.equal(pin.source, 'remote');

  await assert.rejects(
    readMetawebPin('missing', {
      fetchImpl: async () => jsonResponse({ code: 40400, message: 'no pin' }),
    }),
    (error) => error instanceof MetawebPinNotFoundError,
  );
});

test('metaweb URI scheme selection and citation rule', () => {
  const pin = 'e'.repeat(64) + 'i0';
  assert.equal(buildPinBrowserUri({ pinId: pin, path: '/protocols/metaapp' }), `metaapp://${pin}`);
  assert.equal(buildPinBrowserUri({ pinId: pin, protocol: 'file' }), `metafile://${pin}`);
  assert.equal(buildPinBrowserUri({ pinId: ` ${pin.toUpperCase()} ` }), `pin://${pin}`);
  assert.equal(buildPinBrowserUri({ pinId: '' }), '');
  assert.equal(
    buildSearchItemBrowserUri({ pinId: 'old', currentPinId: pin, protocol: 'metaapp' }),
    `metaapp://${pin}`,
  );
  assert.equal(buildMetaIdBrowserUri(' IDQ1 '), 'metaid://idq1');
  assert.equal(buildMetaIdBrowserUri(''), '');
  assert.equal(markdownSelfLink(`pin://${pin}`), `[pin://${pin}](pin://${pin})`);
  assert.match(METAWEB_CITATION_RULE, /NEVER construct Web2 viewer URLs/);
});
