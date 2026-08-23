"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMemoryScopes = resolveMemoryScopes;
// Channel → memory scope resolution, ported from IDBots
// src/main/memory/memoryScopeResolver.ts. Local UI sessions read/write the
// owner scope; direct external channels get a per-contact scope; group/shared
// channels get a per-conversation scope. External sessions additionally read
// only the owner's external-safe operational preferences — never owner
// profile facts.
const memoryScope_1 = require("./memoryScope");
const GROUP_OR_SHARED_CHANNEL_HINTS = ['group', 'order', 'shared', 'orchestrator'];
const DIRECT_EXTERNAL_CHANNELS = new Set(['metaweb_private']);
const STRUCTURED_DIRECT_CHANNEL_SUFFIX = ':direct';
function isGroupOrSharedChannel(sourceChannel) {
    return GROUP_OR_SHARED_CHANNEL_HINTS.some((hint) => sourceChannel.includes(hint));
}
function isDirectExternalSession(sourceChannel, groupOrShared) {
    if (groupOrShared) {
        return false;
    }
    return DIRECT_EXTERNAL_CHANNELS.has(sourceChannel)
        || sourceChannel.endsWith(STRUCTURED_DIRECT_CHANNEL_SUFFIX);
}
function withOwnerOperationalPreferences(writeScope) {
    return {
        writeScope,
        readScopes: [writeScope],
        ownerReadPolicy: 'operational_preference_only',
        resolutionReason: writeScope.kind === 'contact' ? 'contact_direct' : 'conversation_fallback',
    };
}
function ownerOnlyResolution() {
    const ownerScope = (0, memoryScope_1.createOwnerMemoryScope)();
    return {
        writeScope: ownerScope,
        readScopes: [ownerScope],
        ownerReadPolicy: 'all',
        resolutionReason: 'owner_default',
    };
}
function resolveMemoryScopes(input) {
    const sourceChannel = (0, memoryScope_1.normalizeScopeChannel)(input.sourceChannel);
    if ((0, memoryScope_1.isLocalMemoryChannel)(sourceChannel)) {
        return ownerOnlyResolution();
    }
    const groupOrShared = isGroupOrSharedChannel(sourceChannel);
    if (isDirectExternalSession(sourceChannel, groupOrShared)) {
        const contactScope = (0, memoryScope_1.createContactMemoryScope)({
            sourceChannel,
            peerGlobalMetaId: input.peerGlobalMetaId,
        });
        if (contactScope) {
            return withOwnerOperationalPreferences(contactScope);
        }
    }
    const conversationScope = (0, memoryScope_1.createConversationMemoryScope)({
        sourceChannel,
        externalConversationId: input.externalConversationId,
    });
    if (conversationScope) {
        return withOwnerOperationalPreferences(conversationScope);
    }
    return ownerOnlyResolution();
}
