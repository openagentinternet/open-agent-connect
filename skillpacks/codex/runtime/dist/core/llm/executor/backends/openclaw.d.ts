import type { LlmBackend, LlmBackendFactory } from './backend';
export declare function createOpenClawBackend(binaryPath: string): LlmBackend;
export declare const openClawBackendFactory: LlmBackendFactory;
