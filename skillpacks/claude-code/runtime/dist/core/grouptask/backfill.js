"use strict";
/**
 * Group Task message backfill: reconcile the local decrypted transcript cache
 * with the on-chain history (group-chat-list-by-index across both indexer
 * hosts). Chain history is the source of truth; the cache is an idempotent
 * projection keyed by pinId and ordered by chain index.
 *
 * Attribution rule (ported from IDBots round-4): the chain identity is the
 * ONLY trust source. A message whose GlobalMetaID cannot be resolved OR is
 * neither a task member nor the owner is marked senderSuspect — display-only,
 * never triggers replies, never contributes deliverables.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncGroupMessages = syncGroupMessages;
const groupChat_1 = require("../appSession/groupChat");
const transport_1 = require("./transport");
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_ROWS_PER_SYNC = 200;
function normalizeGmid(value) {
    return (value ?? '').trim().toLowerCase();
}
/**
 * Pull new messages (index > local cursor) into the cache. Returns counts;
 * throws when every indexer host failed (callers treat it as a soft failure).
 */
async function syncGroupMessages(input) {
    const pageSize = Math.max(1, Math.trunc(input.pageSize ?? DEFAULT_PAGE_SIZE));
    const maxRows = Math.max(pageSize, Math.trunc(input.maxRows ?? DEFAULT_MAX_ROWS_PER_SYNC));
    const result = { fetched: 0, inserted: 0 };
    const cursor = await input.store.getMessageCursor(input.groupId);
    let startIndex = cursor < 0 ? 0 : cursor + 1;
    while (result.fetched < maxRows) {
        const size = Math.min(pageSize, maxRows - result.fetched);
        const page = await (0, transport_1.fetchGroupHistoryPage)(input.groupId, startIndex, size, input.transport);
        if (page.length === 0)
            break;
        const messages = page.map((item) => {
            const gmid = normalizeGmid(item.globalMetaId);
            const content = item.encryption === 'aes'
                ? (0, groupChat_1.decryptGroupContent)(item.content, input.groupId)
                : item.content;
            return {
                index: item.index ?? -1,
                pinId: item.pinId || null,
                txId: item.txId || null,
                senderMetaId: item.metaId || item.globalMetaId || item.address || '',
                senderGlobalMetaId: item.globalMetaId || null,
                senderName: item.userName || item.nickName || null,
                senderAvatar: item.userAvatar || null,
                content,
                contentType: item.contentType || null,
                chainTimestamp: item.timestamp,
                replyPin: item.replyPin || null,
                mention: item.mention,
                senderSuspect: !gmid || !input.trustedGlobalMetaIds.has(gmid),
            };
        }).filter((message) => message.index >= 0);
        result.fetched += page.length;
        result.inserted += await input.store.appendMessages(input.groupId, messages);
        if (page.length < size)
            break; // short page: no more history
        startIndex += page.length;
    }
    return result;
}
