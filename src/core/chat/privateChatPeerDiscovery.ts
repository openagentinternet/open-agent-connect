import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveA2AConversationFilePath } from '../a2a/conversationStore';
import type { A2AConversationState } from '../a2a/conversationTypes';
import type { IdentityProfileRecord } from '../identity/identityProfiles';
import { resolveMetabotPaths } from '../state/paths';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function listLocalA2AProjectedPeerGlobalMetaIds(input: {
  profiles: IdentityProfileRecord[];
  selfGlobalMetaId: string;
}): Promise<string[]> {
  const selfGlobalMetaId = normalizeText(input.selfGlobalMetaId);
  const normalizedSelf = selfGlobalMetaId.toLowerCase();
  if (!selfGlobalMetaId) return [];

  const peers = await Promise.all(input.profiles.map(async (profile) => {
    const candidateGlobalMetaId = normalizeText(profile.globalMetaId);
    if (!candidateGlobalMetaId || candidateGlobalMetaId.toLowerCase() === normalizedSelf) {
      return null;
    }

    const paths = resolveMetabotPaths(profile.homeDir);
    const conversationPath = resolveA2AConversationFilePath(
      paths,
      candidateGlobalMetaId,
      selfGlobalMetaId,
    );
    try {
      const conversation = JSON.parse(
        await fs.readFile(conversationPath, 'utf8'),
      ) as A2AConversationState;
      const storedLocal = normalizeText(conversation.local?.globalMetaId).toLowerCase();
      const storedPeer = normalizeText(conversation.peer?.globalMetaId).toLowerCase();
      const hasOutboundMessage = Array.isArray(conversation.messages)
        && conversation.messages.some((message) => message?.direction === 'outgoing');
      return storedLocal === candidateGlobalMetaId.toLowerCase()
        && storedPeer === normalizedSelf
        && hasOutboundMessage
        ? candidateGlobalMetaId
        : null;
    } catch {
      return null;
    }
  }));

  return peers.filter((peer): peer is string => Boolean(peer));
}

export async function buildLocalA2AProjectedPeerIndex(
  profiles: IdentityProfileRecord[],
): Promise<Map<string, string[]>> {
  const entries = await Promise.all(profiles.map(async (profile) => {
    const candidateGlobalMetaId = normalizeText(profile.globalMetaId);
    if (!candidateGlobalMetaId) return [];
    const paths = resolveMetabotPaths(profile.homeDir);
    let fileNames: string[];
    try {
      fileNames = await fs.readdir(paths.a2aRoot);
    } catch {
      return [];
    }

    const projectedPeers = await Promise.all(fileNames
      .filter((fileName) => fileName.startsWith('chat-') && fileName.endsWith('.json'))
      .map(async (fileName) => {
        try {
          const conversation = JSON.parse(
            await fs.readFile(path.join(paths.a2aRoot, fileName), 'utf8'),
          ) as A2AConversationState;
          const storedLocal = normalizeText(conversation.local?.globalMetaId);
          const storedPeer = normalizeText(conversation.peer?.globalMetaId);
          const hasOutboundMessage = Array.isArray(conversation.messages)
            && conversation.messages.some((message) => message?.direction === 'outgoing');
          return storedLocal.toLowerCase() === candidateGlobalMetaId.toLowerCase()
            && storedPeer
            && hasOutboundMessage
            ? { recipient: storedPeer.toLowerCase(), sender: candidateGlobalMetaId }
            : null;
        } catch {
          return null;
        }
      }));
    return projectedPeers.filter((entry): entry is { recipient: string; sender: string } => Boolean(entry));
  }));

  const index = new Map<string, Set<string>>();
  for (const entry of entries.flat()) {
    const senders = index.get(entry.recipient) ?? new Set<string>();
    senders.add(entry.sender);
    index.set(entry.recipient, senders);
  }
  return new Map(Array.from(index.entries(), ([recipient, senders]) => (
    [recipient, Array.from(senders)]
  )));
}
