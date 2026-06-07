import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildMetaAppArtifactCacheKey,
  createMetaAppArtifactCacheStore,
} = require('../../dist/core/metaapp/artifactCache.js');
const { writeMetaAppZipArchive } = require('../../dist/core/metaapp/zipArchive.js');

const METAAPP_PIN_ID = '8544d8a15126296abe36a0bad740a4f293580575b5b00d345029bf99b74c78eci0';
const CONTENT_REFERENCE = 'metafile://70f901eb41cd81d2ff1675624dad43ebf4eb151acbdbb8515e7131ddd8976361i0';

async function makeProfileRoot(systemHome, slug) {
  const profileRoot = path.join(systemHome, '.metabot', 'profiles', slug);
  await mkdir(profileRoot, { recursive: true });
  return profileRoot;
}

async function makeZipBuffer(title) {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'oac-metaapp-artifact-project-'));
  await mkdir(path.join(projectDir, 'bundle'), { recursive: true });
  await writeFile(path.join(projectDir, 'bundle', 'index.html'), `<!doctype html><title>${title}</title>`);
  await writeFile(path.join(projectDir, 'bundle', 'app.js'), `window.__title = ${JSON.stringify(title)};`);
  const archivePath = path.join(await mkdtemp(path.join(os.tmpdir(), 'oac-metaapp-artifact-archive-')), 'metaapp.zip');
  await writeMetaAppZipArchive({ sourceDir: projectDir, outFile: archivePath });
  return readFile(archivePath);
}

test('artifact cache root is shared across profiles under ~/.metabot/cache/metaapps', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'oac-metaapp-shared-cache-'));
  const alice = createMetaAppArtifactCacheStore(await makeProfileRoot(systemHome, 'alice'));
  const bob = createMetaAppArtifactCacheStore(await makeProfileRoot(systemHome, 'bob'));

  assert.equal(alice.cacheRoot, path.join(systemHome, '.metabot', 'cache', 'metaapps'));
  assert.equal(bob.cacheRoot, alice.cacheRoot);
  assert.notEqual(alice.cacheRoot, path.join(systemHome, '.metabot', 'profiles', 'alice', '.runtime', 'cache', 'metaapps'));
});

test('artifact cache writes extracted app once and reuses it across profiles', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'oac-metaapp-artifact-cache-'));
  const alice = createMetaAppArtifactCacheStore(await makeProfileRoot(systemHome, 'alice'), { now: () => 1000 });
  const bob = createMetaAppArtifactCacheStore(await makeProfileRoot(systemHome, 'bob'), { now: () => 2000 });
  const descriptor = {
    metaAppPinId: METAAPP_PIN_ID,
    contentReference: CONTENT_REFERENCE,
    contentType: 'application/zip',
    indexFile: 'index.html',
    modifyHistory: null,
  };

  const written = await alice.writeArtifact({
    ...descriptor,
    archive: await makeZipBuffer('Cached Music Player'),
  });
  const hit = await bob.getArtifact(descriptor);

  assert.equal(written.cacheKey, buildMetaAppArtifactCacheKey(descriptor));
  assert.equal(hit?.cacheKey, written.cacheKey);
  assert.equal(hit?.artifactDir, written.artifactDir);
  assert.equal(await readFile(path.join(hit.artifactDir, 'index.html'), 'utf8'), '<!doctype html><title>Cached Music Player</title>');
  assert.equal(JSON.parse(await readFile(path.join(alice.artifactsRoot, written.cacheKey, 'manifest.json'), 'utf8')).lastUsedAt, 2000);
});

test('artifact cache misses when current effective content reference changes', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'oac-metaapp-artifact-cache-miss-'));
  const store = createMetaAppArtifactCacheStore(await makeProfileRoot(systemHome, 'alice'));
  const descriptor = {
    metaAppPinId: METAAPP_PIN_ID,
    contentReference: CONTENT_REFERENCE,
    contentType: 'application/zip',
    indexFile: 'index.html',
    modifyHistory: null,
  };
  await store.writeArtifact({
    ...descriptor,
    archive: await makeZipBuffer('Version One'),
  });

  const changed = await store.getArtifact({
    ...descriptor,
    contentReference: 'metafile://288e9e918800863de1444b1d98bec9f081619102fdee35d93ca653e7f677ffdei0',
    modifyHistory: [
      METAAPP_PIN_ID,
      'd824a3a27638cc8f0aaea8eeb3b49eb4e40914c1f94171712e37c095c970b736i0',
    ],
  });

  assert.equal(changed, null);
});
