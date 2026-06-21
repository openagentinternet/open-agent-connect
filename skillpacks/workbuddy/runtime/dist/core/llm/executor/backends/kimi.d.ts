import type { LlmBackend, LlmBackendFactory } from './backend';
export declare function createKimiBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const kimiBackendFactory: LlmBackendFactory;
