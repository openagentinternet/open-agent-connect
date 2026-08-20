// A2A private-chat memory glue for the daemon auto-reply path, porting the
// IDBots privateChatDaemon behavior: inject the scoped memory + experience
// blocks into the reply prompt (contact scope + external-safe owner
// operational preferences only — the privacy gate lives in the memory
// module), then after a successful reply run post-turn extraction (contact
// write scope) and record the exchange in the experience ledger (hashes and
// references only, never raw private text).
import type { MetabotPaths } from '../state/paths';
import { hashExperienceContent, createExperienceStore } from '../memory/experienceStore';
import {
  applyTurnMemoryExtraction,
  buildMemoryBlocksForRequest,
} from '../memory/memoryService';

/**
 * The memory/experience injection for one A2A reply. Returns '' when the
 * Bot's memory policy is disabled or nothing is stored; never throws.
 */
export async function buildPrivateReplyMemoryContext(
  paths: MetabotPaths,
  input: {
    peerGlobalMetaId: string;
    userText?: string;
  },
): Promise<string> {
  try {
    const result = await buildMemoryBlocksForRequest(paths, {
      channel: 'metaweb_private',
      peerGlobalMetaId: input.peerGlobalMetaId,
      userText: input.userText,
    });
    return result.xml;
  } catch {
    return '';
  }
}

/**
 * Post-reply bookkeeping for one A2A exchange: memory extraction into the
 * contact scope plus an experience episode/evidence record for the dream
 * pipeline's impression candidates. Best-effort — failures are swallowed so
 * the reply loop never breaks on memory bookkeeping.
 */
export async function recordPrivateChatMemoryTurn(
  paths: MetabotPaths,
  input: {
    selfGlobalMetaId: string;
    peerGlobalMetaId: string;
    conversationId: string;
    inboundMessageId?: string | null;
    inboundPinId?: string | null;
    inboundTimestamp?: number;
    userText: string;
    assistantText: string;
  },
): Promise<void> {
  try {
    await applyTurnMemoryExtraction(paths, {
      userText: input.userText,
      assistantText: input.assistantText,
      channel: 'metaweb_private',
      peerGlobalMetaId: input.peerGlobalMetaId,
      sessionId: input.conversationId,
      userMessageId: input.inboundMessageId ?? undefined,
    });
  } catch {
    // extraction failure must not affect the reply loop
  }

  try {
    const experience = createExperienceStore(paths);
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
        contentHash: hashExperienceContent(input.userText),
        occurredAt: input.inboundTimestamp ?? Date.now(),
      });
    }
  } catch {
    // experience recording failure must not affect the reply loop
  }
}
