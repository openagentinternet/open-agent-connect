import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * MetaTask conformance gate (P2): the registered vector sets (v1.2.1 + the
 * v1.3.0 competitive draft) replay through the OAC engine copy, and the
 * three-engine anchor digest must match
 * 726959e97e354b1489c2baa4923702193e0b1ce38871cfc1bca830eb9e9dcfd0.
 * The fixtures are byte-identical to the IDBots / on-chain copies — any drift
 * in engine behavior or fixture bytes fails here.
 */

const here = path.dirname(new URL(import.meta.url).pathname);
const ANCHOR_SHA256 = '726959e97e354b1489c2baa4923702193e0b1ce38871cfc1bca830eb9e9dcfd0';

test('conformance: fixtures are byte-identical to the IDBots source of truth', () => {
  for (const name of ['conformance-vectors.json', 'conformance-vectors-v13-draft.json']) {
    const bytes = readFileSync(path.join(here, '..', 'fixtures', 'metatask', name));
    const digest = createHash('sha256').update(bytes).digest('hex');
    const expected = name === 'conformance-vectors.json'
      ? 'f8396fe28ccea2c20f075b845d662237127ce299fecad279f4d2e097b9df4c0c'
      : '5b594b1e0c5f426ed5f05a6060fe2864f82043f0f75be2c56c49232516717f8d';
    assert.equal(digest, expected, `${name} drifted from the registered bytes`);
  }
});

test('conformance: 16/16 + 11/11 vectors pass and the anchor digest matches', () => {
  const stdout = execFileSync(process.execPath, [path.join(here, '..', '..', 'scripts', 'metatask-vectors.mjs')], {
    encoding: 'utf8',
  });
  const passes = (stdout.match(/^PASS /gm) ?? []).length;
  const failures = (stdout.match(/^FAIL /gm) ?? []).length;
  assert.equal(failures, 0, `vector failures:\n${stdout}`);
  assert.equal(passes, 27, '16 registered + 11 draft vectors');
  assert.match(stdout, /vectors: 16  failed: 0/);
  assert.match(stdout, /draft vectors: 11  failed: 0/);
  assert.match(stdout, new RegExp(`CANONICAL_SHA256 ${ANCHOR_SHA256}\\n`), 'three-engine anchor digest must not drift');
});
