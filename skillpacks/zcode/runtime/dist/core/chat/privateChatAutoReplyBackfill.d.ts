import { type IdentityProfileRecord } from '../identity/identityProfiles';
import type { MetabotPaths } from '../state/paths';
import type { PrivateChatStateStore } from './privateChatStateStore';
import type { PrivateChatInboundMessage } from './privateChatTypes';
import { type PrivateConversationResponse } from './privateConversation';
export interface LocalPrivateChatIdentity {
    globalMetaId?: string | null;
    privateKeyHex: string;
    chatPublicKey?: string | null;
}
export interface PrivateChatAutoReplyBackfillHistoryInput {
    selfGlobalMetaId: string;
    peerGlobalMetaId: string;
    localPrivateKeyHex: string;
    peerChatPublicKey: string;
    limit: number;
}
export interface PrivateChatAutoReplyBackfillHistoryAfterInput extends PrivateChatAutoReplyBackfillHistoryInput {
    afterIndex: number;
}
export interface PrivateChatAutoReplyBackfillHistoryClient {
    fetchRecent(input: PrivateChatAutoReplyBackfillHistoryInput): Promise<PrivateConversationResponse>;
    fetchAfter(input: PrivateChatAutoReplyBackfillHistoryAfterInput): Promise<PrivateConversationResponse>;
}
export interface PrivateChatAutoReplyBackfillDependencies {
    paths: MetabotPaths;
    stateStore: PrivateChatStateStore;
    selfGlobalMetaId: () => Promise<string | null>;
    getLocalPrivateChatIdentity: () => Promise<LocalPrivateChatIdentity>;
    resolvePeerChatPublicKey: (globalMetaId: string) => Promise<string | null>;
    handleInboundMessage: (message: PrivateChatInboundMessage) => Promise<void>;
    historyClient?: PrivateChatAutoReplyBackfillHistoryClient;
    listPeerGlobalMetaIds?: () => Promise<string[]>;
    resolveChatApiBaseUrl?: () => Promise<string | undefined> | string | undefined;
    fetchImpl?: typeof fetch;
    now?: () => number;
    onError?: (error: Error) => void;
}
export interface PrivateChatAutoReplyBackfillOptions {
    intervalMs?: number;
    recentLimit?: number;
    startupCatchUpMs?: number;
    cursorPath?: string;
}
export interface PrivateChatAutoReplyBackfillSyncResult {
    peers: number;
    processed: number;
    skipped: number;
    failed: number;
}
export interface PrivateChatAutoReplyBackfillLoop {
    syncOnce(): Promise<PrivateChatAutoReplyBackfillSyncResult>;
    start(): void;
    stop(): void;
    isRunning(): boolean;
}
export interface PrivateChatAutoReplyBackfillProfileReport {
    started: IdentityProfileRecord[];
    skipped: Array<{
        profile: IdentityProfileRecord;
        reason: string;
    }>;
}
export interface PrivateChatAutoReplyBackfillProfileManager {
    start(): Promise<PrivateChatAutoReplyBackfillProfileReport>;
    stop(): void;
    isRunning(): boolean;
    getLastReport(): PrivateChatAutoReplyBackfillProfileReport;
}
export declare function createPrivateChatAutoReplyBackfillLoop(deps: PrivateChatAutoReplyBackfillDependencies, options?: PrivateChatAutoReplyBackfillOptions): PrivateChatAutoReplyBackfillLoop;
export declare function createPrivateChatAutoReplyBackfillProfileManager(input: {
    systemHomeDir: string;
    listProfiles?: (systemHomeDir: string) => Promise<IdentityProfileRecord[]>;
    createLoop: (profile: IdentityProfileRecord) => PrivateChatAutoReplyBackfillLoop | null | Promise<PrivateChatAutoReplyBackfillLoop | null>;
}): PrivateChatAutoReplyBackfillProfileManager;
