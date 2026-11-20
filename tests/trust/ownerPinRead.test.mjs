import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  DEFAULT_OWNER_PIN_MANAPI_BASE_URL,
  DEFAULT_OWNER_PIN_INFO_BASE_URL,
  resolveMetaIdOwnerAddress,
  createOwnerPinReader,
  createOwnerPathPinLister,
} = require('../../dist/core/trust/ownerPinRead.js');
const { verifyOwnerBinding, signOwnerBinding } = require('../../dist/core/owner/ownerBinding.js');
const { createOwnerIdentity } = require('../../dist/core/owner/ownerIdentity.js');
const { createRootOwnerIdentity } = require('../../dist/core/owner/rootOwnerIdentity.js');

const GMID = 'idq1smokedevice00000000000000000000000000000';
const ADDRESS = '1FakeDeviceAddressXXXXXXXXXXXXXXXXXX';
const PIN_ID = 'fakepinid000000000000000000000000000000000000000000000000000000i0';

function json_ok(data) {
  return new Response(JSON.stringify({ code: 1, message: 'ok', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function text_ok(body) {
  return new Response(body, { status: 200 });
}

/**
 * Fetch mock keyed by URL prefix; records every call. Covers the two-base
 * convention: metafile-indexer serves globalmetaid user info, manapi serves
 * the address-scoped pin list + pin content routes.
 */
function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const [prefix, handler] of routes) {
      if (String(url).startsWith(prefix)) return handler(String(url));
    }
    return new Response('not found', { status: 404 });
  };
  return { calls, fetchImpl };
}

test('resolveMetaIdOwnerAddress queries the metafile-indexer globalmetaid route and extracts the address', async () => {
  const { calls, fetchImpl } = mockFetch([
    [`${DEFAULT_OWNER_PIN_INFO_BASE_URL}/api/v1/info/globalmetaid/`, () =>
      json_ok({ globalMetaId: GMID, metaid: 'abc123', name: 'Device', address: ADDRESS })],
  ]);

  const address = await resolveMetaIdOwnerAddress(GMID, { fetchImpl });
  assert.equal(address, ADDRESS);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, new RegExp(`^${DEFAULT_OWNER_PIN_INFO_BASE_URL}/api/v1/info/globalmetaid/${GMID}$`));
  // The gmid route must NOT hit manapi's /api/info/metaid — that endpoint
  // answers a globalmetaid with an empty record (the BUG-1 read-side break).
  assert.doesNotMatch(calls[0].url, /api\/info\/metaid\//);
});

test('resolveMetaIdOwnerAddress returns null on a non-OK info read', async () => {
  const { fetchImpl } = mockFetch([]);
  const address = await resolveMetaIdOwnerAddress(GMID, { fetchImpl });
  assert.equal(address, null);
});

test('resolveMetaIdOwnerAddress returns null when the info record carries no address', async () => {
  // The exact manapi shape that caused BUG-1: code 1 but an empty record.
  const { fetchImpl } = mockFetch([
    [`${DEFAULT_OWNER_PIN_INFO_BASE_URL}/api/v1/info/globalmetaid/`, () => json_ok({
      globalMetaId: '', metaid: '', name: '', address: '', isInit: false,
    })],
  ]);
  const address = await resolveMetaIdOwnerAddress(GMID, { fetchImpl });
  assert.equal(address, null);
});

test('createOwnerPinReader walks info → pin list → content and returns the latest pin', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-owner-pin-read-');
  const device = await createOwnerIdentity(systemHomeDir, { name: 'Device' });
  const rootOwner = await createRootOwnerIdentity(systemHomeDir, { name: 'Alice' });
  const { payload } = await signOwnerBinding(rootOwner, device.globalMetaId);

  const { calls, fetchImpl } = mockFetch([
    [`${DEFAULT_OWNER_PIN_INFO_BASE_URL}/api/v1/info/globalmetaid/`, () => json_ok({ address: ADDRESS })],
    [`${DEFAULT_OWNER_PIN_MANAPI_BASE_URL}/api/address/pin/list/`, () => json_ok({
      list: [{ id: PIN_ID, operation: 'create', timestamp: 1795129357, path: '/info/owner', globalMetaId: device.globalMetaId }],
    })],
    [`${DEFAULT_OWNER_PIN_MANAPI_BASE_URL}/content/`, () => text_ok(payload)],
  ]);

  const reader = createOwnerPinReader({ fetchImpl });
  const pin = await reader(device.globalMetaId);
  assert.deepEqual(pin, { pinId: PIN_ID, payload });

  // One call per step, each against its own base.
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /metafile-indexer\/api\/v1\/info\/globalmetaid\//);
  assert.match(calls[1].url, /manapi\.metaid\.io\/api\/address\/pin\/list\//);
  assert.match(calls[2].url, /manapi\.metaid\.io\/content\//);

  // The walked payload is a verifiable binding over the subject gmid.
  assert.equal(verifyOwnerBinding(pin.payload, device.globalMetaId), true);
});

test('createOwnerPinReader stops at step 1 when the subject has no address', async () => {
  const { calls, fetchImpl } = mockFetch([
    [`${DEFAULT_OWNER_PIN_INFO_BASE_URL}/api/v1/info/globalmetaid/`, () => json_ok({ address: '' })],
  ]);
  const reader = createOwnerPinReader({ fetchImpl });
  assert.deepEqual(await reader(GMID), null);
  assert.equal(calls.length, 1);
});

test('createOwnerPinReader treats revoked-only pin rows as unbound', async () => {
  const { fetchImpl } = mockFetch([
    [`${DEFAULT_OWNER_PIN_INFO_BASE_URL}/api/v1/info/globalmetaid/`, () => json_ok({ address: ADDRESS })],
    [`${DEFAULT_OWNER_PIN_MANAPI_BASE_URL}/api/address/pin/list/`, () => json_ok({
      list: [{ id: PIN_ID, operation: 'revoke', timestamp: 1795129357, path: '/info/owner', globalMetaId: GMID }],
    })],
  ]);
  const reader = createOwnerPinReader({ fetchImpl });
  assert.deepEqual(await reader(GMID), null);
});

test('createOwnerPathPinLister resolves a gmid through the metafile-indexer and folds pin payloads', async () => {
  const { calls, fetchImpl } = mockFetch([
    [`${DEFAULT_OWNER_PIN_INFO_BASE_URL}/api/v1/info/globalmetaid/`, () => json_ok({ address: ADDRESS })],
    [`${DEFAULT_OWNER_PIN_MANAPI_BASE_URL}/api/address/pin/list/`, () => json_ok({
      list: [
        { id: `${PIN_ID}`, operation: 'create', timestamp: 1795129300, path: '/protocols/simpletrust', globalMetaId: GMID },
      ],
    })],
    [`${DEFAULT_OWNER_PIN_MANAPI_BASE_URL}/content/`, () => text_ok(JSON.stringify({ op: 'trust' }))],
  ]);

  const lister = createOwnerPathPinLister({ fetchImpl });
  const pins = await lister(GMID, '/protocols/simpletrust');
  assert.equal(pins.length, 1);
  assert.equal(pins[0].pinId, PIN_ID);
  assert.equal(pins[0].payload, JSON.stringify({ op: 'trust' }));
  assert.match(calls[0].url, /metafile-indexer\/api\/v1\/info\/globalmetaid\//);
});
