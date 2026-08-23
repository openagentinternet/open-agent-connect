"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROUP_TASK_INDEXER_HOSTS = void 0;
exports.createGroupOnChain = createGroupOnChain;
exports.joinGroupOnChain = joinGroupOnChain;
exports.sendGroupMessageOnChain = sendGroupMessageOnChain;
exports.removeGroupMemberOnChain = removeGroupMemberOnChain;
exports.fetchGroupInfo = fetchGroupInfo;
exports.waitForGroupIndexed = waitForGroupIndexed;
exports.fetchGroupMembers = fetchGroupMembers;
exports.waitForMemberJoined = waitForMemberJoined;
exports.fetchGroupHistoryPage = fetchGroupHistoryPage;
const groupChat_1 = require("../appSession/groupChat");
/** Dual indexer hosts, same pair the IDBots group-task stack uses. */
exports.GROUP_TASK_INDEXER_HOSTS = ['https://api.idchat.io', 'https://www.show.now'];
const DEFAULT_INDEX_TIMEOUT_MS = 60_000;
const INDEX_POLL_INTERVAL_MS = 2_000;
const MEMBER_LIST_TIMEOUT_MS = 10_000;
function resolveHosts(opts) {
    const hosts = (opts?.indexerHosts ?? exports.GROUP_TASK_INDEXER_HOSTS)
        .map((host) => host.trim().replace(/\/+$/u, ''))
        .filter(Boolean);
    return hosts.length > 0 ? hosts : exports.GROUP_TASK_INDEXER_HOSTS;
}
function resolveFetch(opts) {
    return opts?.fetchImpl ?? globalThis.fetch;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// ---------------------------------------------------------------------------
// Chain writes (signer-injected; every write is an MVC pin)
// ---------------------------------------------------------------------------
/**
 * Create a public group chat on-chain (/protocols/simplegroupcreate). The
 * returned pinId IS the canonical on-chain groupId (the indexer overrides the
 * body field), so the body groupId is left empty.
 */
async function createGroupOnChain(signer, input) {
    const body = {
        groupId: '',
        communityId: '',
        groupName: input.groupName,
        groupNote: input.groupNote ?? '',
        groupIcon: '',
        groupType: '1', // idchat PublicText: '1' = AES-encrypted messages
        status: '1',
        type: '0', // public
        tickId: '',
        collectionId: '',
        limitAmount: '',
        chatSettingType: 0, // everyone may speak
        deleteStatus: 0,
        path: '',
        timestamp: Math.floor(Date.now() / 1000), // idchat uses seconds
    };
    const result = await signer.writePin({
        operation: 'create',
        path: '/protocols/simplegroupcreate',
        contentType: 'application/json',
        payload: JSON.stringify(body),
        network: 'mvc',
    });
    return { groupId: result.pinId, pinId: result.pinId };
}
/** Join a public group chat on-chain (/protocols/simplegroupjoin, state 1). */
async function joinGroupOnChain(signer, groupId, opts) {
    const body = {
        groupId,
        state: 1,
        referrer: opts?.referrer ?? '',
        k: '', // public groups have no transferable key
    };
    const result = await signer.writePin({
        operation: 'create',
        path: '/protocols/simplegroupjoin',
        contentType: 'application/json',
        payload: JSON.stringify(body),
        network: 'mvc',
    });
    return { pinId: result.pinId };
}
/** Send an AES-encrypted message to a group chat (/protocols/simplegroupchat). */
async function sendGroupMessageOnChain(signer, groupId, input) {
    const payload = (0, groupChat_1.buildGroupChatWritePayload)({
        groupId,
        plaintext: input.content,
        nickName: input.nickName,
        replyPin: input.replyPin,
        mention: input.mention,
    });
    const result = await signer.writePin({
        operation: 'create',
        path: '/protocols/simplegroupchat',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        network: 'mvc',
    });
    return { pinId: result.pinId };
}
/**
 * Remove a member from a group on-chain (/protocols/simplegroupremoveuser).
 * Only the group creator's signature is honored by the indexer, so the caller
 * must pass the CHAIR signer. `removeMetaid` is the kicked member's legacy
 * MetaID (idchat removeMember convention).
 */
async function removeGroupMemberOnChain(signer, groupId, input) {
    const body = {
        removeMetaid: input.removeMetaid,
        groupId,
        reason: input.reason?.trim() ?? '',
        timestamp: Math.floor(Date.now() / 1000),
    };
    const result = await signer.writePin({
        operation: 'create',
        path: '/protocols/simplegroupremoveuser',
        contentType: 'application/json',
        encryption: '0',
        payload: JSON.stringify(body),
        network: 'mvc',
    });
    return { pinId: result.pinId };
}
function isIndexedGroupInfo(json, groupId) {
    if (!json || typeof json !== 'object')
        return false;
    const envelope = json;
    if (envelope.code !== 0)
        return false;
    const data = envelope.data;
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return false;
    const record = data;
    if ('groupId' in record)
        return record.groupId === groupId;
    return Object.keys(record).length > 0;
}
async function fetchGroupInfoOnce(host, groupId, timeoutMs, fetchImpl) {
    const url = `${host}/chat-api/group-chat/group-info?groupId=${encodeURIComponent(groupId)}`;
    let json;
    try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok)
            return { status: 'error' };
        json = await response.json();
    }
    catch {
        return { status: 'error' };
    }
    if (!isIndexedGroupInfo(json, groupId))
        return { status: 'not_found' };
    const data = json.data;
    return {
        status: 'found',
        info: {
            groupId: typeof data.groupId === 'string' && data.groupId.trim() ? data.groupId.trim() : groupId,
            createUserMetaId: typeof data.createUserMetaId === 'string' ? data.createUserMetaId.trim() : '',
            createUserGlobalMetaId: typeof data.createUserGlobalMetaId === 'string' ? data.createUserGlobalMetaId.trim() : '',
        },
    };
}
/**
 * Group-info lookup across both indexer hosts: the first 'found' wins; a
 * definitive 'not_found' from a healthy host is reported when none found the
 * group; 'error' only when every host failed. Never throws.
 */
async function fetchGroupInfo(groupId, opts) {
    const timeoutMs = Math.max(1_000, opts?.timeoutMs ?? MEMBER_LIST_TIMEOUT_MS);
    const fetchImpl = resolveFetch(opts);
    let sawNotFound = false;
    for (const host of resolveHosts(opts)) {
        const result = await fetchGroupInfoOnce(host, groupId, timeoutMs, fetchImpl);
        if (result.status === 'found')
            return result;
        if (result.status === 'not_found')
            sawNotFound = true;
    }
    return sawNotFound ? { status: 'not_found' } : { status: 'error' };
}
/**
 * Poll the indexer until the newly created group pin is indexed. Tries both
 * hosts each round; returns false on timeout. Never throws.
 */
async function waitForGroupIndexed(groupId, opts) {
    const timeoutMs = Math.max(0, opts?.timeoutMs ?? DEFAULT_INDEX_TIMEOUT_MS);
    const fetchImpl = resolveFetch(opts);
    const hosts = resolveHosts(opts);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        for (const host of hosts) {
            const result = await fetchGroupInfoOnce(host, groupId, MEMBER_LIST_TIMEOUT_MS, fetchImpl);
            if (result.status === 'found')
                return true;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            return false;
        await sleep(Math.min(INDEX_POLL_INTERVAL_MS, remaining));
    }
}
function collectMemberIdentities(data) {
    const found = new Set();
    const push = (value) => {
        const text = typeof value === 'string' ? value.trim() : '';
        if (text)
            found.add(text);
    };
    const pushEntry = (entry) => {
        if (typeof entry === 'string') {
            push(entry);
            return;
        }
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            return;
        const record = entry;
        push(record.metaId);
        push(record.globalMetaId);
    };
    if (Array.isArray(data)) {
        data.forEach(pushEntry);
        return [...found];
    }
    if (!data || typeof data !== 'object')
        return [];
    const record = data;
    if (Array.isArray(record.list))
        record.list.forEach(pushEntry);
    if (Array.isArray(record.admins))
        record.admins.forEach(pushEntry);
    pushEntry(record.creator);
    return [...found];
}
async function fetchGroupMembersOnce(host, groupId, timeoutMs, fetchImpl) {
    const url = `${host}/chat-api/group-chat/group-member-list?groupId=${encodeURIComponent(groupId)}`;
    try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok)
            return null;
        const json = await response.json();
        if (!json || typeof json !== 'object')
            return null;
        const envelope = json;
        if (envelope.code !== 0)
            return null;
        return collectMemberIdentities(envelope.data);
    }
    catch {
        return null;
    }
}
/**
 * Thin group-member-list client: raw member identity strings (metaId /
 * globalMetaId forms mixed) or null when every host failed — an empty array
 * is a real, successful empty list. Never throws.
 */
async function fetchGroupMembers(groupId, opts) {
    const timeoutMs = Math.max(1_000, opts?.timeoutMs ?? MEMBER_LIST_TIMEOUT_MS);
    const fetchImpl = resolveFetch(opts);
    for (const host of resolveHosts(opts)) {
        const members = await fetchGroupMembersOnce(host, groupId, timeoutMs, fetchImpl);
        if (members)
            return members;
    }
    return null;
}
/**
 * Poll group-member-list until any of the given identities appears
 * (case-insensitive; pass both GlobalMetaID and legacy metaId forms when
 * both are known). Returns true on the first hit, false on timeout. Never
 * throws.
 */
async function waitForMemberJoined(groupId, identities, opts) {
    const candidates = new Set((Array.isArray(identities) ? identities : [identities])
        .map((value) => String(value ?? '').trim().toLowerCase())
        .filter((value) => value.length > 0));
    if (candidates.size === 0)
        return false;
    const timeoutMs = Math.max(0, opts?.timeoutMs ?? DEFAULT_INDEX_TIMEOUT_MS);
    const intervalMs = Math.max(250, opts?.intervalMs ?? INDEX_POLL_INTERVAL_MS);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const members = await fetchGroupMembers(groupId, opts);
        if (members && members.some((member) => candidates.has(member.trim().toLowerCase()))) {
            return true;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            return false;
        await sleep(Math.min(intervalMs, remaining));
    }
}
const toSafeString = (value) => {
    if (typeof value === 'string')
        return value.trim();
    if (value == null)
        return '';
    return String(value).trim();
};
const toNullableNumber = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num))
        return null;
    return Math.trunc(num);
};
function normalizeHistoryItem(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const record = raw;
    const txId = toSafeString(record.txId);
    const pinId = toSafeString(record.pinId) || (txId ? `${txId}i0` : '');
    if (!pinId)
        return null;
    const userInfo = record.userInfo && typeof record.userInfo === 'object' && !Array.isArray(record.userInfo)
        ? record.userInfo
        : {};
    return {
        index: toNullableNumber(record.index),
        txId,
        pinId,
        groupId: toSafeString(record.groupId),
        metaId: toSafeString(record.metaId),
        globalMetaId: toSafeString(record.globalMetaId),
        address: toSafeString(record.address),
        nickName: toSafeString(record.nickName),
        userName: toSafeString(userInfo.name),
        userAvatar: toSafeString(userInfo.avatar),
        content: toSafeString(record.content),
        contentType: toSafeString(record.contentType),
        encryption: toSafeString(record.encryption) || toSafeString(record.encrypt),
        chatType: toNullableNumber(record.chatType),
        replyPin: toSafeString(record.replyPin),
        mention: Array.isArray(record.mention) ? record.mention.map(toSafeString).filter(Boolean) : [],
        timestamp: toNullableNumber(record.timestamp),
    };
}
const scoreHistoryItem = (item) => [
    item.txId,
    item.pinId,
    item.groupId,
    item.metaId,
    item.globalMetaId,
    item.address,
    item.content,
    item.contentType,
    item.encryption,
    item.replyPin,
].filter(Boolean).length;
async function fetchHistoryPageOnce(host, groupId, startIndex, size, fetchImpl) {
    const url = new URL(`${host}/chat-api/group-chat/group-chat-list-by-index`);
    url.searchParams.set('groupId', groupId);
    url.searchParams.set('startIndex', String(Math.max(0, Math.trunc(startIndex))));
    url.searchParams.set('size', String(Math.max(1, Math.trunc(size))));
    try {
        const response = await fetchImpl(url.toString(), {
            signal: AbortSignal.timeout(MEMBER_LIST_TIMEOUT_MS),
        });
        if (!response.ok)
            return null;
        const json = await response.json();
        if (typeof json?.code === 'number' && json.code !== 0)
            return [];
        const data = json?.data;
        const list = Array.isArray(data)
            ? data
            : Array.isArray(data?.list)
                ? data.list
                : [];
        return list
            .map(normalizeHistoryItem)
            .filter((item) => Boolean(item));
    }
    catch {
        return null;
    }
}
/**
 * Fetch one history page merged across both indexer hosts, deduplicated by
 * pinId (the record with more populated fields wins) and sorted by index
 * ascending. Throws only when EVERY host failed.
 */
async function fetchGroupHistoryPage(groupId, startIndex, size, opts) {
    const fetchImpl = resolveFetch(opts);
    const hosts = resolveHosts(opts);
    const lists = await Promise.all(hosts.map((host) => fetchHistoryPageOnce(host, groupId, startIndex, size, fetchImpl)));
    if (lists.every((list) => list === null)) {
        throw new Error('All group history endpoints failed');
    }
    const merged = new Map();
    for (const item of lists.flatMap((list) => list ?? [])) {
        const key = item.pinId || item.txId;
        if (!key)
            continue;
        const existing = merged.get(key);
        if (!existing || scoreHistoryItem(item) >= scoreHistoryItem(existing)) {
            merged.set(key, item);
        }
    }
    return [...merged.values()].sort((left, right) => {
        const leftIndex = left.index ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = right.index ?? Number.MAX_SAFE_INTEGER;
        if (leftIndex !== rightIndex)
            return leftIndex - rightIndex;
        return (left.timestamp ?? 0) - (right.timestamp ?? 0);
    });
}
