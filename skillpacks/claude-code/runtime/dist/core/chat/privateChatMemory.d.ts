import type { MetabotPaths } from '../state/paths';
/**
 * The memory/experience injection for one A2A reply. Returns '' when the
 * Bot's memory policy is disabled or nothing is stored; never throws.
 */
export declare function buildPrivateReplyMemoryContext(paths: MetabotPaths, input: {
    peerGlobalMetaId: string;
    userText?: string;
}): Promise<string>;
/**
 * Post-reply bookkeeping for one A2A exchange: memory extraction into the
 * contact scope plus an experience episode/evidence record for the dream
 * pipeline's impression candidates. Best-effort — failures are swallowed so
 * the reply loop never breaks on memory bookkeeping.
 */
export declare function recordPrivateChatMemoryTurn(paths: MetabotPaths, input: {
    selfGlobalMetaId: string;
    peerGlobalMetaId: string;
    conversationId: string;
    inboundMessageId?: string | null;
    inboundPinId?: string | null;
    inboundTimestamp?: number;
    userText: string;
    assistantText: string;
}): Promise<void>;
