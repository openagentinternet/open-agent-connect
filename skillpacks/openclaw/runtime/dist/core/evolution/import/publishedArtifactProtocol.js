"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVOLUTION_SEARCH_MAX_RAW_ROWS = exports.EVOLUTION_ARTIFACT_PROTOCOL_VERSION = void 0;
exports.isSafeEvolutionIdentifier = isSafeEvolutionIdentifier;
exports.parseMetafilePinId = parseMetafilePinId;
exports.parsePublishedArtifactMetadata = parsePublishedArtifactMetadata;
exports.validateShareableArtifactBody = validateShareableArtifactBody;
const localEvolutionStore_1 = require("../localEvolutionStore");
const protocol_1 = require("../protocol");
Object.defineProperty(exports, "EVOLUTION_ARTIFACT_PROTOCOL_VERSION", { enumerable: true, get: function () { return protocol_1.EVOLUTION_ARTIFACT_PROTOCOL_VERSION; } });
exports.EVOLUTION_SEARCH_MAX_RAW_ROWS = 100;
const METAFILE_SCHEME = 'metafile://';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function toNonEmptyString(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function toFiniteNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value !== 'string' || value.trim().length === 0)
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function parseContentSummary(value) {
    if (!value)
        return null;
    if (isRecord(value))
        return value;
    if (typeof value !== 'string')
        return null;
    try {
        const parsed = JSON.parse(value);
        return isRecord(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function normalizeMetadataSource(value) {
    if (!isRecord(value)) {
        return null;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'contentSummary')) {
        return parseContentSummary(value.contentSummary);
    }
    return value;
}
function parseLineage(value) {
    if (!isRecord(value))
        return null;
    const lineageId = toNonEmptyString(value.lineageId);
    const rootVariantId = toNonEmptyString(value.rootVariantId);
    const executionId = toNonEmptyString(value.executionId);
    const analysisId = toNonEmptyString(value.analysisId);
    const createdAt = toFiniteNumber(value.createdAt);
    if (!lineageId
        || !rootVariantId
        || !executionId
        || !analysisId
        || createdAt == null
        || !isSafeEvolutionIdentifier(lineageId)
        || !isSafeEvolutionIdentifier(rootVariantId)
        || !isSafeEvolutionIdentifier(executionId)
        || !isSafeEvolutionIdentifier(analysisId)) {
        return null;
    }
    const parentVariantIdRaw = value.parentVariantId;
    const parentVariantId = parentVariantIdRaw == null
        ? null
        : toNonEmptyString(parentVariantIdRaw);
    if (parentVariantIdRaw != null && (!parentVariantId || !isSafeEvolutionIdentifier(parentVariantId))) {
        return null;
    }
    return {
        lineageId,
        parentVariantId,
        rootVariantId,
        executionId,
        analysisId,
        createdAt,
    };
}
function parseScope(value) {
    if (!isRecord(value))
        return null;
    if (!Array.isArray(value.allowedCommands) || value.allowedCommands.some((item) => typeof item !== 'string')) {
        return null;
    }
    if (typeof value.chainRead !== 'boolean'
        || typeof value.chainWrite !== 'boolean'
        || typeof value.localUiOpen !== 'boolean'
        || typeof value.remoteDelegation !== 'boolean') {
        return null;
    }
    return {
        allowedCommands: [...value.allowedCommands],
        chainRead: value.chainRead,
        chainWrite: value.chainWrite,
        localUiOpen: value.localUiOpen,
        remoteDelegation: value.remoteDelegation,
    };
}
function parseScopeMetadata(value) {
    if (!isRecord(value))
        return null;
    if (typeof value.sameSkill !== 'boolean' || typeof value.sameScope !== 'boolean') {
        return null;
    }
    const scopeHash = value.scopeHash == null ? null : toNonEmptyString(value.scopeHash);
    if (value.scopeHash != null && scopeHash == null) {
        return null;
    }
    return {
        sameSkill: value.sameSkill,
        sameScope: value.sameScope,
        scopeHash,
    };
}
function parseVerification(value) {
    if (!isRecord(value))
        return null;
    const checkedAt = toFiniteNumber(value.checkedAt);
    if (typeof value.passed !== 'boolean'
        || typeof value.protocolCompatible !== 'boolean'
        || typeof value.replayValid !== 'boolean'
        || typeof value.notWorseThanBase !== 'boolean'
        || checkedAt == null) {
        return null;
    }
    const notes = value.notes == null ? undefined : toNonEmptyString(value.notes);
    if (value.notes != null && typeof notes !== 'string') {
        return null;
    }
    const normalizedNotes = typeof notes === 'string' ? notes : undefined;
    return {
        passed: value.passed,
        checkedAt,
        protocolCompatible: value.protocolCompatible,
        replayValid: value.replayValid,
        notWorseThanBase: value.notWorseThanBase,
        notes: normalizedNotes,
    };
}
const ALLOWED_PATCH_KEYS = new Set([
    'instructionsPatch',
    'commandTemplatePatch',
    'outputExpectationPatch',
    'fallbackPolicyPatch',
]);
function parsePatch(value) {
    if (!isRecord(value)) {
        return null;
    }
    const patch = {};
    for (const [key, keyValue] of Object.entries(value)) {
        if (!ALLOWED_PATCH_KEYS.has(key) || typeof keyValue !== 'string') {
            return null;
        }
        patch[key] = keyValue;
    }
    return patch;
}
function isSafeEvolutionIdentifier(value) {
    return (typeof value === 'string'
        && value.length > 0
        && value !== '.'
        && value !== '..'
        && localEvolutionStore_1.SAFE_IDENTIFIER_PATTERN.test(value));
}
function parseMetafilePinId(uri) {
    if (typeof uri !== 'string' || !uri.startsWith(METAFILE_SCHEME)) {
        return null;
    }
    const raw = uri.slice(METAFILE_SCHEME.length).trim().replace(/^\/+/, '');
    if (raw.includes('/')) {
        return null;
    }
    return isSafeEvolutionIdentifier(raw) ? raw : null;
}
function parsePublishedArtifactMetadata(value) {
    const source = normalizeMetadataSource(value);
    if (!source) {
        return null;
    }
    const protocolVersion = toNonEmptyString(source.protocolVersion);
    const skillName = toNonEmptyString(source.skillName);
    const variantId = toNonEmptyString(source.variantId);
    const artifactUri = toNonEmptyString(source.artifactUri);
    const evolutionType = toNonEmptyString(source.evolutionType);
    const triggerSource = toNonEmptyString(source.triggerSource);
    const scopeHash = toNonEmptyString(source.scopeHash);
    const publisherGlobalMetaId = toNonEmptyString(source.publisherGlobalMetaId);
    const artifactCreatedAt = toFiniteNumber(source.artifactCreatedAt);
    const artifactUpdatedAt = toFiniteNumber(source.artifactUpdatedAt);
    const publishedAt = toFiniteNumber(source.publishedAt);
    const lineage = parseLineage(source.lineage);
    if (protocolVersion !== protocol_1.EVOLUTION_ARTIFACT_PROTOCOL_VERSION
        || evolutionType !== 'FIX'
        || !skillName
        || !variantId
        || !artifactUri
        || !triggerSource
        || !scopeHash
        || !publisherGlobalMetaId
        || artifactCreatedAt == null
        || artifactUpdatedAt == null
        || publishedAt == null
        || !lineage) {
        return null;
    }
    if (!isSafeEvolutionIdentifier(variantId)
        || parseMetafilePinId(artifactUri) == null
        || typeof source.sameSkill !== 'boolean'
        || typeof source.sameScope !== 'boolean'
        || typeof source.verificationPassed !== 'boolean'
        || typeof source.replayValid !== 'boolean'
        || typeof source.notWorseThanBase !== 'boolean') {
        return null;
    }
    return {
        protocolVersion: protocol_1.EVOLUTION_ARTIFACT_PROTOCOL_VERSION,
        skillName,
        variantId,
        artifactUri,
        evolutionType: 'FIX',
        triggerSource,
        scopeHash,
        sameSkill: source.sameSkill,
        sameScope: source.sameScope,
        verificationPassed: source.verificationPassed,
        replayValid: source.replayValid,
        notWorseThanBase: source.notWorseThanBase,
        lineage,
        publisherGlobalMetaId,
        artifactCreatedAt,
        artifactUpdatedAt,
        publishedAt,
    };
}
function validateShareableArtifactBody(value) {
    if (!isRecord(value)) {
        return null;
    }
    const variantId = toNonEmptyString(value.variantId);
    const skillName = toNonEmptyString(value.skillName);
    const createdAt = toFiniteNumber(value.createdAt);
    const updatedAt = toFiniteNumber(value.updatedAt);
    const scope = parseScope(value.scope);
    const metadata = parseScopeMetadata(value.metadata);
    const patch = parsePatch(value.patch);
    const lineage = parseLineage(value.lineage);
    const verification = parseVerification(value.verification);
    if (!variantId
        || !skillName
        || !isSafeEvolutionIdentifier(variantId)
        || !scope
        || !metadata
        || !patch
        || !lineage
        || !verification
        || createdAt == null
        || updatedAt == null) {
        return null;
    }
    return {
        variantId,
        skillName,
        status: 'inactive',
        adoption: 'manual',
        scope,
        metadata,
        patch,
        lineage,
        verification,
        createdAt,
        updatedAt,
    };
}
