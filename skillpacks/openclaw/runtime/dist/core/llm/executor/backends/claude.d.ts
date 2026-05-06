import { type LlmBackend, type LlmBackendFactory } from './backend';
export declare function createClaudeBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const claudeBackendFactory: LlmBackendFactory;
