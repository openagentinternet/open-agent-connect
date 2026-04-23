import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildProfileAliases,
  detectAmbiguousProfileNameMatch,
  generateProfileSlug,
  normalizeProfileLookupKey,
  resolveProfileNameMatch,
  scoreProfileNameCandidate,
} = require('../../dist/core/identity/profileNameResolution.js');

function createProfile(name, slug = generateProfileSlug(name), aliases = buildProfileAliases(name, slug)) {
  return {
    name,
    slug,
    aliases,
    homeDir: `/tmp/${slug}`,
    globalMetaId: '',
    mvcAddress: '',
    createdAt: 1,
    updatedAt: 1,
  };
}

test('lookup-key normalization and slugging collapse superficial display-name differences', () => {
  const variants = [
    'Charles Zhang',
    'Charles_Zhang',
    'Chärles Zhang',
    'Charles Zhang 🤖',
  ];

  for (const variant of variants) {
    assert.equal(normalizeProfileLookupKey(variant), 'charles zhang');
    assert.equal(generateProfileSlug(variant), 'charles-zhang');
  }
});

test('empty or punctuation-only names fall back to deterministic mb-hash slugs', () => {
  const emptySlug = generateProfileSlug('   ');
  const punctuationSlug = generateProfileSlug('!!! 🤖 ...');

  assert.match(emptySlug, /^mb-[a-f0-9]{8}$/);
  assert.match(punctuationSlug, /^mb-[a-f0-9]{8}$/);
  assert.equal(generateProfileSlug('   '), emptySlug);
  assert.equal(generateProfileSlug('!!! 🤖 ...'), punctuationSlug);
});

test('alias builder preserves original, normalized, and slug aliases without duplicates', () => {
  assert.deepEqual(
    buildProfileAliases('Charles Zhang', 'charles-zhang'),
    ['Charles Zhang', 'charles zhang', 'charles-zhang'],
  );
});

test('resolver prefers exact slug, display-name normalization, then deterministic ranked matching', () => {
  const profiles = [
    createProfile('Charles Zhang'),
    createProfile('Charles Zhao'),
    createProfile('Alice Example'),
  ];

  const slugMatch = resolveProfileNameMatch('charles-zhang', profiles);
  assert.equal(slugMatch.status, 'matched');
  assert.equal(slugMatch.match.slug, 'charles-zhang');
  assert.equal(slugMatch.matchType, 'exact_slug');

  const normalizedNameMatch = resolveProfileNameMatch('Charles_Zhang 🤖', profiles);
  assert.equal(normalizedNameMatch.status, 'matched');
  assert.equal(normalizedNameMatch.match.slug, 'charles-zhang');
  assert.equal(normalizedNameMatch.matchType, 'exact_name');

  const fuzzyMatch = resolveProfileNameMatch('Alic Examp', profiles);
  assert.equal(fuzzyMatch.status, 'matched');
  assert.equal(fuzzyMatch.match.slug, 'alice-example');
  assert.equal(fuzzyMatch.matchType, 'ranked');
  assert.ok(fuzzyMatch.score > 0);
});

test('best-match scoring exposes deterministic ties for near-equal candidates', () => {
  const query = 'Charles Zh';
  const first = createProfile('Charles Zhang');
  const second = createProfile('Charles Zhao');

  const firstScore = scoreProfileNameCandidate(query, first);
  const secondScore = scoreProfileNameCandidate(query, second);

  assert.equal(firstScore.score, secondScore.score);
  assert.equal(detectAmbiguousProfileNameMatch([firstScore, secondScore]), true);

  const resolved = resolveProfileNameMatch(query, [first, second]);
  assert.equal(resolved.status, 'ambiguous');
  assert.match(resolved.message, /ambiguous/i);
  assert.deepEqual(
    resolved.candidates.map((candidate) => candidate.slug),
    ['charles-zhang', 'charles-zhao'],
  );
});
