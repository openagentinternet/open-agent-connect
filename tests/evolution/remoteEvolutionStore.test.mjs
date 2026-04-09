import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createRemoteEvolutionStore } = require('../../dist/core/evolution/remoteEvolutionStore.js');

function createScope() {
  return {
    allowedCommands: ['metabot network services --online', 'metabot ui open --page hub'],
    chainRead: true,
    chainWrite: false,
    localUiOpen: true,
    remoteDelegation: false,
  };
}

function createArtifactRecord() {
  return {
    variantId: 'variant-1',
    skillName: 'metabot-network-directory',
    status: 'inactive',
    scope: createScope(),
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash: 'scope-hash-v1',
    },
    patch: {
      instructionsPatch: 'Read machine output first and only open UI when explicitly requested.',
    },
    lineage: {
      lineageId: 'lineage-1',
      parentVariantId: null,
      rootVariantId: 'variant-1',
      executionId: 'exec-1',
      analysisId: 'analysis-1',
      createdAt: 1_744_444_445_500,
    },
    verification: {
      passed: true,
      checkedAt: 1_744_444_446_000,
      protocolCompatible: true,
      replayValid: true,
      notWorseThanBase: true,
      notes: 'fixture replay no longer fails',
    },
    adoption: 'manual',
    createdAt: 1_744_444_446_500,
    updatedAt: 1_744_444_446_500,
  };
}

function createSidecarRecord() {
  return {
    pinId: 'pin-1',
    variantId: 'variant-1',
    publisherGlobalMetaId: 'idqpublisher',
    artifactUri: 'metafile://artifact-1.json',
    skillName: 'metabot-network-directory',
    scopeHash: 'scope-hash-v1',
    publishedAt: 1_775_701_234_567,
    importedAt: 1_775_702_345_678,
  };
}

test('resolveMetabotPaths includes remote evolution roots and index file under ~/.metabot/evolution/remote', () => {
  const paths = resolveMetabotPaths('/tmp/home');
  assert.equal(paths.evolutionRemoteRoot, path.join('/tmp/home', '.metabot', 'evolution', 'remote'));
  assert.equal(
    paths.evolutionRemoteArtifactsRoot,
    path.join('/tmp/home', '.metabot', 'evolution', 'remote', 'artifacts')
  );
  assert.equal(
    paths.evolutionRemoteIndexPath,
    path.join('/tmp/home', '.metabot', 'evolution', 'remote', 'index.json')
  );
});

test('remote evolution store bootstraps an empty index for a new layout', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-remote-evolution-store-'));
  const store = createRemoteEvolutionStore(homeDir);

  const index = await store.readIndex();
  assert.deepEqual(index, {
    schemaVersion: 1,
    imports: [],
    byVariantId: {},
  });
});

test('remote evolution store writes artifact, sidecar, and canonical remote index', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-remote-evolution-store-'));
  const store = createRemoteEvolutionStore(homeDir);
  const artifact = createArtifactRecord();
  const sidecar = createSidecarRecord();

  const result = await store.writeImport({
    artifact,
    sidecar,
  });

  const artifactPath = path.join(store.paths.evolutionRemoteArtifactsRoot, `${artifact.variantId}.json`);
  const metadataPath = path.join(store.paths.evolutionRemoteArtifactsRoot, `${artifact.variantId}.meta.json`);

  assert.equal(result.artifactPath, artifactPath);
  assert.equal(result.metadataPath, metadataPath);
  assert.deepEqual(JSON.parse(readFileSync(artifactPath, 'utf8')), artifact);
  assert.deepEqual(JSON.parse(readFileSync(metadataPath, 'utf8')), sidecar);
  assert.deepEqual(result.index, {
    schemaVersion: 1,
    imports: [artifact.variantId],
    byVariantId: {
      [artifact.variantId]: {
        variantId: artifact.variantId,
        pinId: sidecar.pinId,
      },
    },
  });
  assert.deepEqual(JSON.parse(readFileSync(store.paths.evolutionRemoteIndexPath, 'utf8')), result.index);
});

test('remote evolution store rejects duplicate variantId without overwriting existing files', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-remote-evolution-store-'));
  const store = createRemoteEvolutionStore(homeDir);
  const originalArtifact = createArtifactRecord();
  const originalSidecar = createSidecarRecord();

  await store.writeImport({
    artifact: originalArtifact,
    sidecar: originalSidecar,
  });

  const changedArtifact = {
    ...originalArtifact,
    patch: {
      instructionsPatch: 'malicious overwrite',
    },
  };
  const changedSidecar = {
    ...originalSidecar,
    pinId: 'pin-overwrite',
    artifactUri: 'metafile://artifact-overwrite.json',
  };

  await assert.rejects(
    store.writeImport({
      artifact: changedArtifact,
      sidecar: changedSidecar,
    }),
    /already imported/i
  );

  const artifactPath = path.join(store.paths.evolutionRemoteArtifactsRoot, `${originalArtifact.variantId}.json`);
  const metadataPath = path.join(store.paths.evolutionRemoteArtifactsRoot, `${originalArtifact.variantId}.meta.json`);
  assert.deepEqual(JSON.parse(readFileSync(artifactPath, 'utf8')), originalArtifact);
  assert.deepEqual(JSON.parse(readFileSync(metadataPath, 'utf8')), originalSidecar);
});

test('remote evolution store repairs imports list from byVariantId when index disagrees', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-remote-evolution-store-'));
  const store = createRemoteEvolutionStore(homeDir);
  await store.ensureLayout();

  writeFileSync(
    store.paths.evolutionRemoteIndexPath,
    `${JSON.stringify({
      schemaVersion: 1,
      imports: ['wrong-order', 'missing-entry'],
      byVariantId: {
        'variant-b': {
          variantId: 'variant-b',
          pinId: 'pin-b',
        },
        'variant-a': {
          variantId: 'variant-a',
          pinId: 'pin-a',
        },
      },
    })}\n`,
    'utf8'
  );

  const repaired = await store.readIndex();
  assert.deepEqual(repaired.imports, ['variant-a', 'variant-b']);
  assert.deepEqual(JSON.parse(readFileSync(store.paths.evolutionRemoteIndexPath, 'utf8')), repaired);
});

test('remote evolution store rejects filename-unsafe variant identifiers', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-remote-evolution-store-'));
  const store = createRemoteEvolutionStore(homeDir);
  const artifact = createArtifactRecord();
  const sidecar = createSidecarRecord();

  await assert.rejects(
    store.writeImport({
      artifact: {
        ...artifact,
        variantId: '../escape',
      },
      sidecar,
    }),
    /Invalid variantId/
  );

  await assert.rejects(store.readArtifact('/tmp/escape'), /Invalid variantId/);
  await assert.rejects(store.readSidecar('nested/path'), /Invalid variantId/);
});
