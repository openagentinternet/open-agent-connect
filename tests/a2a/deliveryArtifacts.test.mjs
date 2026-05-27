import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  extractDeliveryArtifactsFromText,
  inferDeliveryArtifactKind,
  parseMetafileUri,
} = require('../../dist/core/a2a/deliveryArtifacts.js');
const { buildMetafileContentUrls } = require('../../dist/core/files/metafileUrls.js');

test('parseMetafileUri parses image metafile URIs', () => {
  const artifact = parseMetafileUri('metafile://abc123i0.png');

  assert.equal(artifact.pinId, 'abc123i0');
  assert.equal(artifact.extension, '.png');
  assert.equal(artifact.kind, 'image');
});

test('inferDeliveryArtifactKind classifies video extensions', () => {
  for (const extension of ['.mp4', '.webm', '.mov', '.m4v']) {
    assert.equal(inferDeliveryArtifactKind(extension), 'video');
  }
});

test('inferDeliveryArtifactKind classifies audio extensions', () => {
  for (const extension of ['.mp3', '.wav', '.ogg', '.flac', '.m4a']) {
    assert.equal(inferDeliveryArtifactKind(extension), 'audio');
  }
});

test('inferDeliveryArtifactKind classifies unknown extensions as file', () => {
  assert.equal(inferDeliveryArtifactKind('.zip'), 'file');
  assert.equal(inferDeliveryArtifactKind(null), 'file');
});

test('inferDeliveryArtifactKind lets content types override weak or missing extension data', () => {
  assert.equal(inferDeliveryArtifactKind('.bin', 'image/png'), 'image');
  assert.equal(inferDeliveryArtifactKind(null, 'video/mp4'), 'video');
  assert.equal(inferDeliveryArtifactKind('.txt', 'audio/mpeg'), 'audio');
});

test('parseMetafileUri strips trailing punctuation from text URIs', () => {
  const artifact = parseMetafileUri(' metafile://abc123i0.png),.;:!? ');

  assert.equal(artifact.uri, 'metafile://abc123i0.png');
  assert.equal(artifact.pinId, 'abc123i0');
  assert.equal(artifact.extension, '.png');
});

test('parseMetafileUri keeps query and hash data out of pin and extension parsing', () => {
  const artifact = parseMetafileUri('metafile://abc123i0.mp4?download=1#preview');

  assert.equal(artifact.uri, 'metafile://abc123i0.mp4?download=1#preview');
  assert.equal(artifact.pinId, 'abc123i0');
  assert.equal(artifact.extension, '.mp4');
  assert.equal(artifact.kind, 'video');
});

test('extractDeliveryArtifactsFromText dedupes URIs while preserving first-seen order', () => {
  const artifacts = extractDeliveryArtifactsFromText(
    'first metafile://onei0.png second metafile://twoi0.mp4 duplicate metafile://onei0.png!',
  );

  assert.deepEqual(
    artifacts.map((artifact) => artifact.uri),
    ['metafile://onei0.png', 'metafile://twoi0.mp4'],
  );
});

test('extractDeliveryArtifactsFromText normalizes wrapped metafile URIs', () => {
  const artifacts = extractDeliveryArtifactsFromText(
    '[metafile://abc123i0.png] `metafile://abc123i0.png` {metafile://abc123i0.png}',
  );

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].uri, 'metafile://abc123i0.png');
  assert.equal(artifacts[0].extension, '.png');
  assert.equal(artifacts[0].kind, 'image');
});

test('parseMetafileUri derives file-indexer URLs from buildMetafileContentUrls', () => {
  const artifact = parseMetafileUri('metafile://abc123i0.mp4');
  const urls = buildMetafileContentUrls('abc123i0');

  assert.equal(artifact.sourceUrl, urls.accelerateUrl);
  assert.equal(artifact.fallbackUrl, urls.contentUrl);
  assert.equal(artifact.downloadUrl, urls.accelerateUrl);
});

test('invalid or empty metafile URIs return null or an empty array', () => {
  assert.equal(parseMetafileUri(''), null);
  assert.equal(parseMetafileUri('https://example.test/abc123i0.png'), null);
  assert.equal(parseMetafileUri('metafile://'), null);
  assert.deepEqual(extractDeliveryArtifactsFromText('no metafile URI here'), []);
  assert.deepEqual(extractDeliveryArtifactsFromText(''), []);
});
