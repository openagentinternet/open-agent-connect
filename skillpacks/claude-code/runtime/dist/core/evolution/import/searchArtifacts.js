"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVOLUTION_SEARCH_MAX_RAW_ROWS = void 0;
exports.deriveResolvedScopeHash = deriveResolvedScopeHash;
exports.searchPublishedEvolutionArtifacts = searchPublishedEvolutionArtifacts;
const publishedArtifactProtocol_1 = require("./publishedArtifactProtocol");
Object.defineProperty(exports, "EVOLUTION_SEARCH_MAX_RAW_ROWS", { enumerable: true, get: function () { return publishedArtifactProtocol_1.EVOLUTION_SEARCH_MAX_RAW_ROWS; } });
function toNonEmptyString(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function isSameOrNewerCandidate(input) {
    if (input.incomingPublishedAt !== input.currentPublishedAt) {
        return input.incomingPublishedAt > input.currentPublishedAt;
    }
    return input.incomingPinId.localeCompare(input.currentPinId) < 0;
}
function parseTriggerSource(value) {
    if (value === 'hard_failure' || value === 'soft_failure' || value === 'manual_recovery') {
        return value;
    }
    return null;
}
function createMissingScopeHashError() {
    return new Error('evolution_scope_hash_missing');
}
function createSearchError(code, detail) {
    return new Error(`${code}:${detail}`);
}
function deriveResolvedScopeHash(resolved) {
    const scopedHash = toNonEmptyString(resolved.scopeMetadata?.scopeHash);
    if (scopedHash) {
        return scopedHash;
    }
    try {
        const serialized = JSON.stringify(resolved.scope);
        if (typeof serialized !== 'string' || serialized.length === 0) {
            throw createMissingScopeHashError();
        }
        return serialized;
    }
    catch (error) {
        if (error instanceof Error && error.message === 'evolution_scope_hash_missing') {
            throw error;
        }
        throw createMissingScopeHashError();
    }
}
async function searchPublishedEvolutionArtifacts(input) {
    let rawRows;
    try {
        const fetchedRows = await input.fetchMetadataRows();
        if (!Array.isArray(fetchedRows)) {
            throw createSearchError('evolution_search_result_invalid', 'invalid_page_payload');
        }
        rawRows = fetchedRows.slice(0, publishedArtifactProtocol_1.EVOLUTION_SEARCH_MAX_RAW_ROWS);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('evolution_search_result_invalid:')) {
            throw new Error(message);
        }
        throw createSearchError('evolution_chain_query_failed', message);
    }
    let remoteIndex;
    try {
        remoteIndex = await input.remoteStore.readIndex();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw createSearchError('evolution_search_index_failed', message);
    }
    const dedupedByVariantId = new Map();
    for (const row of rawRows) {
        const pinId = toNonEmptyString(row?.pinId);
        if (!pinId) {
            continue;
        }
        const metadata = (0, publishedArtifactProtocol_1.parsePublishedArtifactMetadata)(row.payload);
        if (!metadata) {
            continue;
        }
        const triggerSource = parseTriggerSource(metadata.triggerSource);
        if (!triggerSource) {
            continue;
        }
        if (metadata.skillName !== input.skillName
            || metadata.scopeHash !== input.resolvedScopeHash
            || metadata.verificationPassed !== true) {
            continue;
        }
        const existing = dedupedByVariantId.get(metadata.variantId);
        if (existing && !isSameOrNewerCandidate({
            incomingPublishedAt: metadata.publishedAt,
            incomingPinId: pinId,
            currentPublishedAt: existing.publishedAt,
            currentPinId: existing.pinId,
        })) {
            continue;
        }
        const importedPinId = remoteIndex.byVariantId[metadata.variantId]?.pinId ?? null;
        dedupedByVariantId.set(metadata.variantId, {
            pinId,
            variantId: metadata.variantId,
            skillName: metadata.skillName,
            artifactUri: metadata.artifactUri,
            publisherGlobalMetaId: metadata.publisherGlobalMetaId,
            publishedAt: metadata.publishedAt,
            scopeHash: metadata.scopeHash,
            triggerSource,
            verificationPassed: metadata.verificationPassed,
            replayValid: metadata.replayValid,
            notWorseThanBase: metadata.notWorseThanBase,
            alreadyImported: importedPinId !== null,
            importedPinId,
        });
    }
    const results = [...dedupedByVariantId.values()].sort((left, right) => {
        const publishedAtSort = right.publishedAt - left.publishedAt;
        if (publishedAtSort !== 0)
            return publishedAtSort;
        return left.pinId.localeCompare(right.pinId);
    });
    return {
        skillName: input.skillName,
        scopeHash: input.resolvedScopeHash,
        count: results.length,
        results,
    };
}
