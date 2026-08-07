/**
 * Group chat client for the App/Game Runtime.
 *
 * Docs/10: Agent-Game-v2 reuses the existing simplegroupchat group as an
 * event bus. The runtime reads through `group-chat-list-by-index` (socket is
 * only a realtime notification; history is the source of truth), decrypts
 * `simplegroupchat` content with the public AES group scheme and parses the
 * `agent-game/1` envelope.
 */
import { type AgentGameEnvelope, type GroupChatMessage } from './types';
/**
 * Group message secret key: the first 16 UTF-8 characters of groupId, padded
 * with '0'. Matches idchat / the chess MetaApp (`js/groupCrypto.js`).
 */
export declare function groupIdToSecretKey(groupId: string): string;
/**
 * AES-128-CBC + PKCS7 group message encryption with the public IV
 * "0000000000000000"; ciphertext is hex encoded. Host-side write path uses
 * this to encrypt the game event before the pin write.
 */
export declare function encryptGroupContent(plaintext: string, groupId: string): string;
/**
 * Decrypt a simplegroupchat content field. When the ciphertext does not
 * decrypt (public/unencrypted group or foreign message), return the original
 * text unchanged — matching idchat convention.
 */
export declare function decryptGroupContent(content: string, groupId: string): string;
export declare function normalizeGroupChatMessage(raw: unknown): GroupChatMessage | null;
/**
 * Fetch messages with index >= startIndex from `group-chat-list-by-index`.
 * Returns messages sorted by index ascending; callers deduplicate by index.
 */
export declare function fetchGroupMessages(input: {
    chatApiBaseUrl: string;
    groupId: string;
    startIndex: number;
    size?: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}): Promise<GroupChatMessage[]>;
/**
 * Parse the decrypted simplegroupchat plaintext as an agent-game/1 envelope.
 * Returns null for non-game content so normal group traffic is ignored.
 */
export declare function parseAgentGameEnvelope(plaintext: string): AgentGameEnvelope | null;
/**
 * Build a group chat write payload body (the JSON value of the
 * simplegroupchat pin), matching the idchat / chess MetaApp shape exactly.
 */
export declare function buildGroupChatWritePayload(input: {
    groupId: string;
    plaintext: string;
    nickName?: string;
    replyPin?: string;
    mention?: string[];
    now?: number;
}): Record<string, unknown>;
