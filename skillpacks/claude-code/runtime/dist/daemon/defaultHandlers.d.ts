import { createRuntimeStateStore, type RuntimeDaemonRecord } from '../core/state/runtimeStateStore';
import type { MetabotDaemonHttpHandlers } from './routes/types';
import type { SessionTraceRecord } from '../core/chat/sessionTrace';
import { exportSessionArtifacts } from '../core/chat/transcriptExport';
import { type FetchPrivateHistory } from '../core/chat/privateConversation';
import type { SecretStore } from '../core/secrets/secretStore';
import type { Signer } from '../core/signing/signer';
import { createSessionStateStore } from '../core/a2a/sessionStateStore';
import type { PrivateChatAutoReplyConfig } from '../core/chat/privateChatTypes';
import type { RequestMvcGasSubsidyOptions, RequestMvcGasSubsidyResult } from '../core/subsidy/requestMvcGasSubsidy';
import { type MetaWebServiceReplyWaiter } from '../core/a2a/metawebReplyWaiter';
import { type MetaWebMasterReplyWaiter } from '../core/master/metawebMasterReplyWaiter';
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
    identitySyncStepDelayMs?: number;
    chainApiBaseUrl?: string;
    idChatApiBaseUrl?: string;
    socketPresenceApiBaseUrl?: string;
    socketPresenceFailureMode?: 'throw' | 'assume_service_providers_online';
    fetchPeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
    fetchPrivateChatHistory?: FetchPrivateHistory;
    callerReplyWaiter?: MetaWebServiceReplyWaiter;
    masterReplyWaiter?: MetaWebMasterReplyWaiter;
    onProviderPresenceChanged?: (enabled: boolean) => Promise<void> | void;
    requestMvcGasSubsidy?: (options: RequestMvcGasSubsidyOptions) => Promise<RequestMvcGasSubsidyResult>;
    autoReplyConfig?: PrivateChatAutoReplyConfig;
}): MetabotDaemonHttpHandlers;
