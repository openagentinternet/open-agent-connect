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
import { type GroupTaskTransportOptions } from './transport';
import type { GroupTaskStore } from './store';
export interface SyncGroupMessagesInput {
    store: GroupTaskStore;
    groupId: string;
    /** Active (non-removed) member GlobalMetaIDs plus the owner's, lowercase. */
    trustedGlobalMetaIds: Set<string>;
    transport?: GroupTaskTransportOptions;
    pageSize?: number;
    maxRows?: number;
}
export interface SyncGroupMessagesResult {
    fetched: number;
    inserted: number;
}
/**
 * Pull new messages (index > local cursor) into the cache. Returns counts;
 * throws when every indexer host failed (callers treat it as a soft failure).
 */
export declare function syncGroupMessages(input: SyncGroupMessagesInput): Promise<SyncGroupMessagesResult>;
