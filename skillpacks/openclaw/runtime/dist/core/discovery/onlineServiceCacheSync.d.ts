import { type SocketPresenceFailureMode } from './chainDirectoryReader';
import { type OnlineServiceCacheState, type OnlineServiceCacheStore } from './onlineServiceCache';
import type { RatingDetailStateStore } from '../ratings/ratingDetailState';
export interface RefreshOnlineServiceCacheInput {
    store: OnlineServiceCacheStore;
    ratingDetailStateStore?: RatingDetailStateStore;
    chainApiBaseUrl?: string;
    socketPresenceApiBaseUrl?: string;
    socketPresenceFailureMode?: SocketPresenceFailureMode;
    fetchSeededDirectoryServices?: () => Promise<Array<Record<string, unknown>>>;
    resolvePeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
    now?: () => number;
}
export declare function refreshOnlineServiceCacheFromChain(input: RefreshOnlineServiceCacheInput): Promise<OnlineServiceCacheState>;
