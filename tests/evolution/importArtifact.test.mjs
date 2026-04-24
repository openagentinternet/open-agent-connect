import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createProfileHomeSync } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createLocalEvolutionStore } = require('../../dist/core/evolution/localEvolutionStore.js');
const { createRemoteEvolutionStore } = require('../../dist/core/evolution/remoteEvolutionStore.js');
const { importPublishedEvolutionArtifact } = require('../../dist/core/evolution/import/importArtifact.js');

function createScope() {
  return {
    allowedCommands: ['metabot network services --online', 'metabot ui open --page hub'],
    chainRead: true,
    chainWrite: false,
    localUiOpen: true,
    remoteDelegation: false,
  };
}

function createMetadata(overrides = {}) {
  return {
    protocolVersion: '1',
    skillName: 'metabot-network-directory',
    variantId: 'variant-import-1',
    artifactUri: 'metafile://artifact-import-1.json',
    evolutionType: 'FIX',
    triggerSource: 'hard_failure',
    scopeHash: 'scope-hash-import-1',
    sameSkill: true,
    sameScope: true,
    verificationPassed: true,
    replayValid: true,
    notWorseThanBase: true,
    lineage: {
      lineageId: 'lineage-import-1',
      parentVariantId: null,
      rootVariantId: 'variant-import-1',
      executionId: 'exec-import-1',
      analysisId: 'analysis-import-1',
      createdAt: 1_760_001_000_000,
    },
    publisherGlobalMetaId: 'idq://publisher-import-1',
    artifactCreatedAt: 1_760_001_100_000,
    artifactUpdatedAt: 1_760_001_200_000,
    publishedAt: 1_760_001_300_000,
    ...overrides,
  };
}

function createArtifactBody(overrides = {}) {
  return {
    variantId: 'variant-import-1',
    skillName: 'metabot-network-directory',
    scope: createScope(),
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash: 'scope-hash-import-1',
    },
    patch: {
      instructionsPatch: 'Prefer deterministic peer probe before UI fallback.',
    },
    lineage: {
      lineageId: 'lineage-import-1',
      parentVariantId: null,
      rootVariantId: 'variant-import-1',
      executionId: 'exec-import-1',
      analysisId: 'analysis-import-1',
      createdAt: 1_760_001_000_000,
    },
    verification: {
      passed: true,
      checkedAt: 1_760_001_250_000,
      protocolCompatible: true,
      replayValid: true,
      notWorseThanBase: true,
      notes: 'Fixture replay is stable.',
    },
    createdAt: 1_760_001_100_000,
    updatedAt: 1_760_001_200_000,
    ...overrides,
  };
}

function assertImportError(error, expectedCode) {
  assert.equal(error instanceof Error, true);
  assert.equal(error.code, expectedCode);
  return true;
}

function snapshotLocalStoreFiles(store, analysisId, variantId) {
  const analysisPath = path.join(store.paths.evolutionAnalysesRoot, `${analysisId}.json`);
  const artifactPath = path.join(store.paths.evolutionArtifactsRoot, `${variantId}.json`);
  return {
    indexRaw: readFileSync(store.paths.evolutionIndexPath, 'utf8'),
    analysisRaw: readFileSync(analysisPath, 'utf8'),
    artifactRaw: readFileSync(artifactPath, 'utf8'),
  };
}

test('successful import by pinId writes artifact + sidecar + index entry', async () => {
  const homeDir = createProfileHomeSync('metabot-evolution-import-');
  const remoteStore = createRemoteEvolutionStore(homeDir);
  const metadata = createMetadata();
  const body = createArtifactBody();
  const now = () => 1_760_001_400_000;

  const result = await importPublishedEvolutionArtifact({
    pinId: 'pin-import-1',
    skillName: 'metabot-network-directory',
    resolvedScopeHash: metadata.scopeHash,
    remoteStore,
    now,
    async readMetadataPinById() {
      return metadata;
    },
    async readArtifactBodyByUri() {
      return JSON.stringify(body);
    },
  });

  const artifactPath = path.join(remoteStore.paths.evolutionRemoteArtifactsRoot, `${metadata.variantId}.json`);
  const metadataPath = path.join(remoteStore.paths.evolutionRemoteArtifactsRoot, `${metadata.variantId}.meta.json`);

  assert.deepEqual(result, {
    pinId: 'pin-import-1',
    variantId: metadata.variantId,
    skillName: metadata.skillName,
    publisherGlobalMetaId: metadata.publisherGlobalMetaId,
    artifactUri: metadata.artifactUri,
    artifactPath,
    metadataPath,
    importedAt: now(),
  });

  assert.deepEqual(JSON.parse(readFileSync(artifactPath, 'utf8')), {
    ...body,
    status: 'inactive',
    adoption: 'manual',
  });
  assert.deepEqual(JSON.parse(readFileSync(metadataPath, 'utf8')), {
    pinId: 'pin-import-1',
    variantId: metadata.variantId,
    publisherGlobalMetaId: metadata.publisherGlobalMetaId,
    artifactUri: metadata.artifactUri,
    skillName: metadata.skillName,
    scopeHash: metadata.scopeHash,
    publishedAt: metadata.publishedAt,
    importedAt: now(),
  });

  assert.deepEqual(await remoteStore.readIndex(), {
    schemaVersion: 1,
    imports: [metadata.variantId],
    byVariantId: {
      [metadata.variantId]: {
        variantId: metadata.variantId,
        pinId: 'pin-import-1',
      },
    },
  });
});

test('unsupported skillName returns evolution_import_not_supported', async () => {
  const unsupportedMetadataCases = [
    createMetadata({
      skillName: 'metabot-trace-inspector',
    }),
    createMetadata({
      skillName: 'metabot-trace-inspector',
      verificationPassed: false,
    }),
  ];

  for (const metadata of unsupportedMetadataCases) {
    await assert.rejects(
      importPublishedEvolutionArtifact({
        pinId: 'pin-import-unsupported',
        skillName: 'metabot-trace-inspector',
        resolvedScopeHash: 'scope-hash-import-1',
        remoteStore: {
          async readIndex() {
            return { schemaVersion: 1, imports: [], byVariantId: {} };
          },
        },
        async readMetadataPinById() {
          return metadata;
        },
        async readArtifactBodyByUri() {
          throw new Error('should not fetch artifact for unsupported skill');
        },
      }),
      (error) => assertImportError(error, 'evolution_import_not_supported')
    );
  }
});

test('scope mismatch returns evolution_import_scope_mismatch', async () => {
  await assert.rejects(
    importPublishedEvolutionArtifact({
      pinId: 'pin-import-scope-mismatch',
      skillName: 'metabot-network-directory',
      resolvedScopeHash: 'scope-hash-local',
      remoteStore: {
        async readIndex() {
          return { schemaVersion: 1, imports: [], byVariantId: {} };
        },
      },
      async readMetadataPinById() {
        return createMetadata({
          scopeHash: 'scope-hash-remote',
        });
      },
      async readArtifactBodyByUri() {
        throw new Error('should not fetch artifact on scope mismatch');
      },
    }),
    (error) => assertImportError(error, 'evolution_import_scope_mismatch')
  );
});

test('malformed or protocol-invalid metadata returns evolution_import_metadata_invalid', async () => {
  const invalidMetadataCases = [
    (() => {
      const malformed = createMetadata();
      delete malformed.protocolVersion;
      return malformed;
    })(),
    createMetadata({
      verificationPassed: false,
    }),
    createMetadata({
      verificationPassed: true,
      replayValid: false,
      notWorseThanBase: false,
    }),
  ];

  for (const metadata of invalidMetadataCases) {
    await assert.rejects(
      importPublishedEvolutionArtifact({
        pinId: 'pin-import-bad-metadata',
        skillName: 'metabot-network-directory',
        resolvedScopeHash: 'scope-hash-import-1',
        remoteStore: {
          async readIndex() {
            return { schemaVersion: 1, imports: [], byVariantId: {} };
          },
        },
        async readMetadataPinById() {
          return metadata;
        },
        async readArtifactBodyByUri() {
          throw new Error('should not fetch artifact when metadata is invalid');
        },
      }),
      (error) => assertImportError(error, 'evolution_import_metadata_invalid')
    );
  }
});

test('missing pin returns evolution_import_pin_not_found', async () => {
  await assert.rejects(
    importPublishedEvolutionArtifact({
      pinId: 'pin-import-missing',
      skillName: 'metabot-network-directory',
      resolvedScopeHash: 'scope-hash-import-1',
      remoteStore: {
        async readIndex() {
          throw new Error('should not read index when pin is missing');
        },
      },
      async readMetadataPinById() {
        return null;
      },
      async readArtifactBodyByUri() {
        throw new Error('should not fetch artifact when pin is missing');
      },
    }),
    (error) => assertImportError(error, 'evolution_import_pin_not_found')
  );
});

test('artifact fetch or JSON decode failures return evolution_import_artifact_fetch_failed', async () => {
  const metadata = createMetadata();
  const importInputBase = {
    pinId: 'pin-import-fetch-failed',
    skillName: 'metabot-network-directory',
    resolvedScopeHash: metadata.scopeHash,
    remoteStore: {
      async readIndex() {
        return { schemaVersion: 1, imports: [], byVariantId: {} };
      },
    },
    async readMetadataPinById() {
      return metadata;
    },
  };

  await assert.rejects(
    importPublishedEvolutionArtifact({
      ...importInputBase,
      async readArtifactBodyByUri() {
        throw new Error('network timeout');
      },
    }),
    (error) => assertImportError(error, 'evolution_import_artifact_fetch_failed')
  );

  await assert.rejects(
    importPublishedEvolutionArtifact({
      ...importInputBase,
      async readArtifactBodyByUri() {
        return '{not-json';
      },
    }),
    (error) => assertImportError(error, 'evolution_import_artifact_fetch_failed')
  );
});

test('metadata/body mismatch returns evolution_import_artifact_invalid', async () => {
  const metadata = createMetadata({
    variantId: 'variant-import-1',
  });

  await assert.rejects(
    importPublishedEvolutionArtifact({
      pinId: 'pin-import-body-mismatch',
      skillName: 'metabot-network-directory',
      resolvedScopeHash: metadata.scopeHash,
      remoteStore: {
        async readIndex() {
          return { schemaVersion: 1, imports: [], byVariantId: {} };
        },
      },
      async readMetadataPinById() {
        return metadata;
      },
      async readArtifactBodyByUri() {
        return createArtifactBody({
          variantId: 'variant-import-different',
        });
      },
    }),
    (error) => assertImportError(error, 'evolution_import_artifact_invalid')
  );
});

test('metadata/body lineage or verification mismatch returns evolution_import_artifact_invalid', async () => {
  const metadata = createMetadata();
  const mismatchedBodies = [
    createArtifactBody({
      lineage: {
        ...createArtifactBody().lineage,
        lineageId: 'lineage-import-other',
      },
    }),
    createArtifactBody({
      lineage: {
        ...createArtifactBody().lineage,
        parentVariantId: 'variant-parent-other',
      },
    }),
    createArtifactBody({
      lineage: {
        ...createArtifactBody().lineage,
        rootVariantId: 'variant-root-other',
      },
    }),
    createArtifactBody({
      lineage: {
        ...createArtifactBody().lineage,
        executionId: 'exec-import-other',
      },
    }),
    createArtifactBody({
      lineage: {
        ...createArtifactBody().lineage,
        analysisId: 'analysis-import-other',
      },
    }),
    createArtifactBody({
      lineage: {
        ...createArtifactBody().lineage,
        createdAt: 1_760_001_999_999,
      },
    }),
    createArtifactBody({
      verification: {
        ...createArtifactBody().verification,
        passed: false,
      },
    }),
    createArtifactBody({
      verification: {
        ...createArtifactBody().verification,
        replayValid: false,
      },
    }),
    createArtifactBody({
      verification: {
        ...createArtifactBody().verification,
        notWorseThanBase: false,
      },
    }),
  ];

  for (const body of mismatchedBodies) {
    await assert.rejects(
      importPublishedEvolutionArtifact({
        pinId: 'pin-import-body-verification-mismatch',
        skillName: 'metabot-network-directory',
        resolvedScopeHash: metadata.scopeHash,
        remoteStore: {
          async readIndex() {
            return { schemaVersion: 1, imports: [], byVariantId: {} };
          },
        },
        async readMetadataPinById() {
          return metadata;
        },
        async readArtifactBodyByUri() {
          return body;
        },
      }),
      (error) => assertImportError(error, 'evolution_import_artifact_invalid')
    );
  }
});

test('duplicate local variantId returns evolution_import_variant_conflict', async () => {
  const metadata = createMetadata();
  let bodyReads = 0;

  await assert.rejects(
    importPublishedEvolutionArtifact({
      pinId: 'pin-import-conflict',
      skillName: 'metabot-network-directory',
      resolvedScopeHash: metadata.scopeHash,
      remoteStore: {
        async readIndex() {
          return {
            schemaVersion: 1,
            imports: [metadata.variantId],
            byVariantId: {
              [metadata.variantId]: {
                variantId: metadata.variantId,
                pinId: 'pin-existing',
              },
            },
          };
        },
      },
      async readMetadataPinById() {
        return metadata;
      },
      async readArtifactBodyByUri() {
        bodyReads += 1;
        return createArtifactBody();
      },
    }),
    (error) => assertImportError(error, 'evolution_import_variant_conflict')
  );

  assert.equal(bodyReads, 0);
});

test('import leaves local self-evolution artifact store and activeVariants untouched', async () => {
  const homeDir = createProfileHomeSync('metabot-evolution-import-local-');
  const localStore = createLocalEvolutionStore(homeDir);
  const remoteStore = createRemoteEvolutionStore(homeDir);

  const localAnalysis = {
    analysisId: 'analysis-local-1',
    executionId: 'exec-local-1',
    skillName: 'metabot-network-directory',
    triggerSource: 'hard_failure',
    evolutionType: 'FIX',
    shouldGenerateCandidate: true,
    summary: 'local baseline analysis',
    analyzedAt: 1_760_000_000_000,
  };
  const localArtifact = {
    ...createArtifactBody({
      variantId: 'variant-local-1',
      lineage: {
        lineageId: 'lineage-local-1',
        parentVariantId: null,
        rootVariantId: 'variant-local-1',
        executionId: 'exec-local-1',
        analysisId: 'analysis-local-1',
        createdAt: 1_760_000_100_000,
      },
    }),
    status: 'inactive',
    adoption: 'manual',
  };

  await localStore.writeAnalysis(localAnalysis);
  await localStore.writeArtifact(localArtifact);
  await localStore.setActiveVariant(localArtifact.skillName, localArtifact.variantId);

  const before = snapshotLocalStoreFiles(localStore, localAnalysis.analysisId, localArtifact.variantId);

  await importPublishedEvolutionArtifact({
    pinId: 'pin-import-isolated',
    skillName: 'metabot-network-directory',
    resolvedScopeHash: 'scope-hash-import-1',
    remoteStore,
    async readMetadataPinById() {
      return createMetadata();
    },
    async readArtifactBodyByUri() {
      return createArtifactBody();
    },
  });

  const after = snapshotLocalStoreFiles(localStore, localAnalysis.analysisId, localArtifact.variantId);
  assert.deepEqual(after, before);
});
