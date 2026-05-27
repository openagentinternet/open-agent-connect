import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  appendDeliveryArtifactSummaries,
  buildDeliveryArtifactSummary,
  extractDeliveryArtifactsFromText,
  inferDeliveryArtifactKind,
  normalizeDeliveryArtifacts,
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

  assert.equal(artifact.uri, 'metafile://abc123i0.mp4');
  assert.equal(artifact.pinId, 'abc123i0');
  assert.equal(artifact.extension, '.mp4');
  assert.equal(artifact.kind, 'video');
});

test('parseMetafileUri rejects slash-containing path-style metafile URIs', () => {
  assert.equal(parseMetafileUri('metafile:///tmp/oac/private/preview.png'), null);
  assert.equal(parseMetafileUri('metafile:///Users/example/private/preview.png'), null);
});

test('parseMetafileUri rejects backslash-containing Windows path-style metafile URIs', () => {
  assert.equal(parseMetafileUri('metafile://C:\\Users\\example\\secret\\preview.png'), null);
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

test('extractDeliveryArtifactsFromText ignores path-style metafile URIs', () => {
  const artifacts = extractDeliveryArtifactsFromText(
    'skip metafile:///tmp/oac/private/preview.png and metafile:///Users/example/private/preview.png',
  );

  assert.deepEqual(artifacts, []);
});

test('extractDeliveryArtifactsFromText ignores Windows path-style metafile URIs', () => {
  const artifacts = extractDeliveryArtifactsFromText(
    'skip metafile://C:\\Users\\example\\secret\\preview.png',
  );

  assert.deepEqual(artifacts, []);
});

test('normalizeDeliveryArtifacts preserves safe structured metadata and fills URL fields', () => {
  const artifacts = normalizeDeliveryArtifacts({
    artifacts: [
      {
        uri: 'metafile://abc123i0.mp4',
        fileName: 'clip.mp4',
        contentType: 'video/mp4',
        byteLength: 123,
      },
    ],
  });
  const urls = buildMetafileContentUrls('abc123i0');

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].uri, 'metafile://abc123i0.mp4');
  assert.equal(artifacts[0].pinId, 'abc123i0');
  assert.equal(artifacts[0].kind, 'video');
  assert.equal(artifacts[0].fileName, 'clip.mp4');
  assert.equal(artifacts[0].extension, '.mp4');
  assert.equal(artifacts[0].contentType, 'video/mp4');
  assert.equal(artifacts[0].byteLength, 123);
  assert.equal(artifacts[0].sourceUrl, urls.accelerateUrl);
  assert.equal(artifacts[0].fallbackUrl, urls.contentUrl);
  assert.equal(artifacts[0].downloadUrl, urls.accelerateUrl);
});

test('normalizeDeliveryArtifacts keeps URI-derived extension when structured metadata conflicts', () => {
  const artifacts = normalizeDeliveryArtifacts({
    artifacts: [
      {
        uri: 'metafile://abc123i0.mp4',
        extension: '.png',
        kind: 'image',
      },
    ],
  });

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].extension, '.mp4');
  assert.equal(artifacts[0].kind, 'video');
});

test('normalizeDeliveryArtifacts uses content type only as a kind hint', () => {
  const artifacts = normalizeDeliveryArtifacts({
    artifacts: [
      {
        uri: 'metafile://abc123i0.mp4',
        extension: '.png',
        contentType: 'image/png',
      },
    ],
  });

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].extension, '.mp4');
  assert.equal(artifacts[0].kind, 'image');
});

test('normalizeDeliveryArtifacts ignores path-like structured content types', () => {
  for (const contentType of [
    '/tmp/private/file.png',
    './private/file.png',
    '../private/file.png',
    'file:///Users/example/secret/file.png',
    'C:\\Users\\example\\secret\\file.png',
  ]) {
    const artifact = normalizeDeliveryArtifacts({
      artifacts: [
        {
          uri: 'metafile://abc123i0.mp4',
          contentType,
        },
      ],
    })[0];
    const summary = buildDeliveryArtifactSummary(artifact);

    assert.equal(artifact.contentType, null);
    assert.equal(artifact.kind, 'video');
    assert.doesNotMatch(summary, /Content-Type:/);
    assert.doesNotMatch(summary, /\/tmp\/private/);
    assert.doesNotMatch(summary, /file:\/\/\/Users\/example\/secret/);
    assert.doesNotMatch(summary, /C:\\Users\\example\\secret/);
  }
});

test('normalizeDeliveryArtifacts keeps valid structured content types as kind hints', () => {
  const artifact = normalizeDeliveryArtifacts({
    artifacts: [
      {
        uri: 'metafile://abc123i0.bin',
        contentType: 'image/png',
      },
    ],
  })[0];
  const summary = buildDeliveryArtifactSummary(artifact);

  assert.equal(artifact.extension, '.bin');
  assert.equal(artifact.contentType, 'image/png');
  assert.equal(artifact.kind, 'image');
  assert.match(summary, /Content-Type: image\/png/);
});

test('normalizeDeliveryArtifacts ignores malformed structured entries', () => {
  const artifacts = normalizeDeliveryArtifacts({
    artifacts: [
      null,
      'metafile://string-entry-is-not-structured.mp4',
      { uri: '' },
      { uri: 'https://example.test/not-a-metafile.mp4' },
      { uri: 'metafile://' },
      { uri: 'metafile:///tmp/oac/private/preview.png' },
      { uri: 'metafile:///Users/example/private/preview.png' },
      { uri: 'metafile://C:\\Users\\example\\secret\\preview.png' },
      { uri: 'metafile://validi0.png' },
    ],
  });

  assert.deepEqual(
    artifacts.map((artifact) => artifact.uri),
    ['metafile://validi0.png'],
  );
});

test('normalizeDeliveryArtifacts canonicalizes structured URIs before summaries', () => {
  const artifact = normalizeDeliveryArtifacts({
    artifacts: [{ uri: 'metafile://abc123i0.png?local=/Users/example/secret.png' }],
  })[0];
  const summary = buildDeliveryArtifactSummary(artifact);

  assert.equal(artifact.uri, 'metafile://abc123i0.png');
  assert.match(summary, /metafile:\/\/abc123i0\.png/);
  assert.doesNotMatch(summary, /\/Users\/example\/secret\.png/);
});

test('normalizeDeliveryArtifacts ignores Windows path-style URI text and structured entries', () => {
  const artifacts = normalizeDeliveryArtifacts({
    artifacts: [{ uri: 'metafile://C:\\Users\\example\\secret\\preview.png' }],
    resultText: 'Generated metafile://C:\\Users\\example\\secret\\preview.png',
  });
  const response = appendDeliveryArtifactSummaries('No public artifact.', artifacts);

  assert.deepEqual(artifacts, []);
  assert.equal(response, 'No public artifact.');
  assert.doesNotMatch(response, /C:\\Users\\example\\secret/);
});

test('normalizeDeliveryArtifacts merges structured entries and text fallback entries with dedupe', () => {
  const artifacts = normalizeDeliveryArtifacts({
    artifacts: [{ uri: 'metafile://onei0.mp4', fileName: 'one.mp4' }],
    resultText: 'Generated metafile://onei0.mp4 and metafile://twoi0.png',
  });

  assert.deepEqual(
    artifacts.map((artifact) => artifact.uri),
    ['metafile://onei0.mp4', 'metafile://twoi0.png'],
  );
  assert.equal(artifacts[0].fileName, 'one.mp4');
  assert.equal(artifacts[1].kind, 'image');
});

test('buildDeliveryArtifactSummary includes public artifact fields', () => {
  const urls = buildMetafileContentUrls('abc123i0');
  const artifact = normalizeDeliveryArtifacts({
    artifacts: [
      {
        uri: 'metafile://abc123i0.mp4',
        fileName: 'clip.mp4',
        contentType: 'video/mp4',
        byteLength: 123,
      },
    ],
  })[0];
  const summary = buildDeliveryArtifactSummary(artifact);

  assert.match(summary, /metafile:\/\/abc123i0\.mp4/);
  assert.match(summary, /abc123i0/);
  assert.match(summary, /clip\.mp4/);
  assert.match(summary, /video\/mp4/);
  assert.match(summary, /123 bytes/);
  assert.match(summary, new RegExp(urls.accelerateUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('buildDeliveryArtifactSummary sanitizes unnormalized artifact input', () => {
  const urls = buildMetafileContentUrls('abc123i0');
  const summary = buildDeliveryArtifactSummary({
    uri: 'metafile://abc123i0.mp4?local=/Users/example/secret.mp4#preview',
    pinId: '/Users/example/secret',
    kind: 'video',
    fileName: '/tmp/oac/private/clip.mp4?token=secret#hash',
    extension: '.mp4',
    contentType: 'file:///Users/example/secret/type.mp4',
    byteLength: -1,
    sourceUrl: '/tmp/oac/private/source.mp4',
    fallbackUrl: 'file:///Users/example/secret/fallback.mp4',
    downloadUrl: 'C:\\Users\\example\\secret\\download.mp4',
  });

  assert.match(summary, /Artifact: metafile:\/\/abc123i0\.mp4/);
  assert.match(summary, /PINID: abc123i0/);
  assert.match(summary, /File: clip\.mp4/);
  assert.match(
    summary,
    new RegExp(`Download: ${urls.accelerateUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  assert.doesNotMatch(summary, /Content-Type:/);
  assert.doesNotMatch(summary, /Size:/);
  assert.doesNotMatch(summary, /\?local=/);
  assert.doesNotMatch(summary, /#preview/);
  assert.doesNotMatch(summary, /token=secret/);
  assert.doesNotMatch(summary, /\/tmp\/oac\/private/);
  assert.doesNotMatch(summary, /\/Users\/example\/secret/);
  assert.doesNotMatch(summary, /file:\/\/\/Users\/example\/secret/);
  assert.doesNotMatch(summary, /C:\\Users\\example\\secret/);
});

test('normalizeDeliveryArtifacts ignores structured URL fields that could expose local paths', () => {
  const urls = buildMetafileContentUrls('abc123i0');
  const artifact = normalizeDeliveryArtifacts({
    artifacts: [
      {
        uri: 'metafile://abc123i0.mp4',
        sourceUrl: '/tmp/oac/private/source.mp4',
        fallbackUrl: 'file:///Users/example/secret/fallback.mp4',
        downloadUrl: 'C:\\Users\\example\\secret\\download.mp4',
      },
    ],
  })[0];
  const summary = buildDeliveryArtifactSummary(artifact);

  assert.equal(artifact.sourceUrl, urls.accelerateUrl);
  assert.equal(artifact.fallbackUrl, urls.contentUrl);
  assert.equal(artifact.downloadUrl, urls.accelerateUrl);
  assert.match(summary, new RegExp(urls.accelerateUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(summary, /\/tmp\/oac\/private/);
  assert.doesNotMatch(summary, /file:\/\/\/Users\/example\/secret/);
  assert.doesNotMatch(summary, /C:\\Users\\example\\secret/);
});

test('delivery artifact normalization and summaries never include local filesystem paths', () => {
  const artifact = normalizeDeliveryArtifacts({
    artifacts: [
      {
        uri: 'metafile://abc123i0.png',
        fileName: '/tmp/oac/private/preview.png',
        localPath: '/tmp/oac/private/preview.png',
        path: '/Users/example/secret/preview.png',
        absolutePath: 'C:\\Users\\example\\secret\\preview.png',
      },
    ],
  })[0];
  const summary = buildDeliveryArtifactSummary(artifact);

  assert.equal(artifact.fileName, 'preview.png');
  assert.equal(Object.hasOwn(artifact, 'localPath'), false);
  assert.equal(Object.hasOwn(artifact, 'path'), false);
  assert.equal(Object.hasOwn(artifact, 'absolutePath'), false);
  assert.doesNotMatch(summary, /\/tmp\/oac\/private/);
  assert.doesNotMatch(summary, /\/Users\/example\/secret/);
  assert.doesNotMatch(summary, /C:\\Users\\example\\secret/);
});

test('appendDeliveryArtifactSummaries preserves response text and appends summaries after blank lines', () => {
  const artifacts = normalizeDeliveryArtifacts({
    artifacts: [
      {
        uri: 'metafile://abc123i0.mp4',
        fileName: 'clip.mp4',
        contentType: 'video/mp4',
        byteLength: 123,
      },
    ],
  });
  const response = appendDeliveryArtifactSummaries('Here is your file.', artifacts);

  assert.match(response, /^Here is your file\.\n\nArtifact:/);
  assert.match(response, /metafile:\/\/abc123i0\.mp4/);
  assert.match(response, /clip\.mp4/);
});

test('appendDeliveryArtifactSummaries preserves trailing response whitespace', () => {
  const artifacts = normalizeDeliveryArtifacts({
    artifacts: [{ uri: 'metafile://abc123i0.mp4' }],
  });
  const responseText = 'Here is your file.\n  ';
  const response = appendDeliveryArtifactSummaries(responseText, artifacts);

  assert.ok(response.startsWith(`${responseText}\n\nArtifact:`));
});
