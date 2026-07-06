import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  announceMetaAppShare,
  commentMetaApp,
  previewMetaAppProject,
  publishMetaApp,
  shareMetaApp,
  updateMetaApp,
} = require('../../dist/core/metaapp/publish.js');

const CREATE_PIN = `${'a'.repeat(64)}i0`;
const UPDATE_TARGET_PIN = `${'b'.repeat(64)}i0`;
const UPDATE_PIN = `${'c'.repeat(64)}i0`;
const BUZZ_PIN = `${'d'.repeat(64)}i0`;
const COMMENT_PIN = `${'e'.repeat(64)}i0`;
const PREVIEW_ARTIFACT_URI = 'metafile://<uploaded-metaapp-zip-pin>.zip';

async function makeProject(prefix, manifest = {}) {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), `metabot-metaapp-publish-${prefix}-`));
  await writeProjectFile(projectDir, 'dist/index.html', '<h1>MetaApp</h1>');
  await writeProjectFile(projectDir, 'dist/assets/app.js', 'console.log("metaapp");');
  await writeProjectFile(projectDir, 'package.json', JSON.stringify({ scripts: { build: 'vite build' } }));
  if (Object.keys(manifest).length > 0) {
    await writeProjectFile(projectDir, '.metaapp.json', JSON.stringify(manifest));
  }
  return projectDir;
}

async function makeStaticProject(prefix, manifest = {}) {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), `metabot-metaapp-static-${prefix}-`));
  await writeProjectFile(projectDir, 'index.html', '<h1>Static MetaApp</h1>');
  await writeProjectFile(projectDir, 'assets/app.js', 'console.log("static metaapp");');
  if (Object.keys(manifest).length > 0) {
    await writeProjectFile(projectDir, '.metaapp.json', JSON.stringify(manifest));
  }
  return projectDir;
}

async function writeProjectFile(projectDir, relativePath, content) {
  const filePath = path.join(projectDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

function createDeps(overrides = {}) {
  const calls = [];
  const upserts = [];
  const deps = {
    calls,
    upserts,
    now: () => 1_700_000_000_000,
    async makeTempDir() {
      return mkdtemp(path.join(os.tmpdir(), 'metabot-metaapp-archive-'));
    },
    createPreviewSession(input) {
      calls.push({ type: 'previewSession', input });
      return {
        previewId: 'metaapp-preview-test',
        localPreviewUrl: '/api/metaapp/preview-assets/metaapp-preview-test/',
      };
    },
    async uploadFile(input) {
      calls.push({ type: 'upload', input });
      return {
        pinId: 'upload-pin',
        txids: ['upload-tx'],
        network: input.network ?? 'mvc',
        filePath: input.filePath,
        contentType: input.contentType,
        bytes: 123,
        metafileUri: 'metafile://upload-pin.zip',
        globalMetaId: 'owner-meta-id',
      };
    },
    async writeChain(input) {
      calls.push({ type: 'write', input });
      const pinId = input.path === '/protocols/paycomment' ? COMMENT_PIN : input.operation === 'modify' ? UPDATE_PIN : CREATE_PIN;
      return {
        pinId,
        firstPinId: input.operation === 'modify' ? UPDATE_TARGET_PIN : CREATE_PIN,
        txids: [`${pinId.slice(0, 6)}-tx`],
        totalCost: 1,
        network: input.network ?? 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        globalMetaId: 'owner-meta-id',
        mvcAddress: 'owner-address',
      };
    },
    async postBuzz(input) {
      calls.push({ type: 'buzz', input });
      return {
        pinId: BUZZ_PIN,
        txids: ['buzz-tx'],
        network: input.network ?? 'mvc',
        content: input.content,
        contentType: input.contentType,
        quotePin: input.quotePin,
        globalMetaId: 'owner-meta-id',
      };
    },
    async upsertLocal(record) {
      calls.push({ type: 'upsert', input: record });
      upserts.push(record);
      return { ok: true };
    },
    ...overrides,
  };
  return deps;
}

function writePayload(calls, index = 0) {
  const write = calls.filter((call) => call.type === 'write')[index];
  assert.ok(write, 'expected a chain write call');
  return JSON.parse(write.input.payload);
}

test('previewMetaAppProject returns a local preview without uploading', async () => {
  const projectDir = await makeProject('preview', {
    title: 'Preview App',
    appName: 'preview-app',
  });
  const deps = createDeps();

  const result = await previewMetaAppProject({ projectDir }, deps);

  assert.equal(result.state, 'success');
  assert.equal(result.data.localPreviewUrl, '/api/metaapp/preview-assets/metaapp-preview-test/');
  assert.equal(result.data.previewId, 'metaapp-preview-test');
  assert.equal(result.data.plan.artifactDir, path.join(projectDir, 'dist'));
  assert.equal(result.data.manifest.title, 'Preview App');
  assert.deepEqual(deps.calls.map((call) => call.type), ['previewSession']);
  assert.deepEqual(deps.calls[0].input, {
    artifactDir: path.join(projectDir, 'dist'),
    indexFile: 'index.html',
  });
});

test('previewMetaAppProject with open true exposes localUiUrl for host consumers', async () => {
  const projectDir = await makeProject('preview-open');
  const deps = createDeps();

  const result = await previewMetaAppProject({ projectDir, open: true }, deps);

  assert.equal(result.state, 'success');
  assert.equal(result.localUiUrl, result.data.localPreviewUrl);
  assert.equal(result.data.localUiUrl, result.data.localPreviewUrl);
});

test('publishMetaApp without confirm awaits confirmation and performs no writes', async () => {
  const projectDir = await makeProject('no-confirm');
  const deps = createDeps();

  const result = await publishMetaApp({ projectDir, confirm: false }, deps);

  assert.equal(result.state, 'awaiting_confirmation');
  assert.equal(result.data.plan.artifactDir, path.join(projectDir, 'dist'));
  assert.equal(result.data.payloadPreview.content, PREVIEW_ARTIFACT_URI);
  assert.equal(result.data.payloadPreview.code, '');
  assert.equal(result.data.payloadPreview.contentType, 'application/zip');
  assert.equal(result.data.payloadPreview.codeType, 'application/zip');
  assert.match(result.data.payloadPreview.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(result.data.payloadPreview.metadata, undefined);
  assert.equal(JSON.stringify(result.data.payloadPreview).includes(projectDir), false);
  assert.deepEqual(deps.calls.map((call) => call.type), ['previewSession']);
});

test('publishMetaApp uploads the ZIP before writing create payload and upserting cache', async () => {
  const projectDir = await makeProject('publish', {
    title: 'Publish App',
    appName: 'publish-app',
    intro: 'Published through OAC',
    tags: ['demo'],
  });
  const deps = createDeps();

  const result = await publishMetaApp({ projectDir, confirm: true, network: 'opcat' }, deps);

  assert.equal(result.state, 'success');
  assert.equal(result.data.pinId, CREATE_PIN);
  assert.equal(result.data.firstPinId, CREATE_PIN);
  assert.equal(result.data.metawebUrl, `https://openagentinternet.org/browser/metaapp/${CREATE_PIN}`);
  assert.deepEqual(deps.calls.map((call) => call.type), ['upload', 'write', 'upsert']);
  assert.equal(deps.calls[0].input.contentType, 'application/zip');
  assert.equal(deps.calls[0].input.network, 'opcat');
  assert.equal(deps.calls[1].input.operation, 'create');
  assert.equal(deps.calls[1].input.path, '/protocols/metaapp');
  assert.equal(deps.calls[1].input.contentType, 'application/json');
  assert.equal(deps.calls[1].input.network, 'opcat');

  const payload = writePayload(deps.calls);
  assert.equal(payload.title, 'Publish App');
  assert.equal(payload.appName, 'publish-app');
  assert.equal(payload.code, '');
  assert.equal(payload.content, 'metafile://upload-pin.zip');
  assert.equal(payload.contentType, 'application/zip');
  assert.equal(payload.codeType, 'application/zip');
  assert.match(payload.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(payload.metadata, undefined);
  assert.equal(JSON.stringify(payload).includes(projectDir), false);
  assert.equal(deps.upserts[0].pinId, CREATE_PIN);
  assert.equal(deps.upserts[0].code, '');
  assert.equal(deps.upserts[0].content, 'metafile://upload-pin.zip');
});

test('publishMetaApp derives a zip metafile URI when upload returns only pinId', async () => {
  const projectDir = await makeProject('publish-pinid-only');
  const deps = createDeps({
    async uploadFile(input) {
      deps.calls.push({ type: 'upload', input });
      return {
        pinId: 'upload-pin',
        txids: ['upload-tx'],
        network: input.network ?? 'mvc',
        filePath: input.filePath,
        contentType: input.contentType,
        bytes: 123,
        globalMetaId: 'owner-meta-id',
      };
    },
  });

  await publishMetaApp({ projectDir, confirm: true }, deps);

  const payload = writePayload(deps.calls);
  assert.equal(payload.content, 'metafile://upload-pin.zip');
});

test('publishMetaApp defaults static project code to the runtime artifact', async () => {
  const projectDir = await makeStaticProject('static-code-runtime');
  const deps = createDeps();

  await publishMetaApp({ projectDir, confirm: true }, deps);

  const payload = writePayload(deps.calls);
  assert.equal(payload.content, 'metafile://upload-pin.zip');
  assert.equal(payload.code, 'metafile://upload-pin.zip');
});

test('publishMetaApp preserves explicit source code while content points at runtime', async () => {
  const projectDir = await makeProject('source-code', {
    code: 'metafile://source-code.zip',
  });
  const deps = createDeps();

  await publishMetaApp({ projectDir, confirm: true }, deps);

  const payload = writePayload(deps.calls);
  assert.equal(payload.content, 'metafile://upload-pin.zip');
  assert.equal(payload.code, 'metafile://source-code.zip');
});

test('publishMetaApp can mirror runtime into code when compatibility mirror is requested', async () => {
  const projectDir = await makeProject('compat-mirror');
  const deps = createDeps();

  await publishMetaApp({ projectDir, confirm: true, compatibilityMirrorContent: true }, deps);

  const payload = writePayload(deps.calls);
  assert.equal(payload.code, 'metafile://upload-pin.zip');
  assert.equal(payload.content, 'metafile://upload-pin.zip');
});

test('updateMetaApp writes modify path and inherits previous fields before local overrides', async () => {
  const projectDir = await makeProject('update-inherit', {
    title: 'Local Update Title',
    version: '2.0.0',
    tags: ['local'],
  });
  const deps = createDeps({
    async readExistingMetaApp(pinId) {
      assert.equal(pinId, UPDATE_TARGET_PIN);
      return {
        pinId: UPDATE_TARGET_PIN,
        firstPinId: UPDATE_TARGET_PIN,
        operation: 'create',
        title: 'Previous Title',
        appName: 'previous-app',
        intro: 'Previous intro',
        icon: 'previous-icon.png',
        coverImg: 'previous-cover.png',
        tags: ['previous'],
        runtime: 'browser',
        indexFile: 'previous.html',
        version: '1.0.0',
        code: 'metafile://previous.zip',
        content: '',
        contentType: 'application/zip',
        codeType: 'application/zip',
        ownerGlobalMetaId: 'previous-owner',
        ownerAddress: 'previous-address',
        network: 'mvc',
        metawebUrl: `https://openagentinternet.org/browser/metaapp/${UPDATE_TARGET_PIN}`,
        updatedAt: 1,
        source: 'indexer',
      };
    },
  });

  const result = await updateMetaApp({
    projectDir,
    targetPinId: UPDATE_TARGET_PIN,
    confirm: true,
  }, deps);

  assert.equal(result.state, 'success');
  assert.equal(result.data.pinId, UPDATE_PIN);
  assert.equal(result.data.firstPinId, UPDATE_TARGET_PIN);
  assert.equal(result.data.metawebUrl, `https://openagentinternet.org/browser/metaapp/${UPDATE_TARGET_PIN}`);
  assert.equal(result.data.localUiUrl, `/ui/metaapps?pinId=${UPDATE_TARGET_PIN}`);
  assert.deepEqual(deps.calls.map((call) => call.type), ['upload', 'write', 'upsert']);
  assert.equal(deps.calls[1].input.operation, 'modify');
  assert.equal(deps.calls[1].input.path, `@${UPDATE_TARGET_PIN}`);

  const payload = writePayload(deps.calls);
  assert.equal(payload.title, 'Local Update Title');
  assert.equal(payload.appName, 'previous-app');
  assert.equal(payload.intro, 'Previous intro');
  assert.equal(payload.icon, 'previous-icon.png');
  assert.equal(payload.coverImg, 'previous-cover.png');
  assert.deepEqual(payload.tags, ['local']);
  assert.equal(payload.runtime, 'browser');
  assert.equal(payload.indexFile, 'previous.html');
  assert.equal(payload.content, 'metafile://upload-pin.zip');
  assert.equal(payload.code, '');
});

test('updateMetaApp continues with a warning when previous lookup fails', async () => {
  const projectDir = await makeProject('update-warning', {
    title: 'Warning Update',
    appName: 'warning-update',
  });
  const deps = createDeps({
    async readExistingMetaApp() {
      throw new Error('indexer unavailable');
    },
  });

  const result = await updateMetaApp({
    projectDir,
    targetPinId: UPDATE_TARGET_PIN,
    confirm: true,
  }, deps);

  assert.equal(result.state, 'success');
  assert.deepEqual(result.data.warnings, [
    {
      code: 'metaapp_previous_lookup_failed',
      message: 'Unable to inherit previous MetaApp metadata: indexer unavailable',
    },
  ]);
  assert.equal(writePayload(deps.calls).title, 'Warning Update');
});

test('file upload failure returns metaapp_upload_failed and skips chain write', async () => {
  const projectDir = await makeProject('upload-failure');
  const deps = createDeps({
    async uploadFile(input) {
      deps.calls.push({ type: 'upload', input });
      throw new Error('upload exploded');
    },
  });

  const result = await publishMetaApp({ projectDir, confirm: true }, deps);

  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'metaapp_upload_failed');
  assert.ok(result.data.archive);
  assert.equal(typeof result.data.archive.filePath, 'string');
  assert.deepEqual(deps.calls.map((call) => call.type), ['upload']);
});

test('file upload failure preserves structured feeAssist data', async () => {
  const projectDir = await makeProject('upload-failure-fee-assist');
  const deps = createDeps({
    async uploadFile(input) {
      deps.calls.push({ type: 'upload', input });
      const error = new Error('upload exploded');
      error.data = {
        feeAssist: {
          attempted: true,
          used: false,
          mode: 'mvc_sponsor_v2',
          sponsor: 'mvc_sponsor_v2',
          stage: 'commit',
          reason: 'commit_failed',
          orderId: 'order-1',
        },
      };
      throw error;
    },
  });

  const result = await publishMetaApp({ projectDir, confirm: true }, deps);

  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'metaapp_upload_failed');
  assert.ok(result.data.archive);
  assert.deepEqual(result.data.feeAssist, {
    attempted: true,
    used: false,
    mode: 'mvc_sponsor_v2',
    sponsor: 'mvc_sponsor_v2',
    stage: 'commit',
    reason: 'commit_failed',
    orderId: 'order-1',
  });
});

test('file upload failure ignores malformed feeAssist data', async () => {
  const projectDir = await makeProject('upload-failure-bad-fee-assist');
  const deps = createDeps({
    async uploadFile(input) {
      deps.calls.push({ type: 'upload', input });
      const error = new Error('upload exploded');
      error.data = {
        feeAssist: ['bad-shape'],
      };
      throw error;
    },
  });

  const result = await publishMetaApp({ projectDir, confirm: true }, deps);

  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'metaapp_upload_failed');
  assert.ok(result.data.archive);
  assert.equal('feeAssist' in result.data, false);
});

test('chain write failure returns metaapp_publish_failed and preserves upload evidence', async () => {
  const projectDir = await makeProject('write-failure');
  const deps = createDeps({
    async writeChain(input) {
      deps.calls.push({ type: 'write', input });
      throw new Error('chain exploded');
    },
  });

  const result = await publishMetaApp({ projectDir, confirm: true }, deps);

  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'metaapp_publish_failed');
  assert.equal(result.data.upload.metafileUri, 'metafile://upload-pin.zip');
  assert.deepEqual(deps.calls.map((call) => call.type), ['upload', 'write']);
});

test('publishMetaApp without local cache dependency fails before upload or write', async () => {
  const projectDir = await makeProject('missing-cache-publish');
  const deps = createDeps({ upsertLocal: undefined });

  const result = await publishMetaApp({ projectDir, confirm: true }, deps);

  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'metaapp_cache_unavailable');
  assert.deepEqual(deps.calls, []);
});

test('updateMetaApp without local cache dependency fails before upload or write', async () => {
  const projectDir = await makeProject('missing-cache-update');
  const deps = createDeps({ upsertLocal: undefined });

  const result = await updateMetaApp({
    projectDir,
    targetPinId: UPDATE_TARGET_PIN,
    confirm: true,
  }, deps);

  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'metaapp_cache_unavailable');
  assert.deepEqual(deps.calls, []);
});

test('publishMetaApp returns success with warning when local cache upsert fails after write', async () => {
  const projectDir = await makeProject('cache-warning-publish');
  const deps = createDeps({
    async upsertLocal(record) {
      deps.calls.push({ type: 'upsert', input: record });
      throw new Error('cache disk full');
    },
  });

  const result = await publishMetaApp({ projectDir, confirm: true }, deps);

  assert.equal(result.state, 'success');
  assert.equal(result.data.pinId, CREATE_PIN);
  assert.equal(result.data.chainWrite.pinId, CREATE_PIN);
  assert.equal(result.data.upload.metafileUri, 'metafile://upload-pin.zip');
  assert.equal(result.data.record.pinId, CREATE_PIN);
  assert.deepEqual(deps.calls.map((call) => call.type), ['upload', 'write', 'upsert']);
  assert.deepEqual(result.data.warnings, [
    {
      code: 'metaapp_local_cache_upsert_failed',
      message: 'Unable to update local MetaApp cache: cache disk full',
    },
  ]);
});

test('updateMetaApp returns success with warning when local cache upsert fails after write', async () => {
  const projectDir = await makeProject('cache-warning-update');
  const deps = createDeps({
    async upsertLocal(record) {
      deps.calls.push({ type: 'upsert', input: record });
      throw new Error('cache locked');
    },
  });

  const result = await updateMetaApp({
    projectDir,
    targetPinId: UPDATE_TARGET_PIN,
    confirm: true,
  }, deps);

  assert.equal(result.state, 'success');
  assert.equal(result.data.pinId, UPDATE_PIN);
  assert.equal(result.data.firstPinId, UPDATE_TARGET_PIN);
  assert.equal(result.data.chainWrite.pinId, UPDATE_PIN);
  assert.equal(result.data.record.pinId, UPDATE_PIN);
  assert.deepEqual(deps.calls.map((call) => call.type), ['upload', 'write', 'upsert']);
  assert.deepEqual(result.data.warnings, [
    {
      code: 'metaapp_local_cache_upsert_failed',
      message: 'Unable to update local MetaApp cache: cache locked',
    },
  ]);
});

test('shareMetaApp returns a pinId and canonical MetaWeb URL without writing', async () => {
  const deps = createDeps();

  const result = await shareMetaApp({ pinId: CREATE_PIN }, deps);

  assert.equal(result.state, 'success');
  assert.equal(result.data.pinId, CREATE_PIN);
  assert.equal(result.data.metawebUrl, `https://openagentinternet.org/browser/metaapp/${CREATE_PIN}`);
  assert.match(result.data.suggestedBuzz, /https:\/\/openagentinternet\.org\/browser\/metaapp\//);
  assert.deepEqual(deps.calls, []);
});

test('announceMetaAppShare builds simplebuzz with quotePin', async () => {
  const deps = createDeps();

  const result = await announceMetaAppShare({
    pinId: CREATE_PIN,
    message: 'Try this MetaApp',
    network: 'doge',
  }, deps);

  assert.equal(result.state, 'success');
  assert.equal(result.data.share.metawebUrl, `https://openagentinternet.org/browser/metaapp/${CREATE_PIN}`);
  assert.equal(result.data.announcement.pinId, BUZZ_PIN);
  assert.deepEqual(deps.calls, [
    {
      type: 'buzz',
      input: {
        content: 'Try this MetaApp',
        contentType: 'text/plain;utf-8',
        quotePin: CREATE_PIN,
        network: 'doge',
      },
    },
  ]);
});

test('commentMetaApp writes paycomment payload', async () => {
  const deps = createDeps();

  const result = await commentMetaApp({
    pinId: CREATE_PIN,
    comment: 'Great demo',
    network: 'btc',
  }, deps);

  assert.equal(result.state, 'success');
  assert.equal(result.data.commentPinId, COMMENT_PIN);
  assert.equal(result.data.commentTo, CREATE_PIN);
  assert.deepEqual(deps.calls.map((call) => call.type), ['write']);
  assert.equal(deps.calls[0].input.operation, 'create');
  assert.equal(deps.calls[0].input.path, '/protocols/paycomment');
  assert.equal(deps.calls[0].input.contentType, 'application/json');
  assert.equal(deps.calls[0].input.network, 'btc');
  assert.deepEqual(JSON.parse(deps.calls[0].input.payload), {
    content: 'Great demo',
    contentType: 'text/plain;utf-8',
    commentTo: CREATE_PIN,
  });
});
