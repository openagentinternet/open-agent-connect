import { type LlmBackend, type LlmBackendFactory } from './backend';
export declare function createCopilotBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const copilotBackendFactory: LlmBackendFactory;
