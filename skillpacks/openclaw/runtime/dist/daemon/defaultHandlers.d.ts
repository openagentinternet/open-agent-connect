import { type MetabotCommandResult } from '../core/contracts/commandResult';
import { createRuntimeStateStore, type RuntimeDaemonRecord } from '../core/state/runtimeStateStore';
import { type MetabotPaths } from '../core/state/paths';
import { testLlmRuntimeReadiness } from '../core/llm/llmRuntimeDiscovery';
import type { LlmRuntime } from '../core/llm/llmTypes';
import type { LlmExecutor } from '../core/llm/executor';
import type { MetabotDaemonHttpHandlers } from './routes/types';
import type { SessionTraceRecord } from '../core/chat/sessionTrace';
import { exportSessionArtifacts } from '../core/chat/transcriptExport';
import type { ChatReplyRunner } from '../core/chat/privateChatTypes';
import { type FetchPrivateHistory } from '../core/chat/privateConversation';
import type { SecretStore } from '../core/secrets/secretStore';
import type { Signer } from '../core/signing/signer';
import { uploadLargeFileToChain, type MvcSponsorV2DirectUploadClient, type ProductionLargeFileUploader } from '../core/files/uploadLargeFile';
import { createMetaAppManOwnerClient } from '../core/metaapp/manOwnerList';
import { createSessionStateStore } from '../core/a2a/sessionStateStore';
import type { PrivateChatAutoReplyConfig } from '../core/chat/privateChatTypes';
import { type A2AConversationMessagePersister } from '../core/a2a/conversationPersistence';
import { assertGitHubToolsReady, buildLoomWorkflowTaskState, createLoomRawCacheStore, createLoomWorkflowStore, createNodeLoomCommandRunner, prepareGitHubForkWorkspace, pushLoomBranch, runLoomAcceptAndPayWorkflow, runLoomClaimAndStartWorkflow, runLoomDeliverWorkflow, runLoomDevRoundWorkflow, runLoomPostTaskWorkflow, runLoomReviewDeliveryWorkflow, createLoomPullRequest, writeLoomProcessLogFile, type LoomUiActionServiceDependencies } from '../core/loom';
import type { RequestMvcGasSubsidyOptions, RequestMvcGasSubsidyResult } from '../core/subsidy/requestMvcGasSubsidy';
import { type ServicePaymentExecutor } from '../core/payments/servicePayment';
import type { ChainAdapterRegistry } from '../core/chain/adapters/types';
import { type MetaWebServiceReplyWaiter } from '../core/a2a/metawebReplyWaiter';
import { type BuyerRatingProtocolTextGenerator, type CallerOrderProtocolTextGenerator, type ProviderOrderProtocolTextGenerator } from '../core/a2a/orderProtocolTextGenerator';
export declare function createLoomDaemonActionHandler(dependencies: LoomUiActionServiceDependencies): NonNullable<NonNullable<MetabotDaemonHttpHandlers['loom']>['actions']>;
interface LoomDaemonActionActorContext {
    homeDir: string;
    paths: MetabotPaths;
    signer: Signer;
    workflowStore: ReturnType<typeof createLoomWorkflowStore>;
    rawCacheStore: ReturnType<typeof createLoomRawCacheStore>;
    metaBotSlug: string;
    globalMetaId: string;
}
interface LoomDaemonActionWorkflowFunctions {
    postTask: typeof runLoomPostTaskWorkflow;
    claimAndStart: typeof runLoomClaimAndStartWorkflow;
    runDevRound: typeof runLoomDevRoundWorkflow;
    deliver: typeof runLoomDeliverWorkflow;
    acceptAndPay: typeof runLoomAcceptAndPayWorkflow;
    reviewDelivery: typeof runLoomReviewDeliveryWorkflow;
}
export declare function createLoomDaemonActionDependencies(input: {
    resolveActor: (rawActor: unknown) => Promise<LoomDaemonActionActorContext | {
        failure: MetabotCommandResult<never>;
    }>;
    resolveTaskState: (actor: LoomDaemonActionActorContext, taskPinId: string, options?: {
        requireFresh?: boolean;
    }) => Promise<ReturnType<typeof buildLoomWorkflowTaskState> | MetabotCommandResult<never>>;
    readPayloadFile: (filePath: string) => Promise<Record<string, unknown>>;
    draftTask: (actor: LoomDaemonActionActorContext, wish: string) => Promise<MetabotCommandResult<unknown>>;
    resolveDeveloperRuntime?: (actor: LoomDaemonActionActorContext) => Promise<{
        developerRuntime?: Record<string, unknown>;
    } | {
        failure: MetabotCommandResult<never>;
    }>;
    ensureDevRoundLlmAvailable?: (actor: LoomDaemonActionActorContext) => Promise<MetabotCommandResult<never> | undefined>;
    executeDevRoundLlm: (actor: LoomDaemonActionActorContext, prompt: string, cwd: string) => ReturnType<Parameters<typeof runLoomDevRoundWorkflow>[0]['executeLlmRound']>;
    walletTransfer: (actor: LoomDaemonActionActorContext, rawActor: unknown, transferInput: Parameters<Parameters<typeof runLoomAcceptAndPayWorkflow>[0]['walletTransfer']>[0]) => Promise<MetabotCommandResult<unknown>>;
    writeChain: (actor: LoomDaemonActionActorContext) => (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    uploadFile: (actor: LoomDaemonActionActorContext) => (uploadInput: {
        filePath: string;
        network: string;
        contentType?: string;
    }) => Promise<{
        metafileUri?: string;
        uri?: string;
        pinId?: string;
        network?: string;
    }>;
    runnerFactory: typeof createNodeLoomCommandRunner;
    github: {
        assertToolsReady: typeof assertGitHubToolsReady;
        prepareForkWorkspace: typeof prepareGitHubForkWorkspace;
        pushLoomBranch: typeof pushLoomBranch;
        createLoomPullRequest: typeof createLoomPullRequest;
    };
    writeLogFile: typeof writeLoomProcessLogFile;
    removePath: (targetPath: string) => Promise<void>;
    renamePath: (from: string, to: string) => Promise<void>;
    pathExists: (targetPath: string) => Promise<boolean>;
    dashboardAfterAction?: LoomUiActionServiceDependencies['dashboardAfterAction'];
    workflows?: Partial<LoomDaemonActionWorkflowFunctions>;
}): LoomUiActionServiceDependencies;
export declare function resolveServiceOrderPaymentMetadata(currency: unknown): {
    paymentChain?: 'mvc' | 'btc';
    settlementKind?: 'native';
};
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
export declare function createDefaultMetabotDaemonHandlers(input: {
    homeDir: string;
    systemHomeDir?: string;
    getDaemonRecord: () => RuntimeDaemonRecord | null;
    secretStore?: SecretStore;
    signer?: Signer;
    adapters?: ChainAdapterRegistry;
    identitySyncStepDelayMs?: number;
    chainApiBaseUrl?: string;
    idChatApiBaseUrl?: string;
    socketPresenceApiBaseUrl?: string;
    socketPresenceFailureMode?: 'throw' | 'assume_service_providers_online';
    fetchPeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
    fetchPrivateChatHistory?: FetchPrivateHistory;
    callerReplyWaiter?: MetaWebServiceReplyWaiter;
    servicePaymentExecutor?: ServicePaymentExecutor;
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
    onProviderPresenceChanged?: (enabled: boolean) => Promise<void> | void;
    onIdentityProfileRegistered?: () => Promise<void> | void;
    requestMvcGasSubsidy?: (options: RequestMvcGasSubsidyOptions) => Promise<RequestMvcGasSubsidyResult>;
    createSignerForHome?: (homeDir: string) => Signer;
    autoReplyConfig?: PrivateChatAutoReplyConfig;
    llmExecutor?: Pick<LlmExecutor, 'execute' | 'getSession' | 'cancel' | 'listSessions' | 'streamEvents'>;
    providerRuntimeCanStart?: (runtime: LlmRuntime) => Promise<boolean> | boolean;
    testLlmRuntimeReadiness?: typeof testLlmRuntimeReadiness;
    conversationGuidanceReplyRunner?: ChatReplyRunner;
    metaAppManFetch?: NonNullable<Parameters<typeof createMetaAppManOwnerClient>[0]>['fetchFn'];
    env?: NodeJS.ProcessEnv;
}): MetabotDaemonHttpHandlers;
export {};
