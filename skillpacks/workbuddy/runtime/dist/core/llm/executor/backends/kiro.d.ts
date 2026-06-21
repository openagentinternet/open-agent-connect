import type { LlmBackend, LlmBackendFactory } from './backend';
export declare function createKiroBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const kiroBackendFactory: LlmBackendFactory;
