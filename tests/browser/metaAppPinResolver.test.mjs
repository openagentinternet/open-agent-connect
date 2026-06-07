import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { commandFailed } = require('../../dist/core/contracts/commandResult.js');
const { resolveBrowserResource } = require('../../dist/core/browser/browserResolver.js');
const { resolveMetaAppPinToRecord } = require('../../dist/core/browser/metaAppPinResolver.js');
const { writeMetaAppZipArchive } = require('../../dist/core/metaapp/zipArchive.js');

const METAAPP_PIN_ID = '8544d8a15126296abe36a0bad740a4f293580575b5b00d345029bf99b74c78eci0';
const ZIP_PIN_ID = '6ea8a0bd0bac9a9c6cf4e035e9ce0a18e3a89f390c355dcc43074010fbee7ee7i0';

async function makeZipBuffer() {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'oac-metaapp-project-'));
  await mkdir(path.join(projectDir, 'app'), { recursive: true });
  await mkdir(path.join(projectDir, '__MACOSX'), { recursive: true });
  await writeFile(path.join(projectDir, 'app', 'index.html'), '<!doctype html><title>Music Player</title>');
  await writeFile(path.join(projectDir, 'app', 'player.js'), 'window.__musicPlayerLoaded = true;');
  await writeFile(path.join(projectDir, '__MACOSX', '._app'), 'metadata');
  const archivePath = path.join(await mkdtemp(path.join(os.tmpdir(), 'oac-metaapp-archive-')), 'metaapp.zip');
  await writeMetaAppZipArchive({ sourceDir: projectDir, outFile: archivePath });
  return readFile(archivePath);
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  };
}

function bufferResponse(buffer, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/zip' },
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

test('resolveMetaAppPinToRecord rejects pins whose path is not /protocols/metaapp', async () => {
  const result = await resolveMetaAppPinToRecord({
    pinId: METAAPP_PIN_ID,
    fetch: async (url) => {
      assert.equal(url, `https://manapi.metaid.io/pin/${METAAPP_PIN_ID}`);
      return jsonResponse({
        data: {
          path: '/protocols/simplebuzz',
          contentSummary: JSON.stringify({ content: 'hello' }),
        },
      });
    },
    createPreviewSession: () => {
      throw new Error('preview session should not be created for protocol mismatches');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'browser_protocol_mismatch');
  assert.match(result.message, /not a MetaApp/i);
});

test('resolveMetaAppPinToRecord downloads zip content and returns a local html iframe record', async () => {
  const zipBuffer = await makeZipBuffer();
  const extractDir = await mkdtemp(path.join(os.tmpdir(), 'oac-metaapp-extract-'));
  const calls = [];

  const result = await resolveMetaAppPinToRecord({
    pinId: METAAPP_PIN_ID,
    makeTempDir: async () => extractDir,
    fetch: async (url) => {
      calls.push(url);
      if (url === `https://manapi.metaid.io/pin/${METAAPP_PIN_ID}`) {
        return jsonResponse({
          data: {
            id: METAAPP_PIN_ID,
            path: '/protocols/metaapp',
            address: '1PublisherAddress',
            timestamp: 1780833765,
            contentSummary: JSON.stringify({
              title: 'KuwoMusic',
              appName: 'kuwo-music',
              version: '1.2.3',
              runtime: 'browser',
              content: `metafile://${ZIP_PIN_ID}.zip`,
              contentType: 'application/zip',
              indexFile: 'index.html',
            }),
          },
        });
      }
      if (url === `https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/${ZIP_PIN_ID}`) {
        return bufferResponse(zipBuffer);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    },
    createPreviewSession: async ({ artifactDir, indexFile }) => {
      assert.equal(artifactDir, path.join(extractDir, 'app'));
      assert.equal(indexFile, 'index.html');
      assert.equal(await readFile(path.join(artifactDir, indexFile), 'utf8'), '<!doctype html><title>Music Player</title>');
      return {
        previewId: 'metaapp-preview-test',
        localPreviewUrl: '/api/metaapp/preview-assets/metaapp-preview-test/index.html',
      };
    },
  });

  assert.deepEqual(calls, [
    `https://manapi.metaid.io/pin/${METAAPP_PIN_ID}`,
    `https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/${ZIP_PIN_ID}`,
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.data.pinId, METAAPP_PIN_ID);
  assert.equal(result.data.title, 'KuwoMusic');
  assert.equal(result.data.contentType, 'text/html');
  assert.equal(result.data.codeType, 'application/zip');
  assert.equal(result.data.content, `metafile://${ZIP_PIN_ID}.zip`);
  assert.equal(result.data.localUiUrl, '/api/metaapp/preview-assets/metaapp-preview-test/index.html');
});

test('resolveBrowserResource returns MetaApp resolver failures without falling back to indexer lookup', async () => {
  const result = await resolveBrowserResource({
    uri: `metaapp://${METAAPP_PIN_ID}`,
    config: {
      metasoP2PBaseUrl: '',
      defaultChainName: 'mvc',
      localMode: true,
    },
    metaAppLookup: async () => {
      throw new Error('legacy MetaApp lookup should not be called');
    },
    metaAppResolve: async () => commandFailed('browser_protocol_mismatch', 'Pin path does not match metaapp://.'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'browser_protocol_mismatch');
});
