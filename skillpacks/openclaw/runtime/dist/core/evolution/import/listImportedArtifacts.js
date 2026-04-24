"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listImportedEvolutionArtifacts = listImportedEvolutionArtifacts;
const publishedArtifactProtocol_1 = require("./publishedArtifactProtocol");
const SUPPORTED_SKILL = 'metabot-network-directory';
function createListError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function toNonEmptyString(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function toFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function normalizeSidecar(value) {
    if (!isRecord(value)) {
        return null;
    }
    const pinId = toNonEmptyString(value.pinId);
    const variantId = toNonEmptyString(value.variantId);
    const publisherGlobalMetaId = toNonEmptyString(value.publisherGlobalMetaId);
    const artifactUri = toNonEmptyString(value.artifactUri);
    const skillName = toNonEmptyString(value.skillName);
    const scopeHash = toNonEmptyString(value.scopeHash);
    const publishedAt = toFiniteNumber(value.publishedAt);
    const importedAt = toFiniteNumber(value.importedAt);
    if (!pinId
        || !variantId
        || !publisherGlobalMetaId
        || !artifactUri
        || !skillName
        || !scopeHash
        || publishedAt == null
        || importedAt == null) {
        return null;
    }
    return {
        pinId,
        variantId,
        publisherGlobalMetaId,
        artifactUri,
        skillName,
        scopeHash,
        publishedAt,
        importedAt,
    };
}
async function listImportedEvolutionArtifacts(input) {
    if (input.skillName !== SUPPORTED_SKILL) {
        throw createListError('evolution_imported_not_supported', `Import is currently supported only for "${SUPPORTED_SKILL}"`);
    }
    const remoteIndex = await input.remoteStore.readIndex();
    const results = [];
    for (const variantId of remoteIndex.imports) {
        let rawSidecar;
        let rawArtifact;
        try {
            [rawSidecar, rawArtifact] = await Promise.all([
                input.remoteStore.readSidecar(variantId),
                input.remoteStore.readArtifact(variantId),
            ]);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw createListError('evolution_imported_artifact_invalid', `Imported artifact "${variantId}" could not be read: ${message}`);
        }
        if (rawSidecar == null || rawArtifact == null) {
            continue;
        }
        const sidecar = normalizeSidecar(rawSidecar);
        const artifact = (0, publishedArtifactProtocol_1.validateShareableArtifactBody)(rawArtifact);
        if (!sidecar || !artifact) {
            throw createListError('evolution_imported_artifact_invalid', `Imported artifact "${variantId}" is malformed`);
        }
        if (sidecar.variantId !== variantId
            || artifact.variantId !== variantId
            || sidecar.skillName !== input.skillName
            || artifact.skillName !== input.skillName
            || remoteIndex.byVariantId[variantId]?.pinId !== sidecar.pinId
            || sidecar.scopeHash !== artifact.metadata.scopeHash) {
            throw createListError('evolution_imported_artifact_invalid', `Imported artifact "${variantId}" has inconsistent metadata`);
        }
        const active = input.activeRef?.source === 'remote' && input.activeRef.variantId === variantId;
        results.push({
            variantId,
            pinId: sidecar.pinId,
            skillName: sidecar.skillName,
            publisherGlobalMetaId: sidecar.publisherGlobalMetaId,
            artifactUri: sidecar.artifactUri,
            publishedAt: sidecar.publishedAt,
            importedAt: sidecar.importedAt,
            scopeHash: sidecar.scopeHash,
            verificationPassed: artifact.verification.passed,
            replayValid: artifact.verification.replayValid,
            notWorseThanBase: artifact.verification.notWorseThanBase,
            active,
        });
    }
    results.sort((left, right) => {
        const importedAtSort = right.importedAt - left.importedAt;
        if (importedAtSort !== 0) {
            return importedAtSort;
        }
        return left.variantId.localeCompare(right.variantId);
    });
    return {
        skillName: input.skillName,
        count: results.length,
        results,
    };
}
