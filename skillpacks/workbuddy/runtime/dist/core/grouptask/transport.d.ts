/**
 * Group Task chain transport: on-chain pin writes (create / join / send /
 * remove) for MetaWeb group chats plus dual-endpoint indexer clients
 * (group-info, member-list, message history, readiness polls).
 *
 * Protocol bodies mirror the proven IDBots groupChatTransport payloads
 * (idchat createChannel / simplegroupjoin / simplegroupchat AES /
 * simplegroupremoveuser). Message encryption reuses the shared AES helpers in
 * core/appSession/groupChat (key = first 16 chars of groupId).
 */
import type { Signer } from '../signing/signer';
/** Dual indexer hosts, same pair the IDBots group-task stack uses. */
export declare const GROUP_TASK_INDEXER_HOSTS: string[];
export interface GroupTaskTransportOptions {
    /** Override indexer hosts (tests / private deployments). */
    indexerHosts?: string[];
    fetchImpl?: typeof fetch;
}
/**
 * Create a public group chat on-chain (/protocols/simplegroupcreate). The
 * returned pinId IS the canonical on-chain groupId (the indexer overrides the
 * body field), so the body groupId is left empty.
 */
export declare function createGroupOnChain(signer: Signer, input: {
    groupName: string;
    groupNote?: string;
}): Promise<{
    groupId: string;
    pinId: string;
}>;
/** Join a public group chat on-chain (/protocols/simplegroupjoin, state 1). */
export declare function joinGroupOnChain(signer: Signer, groupId: string, opts?: {
    referrer?: string;
}): Promise<{
    pinId: string;
}>;
/** Send an AES-encrypted message to a group chat (/protocols/simplegroupchat). */
export declare function sendGroupMessageOnChain(signer: Signer, groupId: string, input: {
    content: string;
    nickName?: string;
    replyPin?: string;
    mention?: string[];
}): Promise<{
    pinId: string;
}>;
/**
 * Remove a member from a group on-chain (/protocols/simplegroupremoveuser).
 * Only the group creator's signature is honored by the indexer, so the caller
 * must pass the CHAIR signer. `removeMetaid` is the kicked member's legacy
 * MetaID (idchat removeMember convention).
 */
export declare function removeGroupMemberOnChain(signer: Signer, groupId: string, input: {
    removeMetaid: string;
    reason?: string;
}): Promise<{
    pinId: string;
}>;
export interface GroupInfoDetails {
    groupId: string;
    createUserMetaId: string;
    createUserGlobalMetaId: string;
}
export type FetchGroupInfoResult = {
    status: 'found';
    info: GroupInfoDetails;
} | {
    status: 'not_found';
} | {
    status: 'error';
};
/**
 * Group-info lookup across both indexer hosts: the first 'found' wins; a
 * definitive 'not_found' from a healthy host is reported when none found the
 * group; 'error' only when every host failed. Never throws.
 */
export declare function fetchGroupInfo(groupId: string, opts?: GroupTaskTransportOptions & {
    timeoutMs?: number;
}): Promise<FetchGroupInfoResult>;
/**
 * Poll the indexer until the newly created group pin is indexed. Tries both
 * hosts each round; returns false on timeout. Never throws.
 */
export declare function waitForGroupIndexed(groupId: string, opts?: GroupTaskTransportOptions & {
    timeoutMs?: number;
}): Promise<boolean>;
/**
 * Thin group-member-list client: raw member identity strings (metaId /
 * globalMetaId forms mixed) or null when every host failed — an empty array
 * is a real, successful empty list. Never throws.
 */
export declare function fetchGroupMembers(groupId: string, opts?: GroupTaskTransportOptions & {
    timeoutMs?: number;
}): Promise<string[] | null>;
/**
 * Poll group-member-list until any of the given identities appears
 * (case-insensitive; pass both GlobalMetaID and legacy metaId forms when
 * both are known). Returns true on the first hit, false on timeout. Never
 * throws.
 */
export declare function waitForMemberJoined(groupId: string, identities: string | string[], opts?: GroupTaskTransportOptions & {
    timeoutMs?: number;
    intervalMs?: number;
}): Promise<boolean>;
/** Raw history item, normalized from the indexer GroupChatItem shape. */
export interface GroupChatHistoryItem {
    index: number | null;
    txId: string;
    pinId: string;
    groupId: string;
    metaId: string;
    globalMetaId: string;
    address: string;
    nickName: string;
    userName: string;
    userAvatar: string;
    content: string;
    contentType: string;
    encryption: string;
    chatType: number | null;
    replyPin: string;
    mention: string[];
    /** Epoch seconds (indexer convention). */
    timestamp: number | null;
}
/**
 * Fetch one history page merged across both indexer hosts, deduplicated by
 * pinId (the record with more populated fields wins) and sorted by index
 * ascending. Throws only when EVERY host failed.
 */
export declare function fetchGroupHistoryPage(groupId: string, startIndex: number, size: number, opts?: GroupTaskTransportOptions): Promise<GroupChatHistoryItem[]>;
