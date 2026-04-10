import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createRemoteEvolutionStore } = require('../../dist/core/evolution/remoteEvolutionStore.js');
const { listImportedEvolutionArtifacts } = require('../../dist/core/evolution/import/listImportedArtifacts.js');

function createScope() {
  return {
    allowedCommands: ['metabot network services --online', 'metabot ui open --page hub'],
    chainRead: true,
    chainWrite: false,
    localUiOpen: true,
    remoteDelegation: false,
  };
}

function createArtifactRecord(overrides = {}) {
  const variantId = overrides.variantId ?? 'variant-1';
  const scopeHash = overrides.scopeHash ?? `scope-${variantId}`;
  const verification = overrides.verification ?? {};
  return {
    variantId,
    skillName: 'metabot-network-directory',
    status: 'inactive',
    scope: createScope(),
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash,
    },
    patch: {
      instructionsPatch: `patch-${variantId}`,
    },
    lineage: {
      lineageId: `lineage-${variantId}`,
      parentVariantId: null,
      rootVariantId: variantId,
      executionId: `exec-${variantId}`,
      analysisId: `analysis-${variantId}`,
      createdAt: 1_766_000_000_000,
    },
    verification: {
      passed: verification.passed ?? true,
      checkedAt: 1_766_000_000_100,
      protocolCompatible: true,
      replayValid: verification.replayValid ?? true,
      notWorseThanBase: verification.notWorseThanBase ?? true,
      notes: `notes-${variantId}`,
    },
    adoption: 'manual',
    createdAt: 1_766_000_000_200,
    updatedAt: 1_766_000_000_200,
  };
}

function createSidecarRecord(overrides = {}) {
  const variantId = overrides.variantId ?? 'variant-1';
  const scopeHash = overrides.scopeHash ?? `scope-${variantId}`;
  return {
    pinId: overrides.pinId ?? `pin-${variantId}`,
    variantId,
    publisherGlobalMetaId: overrides.publisherGlobalMetaId ?? `idq://publisher-${variantId}`,
    artifactUri: overrides.artifactUri ?? `metafile://${variantId}.json`,
    skillName: 'metabot-network-directory',
    scopeHash,
    publishedAt: overrides.publishedAt ?? 1_766_100_000_000,
    importedAt: overrides.importedAt ?? 1_766_100_100_000,
  };
}

function assertFailureCode(error, expectedCode) {
  assert.equal(error instanceof Error, true);
  const errorCode = error.code;
  if (typeof errorCode === 'string') {
    assert.equal(errorCode, expectedCode);
    return true;
  }
  assert.match(error.message, new RegExp(expectedCode));
  return true;
}

test('lists imported remote artifacts from local files with stable sort and active annotation', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-list-imported-'));
  const remoteStore = createRemoteEvolutionStore(homeDir);

  const variants = [
    {
      variantId: 'variant-z',
      importedAt: 1_766_111_000_000,
      publishedAt: 1_766_110_000_000,
      verification: { passed: false, replayValid: true, notWorseThanBase: true },
    },
    {
      variantId: 'variant-a',
      importedAt: 1_766_111_000_000,
      publishedAt: 1_766_109_000_000,
      verification: { passed: true, replayValid: false, notWorseThanBase: true },
    },
    {
      variantId: 'variant-b',
      importedAt: 1_766_100_000_000,
      publishedAt: 1_766_108_000_000,
      verification: { passed: true, replayValid: true, notWorseThanBase: false },
    },
  ];

  for (const fixture of variants) {
    const scopeHash = `scope-${fixture.variantId}`;
    await remoteStore.writeImport({
      artifact: createArtifactRecord({
        variantId: fixture.variantId,
        scopeHash,
        verification: fixture.verification,
      }),
      sidecar: createSidecarRecord({
        variantId: fixture.variantId,
        scopeHash,
        pinId: `pin-${fixture.variantId}`,
        publisherGlobalMetaId: `idq://publisher-${fixture.variantId}`,
        artifactUri: `metafile://${fixture.variantId}.json`,
        importedAt: fixture.importedAt,
        publishedAt: fixture.publishedAt,
      }),
    });
  }

  const result = await listImportedEvolutionArtifacts({
    skillName: 'metabot-network-directory',
    activeRef: {
      source: 'remote',
      variantId: 'variant-z',
    },
    remoteStore,
  });

  assert.equal(result.skillName, 'metabot-network-directory');
  assert.equal(result.count, 3);
  assert.deepEqual(
    result.results.map((row) => row.variantId),
    ['variant-a', 'variant-z', 'variant-b']
  );
  assert.deepEqual(result.results, [
    {
      variantId: 'variant-a',
      pinId: 'pin-variant-a',
      skillName: 'metabot-network-directory',
      publisherGlobalMetaId: 'idq://publisher-variant-a',
      artifactUri: 'metafile://variant-a.json',
      publishedAt: 1_766_109_000_000,
      importedAt: 1_766_111_000_000,
      scopeHash: 'scope-variant-a',
      verificationPassed: true,
      replayValid: false,
      notWorseThanBase: true,
      active: false,
    },
    {
      variantId: 'variant-z',
      pinId: 'pin-variant-z',
      skillName: 'metabot-network-directory',
      publisherGlobalMetaId: 'idq://publisher-variant-z',
      artifactUri: 'metafile://variant-z.json',
      publishedAt: 1_766_110_000_000,
      importedAt: 1_766_111_000_000,
      scopeHash: 'scope-variant-z',
      verificationPassed: false,
      replayValid: true,
      notWorseThanBase: true,
      active: true,
    },
    {
      variantId: 'variant-b',
      pinId: 'pin-variant-b',
      skillName: 'metabot-network-directory',
      publisherGlobalMetaId: 'idq://publisher-variant-b',
      artifactUri: 'metafile://variant-b.json',
      publishedAt: 1_766_108_000_000,
      importedAt: 1_766_100_000_000,
      scopeHash: 'scope-variant-b',
      verificationPassed: true,
      replayValid: true,
      notWorseThanBase: false,
      active: false,
    },
  ]);
});

test('listing imported artifacts is currently supported only for metabot-network-directory', async () => {
  await assert.rejects(
    listImportedEvolutionArtifacts({
      skillName: 'metabot-trace-inspector',
      activeRef: null,
      remoteStore: {
        async readIndex() {
          throw new Error('should not read remote index for unsupported skill');
        },
        async readArtifact() {
          throw new Error('should not read artifacts for unsupported skill');
        },
        async readSidecar() {
          throw new Error('should not read sidecars for unsupported skill');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_imported_not_supported')
  );
});

test('index pinId mismatch with sidecar pinId returns evolution_imported_artifact_invalid', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-list-imported-'));
  const remoteStore = createRemoteEvolutionStore(homeDir);
  await remoteStore.writeImport({
    artifact: createArtifactRecord({
      variantId: 'variant-pin-mismatch',
      scopeHash: 'scope-pin-mismatch',
    }),
    sidecar: createSidecarRecord({
      variantId: 'variant-pin-mismatch',
      scopeHash: 'scope-pin-mismatch',
      pinId: 'pin-sidecar-canonical',
    }),
  });

  const rawIndex = JSON.parse(readFileSync(remoteStore.paths.evolutionRemoteIndexPath, 'utf8'));
  rawIndex.byVariantId['variant-pin-mismatch'].pinId = 'pin-index-corrupted';
  writeFileSync(remoteStore.paths.evolutionRemoteIndexPath, `${JSON.stringify(rawIndex, null, 2)}\n`, 'utf8');

  await assert.rejects(
    listImportedEvolutionArtifacts({
      skillName: 'metabot-network-directory',
      activeRef: null,
      remoteStore,
    }),
    (error) => assertFailureCode(error, 'evolution_imported_artifact_invalid')
  );
});

test('missing imported files are skipped when other valid imported variants remain', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-list-imported-'));
  const remoteStore = createRemoteEvolutionStore(homeDir);
  await remoteStore.writeImport({
    artifact: createArtifactRecord({
      variantId: 'variant-valid',
      scopeHash: 'scope-valid',
    }),
    sidecar: createSidecarRecord({
      variantId: 'variant-valid',
      scopeHash: 'scope-valid',
      importedAt: 1_766_121_000_000,
      publishedAt: 1_766_111_000_000,
    }),
  });
  await remoteStore.writeImport({
    artifact: createArtifactRecord({
      variantId: 'variant-missing',
      scopeHash: 'scope-missing',
    }),
    sidecar: createSidecarRecord({
      variantId: 'variant-missing',
      scopeHash: 'scope-missing',
      importedAt: 1_766_122_000_000,
      publishedAt: 1_766_112_000_000,
    }),
  });

  rmSync(path.join(remoteStore.paths.evolutionRemoteArtifactsRoot, 'variant-missing.json'));

  const result = await listImportedEvolutionArtifacts({
    skillName: 'metabot-network-directory',
    activeRef: {
      source: 'remote',
      variantId: 'variant-missing',
    },
    remoteStore,
  });

  assert.equal(result.count, 1);
  assert.deepEqual(result.results.map((row) => row.variantId), ['variant-valid']);
  assert.equal(result.results[0].active, false);
});

test('malformed sidecar returns evolution_imported_artifact_invalid', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-list-imported-'));
  const remoteStore = createRemoteEvolutionStore(homeDir);
  await remoteStore.writeImport({
    artifact: createArtifactRecord({
      variantId: 'variant-sidecar-bad',
      scopeHash: 'scope-sidecar-bad',
    }),
    sidecar: createSidecarRecord({
      variantId: 'variant-sidecar-bad',
      scopeHash: 'scope-sidecar-bad',
    }),
  });

  const sidecarPath = path.join(remoteStore.paths.evolutionRemoteArtifactsRoot, 'variant-sidecar-bad.meta.json');
  writeFileSync(sidecarPath, `${JSON.stringify({ variantId: 'variant-sidecar-bad' })}\n`, 'utf8');

  await assert.rejects(
    listImportedEvolutionArtifacts({
      skillName: 'metabot-network-directory',
      activeRef: null,
      remoteStore,
    }),
    (error) => assertFailureCode(error, 'evolution_imported_artifact_invalid')
  );
});

test('malformed artifact body returns evolution_imported_artifact_invalid', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-list-imported-'));
  const remoteStore = createRemoteEvolutionStore(homeDir);
  await remoteStore.writeImport({
    artifact: createArtifactRecord({
      variantId: 'variant-artifact-bad',
      scopeHash: 'scope-artifact-bad',
    }),
    sidecar: createSidecarRecord({
      variantId: 'variant-artifact-bad',
      scopeHash: 'scope-artifact-bad',
    }),
  });

  const artifactPath = path.join(remoteStore.paths.evolutionRemoteArtifactsRoot, 'variant-artifact-bad.json');
  writeFileSync(
    artifactPath,
    `${JSON.stringify({
      variantId: 'variant-artifact-bad',
      skillName: 'metabot-network-directory',
    })}\n`,
    'utf8'
  );

  await assert.rejects(
    listImportedEvolutionArtifacts({
      skillName: 'metabot-network-directory',
      activeRef: null,
      remoteStore,
    }),
    (error) => assertFailureCode(error, 'evolution_imported_artifact_invalid')
  );
});
