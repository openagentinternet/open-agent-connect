import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createMetaAppPreviewSessionRegistry,
  inferMetaAppPreviewMimeType,
} = require('../../dist/core/metaapp/previewSessions.js');

async function makeArtifactDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), `metabot-metaapp-preview-${prefix}-`));
}

async function writeArtifactFile(artifactDir, relativePath, content) {
  const filePath = path.join(artifactDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

async function rejectsWithCode(fn, code) {
  await assert.rejects(
    fn,
    (error) => {
      assert.equal(error.code, code);
      return true;
    },
  );
}

test('createMetaAppPreviewSession returns a stable opaque previewId', async () => {
  const artifactDir = await makeArtifactDir('stable-id');
  await writeArtifactFile(artifactDir, 'index.html', '<h1>Preview</h1>');
  const registry = createMetaAppPreviewSessionRegistry({
    now: () => 1_700_000_000_000,
  });

  const session = registry.create({ artifactDir, indexFile: 'index.html' });
  const asset = await registry.resolveAsset({ previewId: session.previewId, assetPath: '' });

  assert.match(session.previewId, /^metaapp-preview-[a-z0-9-]+$/);
  assert.equal(session.previewId.includes(artifactDir), false);
  assert.equal(session.previewId.includes('index.html'), false);
  assert.equal(asset.previewId, session.previewId);
  assert.equal(asset.filePath, path.join(artifactDir, 'index.html'));
  assert.equal(session.localPreviewUrl, `/api/metaapp/preview-assets/${session.previewId}/`);
});

test('preview asset resolution serves files only from the selected artifact directory', async () => {
  const projectDir = await makeArtifactDir('selected-artifact');
  const artifactDir = path.join(projectDir, 'dist');
  await mkdir(artifactDir, { recursive: true });
  await writeArtifactFile(artifactDir, 'assets/app.css', 'body { color: black; }');
  await writeFile(path.join(projectDir, 'secret.txt'), 'do not serve');
  const registry = createMetaAppPreviewSessionRegistry();
  const session = registry.create({ artifactDir, indexFile: 'index.html' });

  const asset = await registry.resolveAsset({
    previewId: session.previewId,
    assetPath: 'assets/app.css',
  });

  assert.equal(asset.filePath, path.join(artifactDir, 'assets/app.css'));
  assert.equal(asset.body.toString('utf8'), 'body { color: black; }');
  await rejectsWithCode(
    () => registry.resolveAsset({ previewId: session.previewId, assetPath: '../secret.txt' }),
    'invalid_preview_asset_path',
  );
});

test('preview asset resolution rejects symlinks that resolve outside the artifact directory', async (t) => {
  const artifactDir = await makeArtifactDir('symlink-escape');
  const outsideDir = await makeArtifactDir('symlink-outside');
  const outsideFile = await writeArtifactFile(outsideDir, 'secret.txt', 'do not serve through symlink');
  await writeArtifactFile(artifactDir, 'index.html', '<h1>Safe</h1>');
  try {
    await symlink(outsideFile, path.join(artifactDir, 'linked-secret.txt'));
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOTSUP'].includes(error.code)) {
      t.skip(`symlink creation is not supported in this environment: ${error.code}`);
      return;
    }
    throw error;
  }

  const registry = createMetaAppPreviewSessionRegistry();
  const session = registry.create({ artifactDir, indexFile: 'index.html' });

  await rejectsWithCode(
    () => registry.resolveAsset({ previewId: session.previewId, assetPath: 'linked-secret.txt' }),
    'invalid_preview_asset_path',
  );
});

test('path traversal attempts fail with invalid_preview_asset_path', async () => {
  const artifactDir = await makeArtifactDir('traversal');
  await writeArtifactFile(artifactDir, 'index.html', '<h1>Safe</h1>');
  const registry = createMetaAppPreviewSessionRegistry();
  const session = registry.create({ artifactDir, indexFile: 'index.html' });

  for (const assetPath of ['../secret.txt', 'assets/../../secret.txt', '/tmp/secret.txt', 'assets\\..\\secret.txt']) {
    await rejectsWithCode(
      () => registry.resolveAsset({ previewId: session.previewId, assetPath }),
      'invalid_preview_asset_path',
    );
  }
});

test('blank asset paths resolve to the detected indexFile', async () => {
  const artifactDir = await makeArtifactDir('blank-index');
  await writeArtifactFile(artifactDir, 'nested/app.html', '<h1>Nested app</h1>');
  const registry = createMetaAppPreviewSessionRegistry();
  const session = registry.create({ artifactDir, indexFile: 'nested/app.html' });

  const asset = await registry.resolveAsset({ previewId: session.previewId, assetPath: '   ' });

  assert.equal(asset.filePath, path.join(artifactDir, 'nested/app.html'));
  assert.equal(asset.contentType, 'text/html; charset=utf-8');
});

test('MIME inference covers browser assets and binary fallback', () => {
  assert.equal(inferMetaAppPreviewMimeType('index.html'), 'text/html; charset=utf-8');
  assert.equal(inferMetaAppPreviewMimeType('styles.css'), 'text/css; charset=utf-8');
  assert.equal(inferMetaAppPreviewMimeType('app.js'), 'application/javascript; charset=utf-8');
  assert.equal(inferMetaAppPreviewMimeType('data.json'), 'application/json; charset=utf-8');
  assert.equal(inferMetaAppPreviewMimeType('icon.svg'), 'image/svg+xml; charset=utf-8');
  assert.equal(inferMetaAppPreviewMimeType('image.png'), 'image/png');
  assert.equal(inferMetaAppPreviewMimeType('photo.jpg'), 'image/jpeg');
  assert.equal(inferMetaAppPreviewMimeType('photo.jpeg'), 'image/jpeg');
  assert.equal(inferMetaAppPreviewMimeType('image.webp'), 'image/webp');
  assert.equal(inferMetaAppPreviewMimeType('asset.bin'), 'application/octet-stream');
});
