import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildMetafileContentUrls } = require('../../dist/core/files/metafileUrls.js');
const { verifyMetafileAvailability } = require('../../dist/core/files/metafileVerifier.js');

test('buildMetafileContentUrls returns accelerated, canonical, and legacy content URLs', () => {
  assert.deepEqual(buildMetafileContentUrls('abc123i0'), {
    accelerateUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/abc123i0',
    contentUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/content/abc123i0',
    legacyContentUrl: 'https://file.metaid.io/metafile-indexer/content/abc123i0',
    previewUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/content/abc123i0',
    downloadUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/abc123i0',
  });
});

test('buildMetafileContentUrls URL-encodes pin ids', () => {
  const urls = buildMetafileContentUrls('abc 123/?i0');
  assert.match(urls.accelerateUrl, /abc%20123%2F%3Fi0$/);
  assert.match(urls.contentUrl, /abc%20123%2F%3Fi0$/);
  assert.match(urls.legacyContentUrl, /abc%20123%2F%3Fi0$/);
});

test('verifyMetafileAvailability succeeds on accelerated HEAD', async () => {
  const calls = [];
  const result = await verifyMetafileAvailability({
    pinId: 'abc123i0',
    attempts: 3,
    delayMs: 0,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      return { ok: true, status: 200 };
    },
  });

  assert.deepEqual(calls, [
    {
      url: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/abc123i0',
      method: 'HEAD',
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    url: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/abc123i0',
    attempts: 1,
  });
});

test('verifyMetafileAvailability falls back to canonical HEAD when accelerated fails', async () => {
  const calls = [];
  const result = await verifyMetafileAvailability({
    pinId: 'abc123i0',
    attempts: 2,
    delayMs: 0,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.includes('/accelerate/')) {
        throw new Error('accelerated unavailable');
      }
      return { ok: true, status: 200 };
    },
  });

  assert.deepEqual(calls, [
    {
      url: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/abc123i0',
      method: 'HEAD',
    },
    {
      url: 'https://file.metaid.io/metafile-indexer/api/v1/files/content/abc123i0',
      method: 'HEAD',
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    url: 'https://file.metaid.io/metafile-indexer/api/v1/files/content/abc123i0',
    attempts: 1,
  });
});

test('verifyMetafileAvailability falls back to GET when HEAD is method-not-allowed', async () => {
  const calls = [];
  const result = await verifyMetafileAvailability({
    pinId: 'abc123i0',
    attempts: 1,
    delayMs: 0,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (init?.method === 'HEAD') {
        return { ok: false, status: 405 };
      }
      return { ok: true, status: 200 };
    },
  });

  assert.deepEqual(calls, [
    {
      url: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/abc123i0',
      method: 'HEAD',
    },
    {
      url: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/abc123i0',
      method: 'GET',
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    url: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/abc123i0',
    attempts: 1,
  });
});

test('verifyMetafileAvailability returns bounded retry failures with the last error', async () => {
  let attempts = 0;
  const result = await verifyMetafileAvailability({
    pinId: 'abc123i0',
    attempts: 2,
    delayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      throw new Error('network down');
    },
  });

  assert.ok(attempts > 2);
  assert.deepEqual(result, {
    ok: false,
    url: null,
    attempts: 2,
    error: 'network down',
  });
});
