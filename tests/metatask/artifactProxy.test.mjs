import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  fetchMetafileContent,
  normalizeMetafileReference,
} = require('../../dist/core/metatask/artifactProxy.js');

/**
 * Metafile artifact proxy (M9): reference normalization (bare/suffixed/URI
 * forms), chunked-upload reassembly in listed order with the manifest
 * sha256 gate, inline small files, and the never-serve-tampered-bytes rule.
 */

/** Unique pin per test — the proxy caches resolved content by pin id. */
const pinOf = (char, tag = 'i0') => char.repeat(64) + tag;
const PIN = pinOf('a');
const CHUNK_1 = pinOf('b');
const CHUNK_2 = pinOf('c');

test('proxy: reference normalization accepts the three URI forms', () => {
  assert.equal(normalizeMetafileReference(`metafile://${PIN}`), PIN);
  assert.equal(normalizeMetafileReference(`metafile://${PIN}.gz`), PIN, 'suffixed form resolves by the bare pin');
  assert.equal(normalizeMetafileReference(`https://manapi.metaid.io/content/${PIN}`), PIN);
  assert.equal(normalizeMetafileReference(PIN), PIN);
  assert.equal(normalizeMetafileReference('not-a-pin'), null);
  assert.equal(normalizeMetafileReference(''), null);
});

test('proxy: chunked uploads reassemble in listed order and pass the sha256 gate', async () => {
  const part1 = Buffer.from('HELLO-');
  const part2 = Buffer.from('WORLD-');
  const part3 = Buffer.from('6488396');
  const whole = Buffer.concat([part1, part2, part3]);
  const manifest = {
    sha256: createHash('sha256').update(whole).digest('hex'),
    fileSize: whole.length,
    chunkNumber: 3,
    chunkSize: 6,
    dataType: 'application/gzip',
    name: 's5-release.tar.gz',
    chunkList: [
      { sha256: createHash('sha256').update(part1).digest('hex'), pinId: CHUNK_1 },
      { sha256: createHash('sha256').update(part2).digest('hex'), pinId: CHUNK_2 },
      { sha256: createHash('sha256').update(part3).digest('hex'), pinId: 'd'.repeat(64) + 'i0' },
    ],
  };
  const bodies = new Map([
    [PIN, JSON.stringify(manifest)],
    [CHUNK_1, part1],
    [CHUNK_2, part2],
    ['d'.repeat(64) + 'i0', part3],
  ]);
  const fetchImpl = fakeContentHost(bodies);
  const resolved = await fetchMetafileContent(`metafile://${PIN}.gz`, { fetchImpl });
  assert.ok(resolved);
  assert.deepEqual(resolved.body, whole, 'chunks concatenated in listed order');
  assert.equal(resolved.contentType, 'application/gzip');
  assert.equal(resolved.fileName, 's5-release.tar.gz');
  assert.equal(resolved.sha256, manifest.sha256);
});

test('proxy: a tampered chunk fails the sha256 gate and serves nothing', async () => {
  const PIN = pinOf('e');
  const CHUNK_1 = pinOf('f');
  const part1 = Buffer.from('GOOD');
  const whole = part1;
  const manifest = {
    sha256: createHash('sha256').update(Buffer.from('EVIL')).digest('hex'),
    fileSize: whole.length,
    chunkNumber: 1,
    chunkSize: 4,
    dataType: 'text/plain',
    name: 'x.txt',
    chunkList: [{ sha256: createHash('sha256').update(part1).digest('hex'), pinId: CHUNK_1 }],
  };
  const bodies = new Map([[PIN, JSON.stringify(manifest)], [CHUNK_1, part1]]);
  const resolved = await fetchMetafileContent(PIN, { fetchImpl: fakeContentHost(bodies) });
  assert.equal(resolved, null, 'bytes that fail the manifest digest are never served');
});

test('proxy: inline small files serve without a manifest', async () => {
  const PIN = pinOf('7');
  const inline = Buffer.from('plain artifact bytes');
  const bodies = new Map([[PIN, inline]]);
  const fetchImpl = async (url) => {
    const pin = String(url).split('/').pop();
    const body = bodies.get(pin) ?? Buffer.alloc(0);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
  };
  const resolved = await fetchMetafileContent(`metafile://${PIN}`, { fetchImpl });
  assert.ok(resolved);
  assert.deepEqual(resolved.body, inline);
  assert.equal(resolved.contentType, 'application/octet-stream');
});

test('proxy: an unknown pin answers null, never throws', async () => {
  const PIN = pinOf('9');
  const fetchImpl = async () => new Response('not found', { status: 404 });
  assert.equal(await fetchMetafileContent(PIN, { fetchImpl }), null);
});

/** Minimal fake content host keyed by pin id. */
function fakeContentHost(bodies) {
  return async (url) => {
    const pin = String(url).split('/').pop();
    const body = bodies.get(pin);
    if (body === undefined) return new Response('not found', { status: 404 });
    const isJson = !(body instanceof Buffer);
    return new Response(body, {
      status: 200,
      headers: { 'content-type': isJson ? 'application/json' : 'application/octet-stream' },
    });
  };
}
