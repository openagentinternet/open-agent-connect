import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';
import { createProfileHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createMetaAppArtifactCacheStore } = require('../../dist/core/metaapp/artifactCache.js');
const { materializeMetaAppSource } = require('../../dist/core/metaapp/metaAppSource.js');
const { writeMetaAppZipArchive } = require('../../dist/core/metaapp/zipArchive.js');

const VALID_PIN_ID = `${'a1b2c3d4'.repeat(8)}i0`;
const MAN_API_BASE_URL = 'http://man.test';
const NOW_MS = 1_700_000_000_000;

const PROTOCOL = {
  title: 'Pomodoro Timer',
  appName: 'pomodoro-timer',
  runtime: 'browser',
  version: '1.0.0',
  content: 'http://content.test/app.zip',
  contentType: 'application/zip',
  indexFile: 'index.html',
  tags: ['tool', 'timer'],
};

function pinRecordResponse(protocol = PROTOCOL, pinExtras = {}) {
  return {
    path: '/protocols/metaapp',
    contentSummary: JSON.stringify(protocol),
    timestamp: 1_700_000_000,
    ...pinExtras,
  };
}

function okJson(body) {
  return { ok: true, status: 200, json: async () => body };
}

function fetchForPin(protocol = PROTOCOL, pinExtras = {}) {
  return async (url) => {
    if (url === `${MAN_API_BASE_URL}/pin/${VALID_PIN_ID}`) {
      return okJson(pinRecordResponse(protocol, pinExtras));
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

async function makeSourceTree() {
  const sourceDir = await mkdtempTempRoot('metabot-metaapp-source-tree-');
  await mkdir(path.join(sourceDir, 'assets'), { recursive: true });
  await writeFile(path.join(sourceDir, 'index.html'), '<h1>Pomodoro</h1>');
  await writeFile(path.join(sourceDir, 'assets', 'app.js'), 'console.log("pomodoro");');
  return sourceDir;
}

async function makeArchiveBuffer(sourceDir) {
  const archiveRoot = await mkdtempTempRoot('metabot-metaapp-source-zip-');
  const archive = await writeMetaAppZipArchive({
    sourceDir,
    outFile: path.join(archiveRoot, 'app.zip'),
  });
  return readFile(archive.filePath);
}

async function seedArtifactCache(homeDir, sourceDir, overrides = {}) {
  const archive = await makeArchiveBuffer(sourceDir);
  const cache = createMetaAppArtifactCacheStore(homeDir);
  const descriptor = {
    metaAppPinId: VALID_PIN_ID,
    contentReference: PROTOCOL.content,
    contentType: PROTOCOL.contentType,
    indexFile: PROTOCOL.indexFile,
    ...overrides,
  };
  const entry = await cache.writeArtifact({ ...descriptor, archive });
  return { cache, descriptor, entry };
}

test('materializeMetaAppSource resolves from the artifact cache without downloading', async () => {
  const homeDir = await createProfileHome('metabot-metaapp-source-cache-');
  const sourceDir = await makeSourceTree();
  const { entry } = await seedArtifactCache(homeDir, sourceDir);

  const result = await materializeMetaAppSource(
    { pinId: VALID_PIN_ID },
    { homeDir, fetch: fetchForPin(), manApiBaseUrl: MAN_API_BASE_URL, now: () => NOW_MS },
  );

  assert.equal(result.ok, true);
  assert.equal(result.state, 'success');
  assert.equal(result.data.dir, entry.artifactDir);
  assert.equal(result.data.indexFile, 'index.html');
  assert.equal(result.data.title, 'Pomodoro Timer');
  assert.equal(result.data.sourcePinId, VALID_PIN_ID);
  assert.equal('sourceUri' in result.data, false);
  assert.ok(existsSync(path.join(result.data.dir, 'index.html')));
});

test('materializeMetaAppSource downloads the archive on a cache miss and --out copies it with a fork marker', async () => {
  const homeDir = await createProfileHome('metabot-metaapp-source-out-');
  const sourceDir = await makeSourceTree();
  const archive = await makeArchiveBuffer(sourceDir);

  const fetch = async (url) => {
    if (url === `${MAN_API_BASE_URL}/pin/${VALID_PIN_ID}`) {
      return okJson(pinRecordResponse());
    }
    if (url === PROTOCOL.content) {
      return { ok: true, status: 200, arrayBuffer: async () => archive };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const outDir = path.join(homeDir, 'workspace', 'my-remix');
  const result = await materializeMetaAppSource(
    { pinId: VALID_PIN_ID, outDir },
    { homeDir, fetch, manApiBaseUrl: MAN_API_BASE_URL, now: () => NOW_MS },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.dir, outDir);
  assert.equal(result.data.indexFile, 'index.html');
  assert.equal(result.data.title, 'Pomodoro Timer');
  assert.equal(result.data.sourcePinId, VALID_PIN_ID);
  assert.equal(result.data.sourceUri, `metaapp://${VALID_PIN_ID}`);
  assert.equal(result.data.markerPath, path.join(outDir, '.metaapp-fork.json'));

  // The source tree is copied into the output directory.
  assert.equal(await readFile(path.join(outDir, 'index.html'), 'utf8'), '<h1>Pomodoro</h1>');
  assert.equal(await readFile(path.join(outDir, 'assets', 'app.js'), 'utf8'), 'console.log("pomodoro");');

  // The provenance marker records fork lineage for the publish flow.
  const marker = JSON.parse(await readFile(result.data.markerPath, 'utf8'));
  assert.deepEqual(marker, {
    sourcePinId: VALID_PIN_ID,
    sourceUri: `metaapp://${VALID_PIN_ID}`,
    title: 'Pomodoro Timer',
    indexFile: 'index.html',
    tags: ['tool', 'timer'],
    forkedAt: new Date(NOW_MS).toISOString(),
  });

  // The download populated the shared artifact cache.
  const stats = await createMetaAppArtifactCacheStore(homeDir).getStats();
  assert.equal(stats.artifactCount, 1);
});

test('materializeMetaAppSource rejects an invalid pinId before any fetch', async () => {
  const homeDir = await createProfileHome('metabot-metaapp-source-invalid-');
  let fetched = false;
  const result = await materializeMetaAppSource(
    { pinId: 'not-a-pin' },
    {
      homeDir,
      fetch: async () => {
        fetched = true;
        throw new Error('must not fetch');
      },
      manApiBaseUrl: MAN_API_BASE_URL,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_argument');
  assert.equal(fetched, false);
});

test('materializeMetaAppSource maps pin resolution failures to CLI codes', async () => {
  const homeDir = await createProfileHome('metabot-metaapp-source-errors-');

  const notFound = await materializeMetaAppSource(
    { pinId: VALID_PIN_ID },
    {
      homeDir,
      fetch: async () => ({ ok: false, status: 404 }),
      manApiBaseUrl: MAN_API_BASE_URL,
    },
  );
  assert.equal(notFound.ok, false);
  assert.equal(notFound.code, 'metaapp_not_found');

  const protocolMismatch = await materializeMetaAppSource(
    { pinId: VALID_PIN_ID },
    {
      homeDir,
      fetch: fetchForPin(PROTOCOL, { path: '/protocols/simplebuzz' }),
      manApiBaseUrl: MAN_API_BASE_URL,
    },
  );
  assert.equal(protocolMismatch.ok, false);
  assert.equal(protocolMismatch.code, 'metaapp_protocol_mismatch');

  const disabled = await materializeMetaAppSource(
    { pinId: VALID_PIN_ID },
    {
      homeDir,
      fetch: fetchForPin({ ...PROTOCOL, disabled: true }),
      manApiBaseUrl: MAN_API_BASE_URL,
    },
  );
  assert.equal(disabled.ok, false);
  assert.equal(disabled.code, 'metaapp_disabled');
});

test('materializeMetaAppSource rejects non-zip packages and download failures', async () => {
  const homeDir = await createProfileHome('metabot-metaapp-source-content-');

  const nonZip = await materializeMetaAppSource(
    { pinId: VALID_PIN_ID },
    {
      homeDir,
      fetch: fetchForPin({ ...PROTOCOL, content: 'metafile://abc123.txt', contentType: 'text/plain' }),
      manApiBaseUrl: MAN_API_BASE_URL,
    },
  );
  assert.equal(nonZip.ok, false);
  assert.equal(nonZip.code, 'metaapp_source_unsupported');

  const downloadFailed = await materializeMetaAppSource(
    { pinId: VALID_PIN_ID },
    {
      homeDir,
      fetch: async (url) => {
        if (url === `${MAN_API_BASE_URL}/pin/${VALID_PIN_ID}`) {
          return okJson(pinRecordResponse());
        }
        return { ok: false, status: 502 };
      },
      manApiBaseUrl: MAN_API_BASE_URL,
    },
  );
  assert.equal(downloadFailed.ok, false);
  assert.equal(downloadFailed.code, 'metaapp_source_download_failed');
});

test('materializeMetaAppSource forks from the artifact cache when pin fetch fails', async () => {
  const homeDir = await createProfileHome('metabot-metaapp-source-cache-fetch-fail-');
  const sourceDir = await makeSourceTree();
  const { entry } = await seedArtifactCache(homeDir, sourceDir);
  const outDir = path.join(homeDir, 'workspace', 'cached-remix');

  const result = await materializeMetaAppSource(
    { pinId: VALID_PIN_ID, outDir },
    {
      homeDir,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
      manApiBaseUrl: MAN_API_BASE_URL,
      now: () => NOW_MS,
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.dir, outDir);
  assert.equal(result.data.indexFile, entry.indexFile);
  assert.equal(result.data.sourcePinId, VALID_PIN_ID);
  assert.equal(await readFile(path.join(outDir, 'index.html'), 'utf8'), '<h1>Pomodoro</h1>');
  assert.ok(existsSync(path.join(outDir, '.metaapp-fork.json')));
});

test('materializeMetaAppSource refuses a non-empty --out directory', async () => {
  const homeDir = await createProfileHome('metabot-metaapp-source-clobber-');
  const sourceDir = await makeSourceTree();
  await seedArtifactCache(homeDir, sourceDir);

  const outDir = path.join(homeDir, 'occupied');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'keep.txt'), 'do not touch');

  const result = await materializeMetaAppSource(
    { pinId: VALID_PIN_ID, outDir },
    { homeDir, fetch: fetchForPin(), manApiBaseUrl: MAN_API_BASE_URL },
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'metaapp_source_out_not_empty');
  assert.equal(await readFile(path.join(outDir, 'keep.txt'), 'utf8'), 'do not touch');
});
