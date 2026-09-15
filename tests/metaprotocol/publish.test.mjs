import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const publish = require('../../dist/core/metaprotocol/publish.js');
const registry = require('../../dist/core/metaprotocol/registry.js');
const schema = require('../../dist/core/metaprotocol/schema.js');

function envelopeFetch(handler) {
  const fetchImpl = async (url) => {
    const body = await handler(String(url));
    return { status: 200, json: async () => body };
  };
  return { fetchImpl };
}

const IDENTITY = { name: 'Alice Bot', globalMetaId: 'idq1alice', metaId: 'metaid-alice', address: '16alice' };

function targetRecord(overrides = {}) {
  return {
    protocolPath: '/protocols/simplebuzz',
    title: 'Simple Buzz',
    protocolName: 'SimpleBuzz',
    intro: '',
    version: '1.0.9',
    chainName: 'mvc',
    pinId: 'a'.repeat(64) + 'i0',
    currentPinId: 'a'.repeat(64) + 'i0',
    createdAt: 1757000000,
    updatedAt: 1757000000,
    confirmed: true,
    author: { address: '16alice', metaid: 'metaid-alice', globalMetaId: 'idq1alice', name: 'Alice Bot' },
    conflictsCount: 0,
    payload: {
      title: 'Simple Buzz',
      path: '/protocols/simplebuzz',
      version: '1.0.9',
      authors: 'Alice Bot',
      intro: '',
      protocolName: 'SimpleBuzz',
      protocolAttachments: [],
      metadata: '',
      protocolContent: '{}',
      protocolContentType: 'application/json',
    },
    ...overrides,
  };
}

function fakeSigner(writes) {
  return {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async (input) => {
      writes.push(input);
      return {
        pinId: 'f'.repeat(64) + 'i0',
        txids: ['tx-9'],
        totalCost: 777,
        network: input.network,
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        encoding: 'utf-8',
        globalMetaId: 'idq1alice',
        mvcAddress: '16alice',
      };
    },
  };
}

test('serializeMetaprotocolBody: {value,description} comments + nested 2-space JSON', () => {
  const out = publish.serializeMetaprotocolBody({
    buzz: { value: true, description: 'post micro updates' },
    list: { value: ['a', 'b'], description: 'allowed kinds' },
    plain: 42,
  });
  assert.equal(out, [
    '{',
    ' /** post micro updates */',
    ' "buzz": true,',
    ' /** allowed kinds */',
    ' "list": [',
    '   "a",',
    '   "b"',
    ' ],',
    ' "plain": 42',
    '}',
  ].join('\n'));
});

test('version auto-increment table: 1.0.0→1.0.1, 1.0.9→1.1.0, 1.9.9→2.0.0', () => {
  assert.equal(publish.incrementMetaprotocolVersion('1.0.0'), '1.0.1');
  assert.equal(publish.incrementMetaprotocolVersion('1.0.9'), '1.1.0');
  assert.equal(publish.incrementMetaprotocolVersion('1.9.9'), '2.0.0');
  assert.equal(publish.incrementMetaprotocolVersion('not-a-version'), 'not-a-version');
});

test('isSameRegistrant: globalMetaId layer first, falls through to address', () => {
  const author = { globalMetaId: 'IDQ1ALICE', metaid: '', address: '16ALICE' };
  assert.equal(publish.isSameRegistrant(author, IDENTITY), true);
  assert.equal(publish.isSameRegistrant({ globalMetaId: 'idq1other', metaid: '', address: '16alice' }, IDENTITY), false);
  assert.equal(publish.isSameRegistrant({ globalMetaId: '', metaid: '', address: '16ALICE' }, IDENTITY), true);
  assert.equal(publish.isSameRegistrant({ globalMetaId: '', metaid: '', address: '' }, IDENTITY), false);
});

test('draft-07 gate: invalid path/version payloads are rejected before the wallet', () => {
  const bad = publish.validateMetaprotocolPayload({
    ...targetRecord().payload,
    path: '/protocols/Not-Lower',
    version: '1.0',
  });
  assert.equal(bad != null, true);
  assert.match(bad, /path: must match the pattern/);
  assert.match(bad, /version: must match the pattern/);
  const extra = publish.validateMetaprotocolPayload({ ...targetRecord().payload, rogue: 1 });
  assert.match(extra, /unexpected field "rogue"/);
  const ok = publish.validateMetaprotocolPayload(targetRecord().payload);
  assert.equal(ok, null);
});

test('schema validator subset: required, enum, minLength, items', () => {
  const result = schema.validateAgainstSchema(
    { a: 'x', list: [1] },
    {
      type: 'object',
      required: ['a', 'missing'],
      properties: {
        a: { type: 'string', minLength: 2 },
        list: { type: 'array', items: { type: 'string' } },
        kind: { type: 'string', enum: ['one', 'two'] },
      },
    },
  );
  assert.equal(result.ok, false);
  const messages = result.errors.map((issue) => issue.message).join('\n');
  assert.match(messages, /missing the required field "missing"/);
  assert.match(messages, /at least 2 character/);
  assert.match(messages, /must be of type string/);
});

test('buildMetaprotocolPayload: publish derives the path, update keeps it and auto-increments', () => {
  const built = publish.buildMetaprotocolPayload({
    action: 'publish',
    request: {
      title: 'New Proto',
      protocolName: 'NewProto',
      intro: 'hello',
      body: { field: { value: 1, description: 'one' } },
      metadata: '{"k":"v"}',
      attachments: ['metafile://x'],
    },
    identity: IDENTITY,
    record: null,
  });
  assert.equal(built.payload.path, '/protocols/newproto');
  assert.equal(built.payload.version, '1.0.0');
  assert.equal(built.payload.authors, 'Alice Bot');
  assert.deepEqual(built.payload.metadata, { k: 'v' });
  assert.equal(built.payload.protocolAttachments[0], 'metafile://x');
  assert.match(built.payload.protocolContent, /\/\*\* one \*\//);

  const updated = publish.buildMetaprotocolPayload({
    action: 'update',
    request: { title: 'Simple Buzz', protocolName: 'SimpleBuzz', protocolContent: '{ x: 1 }' },
    identity: IDENTITY,
    record: targetRecord(),
  });
  assert.equal(updated.payload.path, '/protocols/simplebuzz');
  assert.equal(updated.payload.version, '1.1.0');
  assert.equal(updated.replacedVersion, '1.0.9');
});

test('findMetaprotocolPublishConflict: occupied path returns registrant info and never throws', async () => {
  const { fetchImpl } = envelopeFetch(() => ({
    code: 0,
    data: { path: '/protocols/simplebuzz', available: false, existing: targetRecord() },
  }));
  const conflict = await publish.findMetaprotocolPublishConflict('/protocols/simplebuzz', { baseUrl: 'https://so.test', fetchImpl });
  assert.match(conflict, /already registered by Alice Bot/);
  assert.match(conflict, /current version 1\.0\.9/);

  const free = await publish.findMetaprotocolPublishConflict('/protocols/simplebuzz', {
    baseUrl: 'https://so.test',
    fetchImpl: envelopeFetch(() => ({ code: 0, data: { path: '/protocols/simplebuzz', available: true, existing: null } })).fetchImpl,
  });
  assert.equal(free, null);
});

test('findMetaprotocolPublishConflict: MetaSo down + MANAPI hit still rejects; both down refuses', async () => {
  const { fetchImpl } = envelopeFetch((url) => {
    if (url.includes('manapi')) {
      return {
        code: 1,
        data: {
          list: [{
            id: 'c'.repeat(64) + 'i0',
            timestamp: 1757000000,
            operation: 'create',
            version: 1,
            address: '16other',
            metaid: 'mid-other',
            globalMetaId: 'idq1other',
            contentSummary: '{"title":"Taken","path":"/protocols/taken","protocolName":"Taken","version":"1.0.0"}',
          }],
          nextCursor: null,
        },
      };
    }
    throw new Error('so.metaid.io unreachable');
  });
  const conflict = await publish.findMetaprotocolPublishConflict('/protocols/taken', {
    baseUrl: 'https://so.test',
    manapiBaseUrl: 'https://manapi.test',
    fetchImpl,
  });
  assert.match(conflict, /already registered by idq1other/);

  const bothDown = await publish.findMetaprotocolPublishConflict('/protocols/taken', {
    baseUrl: 'https://so.test',
    manapiBaseUrl: 'https://manapi.test',
    fetchImpl: envelopeFetch(() => Promise.reject(new Error('network down'))).fetchImpl,
  });
  assert.match(bothDown, /registry and fallback both failed/);
  assert.match(bothDown, /Refusing to publish/);
});

test('resolveMetaprotocolUpdateTarget: path hit, 40400 → publish hint, transport error surfaces retry text', async () => {
  const { fetchImpl } = envelopeFetch((url) => {
    if (url.includes('/protocols/detail')) {
      return { code: 0, data: { record: targetRecord(), versions: [], conflicts: [], invalidModifies: [] } };
    }
    return { code: 40400, data: null, message: 'not found' };
  });
  const record = await publish.resolveMetaprotocolUpdateTarget('/protocols/simplebuzz', { baseUrl: 'https://so.test', fetchImpl });
  assert.equal(record.protocolPath, '/protocols/simplebuzz');

  const missing = envelopeFetch(() => ({ code: 40400, data: null, message: 'not found' }));
  await assert.rejects(
    () => publish.resolveMetaprotocolUpdateTarget('/protocols/nope', { baseUrl: 'https://so.test', fetchImpl: missing.fetchImpl }),
    (error) => error.name === 'MetaprotocolResolveError' && /Use action "publish" instead/.test(error.message),
  );

  const down = envelopeFetch(() => Promise.reject(new Error('connection refused')));
  await assert.rejects(
    () => publish.resolveMetaprotocolUpdateTarget('/protocols/x', { baseUrl: 'https://so.test', fetchImpl: down.fetchImpl }),
    (error) => error.name === 'MetaprotocolResolveError' && /Try again later/.test(error.message),
  );
});

test('writeMetaprotocolPin: publish creates on the registry path; update modifies @<source> with the replaced outer version', async () => {
  const writes = [];
  const signer = fakeSigner(writes);
  const built = publish.buildMetaprotocolPayload({
    action: 'publish',
    request: { title: 'New Proto', protocolName: 'NewProto', protocolContent: '{ x: 1 }' },
    identity: IDENTITY,
    record: null,
  });
  const result = await publish.writeMetaprotocolPin(signer, {
    action: 'publish',
    payload: built.payload,
    record: null,
    replacedVersion: built.replacedVersion,
    network: 'mvc',
  });
  assert.equal(writes[0].operation, 'create');
  assert.equal(writes[0].path, '/protocols/metaprotocol');
  assert.equal(writes[0].version, '1.0.0');
  assert.equal(JSON.parse(writes[0].payload).protocolName, 'NewProto');
  assert.equal(result.pinId, 'f'.repeat(64) + 'i0');
  assert.equal(result.totalCost, 777);

  const record = targetRecord();
  const updated = publish.buildMetaprotocolPayload({
    action: 'update',
    request: { title: 'Simple Buzz', protocolName: 'SimpleBuzz', protocolContent: '{ x: 2 }' },
    identity: IDENTITY,
    record,
  });
  await publish.writeMetaprotocolPin(signer, {
    action: 'update',
    payload: updated.payload,
    record,
    replacedVersion: updated.replacedVersion,
    network: 'mvc',
  });
  assert.equal(writes[1].operation, 'modify');
  assert.equal(writes[1].path, '@' + 'a'.repeat(64) + 'i0');
  assert.equal(writes[1].version, '1.0.9');
  assert.equal(JSON.parse(writes[1].payload).version, '1.1.0');
});

test('formatMetaprotocolResult receipt carries pin link, cost and the indexer hint', () => {
  const sheet = publish.formatMetaprotocolResult({
    action: 'update',
    pinId: 'f'.repeat(64) + 'i0',
    txids: ['tx-9'],
    totalCost: 777,
    protocolPath: '/protocols/simplebuzz',
    version: '1.1.0',
    title: 'Simple Buzz',
  });
  assert.match(sheet, /Protocol updated on-chain: \/protocols\/simplebuzz v1\.1\.0/);
  assert.match(sheet, /cost: 777 sats/);
  assert.match(sheet, /\[pin:\/\//);
  assert.match(sheet, /indexer may take ~1 minute/);
});

test('checkMetaprotocolContentInput enforces the body/protocolContent XOR', () => {
  assert.equal(publish.checkMetaprotocolContentInput({ body: { a: 1 } }), null);
  assert.equal(publish.checkMetaprotocolContentInput({ protocolContent: '{ x: 1 }' }), null);
  assert.match(publish.checkMetaprotocolContentInput({}), /exactly one of body/);
  assert.match(publish.checkMetaprotocolContentInput({ body: { a: 1 }, protocolContent: '{ x: 1 }' }), /exactly one of body/);
});

test('registry module exports the not-registered helper used by both tools', () => {
  assert.match(registry.notRegisteredText('/protocols/x'), /not registered yet/);
});
