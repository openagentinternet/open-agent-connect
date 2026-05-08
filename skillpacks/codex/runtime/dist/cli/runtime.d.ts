import { type MetabotCommandResult } from '../core/contracts/commandResult';
import { type IdentityProfileRecord } from '../core/identity/identityProfiles';
import { type MetabotPaths } from '../core/state/paths';
import type { Signer } from '../core/signing/signer';
import { type PrivateChatAutoReplyDependencies, type PrivateChatAutoReplyOrchestrator } from '../core/chat/privateChatAutoReply';
import type { ChatReplyRunner, PrivateChatAutoReplyConfig, PrivateChatInboundMessage } from '../core/chat/privateChatTypes';
import { createLlmRuntimeResolver } from '../core/llm/llmRuntimeResolver';
import { LlmExecutor } from '../core/llm/executor';
import type { CliDependencies, CliRuntimeContext } from './types';
type A2ASimplemsgInboundDispatcherMessage = Pick<PrivateChatInboundMessage, 'fromGlobalMetaId' | 'content' | 'messagePinId' | 'timestamp'> & Partial<PrivateChatInboundMessage>;
export declare function buildA2ASimplemsgInboundDispatcher(input: {
    handleOrderProtocolMessage?: (message: A2ASimplemsgInboundDispatcherMessage) => Promise<MetabotCommandResult<unknown>> | MetabotCommandResult<unknown>;
    handleGenericPrivateChatMessage: (message: PrivateChatInboundMessage) => Promise<void> | void;
    logWarning?: (scope: string, error: unknown) => void;
}): (message: A2ASimplemsgInboundDispatcherMessage) => Promise<void>;
export declare function getDefaultDaemonPort(homeDir?: string): number;
export declare function getDaemonRuntimeFingerprint(rootDir?: string): string;
export declare function buildDaemonConfigHash(env: NodeJS.ProcessEnv, options?: {
    runtimeFingerprint?: string;
}): string;
export interface PrivateChatAutoReplyProfileDispatcher {
    handleInboundMessage(profile: IdentityProfileRecord, message: PrivateChatInboundMessage): Promise<void>;
}
export interface PrivateChatAutoReplyProfileDispatcherOptions {
    autoReplyConfig: PrivateChatAutoReplyConfig;
    resolvePeerChatPublicKey: (globalMetaId: string) => Promise<string | null>;
    llmExecutor: Pick<LlmExecutor, 'execute' | 'getSession'>;
    createSignerForHome?: (homeDir: string) => Signer;
    createReplyRunnerForProfile?: (input: {
        paths: MetabotPaths;
        metaBotSlug: string;
        runtimeResolver: ReturnType<typeof createLlmRuntimeResolver>;
        llmExecutor: Pick<LlmExecutor, 'execute' | 'getSession'>;
    }) => ChatReplyRunner;
    createOrchestrator?: (deps: PrivateChatAutoReplyDependencies, config: PrivateChatAutoReplyConfig) => PrivateChatAutoReplyOrchestrator;
}
export declare function createPrivateChatAutoReplyProfileDispatcher(input: PrivateChatAutoReplyProfileDispatcherOptions): PrivateChatAutoReplyProfileDispatcher;
export declare function createDefaultCliDependencies(context: CliRuntimeContext): CliDependencies;
export declare function mergeCliDependencies(context: CliRuntimeContext): CliDependencies;
export declare function serveCliDaemonProcess(context: Pick<CliRuntimeContext, 'env' | 'cwd'>): Promise<never>;
export {};
