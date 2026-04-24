"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishEvolutionArtifact = publishEvolutionArtifact;
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const shareableArtifact_1 = require("./shareableArtifact");
const SUPPORTED_SKILL = 'metabot-network-directory';
function createPublishValidationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}
function isCoherentAnalysisRecord(value) {
    return Boolean(value
        && isNonEmptyString(value.analysisId)
        && isNonEmptyString(value.executionId)
        && isNonEmptyString(value.skillName)
        && isNonEmptyString(value.triggerSource)
        && isNonEmptyString(value.evolutionType)
        && typeof value.shouldGenerateCandidate === 'boolean'
        && isNonEmptyString(value.summary)
        && typeof value.analyzedAt === 'number');
}
async function cleanupTempArtifactFile(tempFilePath, tempDirPath) {
    try {
        await node_fs_1.promises.unlink(tempFilePath);
    }
    catch {
        // Ignore cleanup failures.
    }
    try {
        await node_fs_1.promises.rmdir(tempDirPath);
    }
    catch {
        // Ignore cleanup failures.
    }
}
async function publishEvolutionArtifact(input) {
    const artifact = await input.store.readArtifact(input.variantId);
    if (!artifact) {
        throw createPublishValidationError('evolution_variant_not_found', `Evolution variant "${input.variantId}" was not found`);
    }
    const lineageAnalysisId = artifact.lineage?.analysisId;
    const analysis = isNonEmptyString(lineageAnalysisId)
        ? await input.store.readAnalysis(lineageAnalysisId)
        : null;
    if (artifact.skillName !== input.skillName) {
        throw createPublishValidationError('evolution_variant_skill_mismatch', `Requested skill "${input.skillName}" does not match artifact skill "${artifact.skillName}"`);
    }
    if (artifact.skillName !== SUPPORTED_SKILL) {
        throw createPublishValidationError('evolution_publish_not_supported', `Publishing is currently supported only for "${SUPPORTED_SKILL}"`);
    }
    if (!isNonEmptyString(artifact.lineage?.analysisId) || !isNonEmptyString(artifact.lineage?.executionId)) {
        throw createPublishValidationError('evolution_variant_analysis_mismatch', 'Artifact lineage is missing required analysis linkage fields');
    }
    if (!isCoherentAnalysisRecord(analysis)) {
        throw createPublishValidationError('evolution_variant_analysis_mismatch', 'Linked analysis record is missing or malformed');
    }
    if (analysis.analysisId !== artifact.lineage.analysisId
        || analysis.skillName !== artifact.skillName
        || analysis.executionId !== artifact.lineage.executionId) {
        throw createPublishValidationError('evolution_variant_analysis_mismatch', 'Linked analysis record does not match artifact lineage');
    }
    if (analysis.evolutionType !== 'FIX') {
        throw createPublishValidationError('evolution_publish_not_supported', `Publishing is not supported for evolutionType "${analysis.evolutionType}"`);
    }
    if (artifact.verification?.passed !== true) {
        throw createPublishValidationError('evolution_variant_not_verified', 'Artifact verification must pass before publishing');
    }
    const scopeHash = artifact.metadata?.scopeHash;
    if (!isNonEmptyString(scopeHash)) {
        throw createPublishValidationError('evolution_variant_scope_hash_missing', 'Artifact metadata.scopeHash is required for publishing');
    }
    const publishedAt = (input.now ?? (() => Date.now()))();
    const shareableBody = (0, shareableArtifact_1.buildShareableArtifactBody)(artifact);
    const tempDirPath = await node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), 'metabot-evolution-artifact-'));
    const tempFilePath = node_path_1.default.join(tempDirPath, `${artifact.variantId}.json`);
    await node_fs_1.promises.writeFile(tempFilePath, `${JSON.stringify(shareableBody)}\n`, 'utf8');
    try {
        const uploadResult = await input.uploadArtifactBody(tempFilePath);
        const metadataWriteRequest = (0, shareableArtifact_1.buildEvolutionArtifactMetadataWriteRequest)({
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
    }
    finally {
        await cleanupTempArtifactFile(tempFilePath, tempDirPath);
    }
}
