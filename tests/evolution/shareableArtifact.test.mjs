import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  EVOLUTION_ARTIFACT_PROTOCOL_PATH,
  buildShareableArtifactBody,
  buildEvolutionArtifactMetadataPayload,
  buildEvolutionArtifactMetadataWriteRequest,
} = require('../../dist/core/evolution/publish/shareableArtifact.js');

function createSampleArtifact(overrides = {}) {
  return {
    variantId: 'variant-123',
    skillName: 'metabot-network-directory',
    status: 'active',
    adoption: 'active',
    scope: {
      allowedCommands: ['metabot network services'],
      chainRead: true,
      chainWrite: true,
      localUiOpen: true,
      remoteDelegation: false,
    },
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash: 'scope-hash-123',
    },
    patch: {
      instructionsPatch: 'do X',
    },
    lineage: {
      lineageId: 'lineage-123',
      parentVariantId: null,
      rootVariantId: 'variant-123',
      executionId: 'execution-456',
      analysisId: 'analysis-789',
    },
    verification: {
      passed: true,
      checkedAt: 1_744_444_500_000,
      protocolCompatible: true,
      replayValid: true,
      notWorseThanBase: true,
    },
    createdAt: 1_744_444_400_000,
    updatedAt: 1_744_444_410_000,
    ...overrides,
  };
}

function createSampleAnalysis(overrides = {}) {
  return {
    analysisId: 'analysis-789',
    executionId: 'execution-456',
    skillName: 'metabot-network-directory',
    triggerSource: 'hard_failure',
    evolutionType: 'FIX',
    shouldGenerateCandidate: true,
    summary: 'summary',
    analyzedAt: 1_744_444_420_000,
    ...overrides,
  };
}

test('shareable body excludes status and adoption', () => {
  const artifact = createSampleArtifact();
  const body = buildShareableArtifactBody(artifact);

  assert.deepEqual(body.variantId, artifact.variantId);
  assert.deepEqual(body.skillName, artifact.skillName);
  assert.deepEqual(body.scope, artifact.scope);
  assert.deepEqual(body.metadata, artifact.metadata);
  assert.deepEqual(body.patch, artifact.patch);
  assert.deepEqual(body.lineage, artifact.lineage);
  assert.deepEqual(body.verification, artifact.verification);
  assert.equal(body.createdAt, artifact.createdAt);
  assert.equal(body.updatedAt, artifact.updatedAt);
  assert.equal(body.status, undefined);
  assert.equal(body.adoption, undefined);
});

test('metadata payload matches spec and uses analysis details', () => {
  const artifact = createSampleArtifact();
  const analysis = createSampleAnalysis({ triggerSource: 'soft_failure', evolutionType: 'FIX' });
  const publishedAt = 1_744_444_450_000;
  const artifactUri = 'metafile://artifact-body.json';
  const publisherGlobalMetaId = 'idq://publisher-1';

  const payload = buildEvolutionArtifactMetadataPayload({
    artifact,
    analysis,
    artifactUri,
    publisherGlobalMetaId,
    publishedAt,
  });

  assert.equal(payload.protocolVersion, '1');
  assert.equal(payload.skillName, artifact.skillName);
  assert.equal(payload.variantId, artifact.variantId);
  assert.equal(payload.artifactUri, artifactUri);
  assert.equal(payload.evolutionType, analysis.evolutionType);
  assert.equal(payload.triggerSource, analysis.triggerSource);
  assert.equal(payload.scopeHash, artifact.metadata.scopeHash);
  assert.equal(payload.sameSkill, artifact.metadata.sameSkill);
  assert.equal(payload.sameScope, artifact.metadata.sameScope);
  assert.equal(payload.verificationPassed, artifact.verification.passed);
  assert.equal(payload.replayValid, artifact.verification.replayValid);
  assert.equal(payload.notWorseThanBase, artifact.verification.notWorseThanBase);
  assert.deepEqual(payload.lineage, artifact.lineage);
  assert.equal(payload.publisherGlobalMetaId, publisherGlobalMetaId);
  assert.equal(payload.artifactCreatedAt, artifact.createdAt);
  assert.equal(payload.artifactUpdatedAt, artifact.updatedAt);
  assert.equal(payload.publishedAt, publishedAt);
});

test('metadata write request enforces protocol path and JSON content type', () => {
  const artifact = createSampleArtifact();
  const analysis = createSampleAnalysis();
  const publishedAt = 1_744_444_450_000;
  const artifactUri = 'metafile://artifact-body.json';
  const publisherGlobalMetaId = 'idq://publisher-1';

  const payloadObject = buildEvolutionArtifactMetadataPayload({
    artifact,
    analysis,
    artifactUri,
    publisherGlobalMetaId,
    publishedAt,
  });

  const writeRequest = buildEvolutionArtifactMetadataWriteRequest({
    artifact,
    analysis,
    artifactUri,
    publisherGlobalMetaId,
    publishedAt,
  });

  assert.equal(writeRequest.path, EVOLUTION_ARTIFACT_PROTOCOL_PATH);
  assert.equal(writeRequest.contentType, 'application/json');
  assert.equal(writeRequest.payload, JSON.stringify(payloadObject));
});
