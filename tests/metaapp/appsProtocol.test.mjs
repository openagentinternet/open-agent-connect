import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

const {
  normalizeMetaAppImageReference,
  normalizeMetaAppImageReferenceList,
  normalizeMetafileReference,
  normalizeMetafileReferenceList,
  serializeMetaAppRuntime,
  buildMetaAppProtocolPayload,
  buildMetaAppCreateWrite,
  buildMetaAppModifyWrite,
  buildMetaAppRevokeWrite,
  metaAppFormFailure,
  metaAppFormSuccess,
} = require('../../dist/core/metaapp/appsProtocol.js');

const PIN = '6ea8a0bd0bac9a9c6cf4e035e9ce0a18e3a89f390c355dcc43074010fbee7ee7i0';
const SECOND_PIN = `${'a'.repeat(64)}i0`;

test('normalizeMetafileReference accepts raw pin id and metafile uri', () => {
  assert.equal(normalizeMetafileReference(PIN, 'icon'), `metafile://${PIN}`);
  assert.equal(normalizeMetafileReference(` metafile://${PIN} `, 'icon'), `metafile://${PIN}`);
});

test('normalizeMetafileReference rejects invalid pin ids', () => {
  assert.throws(
    () => normalizeMetafileReference('not-a-pin', 'icon'),
    /icon must be a MetaID pin id or metafile:\/\/ pin id/i,
  );
});

test('normalizeMetafileReferenceList parses comma and newline separated pin ids', () => {
  assert.deepEqual(
    normalizeMetafileReferenceList(`${PIN},\nmetafile://${SECOND_PIN}`, 'introImgs'),
    [`metafile://${PIN}`, `metafile://${SECOND_PIN}`],
  );
});

test('normalizeMetaAppImageReference accepts http image URLs and metafile refs', () => {
  assert.equal(
    normalizeMetaAppImageReference('https://cdn.example.test/icon.png', 'icon'),
    'https://cdn.example.test/icon.png',
  );
  assert.equal(normalizeMetaAppImageReference(PIN, 'icon'), `metafile://${PIN}`);
});

test('normalizeMetaAppImageReferenceList preserves mixed http and metafile refs', () => {
  assert.deepEqual(
    normalizeMetaAppImageReferenceList(`https://cdn.example.test/one.png,\nmetafile://${SECOND_PIN}`, 'introImgs'),
    ['https://cdn.example.test/one.png', `metafile://${SECOND_PIN}`],
  );
});

test('serializeMetaAppRuntime serializes selected runtimes with slash separators', () => {
  assert.equal(serializeMetaAppRuntime(['browser', 'ios', 'linux']), 'browser/ios/linux');
});

test('serializeMetaAppRuntime rejects mixed valid and invalid runtimes', () => {
  assert.throws(
    () => serializeMetaAppRuntime(['browser', 'web']),
    /runtime contains unsupported value: web/i,
  );
});

test('serializeMetaAppRuntime rejects all-invalid runtimes', () => {
  assert.throws(
    () => serializeMetaAppRuntime(['web', 'desktop']),
    /runtime contains unsupported values: web, desktop/i,
  );
});

test('serializeMetaAppRuntime preserves first-seen order while deduping valid runtimes', () => {
  assert.equal(serializeMetaAppRuntime(['browser', 'linux', 'browser', 'ios', 'linux']), 'browser/linux/ios');
});

function validInput(overrides = {}) {
  return {
    title: 'Agent Wiki Builder',
    appName: 'Agent Wiki Builder',
    prompt: 'Open the app.',
    icon: PIN,
    coverImg: `metafile://${PIN}`,
    introImgs: [PIN],
    intro: 'Builds a browsable project wiki.',
    runtime: ['browser', 'linux'],
    version: 'v1.0.0',
    contentType: 'application/zip',
    content: PIN,
    indexFile: 'index.html',
    code: PIN,
    contentHash: 'sha256:abc',
    metadata: '{"homepage":false}',
    tags: 'tool, knowledge',
    disabled: true,
    codeType: 'application/zip',
    ...overrides,
  };
}

test('buildMetaAppProtocolPayload normalizes MetaAPP protocol fields', () => {
  const payload = buildMetaAppProtocolPayload(validInput());
  assert.equal(payload.title, 'Agent Wiki Builder');
  assert.equal(payload.icon, `metafile://${PIN}`);
  assert.equal(payload.coverImg, `metafile://${PIN}`);
  assert.deepEqual(payload.introImgs, [`metafile://${PIN}`]);
  assert.equal(payload.content, `metafile://${PIN}`);
  assert.equal(payload.code, `metafile://${PIN}`);
  assert.equal(payload.runtime, 'browser/linux');
  assert.equal(payload.disabled, true);
  assert.deepEqual(payload.tags, ['tool', 'knowledge']);
  assert.deepEqual(payload.metadata, { homepage: false });
});

test('buildMetaAppProtocolPayload preserves http image fields', () => {
  const payload = buildMetaAppProtocolPayload(validInput({
    icon: 'https://cdn.example.test/icon.png',
    coverImg: 'http://cdn.example.test/cover.png',
    introImgs: ['https://cdn.example.test/one.png', PIN],
  }));

  assert.equal(payload.icon, 'https://cdn.example.test/icon.png');
  assert.equal(payload.coverImg, 'http://cdn.example.test/cover.png');
  assert.deepEqual(payload.introImgs, ['https://cdn.example.test/one.png', `metafile://${PIN}`]);
  assert.equal(payload.content, `metafile://${PIN}`);
  assert.equal(payload.code, `metafile://${PIN}`);
});

test('buildMetaAppProtocolPayload rejects unsupported runtime values', () => {
  assert.throws(
    () => buildMetaAppProtocolPayload(validInput({ runtime: ['browser', 'beos'] })),
    /runtime contains unsupported value: beos/i,
  );
});

test('buildMetaAppProtocolPayload defaults empty contentType to application/zip', () => {
  const payload = buildMetaAppProtocolPayload(validInput({ contentType: ' ' }));

  assert.equal(payload.contentType, 'application/zip');
});

test('buildMetaAppProtocolPayload leaves empty codeType undefined', () => {
  const payload = buildMetaAppProtocolPayload(validInput({ codeType: ' ' }));

  assert.equal(payload.codeType, undefined);
});

test('buildMetaAppProtocolPayload rejects unsupported contentType', () => {
  assert.throws(
    () => buildMetaAppProtocolPayload(validInput({ contentType: 'application/x-msdownload' })),
    /contentType must be one of:/i,
  );
});

test('buildMetaAppProtocolPayload rejects unsupported codeType', () => {
  assert.throws(
    () => buildMetaAppProtocolPayload(validInput({ codeType: 'application/octet-stream' })),
    /codeType must be one of:/i,
  );
});

test('buildMetaAppProtocolPayload rejects invalid metadata JSON', () => {
  assert.throws(
    () => buildMetaAppProtocolPayload(validInput({ metadata: '{bad-json' })),
    /expected property name or/i,
  );
});

test('buildMetaAppProtocolPayload rejects metadata arrays', () => {
  assert.throws(
    () => buildMetaAppProtocolPayload(validInput({ metadata: '[]' })),
    /metadata must be a JSON object/i,
  );
});

test('buildMetaAppCreateWrite writes create under /protocols/metaapp', () => {
  const payload = buildMetaAppProtocolPayload(validInput());
  const write = buildMetaAppCreateWrite(payload);
  assert.equal(write.operation, 'create');
  assert.equal(write.path, '/protocols/metaapp');
  assert.equal(write.contentType, 'application/json');
  assert.deepEqual(JSON.parse(write.payload), payload);
});

test('buildMetaAppModifyWrite targets the latest pin id', () => {
  const payload = buildMetaAppProtocolPayload(validInput({ disabled: false }));
  const write = buildMetaAppModifyWrite(PIN, payload);
  assert.equal(write.operation, 'modify');
  assert.equal(write.path, `@${PIN}`);
  assert.equal(JSON.parse(write.payload).disabled, false);
});

test('buildMetaAppModifyWrite rejects invalid target pin ids', () => {
  const payload = buildMetaAppProtocolPayload(validInput());

  assert.throws(
    () => buildMetaAppModifyWrite('not-a-pin', payload),
    /targetPinId must be a MetaID pin id/i,
  );
});

test('buildMetaAppRevokeWrite creates a PIN-level revoke request', () => {
  assert.deepEqual(buildMetaAppRevokeWrite(PIN), {
    operation: 'revoke',
    path: `@${PIN}`,
  });
});

test('buildMetaAppRevokeWrite rejects invalid target pin ids', () => {
  assert.throws(
    () => buildMetaAppRevokeWrite('not-a-pin'),
    /targetPinId must be a MetaID pin id/i,
  );
});

test('metaAppFormFailure wraps errors as command failures', () => {
  assert.deepEqual(metaAppFormFailure(new Error('bad form')), {
    ok: false,
    state: 'failed',
    code: 'metaapp_apps_form_invalid',
    message: 'bad form',
  });
});

test('metaAppFormSuccess wraps form data as command success', () => {
  const data = { pinId: PIN };

  assert.deepEqual(metaAppFormSuccess(data), {
    ok: true,
    state: 'success',
    data,
  });
});
