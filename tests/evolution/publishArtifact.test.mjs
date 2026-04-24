import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createProfileHomeSync } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createLocalEvolutionStore } = require('../../dist/core/evolution/localEvolutionStore.js');
const { publishEvolutionArtifact } = require('../../dist/core/evolution/publish/publishArtifact.js');
const {
  EVOLUTION_ARTIFACT_PROTOCOL_PATH,
  buildShareableArtifactBody,
  buildEvolutionArtifactMetadataWriteRequest,
} = require('../../dist/core/evolution/publish/shareableArtifact.js');

function createScope() {
  return {
    allowedCommands: ['metabot network services --online', 'metabot ui open --page hub'],
    chainRead: true,
    chainWrite: false,
    localUiOpen: true,
    remoteDelegation: false,
  };
}

function createAnalysisRecord(overrides = {}) {
  return {
    analysisId: 'analysis-1',
    executionId: 'exec-1',
    skillName: 'metabot-network-directory',
    triggerSource: 'hard_failure',
    evolutionType: 'FIX',
    shouldGenerateCandidate: true,
    summary: 'command returned a failed envelope',
    analyzedAt: 1_744_444_445_000,
    ...overrides,
  };
}

function createArtifactRecord(overrides = {}) {
  return {
    variantId: 'variant-1',
    skillName: 'metabot-network-directory',
    status: 'inactive',
    scope: createScope(),
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash: ' scope-hash-v1 ',
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
    ...overrides,
  };
}

function assertPublishError(error, expectedCode, expectedMessagePart) {
  assert.equal(error instanceof Error, true);
  assert.equal(error.code, expectedCode);
  assert.match(error.message, new RegExp(expectedMessagePart));
  return true;
}

function snapshotLocalEvolutionFiles(store, artifact, analysis) {
  const artifactPath = path.join(store.paths.evolutionArtifactsRoot, `${artifact.variantId}.json`);
  const analysisPath = path.join(store.paths.evolutionAnalysesRoot, `${analysis.analysisId}.json`);
  const indexPath = store.paths.evolutionIndexPath;
  return {
    artifactRaw: readFileSync(artifactPath, 'utf8'),
    analysisRaw: readFileSync(analysisPath, 'utf8'),
    indexRaw: readFileSync(indexPath, 'utf8'),
  };
}

test('publish artifact uploads body before metadata pin write and does not mutate local store files', async () => {
  const homeDir = createProfileHomeSync('metabot-evolution-publish-');
  const store = createLocalEvolutionStore(homeDir);
  const analysis = createAnalysisRecord();
  const artifact = createArtifactRecord();

  await store.writeAnalysis(analysis);
  await store.writeArtifact(artifact);
  await store.setActiveVariant(artifact.skillName, artifact.variantId);

  const before = snapshotLocalEvolutionFiles(store, artifact, analysis);
  const callOrder = [];
  let uploadedBody = null;
  let metadataInput = null;

  const now = () => 1_744_444_500_000;
  const result = await publishEvolutionArtifact({
    store,
    skillName: artifact.skillName,
    variantId: artifact.variantId,
    publisherGlobalMetaId: 'idq://publisher-1',
    now,
    async uploadArtifactBody(filePath) {
      callOrder.push('upload');
      uploadedBody = JSON.parse(readFileSync(filePath, 'utf8'));
      return { artifactUri: 'metafile://artifact-body.json' };
    },
    async writeMetadataPin(input) {
      callOrder.push('metadata');
      metadataInput = input;
      return { pinId: 'pin-1', txids: ['tx-1', 'tx-2'] };
    },
  });

  assert.deepEqual(callOrder, ['upload', 'metadata']);
  assert.deepEqual(uploadedBody, buildShareableArtifactBody(artifact));
  assert.deepEqual(
    metadataInput,
    buildEvolutionArtifactMetadataWriteRequest({
      artifact,
      analysis,
      artifactUri: 'metafile://artifact-body.json',
      publisherGlobalMetaId: 'idq://publisher-1',
      publishedAt: now(),
    })
  );
  assert.equal(metadataInput.path, EVOLUTION_ARTIFACT_PROTOCOL_PATH);
  assert.equal(metadataInput.contentType, 'application/json');
  assert.deepEqual(result, {
    pinId: 'pin-1',
    txids: ['tx-1', 'tx-2'],
    skillName: artifact.skillName,
    variantId: artifact.variantId,
    artifactUri: 'metafile://artifact-body.json',
    scopeHash: artifact.metadata.scopeHash,
    publisherGlobalMetaId: 'idq://publisher-1',
    publishedAt: now(),
  });

  const after = snapshotLocalEvolutionFiles(store, artifact, analysis);
  assert.deepEqual(after, before);
});

test('publish artifact fails with evolution_variant_not_found when variant does not exist', async () => {
  await assert.rejects(
    publishEvolutionArtifact({
      store: {
        async readArtifact() {
          return null;
        },
        async readAnalysis() {
          throw new Error('should not read analysis when variant is missing');
        },
      },
      skillName: 'metabot-network-directory',
      variantId: 'variant-missing',
      publisherGlobalMetaId: 'idq://publisher',
      async uploadArtifactBody() {
        throw new Error('should not upload');
      },
      async writeMetadataPin() {
        throw new Error('should not write metadata');
      },
    }),
    (error) => assertPublishError(error, 'evolution_variant_not_found', 'not found')
  );
});

test('publish artifact fails with evolution_variant_skill_mismatch when requested skill and artifact skill differ', async () => {
  const artifact = createArtifactRecord({ skillName: 'metabot-trace-inspector' });
  const analysis = createAnalysisRecord({ skillName: artifact.skillName });

  await assert.rejects(
    publishEvolutionArtifact({
      store: {
        async readArtifact() {
          return artifact;
        },
        async readAnalysis() {
          return analysis;
        },
      },
      skillName: 'metabot-network-directory',
      variantId: artifact.variantId,
      publisherGlobalMetaId: 'idq://publisher',
      async uploadArtifactBody() {
        throw new Error('should not upload');
      },
      async writeMetadataPin() {
        throw new Error('should not write metadata');
      },
    }),
    (error) => assertPublishError(error, 'evolution_variant_skill_mismatch', 'skill')
  );
});

test('publish artifact fails with evolution_publish_not_supported for unsupported skill', async () => {
  const artifact = createArtifactRecord({ skillName: 'metabot-trace-inspector' });
  const analysis = createAnalysisRecord({ skillName: artifact.skillName });

  await assert.rejects(
    publishEvolutionArtifact({
      store: {
        async readArtifact() {
          return artifact;
        },
        async readAnalysis() {
          return analysis;
        },
      },
      skillName: artifact.skillName,
      variantId: artifact.variantId,
      publisherGlobalMetaId: 'idq://publisher',
      async uploadArtifactBody() {
        throw new Error('should not upload');
      },
      async writeMetadataPin() {
        throw new Error('should not write metadata');
      },
    }),
    (error) => assertPublishError(error, 'evolution_publish_not_supported', 'supported')
  );
});

test('publish artifact fails with evolution_variant_analysis_mismatch when linked analysis is missing', async () => {
  const artifact = createArtifactRecord();

  await assert.rejects(
    publishEvolutionArtifact({
      store: {
        async readArtifact() {
          return artifact;
        },
        async readAnalysis() {
          return null;
        },
      },
      skillName: artifact.skillName,
      variantId: artifact.variantId,
      publisherGlobalMetaId: 'idq://publisher',
      async uploadArtifactBody() {
        throw new Error('should not upload');
      },
      async writeMetadataPin() {
        throw new Error('should not write metadata');
      },
    }),
    (error) => assertPublishError(error, 'evolution_variant_analysis_mismatch', 'analysis')
  );
});

test('publish artifact fails with evolution_variant_analysis_mismatch when analysis record is malformed or incoherent', async () => {
  const artifact = createArtifactRecord();
  const brokenAnalyses = [
    { analysisId: artifact.lineage.analysisId },
    createAnalysisRecord({ analysisId: 'different-analysis-id' }),
    createAnalysisRecord({ skillName: 'metabot-trace-inspector' }),
    createAnalysisRecord({ executionId: 'different-execution-id' }),
  ];

  for (const analysis of brokenAnalyses) {
    await assert.rejects(
      publishEvolutionArtifact({
        store: {
          async readArtifact() {
            return artifact;
          },
          async readAnalysis() {
            return analysis;
          },
        },
        skillName: artifact.skillName,
        variantId: artifact.variantId,
        publisherGlobalMetaId: 'idq://publisher',
        async uploadArtifactBody() {
          throw new Error('should not upload');
        },
        async writeMetadataPin() {
          throw new Error('should not write metadata');
        },
      }),
      (error) => assertPublishError(error, 'evolution_variant_analysis_mismatch', 'analysis')
    );
  }
});

test('publish artifact fails with evolution_publish_not_supported when analysis evolutionType is not FIX', async () => {
  const artifact = createArtifactRecord();
  const analysis = createAnalysisRecord({ evolutionType: 'TUNE' });

  await assert.rejects(
    publishEvolutionArtifact({
      store: {
        async readArtifact() {
          return artifact;
        },
        async readAnalysis() {
          return analysis;
        },
      },
      skillName: artifact.skillName,
      variantId: artifact.variantId,
      publisherGlobalMetaId: 'idq://publisher',
      async uploadArtifactBody() {
        throw new Error('should not upload');
      },
      async writeMetadataPin() {
        throw new Error('should not write metadata');
      },
    }),
    (error) => assertPublishError(error, 'evolution_publish_not_supported', 'evolutionType')
  );
});

test('publish artifact fails with evolution_variant_not_verified when artifact verification did not pass', async () => {
  const artifact = createArtifactRecord({
    verification: {
      ...createArtifactRecord().verification,
      passed: false,
    },
  });
  const analysis = createAnalysisRecord();

  await assert.rejects(
    publishEvolutionArtifact({
      store: {
        async readArtifact() {
          return artifact;
        },
        async readAnalysis() {
          return analysis;
        },
      },
      skillName: artifact.skillName,
      variantId: artifact.variantId,
      publisherGlobalMetaId: 'idq://publisher',
      async uploadArtifactBody() {
        throw new Error('should not upload');
      },
      async writeMetadataPin() {
        throw new Error('should not write metadata');
      },
    }),
    (error) => assertPublishError(error, 'evolution_variant_not_verified', 'verification')
  );
});

test('publish artifact fails with evolution_variant_scope_hash_missing when scope hash is missing', async () => {
  const artifact = createArtifactRecord({
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash: '',
    },
  });
  const analysis = createAnalysisRecord();

  await assert.rejects(
    publishEvolutionArtifact({
      store: {
        async readArtifact() {
          return artifact;
        },
        async readAnalysis() {
          return analysis;
        },
      },
      skillName: artifact.skillName,
      variantId: artifact.variantId,
      publisherGlobalMetaId: 'idq://publisher',
      async uploadArtifactBody() {
        throw new Error('should not upload');
      },
      async writeMetadataPin() {
        throw new Error('should not write metadata');
      },
    }),
    (error) => assertPublishError(error, 'evolution_variant_scope_hash_missing', 'scopeHash')
  );
});

test('publish artifact bubbles upload failure exactly and prevents metadata write', async () => {
  const artifact = createArtifactRecord();
  const analysis = createAnalysisRecord();
  const uploadError = new Error('upload transport failed');
  let metadataWriteCount = 0;

  await assert.rejects(
    publishEvolutionArtifact({
      store: {
        async readArtifact() {
          return artifact;
        },
        async readAnalysis() {
          return analysis;
        },
      },
      skillName: artifact.skillName,
      variantId: artifact.variantId,
      publisherGlobalMetaId: 'idq://publisher',
      async uploadArtifactBody() {
        throw uploadError;
      },
      async writeMetadataPin() {
        metadataWriteCount += 1;
        return { pinId: 'pin-should-not-write', txids: [] };
      },
    }),
    (error) => {
      assert.equal(error, uploadError);
      return true;
    }
  );
  assert.equal(metadataWriteCount, 0);
});

test('publish artifact bubbles metadata write failure exactly after successful body upload', async () => {
  const artifact = createArtifactRecord();
  const analysis = createAnalysisRecord();
  const metadataError = new Error('metadata write failed');
  let uploadCount = 0;

  await assert.rejects(
    publishEvolutionArtifact({
      store: {
        async readArtifact() {
          return artifact;
        },
        async readAnalysis() {
          return analysis;
        },
      },
      skillName: artifact.skillName,
      variantId: artifact.variantId,
      publisherGlobalMetaId: 'idq://publisher',
      async uploadArtifactBody() {
        uploadCount += 1;
        return { artifactUri: 'metafile://artifact-body.json' };
      },
      async writeMetadataPin() {
        throw metadataError;
      },
    }),
    (error) => {
      assert.equal(error, metadataError);
      return true;
    }
  );
  assert.equal(uploadCount, 1);
});
