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

test('parseManMetaAppListResponse hides older create row when later revoke has same first pin', () => {
  const revokePin = `${'c'.repeat(64)}i0`;
  const parsed = parseManMetaAppListResponse({
    code: 1,
    data: {
      list: [
        manRecord(PIN_A, { title: 'Visible Before Revoke', appName: 'Visible Before Revoke', runtime: 'browser' }, {
          firstPinId: PIN_A,
          timestamp: 1782490000,
        }),
        manRecord(revokePin, {}, {
          firstPinId: PIN_A,
          operation: 'revoke',
          timestamp: 1782490001,
        }),
      ],
    },
  });

  assert.equal(parsed.records.length, 0);
});

test('parseManMetaAppListResponse uses later modify row for the same root pin', () => {
  const modifyPin = `${'d'.repeat(64)}i0`;
  const parsed = parseManMetaAppListResponse({
    code: 1,
    data: {
      list: [
        manRecord(PIN_A, {
          title: 'Original App',
          appName: 'Original App',
          runtime: 'browser',
          version: 'v1.0.0',
        }, {
          root_pin_id: PIN_A,
          timestamp: 1782490000,
        }),
        manRecord(modifyPin, {
          title: 'Modified App',
          appName: 'Modified App',
          runtime: 'browser/linux',
          version: 'v1.1.0',
        }, {
          root_pin_id: PIN_A,
          operation: 'modify',
          timestamp: 1782490001,
        }),
      ],
    },
  });

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].pinId, modifyPin);
  assert.equal(parsed.records[0].firstPinId, PIN_A);
  assert.equal(parsed.records[0].operation, 'modify');
  assert.equal(parsed.records[0].title, 'Modified App');
  assert.equal(parsed.records[0].runtime, 'browser/linux');
  assert.equal(parsed.records[0].version, 'v1.1.0');
});

test('parseManMetaAppListResponse groups modify target paths under the original pin', () => {
  const modifyPin = `${'f'.repeat(64)}i0`;
  const parsed = parseManMetaAppListResponse({
    code: 1,
    data: {
      list: [
        manRecord(PIN_A, {
          title: 'Original Path App',
          appName: 'Original Path App',
          runtime: 'browser',
        }, {
          timestamp: 1782490000,
        }),
        manRecord(modifyPin, {
          title: 'Modified Path App',
          appName: 'Modified Path App',
          runtime: 'browser/linux',
        }, {
          operation: 'modify',
          path: `@${PIN_A}`,
          timestamp: 1782490001,
        }),
      ],
    },
  });

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].pinId, modifyPin);
  assert.equal(parsed.records[0].firstPinId, PIN_A);
  assert.equal(parsed.records[0].operation, 'modify');
  assert.equal(parsed.records[0].title, 'Modified Path App');
});

test('parseManMetaAppListResponse groups revoke target paths under the original pin', () => {
  const revokePin = `${'c'.repeat(64)}i0`;
  const parsed = parseManMetaAppListResponse({
    code: 1,
    data: {
      list: [
        manRecord(PIN_A, { title: 'Path App Before Revoke', appName: 'Path App Before Revoke', runtime: 'browser' }, {
          timestamp: 1782490000,
        }),
        manRecord(revokePin, {}, {
          operation: 'revoke',
          path: `@${PIN_A}`,
          timestamp: 1782490001,
        }),
      ],
    },
  });

  assert.equal(parsed.records.length, 0);
});

test('parseManMetaAppListResponse skips malformed pin ids without aborting valid rows', () => {
  const parsed = parseManMetaAppListResponse({
    code: 1,
    data: {
      list: [
        manRecord('not-a-pin', { title: 'Malformed', appName: 'Malformed', runtime: 'browser' }),
        manRecord(PIN_A, { title: 'Valid App', appName: 'Valid App', runtime: 'browser' }),
      ],
    },
  });

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].pinId, PIN_A);
  assert.equal(parsed.records[0].title, 'Valid App');
});

test('parseManMetaAppListResponse groups original id fields under the original pin', () => {
  const modifyPin = `${'f'.repeat(64)}i0`;
  const parsed = parseManMetaAppListResponse({
    code: 1,
    data: {
      list: [
        manRecord(PIN_A, { title: 'Original Id App', appName: 'Original Id App', runtime: 'browser' }, {
          timestamp: 1782490000,
        }),
        manRecord(modifyPin, { title: 'Original Id Modified', appName: 'Original Id Modified', runtime: 'browser/linux' }, {
          operation: 'modify',
          original_id: PIN_A,
          timestamp: 1782490001,
        }),
      ],
    },
  });

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].pinId, modifyPin);
  assert.equal(parsed.records[0].firstPinId, PIN_A);
  assert.equal(parsed.records[0].title, 'Original Id Modified');
});

test('parseManMetaAppListResponse prefers explicit owner address fields over address', () => {
  const ownerAddressPin = `${'e'.repeat(64)}i0`;
  const ownerAddressParsed = parseManMetaAppListResponse({
    code: 1,
    data: {
      list: [
        manRecord(PIN_A, { title: 'Owner Address', appName: 'Owner Address', runtime: 'browser' }, {
          ownerAddress: 'explicit-owner',
          address: 'fallback-address',
        }),
      ],
    },
  });
  const snakeOwnerAddressParsed = parseManMetaAppListResponse({
    code: 1,
    data: {
      list: [
        manRecord(ownerAddressPin, { title: 'Snake Owner Address', appName: 'Snake Owner Address', runtime: 'browser' }, {
          owner_address: 'snake-owner',
          address: 'fallback-address',
        }),
      ],
    },
  });

  assert.equal(ownerAddressParsed.records[0].ownerAddress, 'explicit-owner');
  assert.equal(snakeOwnerAddressParsed.records[0].ownerAddress, 'snake-owner');
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
