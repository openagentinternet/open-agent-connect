import { type MetabotCommandResult } from '../core/contracts/commandResult';
import type { PrivateChatInboundMessage } from '../core/chat/privateChatTypes';
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
export declare function createDefaultCliDependencies(context: CliRuntimeContext): CliDependencies;
export declare function mergeCliDependencies(context: CliRuntimeContext): CliDependencies;
export declare function serveCliDaemonProcess(context: Pick<CliRuntimeContext, 'env' | 'cwd'>): Promise<never>;
export {};
