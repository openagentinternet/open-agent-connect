import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { LocalEvolutionStore } from '../localEvolutionStore';
import type { SkillExecutionAnalysis } from '../types';
import {
  buildEvolutionArtifactMetadataWriteRequest,
  buildShareableArtifactBody,
} from './shareableArtifact';

type PublishValidationFailureCode =
  | 'evolution_variant_not_found'
  | 'evolution_variant_skill_mismatch'
  | 'evolution_variant_analysis_mismatch'
  | 'evolution_variant_scope_hash_missing'
  | 'evolution_variant_not_verified'
  | 'evolution_publish_not_supported';

type CodedError = Error & { code: PublishValidationFailureCode };

const SUPPORTED_SKILL = 'metabot-network-directory';

function createPublishValidationError(
  code: PublishValidationFailureCode,
  message: string
): CodedError {
  const error = new Error(message) as CodedError;
  error.code = code;
  return error;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCoherentAnalysisRecord(value: SkillExecutionAnalysis | null): value is SkillExecutionAnalysis {
  return Boolean(
    value
    && isNonEmptyString(value.analysisId)
    && isNonEmptyString(value.executionId)
    && isNonEmptyString(value.skillName)
    && isNonEmptyString(value.triggerSource)
    && isNonEmptyString(value.evolutionType)
    && typeof value.shouldGenerateCandidate === 'boolean'
    && isNonEmptyString(value.summary)
    && typeof value.analyzedAt === 'number'
  );
}

async function cleanupTempArtifactFile(tempFilePath: string, tempDirPath: string): Promise<void> {
  try {
    await fs.unlink(tempFilePath);
  } catch {
    // Ignore cleanup failures.
  }
  try {
    await fs.rmdir(tempDirPath);
  } catch {
    // Ignore cleanup failures.
  }
}

export interface PublishEvolutionArtifactInput {
  store: Pick<LocalEvolutionStore, 'readArtifact' | 'readAnalysis'>;
  skillName: string;
  variantId: string;
  publisherGlobalMetaId: string;
  uploadArtifactBody: (filePath: string) => Promise<{ artifactUri: string }>;
  writeMetadataPin: (
    input: { path: string; contentType: string; payload: string }
  ) => Promise<{ pinId: string; txids: string[] }>;
  now?: () => number;
}

export interface PublishEvolutionArtifactResult {
  pinId: string;
  txids: string[];
  skillName: string;
  variantId: string;
  artifactUri: string;
  scopeHash: string;
  publisherGlobalMetaId: string;
  publishedAt: number;
}

export async function publishEvolutionArtifact(
  input: PublishEvolutionArtifactInput
): Promise<PublishEvolutionArtifactResult> {
  const artifact = await input.store.readArtifact(input.variantId);
  if (!artifact) {
    throw createPublishValidationError(
      'evolution_variant_not_found',
      `Evolution variant "${input.variantId}" was not found`
    );
  }

  const lineageAnalysisId = artifact.lineage?.analysisId;
  const analysis = isNonEmptyString(lineageAnalysisId)
    ? await input.store.readAnalysis(lineageAnalysisId)
    : null;

  if (artifact.skillName !== input.skillName) {
    throw createPublishValidationError(
      'evolution_variant_skill_mismatch',
      `Requested skill "${input.skillName}" does not match artifact skill "${artifact.skillName}"`
    );
  }

  if (artifact.skillName !== SUPPORTED_SKILL) {
    throw createPublishValidationError(
      'evolution_publish_not_supported',
      `Publishing is currently supported only for "${SUPPORTED_SKILL}"`
    );
  }

  if (!isNonEmptyString(artifact.lineage?.analysisId) || !isNonEmptyString(artifact.lineage?.executionId)) {
    throw createPublishValidationError(
      'evolution_variant_analysis_mismatch',
      'Artifact lineage is missing required analysis linkage fields'
    );
  }

  if (!isCoherentAnalysisRecord(analysis)) {
    throw createPublishValidationError(
      'evolution_variant_analysis_mismatch',
      'Linked analysis record is missing or malformed'
    );
  }

  if (
    analysis.analysisId !== artifact.lineage.analysisId
    || analysis.skillName !== artifact.skillName
    || analysis.executionId !== artifact.lineage.executionId
  ) {
    throw createPublishValidationError(
      'evolution_variant_analysis_mismatch',
      'Linked analysis record does not match artifact lineage'
    );
  }

  if (analysis.evolutionType !== 'FIX') {
    throw createPublishValidationError(
      'evolution_publish_not_supported',
      `Publishing is not supported for evolutionType "${analysis.evolutionType}"`
    );
  }

  if (artifact.verification?.passed !== true) {
    throw createPublishValidationError(
      'evolution_variant_not_verified',
      'Artifact verification must pass before publishing'
    );
  }

  const scopeHash = artifact.metadata?.scopeHash;
  if (!isNonEmptyString(scopeHash)) {
    throw createPublishValidationError(
      'evolution_variant_scope_hash_missing',
      'Artifact metadata.scopeHash is required for publishing'
    );
  }

  const publishedAt = (input.now ?? (() => Date.now()))();
  const shareableBody = buildShareableArtifactBody(artifact);
  const tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'metabot-evolution-artifact-'));
  const tempFilePath = path.join(tempDirPath, `${artifact.variantId}.json`);
  await fs.writeFile(tempFilePath, `${JSON.stringify(shareableBody)}\n`, 'utf8');

  try {
    const uploadResult = await input.uploadArtifactBody(tempFilePath);
    const metadataWriteRequest = buildEvolutionArtifactMetadataWriteRequest({
      artifact,
      analysis,
      artifactUri: uploadResult.artifactUri,
      publisherGlobalMetaId: input.publisherGlobalMetaId,
      publishedAt,
    });
    const metadataWriteResult = await input.writeMetadataPin(metadataWriteRequest);

    return {
      pinId: metadataWriteResult.pinId,
      txids: metadataWriteResult.txids,
      skillName: artifact.skillName,
      variantId: artifact.variantId,
      artifactUri: uploadResult.artifactUri,
      scopeHash,
      publisherGlobalMetaId: input.publisherGlobalMetaId,
      publishedAt,
    };
  } finally {
    await cleanupTempArtifactFile(tempFilePath, tempDirPath);
  }
}
