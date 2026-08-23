"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPrivateReplyMemoryContext = buildPrivateReplyMemoryContext;
exports.recordPrivateChatMemoryTurn = recordPrivateChatMemoryTurn;
const experienceStore_1 = require("../memory/experienceStore");
const memoryService_1 = require("../memory/memoryService");
/**
 * The memory/experience injection for one A2A reply. Returns '' when the
 * Bot's memory policy is disabled or nothing is stored; never throws.
 */
async function buildPrivateReplyMemoryContext(paths, input) {
    try {
        const result = await (0, memoryService_1.buildMemoryBlocksForRequest)(paths, {
            channel: 'metaweb_private',
            peerGlobalMetaId: input.peerGlobalMetaId,
            userText: input.userText,
        });
        return result.xml;
    }
    catch {
        return '';
    }
}
/**
 * Post-reply bookkeeping for one A2A exchange: memory extraction into the
 * contact scope plus an experience episode/evidence record for the dream
 * pipeline's impression candidates. Best-effort — failures are swallowed so
 * the reply loop never breaks on memory bookkeeping.
 */
async function recordPrivateChatMemoryTurn(paths, input) {
    try {
        await (0, memoryService_1.applyTurnMemoryExtraction)(paths, {
            userText: input.userText,
            assistantText: input.assistantText,
            channel: 'metaweb_private',
            peerGlobalMetaId: input.peerGlobalMetaId,
            sessionId: input.conversationId,
            userMessageId: input.inboundMessageId ?? undefined,
        });
    }
    catch {
        // extraction failure must not affect the reply loop
    }
    try {
        const experience = (0, experienceStore_1.createExperienceStore)(paths);
        const episode = await experience.createEpisode({
            ownerGlobalMetaId: input.selfGlobalMetaId,
            episodeType: 'direct_interaction',
            sourceChannel: 'metaweb_private',
            sourceKey: `metaweb_private:${input.conversationId}`,
            sessionId: input.conversationId,
            externalConversationId: input.conversationId,
            status: 'open',
            startedAt: input.inboundTimestamp ?? Date.now(),
        });
        await experience.addParticipant({
            episodeId: episode.id,
            globalMetaId: input.peerGlobalMetaId,
            role: 'peer',
            source: 'a2a',
        });
        await experience.addParticipant({
            episodeId: episode.id,
            globalMetaId: input.selfGlobalMetaId,
            role: 'self',
            source: 'a2a',
        });
        if (input.inboundMessageId && input.userText.trim()) {
            await experience.addEvidence({
                episodeId: episode.id,
                evidenceType: 'message',
                sourceKey: `simplemsg:${input.inboundMessageId}`,
                pinId: input.inboundPinId ?? null,
                publisherGlobalMetaId: input.peerGlobalMetaId,
                messageId: input.inboundMessageId,
                contentHash: (0, experienceStore_1.hashExperienceContent)(input.userText),
                occurredAt: input.inboundTimestamp ?? Date.now(),
            });
        }
    }
    catch {
        // experience recording failure must not affect the reply loop
    }
}
