import { createRuntimeStateStore, type RuntimeDaemonRecord } from '../core/state/runtimeStateStore';
import { discoverLlmRuntimes, testLlmRuntimeReadiness } from '../core/llm/llmRuntimeDiscovery';
import type { LlmRuntime } from '../core/llm/llmTypes';
import type { LlmExecutor } from '../core/llm/executor';
import type { MetabotDaemonHttpHandlers } from './routes/types';
import type { SessionTraceRecord } from '../core/chat/sessionTrace';
import { exportSessionArtifacts } from '../core/chat/transcriptExport';
import type { ChatReplyRunner } from '../core/chat/privateChatTypes';
import { type FetchPrivateHistory } from '../core/chat/privateConversation';
import type { ScheduleStore } from '../core/schedule/store';
import type { SecretStore } from '../core/secrets/secretStore';
import type { Signer } from '../core/signing/signer';
import { uploadLargeFileToChain, type MvcSponsorV2DirectUploadClient, type ProductionLargeFileUploader } from '../core/files/uploadLargeFile';
import { type TrafficAccountService } from '../core/traffic/trafficAccountService';
import { createMetaAppManOwnerClient } from '../core/metaapp/manOwnerList';
import { createSessionStateStore } from '../core/a2a/sessionStateStore';
import type { PrivateChatAutoReplyConfig } from '../core/chat/privateChatTypes';
import { type A2AConversationMessagePersister } from '../core/a2a/conversationPersistence';
import type { RequestMvcGasSubsidyOptions, RequestMvcGasSubsidyResult } from '../core/subsidy/requestMvcGasSubsidy';
import { type ServicePaymentExecutor } from '../core/payments/servicePayment';
import { verifyServiceOrderPayment } from '../core/payments/servicePaymentVerification';
import type { ChainAdapterRegistry } from '../core/chain/adapters/types';
import type { AppSessionRuntimeStartReport } from '../core/appSession/types';
import { type MetaWebServiceReplyWaiter } from '../core/a2a/metawebReplyWaiter';
import { type BuyerRatingProtocolTextGenerator, type CallerOrderProtocolTextGenerator, type ProviderOrderProtocolTextGenerator } from '../core/a2a/orderProtocolTextGenerator';
export declare function resolveServiceOrderPaymentMetadata(currency: unknown): {
    paymentChain?: 'mvc' | 'btc';
    settlementKind?: 'native';
};
export type PeerChatPublicKeyOutcome = {
    status: 'found';
    chatPublicKey: string;
} | {
    status: 'absent';
} | {
    status: 'unreachable';
    errors: string[];
};
export declare function lookupPeerChatPublicKey(globalMetaId: string, options?: {
    chainApiBaseUrl?: string;
}): Promise<PeerChatPublicKeyOutcome>;
export declare function fetchPeerChatPublicKey(globalMetaId: string, options?: {
    chainApiBaseUrl?: string;
}): Promise<string | null>;
export declare function rebuildTraceArtifactsFromSessionState(input: {
    baseTrace: SessionTraceRecord;
    runtimeStateStore: ReturnType<typeof createRuntimeStateStore>;
    sessionStateStore: ReturnType<typeof createSessionStateStore>;
}): Promise<{
    trace: SessionTraceRecord;
    artifacts: Awaited<ReturnType<typeof exportSessionArtifacts>>;
}>;
export declare function llmDiscoverySweepRunningForHomeDir(homeDir: string): boolean;
export interface A2ACallerReplyResumeReport {
    scanned: number;
    armed: number;
    timedOut: number;
    skipped: number;
    failed: number;
}
export interface BuyerOrderDeadlineSweepReport {
    scanned: number;
    timedOut: number;
    skipped: number;
}
export declare function createDefaultMetabotDaemonHandlers(input: {
    homeDir: string;
    systemHomeDir?: string;
    getDaemonRecord: () => RuntimeDaemonRecord | null;
    secretStore?: SecretStore;
    signer?: Signer;
    adapters?: ChainAdapterRegistry;
    identitySyncStepDelayMs?: number;
    chainApiBaseUrl?: string;
    chatApiBaseUrl?: string;
    socketPresenceApiBaseUrl?: string;
    socketPresenceFailureMode?: 'throw' | 'assume_service_providers_online';
    fetchPeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
    fetchPrivateChatHistory?: FetchPrivateHistory;
    callerReplyWaiter?: MetaWebServiceReplyWaiter;
    servicePaymentExecutor?: ServicePaymentExecutor;
    serviceOrderPaymentVerifier?: typeof verifyServiceOrderPayment;
    ratingFollowupRetryDelaysMs?: number[];
    a2aConversationPersister?: A2AConversationMessagePersister;
    buyerRatingReplyRunner?: ChatReplyRunner;
    buyerRatingTextGenerator?: BuyerRatingProtocolTextGenerator;
    callerOrderTextGenerator?: CallerOrderProtocolTextGenerator;
    providerOrderReplyRunner?: ChatReplyRunner;
    providerOrderTextGenerator?: ProviderOrderProtocolTextGenerator;
    uploadLargeFile?: typeof uploadLargeFileToChain;
    providerArtifactUploadLargeFile?: typeof uploadLargeFileToChain;
    providerLargeFileUploader?: ProductionLargeFileUploader | null;
    createProviderLargeFileUploader?: () => ProductionLargeFileUploader;
    createMvcSponsorClient?: () => MvcSponsorV2DirectUploadClient;
    /** Shared traffic account service (流量); defaults to one instance per daemon process. */
    trafficAccountService?: TrafficAccountService;
    onProviderPresenceChanged?: (enabled: boolean) => Promise<void> | void;
    onIdentityProfileRegistered?: () => Promise<void> | void;
    onBrowserInfrastructureChanged?: () => Promise<void> | void;
    requestMvcGasSubsidy?: (options: RequestMvcGasSubsidyOptions) => Promise<RequestMvcGasSubsidyResult>;
    createSignerForHome?: (homeDir: string) => Signer;
    autoReplyConfig?: PrivateChatAutoReplyConfig;
    llmExecutor?: Pick<LlmExecutor, 'execute' | 'getSession' | 'cancel' | 'listSessions' | 'streamEvents'>;
    providerRuntimeCanStart?: (runtime: LlmRuntime) => Promise<boolean> | boolean;
    /** Scheduled-task verbs: shared per-profile store instances + host leases
     *  owned by the daemon process (the tick and the routes must mutate the
     *  same store instances / lease map). */
    schedule?: {
        createScheduleStore?: (homeDir: string) => ScheduleStore;
        hostLeases?: Map<string, {
            host: string;
            expiresAtMs: number;
        }>;
    };
    providerOrderProgressNoticeIntervalMs?: number;
    testLlmRuntimeReadiness?: typeof testLlmRuntimeReadiness;
    discoverLlmRuntimes?: typeof discoverLlmRuntimes;
    conversationGuidanceReplyRunner?: ChatReplyRunner;
    metaAppManFetch?: NonNullable<Parameters<typeof createMetaAppManOwnerClient>[0]>['fetchFn'];
    conversationProfileFetch?: typeof fetch;
    env?: NodeJS.ProcessEnv;
}): MetabotDaemonHttpHandlers & {
    resolveAutoReplyConfigForHome: (homeDir: string) => Promise<PrivateChatAutoReplyConfig>;
    resumePendingCallerReplyContinuations: (inputResume?: {
        localProfileSlug?: string | null;
    }) => Promise<A2ACallerReplyResumeReport>;
    sweepBuyerOrderDeadlines: (nowMs?: number) => Promise<BuyerOrderDeadlineSweepReport>;
    startAppSessionRuntime: () => Promise<AppSessionRuntimeStartReport>;
    stopAppSessionRuntime: () => Promise<void>;
};
