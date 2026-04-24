import type { SkillExecutionAnalysis, SkillVariantArtifact } from '../types';
import { EVOLUTION_ARTIFACT_PROTOCOL_PATH } from '../protocol';
export { EVOLUTION_ARTIFACT_PROTOCOL_PATH };
export interface EvolutionArtifactMetadataInput {
    artifact: SkillVariantArtifact;
    analysis: SkillExecutionAnalysis;
    artifactUri: string;
    publisherGlobalMetaId: string;
    publishedAt: number;
}
export declare function buildShareableArtifactBody(artifact: SkillVariantArtifact): {
    variantId: string;
    skillName: string;
    scope: import("../../skills/skillContractTypes").SkillPermissionScope;
    metadata: import("../../skills/skillContractTypes").SkillVariantScopeMetadata;
    patch: import("../../skills/skillContractTypes").SkillContractPatch;
    lineage: import("../types").SkillLineageRecord;
    verification: import("../types").SkillVerificationSummary;
    createdAt: number;
    updatedAt: number;
};
export declare function buildEvolutionArtifactMetadataPayload(input: EvolutionArtifactMetadataInput): {
    protocolVersion: string;
    skillName: string;
    variantId: string;
    artifactUri: string;
    evolutionType: "FIX";
    triggerSource: import("../types").SkillExecutionTriggerSource;
    scopeHash: string | null;
    sameSkill: boolean;
    sameScope: boolean;
    verificationPassed: boolean;
    replayValid: boolean;
    notWorseThanBase: boolean;
    lineage: import("../types").SkillLineageRecord;
    publisherGlobalMetaId: string;
    artifactCreatedAt: number;
    artifactUpdatedAt: number;
    publishedAt: number;
};
export declare function buildEvolutionArtifactMetadataWriteRequest(input: EvolutionArtifactMetadataInput): {
    path: string;
    contentType: string;
    payload: string;
};
