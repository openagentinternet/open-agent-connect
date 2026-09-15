import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const registry = require('../../dist/core/metaprotocol/registry.js');

function envelopeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const body = await handler(String(url));
    return {
      status: 200,
      json: async () => body,
    };
  };
  return { calls, fetchImpl };
}

function manapiEnvelope(data) {
  return { code: 1, data, message: 'ok' };
}

const AUTHOR = { address: '16abc', metaid: 'mid-1', globalMetaId: 'idq1reg', name: 'Registrar' };

function listItem(overrides = {}) {
  return {
    protocolPath: '/protocols/simplebuzz',
    title: 'Simple Buzz',
    protocolName: 'SimpleBuzz',
    intro: 'micro posts',
    version: '1.2.0',
    chainName: 'mvc',
    pinId: 'a'.repeat(64) + 'i0',
    currentPinId: 'b'.repeat(64) + 'i0',
    createdAt: 1757000000,
    updatedAt: 1757100000,
    confirmed: true,
    author: AUTHOR,
    conflictsCount: 0,
    ...overrides,
  };
}

test('listMetaProtocols serializes filters and normalizes the page', async () => {
  const { calls, fetchImpl } = envelopeFetch(() => ({
    code: 0,
    data: {
      items: [listItem()],
      rejected: [{ pinId: 'z'.repeat(64) + 'i0', reason: 'unparseable payload' }],
      nextCursor: 'cur-2',
      hasMore: true,
    },
  }));
  const page = await registry.listMetaProtocols(
    { query: 'buzz', publisher: 'idq1reg', size: 20, cursor: 'cur-1' },
    { baseUrl: 'https://so.test/', fetchImpl },
  );
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].protocolPath, '/protocols/simplebuzz');
  assert.equal(page.items[0].currentPinId, 'b'.repeat(64) + 'i0');
  assert.equal(page.items[0].author.name, 'Registrar');
  assert.equal(page.rejected[0].reason, 'unparseable payload');
  assert.equal(page.nextCursor, 'cur-2');
  assert.equal(page.hasMore, true);
  const url = new URL(calls[0]);
  assert.equal(url.pathname, '/api/metaweb/protocols');
  assert.equal(url.searchParams.get('q'), 'buzz');
  assert.equal(url.searchParams.get('publisher'), 'idq1reg');
  assert.equal(url.searchParams.get('size'), '20');
  assert.equal(url.searchParams.get('cursor'), 'cur-1');
});

test('checkMetaProtocolPath maps the occupancy precheck', async () => {
  const { calls, fetchImpl } = envelopeFetch(() => ({
    code: 0,
    data: {
      path: '/protocols/simplebuzz',
      available: false,
      existing: { ...listItem() },
    },
  }));
  const check = await registry.checkMetaProtocolPath('/protocols/simplebuzz', { baseUrl: 'https://so.test', fetchImpl });
  assert.equal(check.available, false);
  assert.equal(check.existing.pinId, 'a'.repeat(64) + 'i0');
  assert.equal(check.existing.author.globalMetaId, 'idq1reg');
  assert.equal(new URL(calls[0]).pathname, '/api/metaweb/protocols/check');
  await assert.rejects(
    () => registry.checkMetaProtocolPath('  ', { baseUrl: 'https://so.test', fetchImpl }),
    /path is required/,
  );
});

test('getMetaProtocolDetail normalizes the record payload; business errors surface the code', async () => {
  const { fetchImpl } = envelopeFetch(() => ({
    code: 0,
    data: {
      record: {
        ...listItem(),
        payload: {
          title: 'Simple Buzz',
          path: '/protocols/simplebuzz',
          version: '1.2.0',
          authors: 'Registrar',
          intro: '',
          protocolName: 'SimpleBuzz',
          protocolAttachments: [],
          metadata: '',
          protocolContent: '{\n buzz: true\n}',
          protocolContentType: 'application/json',
        },
      },
      versions: [{ pinId: 'a'.repeat(64) + 'i0', version: '1.0.0', timestamp: 1, author: AUTHOR, attribution: 'chain' }],
      conflicts: [],
      invalidModifies: [],
    },
  }));
  const detail = await registry.getMetaProtocolDetail({ path: '/protocols/simplebuzz' }, { baseUrl: 'https://so.test', fetchImpl });
  assert.equal(detail.record.payload.protocolContent, '{\n buzz: true\n}');
  assert.equal(detail.record.payload.protocolContentType, 'application/json');
  assert.equal(detail.versions[0].attribution, 'chain');
  await assert.rejects(
    () => registry.getMetaProtocolDetail({}, { baseUrl: 'https://so.test', fetchImpl }),
    /path or pinId is required/,
  );

  const failing = envelopeFetch(() => ({ code: 40400, data: null, message: 'not found' }));
  await assert.rejects(
    () => registry.getMetaProtocolDetail({ path: '/protocols/nope' }, { baseUrl: 'https://so.test', fetchImpl: failing.fetchImpl }),
    /40400/,
  );
});

test('getMetaProtocolPinVersions stringifies numeric version fields', async () => {
  const { calls, fetchImpl } = envelopeFetch(() => ({
    code: 0,
    data: {
      pinId: 'a'.repeat(64) + 'i0',
      latest: 'b'.repeat(64) + 'i0',
      attribution: 'local',
      versions: [
        { pinId: 'a'.repeat(64) + 'i0', version: 1, createdAt: 1757000000, operation: 'create', author: AUTHOR },
        { pinId: 'b'.repeat(64) + 'i0', version: 2, createdAt: 1757100000, operation: 'modify', author: AUTHOR },
      ],
    },
  }));
  const versions = await registry.getMetaProtocolPinVersions('a'.repeat(64) + 'i0', { baseUrl: 'https://so.test', fetchImpl });
  assert.equal(versions.attribution, 'local');
  assert.equal(versions.versions[0].version, '1');
  assert.equal(versions.versions[1].version, '2');
  assert.equal(calls[0].endsWith('/api/metaweb/pin/' + 'a'.repeat(64) + 'i0/versions'), true);
});

test('resolveMetaProtocolRecord: path order, name disambiguation, 40400 → not registered', async () => {
  const { fetchImpl } = envelopeFetch((url) => {
    if (url.includes('/protocols/detail')) {
      return { code: 0, data: { record: { ...listItem(), payload: {} }, versions: [], conflicts: [], invalidModifies: [] } };
    }
    if (url.includes('/api/metaweb/protocols?')) {
      return { code: 0, data: { items: [listItem()], rejected: [], nextCursor: null, hasMore: false } };
    }
    return { code: 40400, data: null, message: 'not found' };
  });
  const record = await registry.resolveMetaProtocolRecord({ protocolName: 'SimpleBuzz' }, { baseUrl: 'https://so.test', fetchImpl });
  assert.equal(record.protocolPath, '/protocols/simplebuzz');

  const ambiguous = envelopeFetch((url) => {
    if (url.includes('/api/metaweb/protocols?')) {
      return {
        code: 0,
        data: { items: [listItem(), listItem({ protocolPath: '/protocols/simplebuzz2', protocolName: 'SimpleBuzz' })], rejected: [], nextCursor: null, hasMore: false },
      };
    }
    return { code: 0, data: {} };
  });
  await assert.rejects(
    () => registry.resolveMetaProtocolRecord({ protocolName: 'SimpleBuzz' }, { baseUrl: 'https://so.test', fetchImpl: ambiguous.fetchImpl }),
    (error) => error.name === 'MetaprotocolResolveError' && /Multiple protocols/.test(error.message),
  );

  const missing = envelopeFetch(() => ({ code: 40400, data: null, message: 'not found' }));
  await assert.rejects(
    () => registry.resolveMetaProtocolRecord({ protocolPath: '/protocols/nope' }, { baseUrl: 'https://so.test', fetchImpl: missing.fetchImpl }),
    (error) => error.name === 'MetaprotocolResolveError' && /not registered yet/.test(error.message),
  );
});

test('MANAPI fallback: registrations scan pages and parses payloads (contentSummary first, base64 body fallback)', async () => {
  const fullBody = Buffer.from(JSON.stringify({ title: 'Base64 Protocol', path: '/protocols/base64', protocolName: 'Base64', version: '2.0.0' }), 'utf8').toString('base64');
  const { calls, fetchImpl } = envelopeFetch((url) => {
    if (!url.includes('/pin/path/list')) throw new Error('unexpected url ' + url);
    if (url.includes('cursor=')) return manapiEnvelope({ list: [], nextCursor: null });
    return manapiEnvelope({
      list: [
        {
          id: 'c'.repeat(64) + 'i0',
          timestamp: 1757000001,
          operation: 'create',
          version: 1,
          address: '16abc',
          metaid: 'mid-1',
          globalMetaId: 'idq1reg',
          contentSummary: '{"title":"Summarized","path":"/protocols/summarized","protocolName":"Sum","version":"1.0.0"}',
        },
        {
          id: 'd'.repeat(64) + 'i0',
          timestamp: 1757000002,
          operation: 'create',
          version: 2,
          address: '16abc',
          metaid: 'mid-1',
          globalMetaId: 'idq1reg',
          contentSummary: '{"title":"trunc',
          originalContentBody: fullBody,
        },
      ],
      nextCursor: 'page-2',
    });
  });
  const registrations = await registry.listMetaProtocolRegistrationsViaManapi({ manapiBaseUrl: 'https://manapi.test', fetchImpl });
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0].payload.path, '/protocols/summarized');
  assert.equal(registrations[1].payload.title, 'Base64 Protocol');
  assert.ok(calls[0].includes('/pin/path/list?path=%2Fprotocols%2Fmetaprotocol&size=100'));
  assert.ok(calls[1].includes('cursor=page-2'));
  const matches = registry.matchManapiRegistrations(registrations, { protocolPath: '/protocols/base64' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].pinId, 'd'.repeat(64) + 'i0');
});

test('MANAPI fallback versions walk the modify_history best-effort', async () => {
  const sourcePin = 'a'.repeat(64) + 'i0';
  const { fetchImpl } = envelopeFetch((url) => {
    if (url.endsWith(`/api/pin/${sourcePin}`)) {
      return manapiEnvelope({ id: sourcePin, modify_history: [sourcePin, 'b'.repeat(64) + 'i0'] });
    }
    if (url.endsWith(`/api/pin/${'b'.repeat(64)}i0`)) {
      return manapiEnvelope({
        id: 'b'.repeat(64) + 'i0',
        timestamp: 1757100000,
        address: '16abc',
        metaid: 'mid-1',
        globalMetaId: 'idq1reg',
        contentSummary: '{"version":"1.1.0"}',
      });
    }
    throw new Error('unexpected url ' + url);
  });
  const versions = await registry.getMetaProtocolVersionsViaManapi(sourcePin, { manapiBaseUrl: 'https://manapi.test', fetchImpl });
  assert.equal(versions.length, 2);
  assert.equal(versions[0].version, '');
  assert.equal(versions[1].version, '1.1.0');
  assert.equal(versions[1].author.globalMetaId, 'idq1reg');
});
