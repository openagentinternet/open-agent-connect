import type {
  SkillExecutionAnalysis,
  SkillVariantArtifact,
} from '../types';
import { EVOLUTION_ARTIFACT_PROTOCOL_VERSION } from '../import/publishedArtifactProtocol';

export const EVOLUTION_ARTIFACT_PROTOCOL_PATH = '/protocols/metabot-evolution-artifact-v1';

export interface EvolutionArtifactMetadataInput {
  artifact: SkillVariantArtifact;
  analysis: SkillExecutionAnalysis;
  artifactUri: string;
  publisherGlobalMetaId: string;
  publishedAt: number;
}

export function buildShareableArtifactBody(artifact: SkillVariantArtifact) {
  return {
    variantId: artifact.variantId,
    skillName: artifact.skillName,
    scope: artifact.scope,
    metadata: artifact.metadata,
    patch: artifact.patch,
    lineage: artifact.lineage,
    verification: artifact.verification,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

export function buildEvolutionArtifactMetadataPayload(input: EvolutionArtifactMetadataInput) {
  const { artifact, analysis, artifactUri, publisherGlobalMetaId, publishedAt } = input;

  return {
    protocolVersion: EVOLUTION_ARTIFACT_PROTOCOL_VERSION,
    skillName: artifact.skillName,
    variantId: artifact.variantId,
    artifactUri,
    evolutionType: analysis.evolutionType,
    triggerSource: analysis.triggerSource,
    scopeHash: artifact.metadata.scopeHash,
    sameSkill: artifact.metadata.sameSkill,
    sameScope: artifact.metadata.sameScope,
    verificationPassed: artifact.verification.passed,
    replayValid: artifact.verification.replayValid,
    notWorseThanBase: artifact.verification.notWorseThanBase,
    lineage: artifact.lineage,
    publisherGlobalMetaId,
    artifactCreatedAt: artifact.createdAt,
    artifactUpdatedAt: artifact.updatedAt,
    publishedAt,
  };
}

export function buildEvolutionArtifactMetadataWriteRequest(input: EvolutionArtifactMetadataInput) {
  const payload = buildEvolutionArtifactMetadataPayload(input);

  return {
    path: EVOLUTION_ARTIFACT_PROTOCOL_PATH,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
  };
}
