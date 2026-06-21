import { type LlmBackend, type LlmBackendFactory } from './backend';
export declare function createOpenCodeBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const opencodeBackendFactory: LlmBackendFactory;
