import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  buildSimpleNotePayload,
  publishSimpleNote,
  formatSimpleNoteResult,
  resolveSimpleNoteFileReference,
  SimpleNoteError,
} = require('../../dist/core/simplenote/publish.js');
const {
  isPathInsideDir,
  checkUploadAllowed,
  wrapUploadWithGate,
} = require('../../dist/core/files/chainUploadGate.js');

function fakeSigner() {
  const pins = [];
  return {
    pins,
    signer: {
      async writePin(request) {
        pins.push(request);
        return { pinId: 'note-pin-1', txids: ['tx-1'], totalCost: 4200, network: request.network ?? 'mvc', globalMetaId: 'IDQ1' };
      },
    },
  };
}

function recordingUpload() {
  const calls = [];
  return {
    calls,
    upload: async ({ filePath, network }) => {
      calls.push({ filePath, network });
      return { metafileUri: `metafile://up-${calls.length}` };
    },
  };
}

test('simplenote payload follows the verified on-chain 1.0.1 shape', () => {
  const payload = JSON.parse(buildSimpleNotePayload({
    title: 'T', content: 'Body', subtitle: 'S', coverImg: 'metafile://c',
    contentType: 'text/markdown', tags: [' a ', '', 'b'], attachments: ['metafile://x'], createTime: 1787000000123,
  }));
  assert.deepEqual(payload, {
    title: 'T',
    subtitle: 'S',
    coverImg: 'metafile://c',
    contentType: 'text/markdown',
    content: 'Body',
    encryption: '0',
    createTime: 1787000000123,
    tags: ['a', 'b'],
    attachments: ['metafile://x'],
  });
  // Defaults when optional fields are absent.
  const minimal = JSON.parse(buildSimpleNotePayload({ title: 'T', content: 'B', createTime: 1 }));
  assert.equal(minimal.contentType, 'text/markdown');
  assert.equal(minimal.subtitle, '');
  assert.deepEqual(minimal.tags, []);
});

test('publishSimpleNote uploads local files, keeps metafile URIs, writes the pin', async () => {
  const systemHome = mkdtempTempRootSync('metabot-simplenote-');
  const workDir = path.join(systemHome, 'work');
  mkdirSync(workDir, { recursive: true });
  const coverPath = path.join(workDir, 'cover.png');
  writeFileSync(coverPath, 'png');

  const { signer, pins } = fakeSigner();
  const { calls, upload } = recordingUpload();
  const result = await publishSimpleNote(signer, upload, {
    title: 'Guide',
    content: '# Hi',
    cover: coverPath,
    attachments: [coverPath, 'metafile://existing'],
    tags: ['guide'],
    network: 'dogge' === 'dogge' ? 'doge' : 'mvc',
  });

  // DOGE note: files upload on MVC only.
  assert.deepEqual(calls.map((call) => call.network), ['mvc', 'mvc']);
  assert.equal(calls.length, 2);
  // Relative paths are rejected outright before any upload.
  await assert.rejects(
    publishSimpleNote(signer, upload, { title: 't', content: 'c', attachments: ['not-absolute'] }),
    (error) => error instanceof SimpleNoteError && /ABSOLUTE/.test(error.message),
  );
  assert.equal(result.pinId, 'note-pin-1');
  assert.equal(result.coverImg, 'metafile://up-1');
  assert.deepEqual(result.attachments, ['metafile://up-2', 'metafile://existing']);

  const write = pins[0];
  assert.equal(write.path, '/protocols/simplenote');
  assert.equal(write.version, '1.0.1');
  assert.equal(write.contentType, 'application/json');
  assert.equal(write.operation, 'create');
  assert.equal(write.network, 'doge');
  const payload = JSON.parse(write.payload);
  assert.equal(payload.title, 'Guide');
  assert.equal(payload.coverImg, 'metafile://up-1');
  assert.ok(Number.isFinite(payload.createTime));

  await assert.rejects(
    publishSimpleNote(signer, upload, { title: '', content: 'x' }),
    (error) => error instanceof SimpleNoteError,
  );
});

test('resolveSimpleNoteFileReference errors are agent-readable', async () => {
  const { upload } = recordingUpload();
  const relative = await resolveSimpleNoteFileReference({ upload, network: 'mvc', raw: './x.png', field: 'cover' });
  assert.match(relative.error, /ABSOLUTE local file paths/);
  const missing = await resolveSimpleNoteFileReference({
    upload, network: 'mvc', raw: '/tmp/definitely-missing-simplenote-xyz.png', field: 'cover',
  });
  assert.match(missing.error, /file not found/);
  const passthrough = await resolveSimpleNoteFileReference({
    upload, network: 'mvc', raw: ' metafile://keep ', field: 'cover',
  });
  assert.equal(passthrough.uri, 'metafile://keep');
});

test('formatSimpleNoteResult quotes a pin:// view link', () => {
  const sheet = formatSimpleNoteResult({
    pinId: 'p1', txids: ['tx1'], totalCost: 99, title: 'T', coverImg: 'metafile://c', attachments: ['metafile://a'],
  });
  assert.match(sheet, /Note published on-chain\./);
  assert.match(sheet, /- view link: \[pin:\/\/p1\]\(pin:\/\/p1\)/);
});

test('chain upload gate: symlink-aware containment, decline blocks before upload', async () => {
  const systemHome = mkdtempTempRootSync('metabot-gate-');
  const workspace = path.join(systemHome, 'workspace');
  const secretDir = path.join(systemHome, 'secret');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(secretDir, { recursive: true });
  const secretFile = path.join(secretDir, 'id_rsa');
  writeFileSync(secretFile, 'key');
  const link = path.join(workspace, 'leak');
  symlinkSync(secretFile, link);
  const insideFile = path.join(workspace, 'doc.png');
  writeFileSync(insideFile, 'png');

  assert.equal(isPathInsideDir(insideFile, workspace), true);
  assert.equal(isPathInsideDir(link, workspace), false, 'symlink escaping the workspace counts as outside');
  assert.equal(isPathInsideDir(secretFile, workspace), false);

  const asked = [];
  let approve = true;
  const deps = {
    getWorkspaceDir: () => workspace,
    confirmExternalUpload: async (files) => {
      asked.push(...files);
      return approve;
    },
  };
  assert.equal(await checkUploadAllowed(insideFile, deps), null, 'in-workspace file never asks');
  assert.equal(await checkUploadAllowed(link, deps), null, 'approved external file passes');

  approve = false;
  const denied = await checkUploadAllowed(secretFile, deps);
  assert.match(denied, /Owner declined/);
  assert.deepEqual(asked, [link, secretFile]);

  const uploads = [];
  const gated = wrapUploadWithGate(async ({ filePath }) => {
    uploads.push(filePath);
    return { metafileUri: 'metafile://ok' };
  }, deps);
  await assert.rejects(gated({ filePath: secretFile }), /Owner declined/);
  assert.deepEqual(uploads, [], 'no bytes leave the machine on decline');
  await gated({ filePath: insideFile });
  assert.deepEqual(uploads, [insideFile]);

  // No host deps -> ungated legacy behavior.
  assert.equal(await checkUploadAllowed(secretFile, {}), null);
  rmSync(systemHome, { recursive: true, force: true });
});
