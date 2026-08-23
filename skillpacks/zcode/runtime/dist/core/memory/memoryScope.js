"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCAL_MEMORY_CHANNELS = exports.OWNER_SCOPE_KEY = void 0;
exports.isLocalMemoryChannel = isLocalMemoryChannel;
exports.normalizeScopeChannel = normalizeScopeChannel;
exports.normalizeScopeIdentity = normalizeScopeIdentity;
exports.createOwnerMemoryScope = createOwnerMemoryScope;
exports.buildContactScopeKey = buildContactScopeKey;
exports.parseContactScopeKey = parseContactScopeKey;
exports.createContactMemoryScope = createContactMemoryScope;
exports.buildConversationScopeKey = buildConversationScopeKey;
exports.createConversationMemoryScope = createConversationMemoryScope;
exports.normalizeMemoryScopeSelector = normalizeMemoryScopeSelector;
exports.OWNER_SCOPE_KEY = 'owner:self';
/**
 * Channels that mean "the local human's own UI session". Anything else is an
 * external channel and follows the contact/conversation privacy rules.
 * 'cowork_ui' kept for IDBots port parity.
 */
exports.LOCAL_MEMORY_CHANNELS = new Set(['cowork_ui', 'dsh', '']);
function isLocalMemoryChannel(channel) {
    return exports.LOCAL_MEMORY_CHANNELS.has(normalizeScopeChannel(channel));
}
function normalizeScopePart(value) {
    return String(value ?? '').trim();
}
function normalizeScopeChannel(channel) {
    return normalizeScopePart(channel).replace(/\s+/g, '_').toLowerCase();
}
function normalizeScopeIdentity(value) {
    // Preserve caller-provided casing because some upstream IDs may be case-sensitive.
    return normalizeScopePart(value);
}
function createOwnerMemoryScope() {
    return {
        kind: 'owner',
        key: exports.OWNER_SCOPE_KEY,
    };
}
function buildContactScopeKey(input) {
    const channel = normalizeScopeChannel(input.sourceChannel);
    const peerGlobalMetaId = normalizeScopeIdentity(input.peerGlobalMetaId);
    if (!channel || !peerGlobalMetaId) {
        return null;
    }
    return `${channel}:peer:${peerGlobalMetaId}`;
}
/**
 * Reverse of `buildContactScopeKey`: extracts the peer identity from a
 * contact scope key of the form `<channel>:peer:<peerGlobalMetaId>`.
 * Returns null when the key does not follow the contact shape.
 */
function parseContactScopeKey(scopeKey) {
    const key = normalizeScopeIdentity(scopeKey);
    if (!key) {
        return null;
    }
    const peerMarkerIndex = key.indexOf(':peer:');
    if (peerMarkerIndex <= 0) {
        return null;
    }
    const sourceChannel = key.slice(0, peerMarkerIndex);
    const peerGlobalMetaId = key.slice(peerMarkerIndex + ':peer:'.length);
    if (!sourceChannel || !peerGlobalMetaId) {
        return null;
    }
    return {
        sourceChannel,
        peerGlobalMetaId,
    };
}
function createContactMemoryScope(input) {
    const key = buildContactScopeKey(input);
    if (!key) {
        return null;
    }
    return {
        kind: 'contact',
        key,
    };
}
function buildConversationScopeKey(input) {
    const channel = normalizeScopeChannel(input.sourceChannel);
    const externalConversationId = normalizeScopeIdentity(input.externalConversationId);
    if (!channel || !externalConversationId) {
        return null;
    }
    return `${channel}:conversation:${externalConversationId}`;
}
function createConversationMemoryScope(input) {
    const key = buildConversationScopeKey(input);
    if (!key) {
        return null;
    }
    return {
        kind: 'conversation',
        key,
    };
}
function normalizeMemoryScopeSelector(input) {
    const scope = input.scope ?? null;
    const scopeKind = input.scopeKind ?? null;
    const scopeKey = normalizeScopeIdentity(input.scopeKey);
    if (scope) {
        const normalizedScope = {
            kind: scope.kind,
            key: normalizeScopeIdentity(scope.key),
        };
        if (scopeKind && scopeKind !== normalizedScope.kind) {
            throw new Error('Conflicting memory scope selector kind');
        }
        if (scopeKey && scopeKey !== normalizedScope.key) {
            throw new Error('Conflicting memory scope selector key');
        }
        return normalizedScope;
    }
    if (!scopeKind && !scopeKey) {
        return null;
    }
    if (!scopeKind || !scopeKey) {
        throw new Error('Both scopeKind and scopeKey are required when scope is omitted');
    }
    return {
        kind: scopeKind,
        key: scopeKey,
    };
}
