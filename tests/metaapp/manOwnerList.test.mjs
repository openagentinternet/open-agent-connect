import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createMetaAppManOwnerClient, parseManMetaAppListResponse } = require('../../dist/core/metaapp/manOwnerList.js');

const PIN_A = '6ea8a0bd0bac9a9c6cf4e035e9ce0a18e3a89f390c355dcc43074010fbee7ee7i0';
const PIN_B = `${'a'.repeat(64)}i0`;
const PIN_C = `${'b'.repeat(64)}i0`;

function manRecord(pinId, contentSummary, extra = {}) {
  return {
    id: pinId,
    operation: 'create',
    path: '/protocols/metaapp',
    address: '16UjcYNBG9GTK4uq2f7yYEbuifqCzoLMGS',
    timestamp: 1782490000,
    contentSummary: JSON.stringify(contentSummary),
    ...extra,
  };
}

test('parseManMetaAppListResponse maps MAN records to Apps records', () => {
  const parsed = parseManMetaAppListResponse({
    code: 1,
    message: 'ok',
    data: {
      list: [
        manRecord(PIN_A, {
          title: 'Agent Wiki Builder',
          appName: 'Agent Wiki Builder',
          runtime: 'browser/linux',
          version: 'v1.2.0',
          icon: `metafile://${PIN_B}`,
          coverImg: `metafile://${PIN_C}`,
          intro: 'A project wiki app.',
          tags: ['tool', 'knowledge'],
          disabled: false,
        }),
      ],
      nextCursor: 'cursor-2',
      total: 1,
    },
  });

  assert.equal(parsed.nextCursor, 'cursor-2');
  assert.equal(parsed.total, 1);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].pinId, PIN_A);
  assert.equal(parsed.records[0].title, 'Agent Wiki Builder');
  assert.equal(parsed.records[0].runtime, 'browser/linux');
  assert.equal(parsed.records[0].disabled, false);
  assert.equal(parsed.records[0].runUrl, `/browser/metaapp/${PIN_A}`);
  assert.equal(parsed.records[0].metaappUri, `metaapp://${PIN_A}`);
  assert.equal(parsed.records[0].metawebUrl, `https://metaweb.world/metaapp/${PIN_A}`);
});

test('parseManMetaAppListResponse hides revoke records and keeps disabled records', () => {
  const parsed = parseManMetaAppListResponse({
    code: 1,
    data: {
      list: [
        manRecord(PIN_A, { title: 'Deleted', appName: 'Deleted', runtime: 'browser', icon: `metafile://${PIN_B}`, coverImg: `metafile://${PIN_C}` }, { operation: 'revoke' }),
        manRecord(PIN_B, { title: 'Disabled', appName: 'Disabled', runtime: 'browser', icon: `metafile://${PIN_A}`, coverImg: `metafile://${PIN_C}`, disabled: true }),
      ],
      nextCursor: '',
      total: 2,
    },
  });

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].pinId, PIN_B);
  assert.equal(parsed.records[0].disabled, true);
});

test('createMetaAppManOwnerClient lists by encoded address and cursor', async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 1, data: { list: [], nextCursor: 'next', total: 0 } }),
    };
  };

  const client = createMetaAppManOwnerClient({ baseUrl: 'https://manapi.metaid.io', fetchFn });
  const result = await client.listByAddress({
    address: '16UjcYNBG9GTK4uq2f7yYEbuifqCzoLMGS',
    cursor: 'abc',
    size: 12,
  });

  assert.equal(result.nextCursor, 'next');
  assert.equal(urls.length, 1);
  assert.equal(
    urls[0],
    'https://manapi.metaid.io/address/pin/list/16UjcYNBG9GTK4uq2f7yYEbuifqCzoLMGS?cursor=abc&size=12&path=%2Fprotocols%2Fmetaapp',
  );
});
