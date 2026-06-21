import { type BlockedArgSpec, type LlmBackend } from './backend';
export interface AcpBackendOptions {
    provider: string;
    binaryPath: string;
    env?: Record<string, string>;
    baseArgs: string[];
    blockedArgs: Record<string, BlockedArgSpec>;
    forcedEnv?: Record<string, string>;
    resumeMethod: 'session/resume' | 'session/load';
    includeModelInNewSession?: boolean;
    includeMcpServersInResume?: boolean;
    sendPromptContentAlias?: boolean;
    gateNotificationsUntilPrompt?: boolean;
    normalizeToolName?: (toolName: string) => string;
}
export declare function hermesToolNameFromTitle(title: string | undefined, kind: string | undefined): string;
export declare function createAcpBackend(options: AcpBackendOptions): LlmBackend;
