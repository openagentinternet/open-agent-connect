import { type MetabotCommandResult } from '../core/contracts/commandResult';
import { type IdentityProfileRecord } from '../core/identity/identityProfiles';
import { type MetabotPaths } from '../core/state/paths';
import type { Signer } from '../core/signing/signer';
import { type A2ASimplemsgListenerManager, type A2ASimplemsgListenerStartReport } from '../core/a2a/simplemsgListener';
import { type A2ASimplemsgPresenceWatchdog } from '../core/a2a/simplemsgPresenceWatchdog';
import { type PrivateChatAutoReplyDependencies, type PrivateChatAutoReplyOrchestrator } from '../core/chat/privateChatAutoReply';
import { type PrivateChatAutoReplyBackfillProfileManager } from '../core/chat/privateChatAutoReplyBackfill';
import type { ChatReplyRunner, PrivateChatAutoReplyConfig, PrivateChatInboundMessage } from '../core/chat/privateChatTypes';
import { createLlmRuntimeStore } from '../core/llm/llmRuntimeStore';
import { createLlmBindingStore } from '../core/llm/llmBindingStore';
import { createLlmRuntimeResolver } from '../core/llm/llmRuntimeResolver';
import { LlmExecutor } from '../core/llm/executor';
import type { CliDependencies, CliRuntimeContext } from './types';
export declare const LOOM_DRAFT_LLM_TIMEOUT_MS = 120000;
export declare const LOOM_DEV_ROUND_LLM_TIMEOUT_MS = 900000;
type A2ASimplemsgInboundDispatcherMessage = Pick<PrivateChatInboundMessage, 'fromGlobalMetaId' | 'content' | 'messagePinId' | 'timestamp'> & Partial<PrivateChatInboundMessage>;
export declare function buildA2ASimplemsgInboundDispatcher(input: {
    handleOrderProtocolMessage?: (message: A2ASimplemsgInboundDispatcherMessage) => Promise<MetabotCommandResult<unknown>> | MetabotCommandResult<unknown>;
    handleGenericPrivateChatMessage: (message: PrivateChatInboundMessage) => Promise<void> | void;
    logWarning?: (scope: string, error: unknown) => void;
}): (message: A2ASimplemsgInboundDispatcherMessage) => Promise<void>;
export declare function refreshA2ASimplemsgListenerForIdentityProfileRegistration(input: {
    enabled: boolean;
    listener: Pick<A2ASimplemsgListenerManager, 'start' | 'stop'>;
    backfill?: Pick<PrivateChatAutoReplyBackfillProfileManager, 'start' | 'stop'>;
    watchdog?: Pick<A2ASimplemsgPresenceWatchdog, 'start' | 'stop'>;
}): Promise<{
    refreshed: boolean;
    report: A2ASimplemsgListenerStartReport | null;
}>;
type ServiceRefundSyncIntervalHandle = {
    unref?: () => void;
};
export interface ServiceRefundSyncLoop {
    runOnce: () => Promise<void>;
    stop: () => void;
}
export declare function createServiceRefundSyncLoop(input: {
    syncRefunds: () => Promise<unknown>;
    intervalMs?: number;
    setIntervalFn?: (callback: () => Promise<void>, intervalMs: number) => ServiceRefundSyncIntervalHandle;
    clearIntervalFn?: (handle: ServiceRefundSyncIntervalHandle) => void;
    logWarning?: (message: string) => void;
}): ServiceRefundSyncLoop;
export declare function getDefaultDaemonPort(_systemHomeDir?: string): number;
export declare function getDaemonRuntimeFingerprint(rootDir?: string): string;
export declare function buildDaemonConfigHash(env: NodeJS.ProcessEnv, options?: {
    runtimeFingerprint?: string;
}): string;
export interface DaemonStatusProbe {
    reachable: boolean;
    ownerId: string | null;
    pid: number | null;
}
export declare function probeDaemonStatus(baseUrl: string, timeoutMs?: number): Promise<DaemonStatusProbe>;
export interface PrivateChatAutoReplyProfileDispatcher {
    handleInboundMessage(profile: IdentityProfileRecord, message: PrivateChatInboundMessage): Promise<void>;
}
export interface PrivateChatAutoReplyProfileDispatcherOptions {
    autoReplyConfig: PrivateChatAutoReplyConfig;
    resolvePeerChatPublicKey: (globalMetaId: string) => Promise<string | null>;
    llmExecutor: Pick<LlmExecutor, 'execute' | 'getSession'>;
    handleOrderProtocolMessageForProfile?: (profile: IdentityProfileRecord, message: A2ASimplemsgInboundDispatcherMessage) => Promise<MetabotCommandResult<unknown>> | MetabotCommandResult<unknown>;
    createSignerForHome?: (homeDir: string) => Signer;
    createReplyRunnerForProfile?: (input: {
        paths: MetabotPaths;
        metaBotSlug: string;
        runtimeResolver: ReturnType<typeof createLlmRuntimeResolver>;
        runtimeStore: ReturnType<typeof createLlmRuntimeStore>;
        bindingStore: ReturnType<typeof createLlmBindingStore>;
        llmExecutor: Pick<LlmExecutor, 'execute' | 'getSession'>;
    }) => ChatReplyRunner;
    createOrchestrator?: (deps: PrivateChatAutoReplyDependencies, config: PrivateChatAutoReplyConfig) => PrivateChatAutoReplyOrchestrator;
    resolveAutoReplyConfigForHome?: (homeDir: string) => PrivateChatAutoReplyConfig;
}
type A2ARecoveredOrderProtocolMessage = A2ASimplemsgInboundDispatcherMessage & {
    localProfileSlug?: string | null;
};
export declare function createPrivateChatReplyRunnerForProfile(input: {
    paths: MetabotPaths;
    metaBotSlug: string;
    runtimeResolver: ReturnType<typeof createLlmRuntimeResolver>;
    runtimeStore: ReturnType<typeof createLlmRuntimeStore>;
    bindingStore: ReturnType<typeof createLlmBindingStore>;
    llmExecutor: Pick<LlmExecutor, 'execute' | 'getSession'>;
    env?: NodeJS.ProcessEnv;
    logWarning?: (scope: string, message: string) => void;
}): ChatReplyRunner;
export interface A2AUnhandledOrderReplayResult {
    profiles: number;
    conversations: number;
    scanned: number;
    replayed: number;
    skipped: number;
    failed: number;
}
export interface A2AUnhandledOrderReplayOptions {
    systemHomeDir: string;
    activeHomeDir?: string | null;
    handleOrderProtocolMessage?: (message: A2ARecoveredOrderProtocolMessage) => Promise<MetabotCommandResult<unknown>> | MetabotCommandResult<unknown>;
    listProfiles?: (systemHomeDir: string) => Promise<IdentityProfileRecord[]>;
    maxMessagesPerProfile?: number;
    logWarning?: (scope: string, error: unknown) => void;
}
export declare function replayUnhandledA2AOrderMessagesForProfiles(input: A2AUnhandledOrderReplayOptions): Promise<A2AUnhandledOrderReplayResult>;
export declare function createPrivateChatAutoReplyProfileDispatcher(input: PrivateChatAutoReplyProfileDispatcherOptions): PrivateChatAutoReplyProfileDispatcher;
export declare function resolvePeerChatPublicKeyFromLocalProfiles(systemHomeDir: string, globalMetaId: string): Promise<string | null>;
export declare function createPeerChatPublicKeyResolver(input: {
    systemHomeDir: string;
    fetchPeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
    chainApiBaseUrl?: string;
}): (globalMetaId: string) => Promise<string | null>;
export declare function createDefaultCliDependencies(context: CliRuntimeContext): CliDependencies;
export declare function mergeCliDependencies(context: CliRuntimeContext): CliDependencies;
export declare function serveCliDaemonProcess(context: Pick<CliRuntimeContext, 'env' | 'cwd'>): Promise<never>;
export {};
