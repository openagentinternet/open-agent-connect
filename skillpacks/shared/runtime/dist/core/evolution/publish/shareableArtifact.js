"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVOLUTION_ARTIFACT_PROTOCOL_PATH = void 0;
exports.buildShareableArtifactBody = buildShareableArtifactBody;
exports.buildEvolutionArtifactMetadataPayload = buildEvolutionArtifactMetadataPayload;
exports.buildEvolutionArtifactMetadataWriteRequest = buildEvolutionArtifactMetadataWriteRequest;
const protocol_1 = require("../protocol");
Object.defineProperty(exports, "EVOLUTION_ARTIFACT_PROTOCOL_PATH", { enumerable: true, get: function () { return protocol_1.EVOLUTION_ARTIFACT_PROTOCOL_PATH; } });
function buildShareableArtifactBody(artifact) {
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
function buildEvolutionArtifactMetadataPayload(input) {
    const { artifact, analysis, artifactUri, publisherGlobalMetaId, publishedAt } = input;
    return {
        protocolVersion: protocol_1.EVOLUTION_ARTIFACT_PROTOCOL_VERSION,
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
function buildEvolutionArtifactMetadataWriteRequest(input) {
    const payload = buildEvolutionArtifactMetadataPayload(input);
    return {
        path: protocol_1.EVOLUTION_ARTIFACT_PROTOCOL_PATH,
        contentType: 'application/json',
        payload: JSON.stringify(payload),
    };
}
