import type { LlmBackend, LlmBackendFactory } from './backend';
export declare function createHermesBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const hermesBackendFactory: LlmBackendFactory;
