export const EVOLUTION_ARTIFACT_PROTOCOL_PATH = '/protocols/metabot-evolution-artifact-v1';
export const EVOLUTION_ARTIFACT_PROTOCOL_VERSION = '1';

export interface PublishedEvolutionArtifactMetadata {
  protocolVersion: typeof EVOLUTION_ARTIFACT_PROTOCOL_VERSION;
  skillName: string;
  variantId: string;
  artifactUri: string;
  evolutionType: 'FIX';
  triggerSource: string;
  scopeHash: string;
  sameSkill: boolean;
  sameScope: boolean;
  verificationPassed: boolean;
  replayValid: boolean;
  notWorseThanBase: boolean;
  lineage: {
    lineageId: string;
    parentVariantId: string | null;
    rootVariantId: string;
    executionId: string;
    analysisId: string;
    createdAt: number;
  };
  publisherGlobalMetaId: string;
  artifactCreatedAt: number;
  artifactUpdatedAt: number;
  publishedAt: number;
}
