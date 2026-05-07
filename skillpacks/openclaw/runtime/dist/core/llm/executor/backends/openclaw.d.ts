import { type LlmBackend, type LlmBackendFactory } from './backend';
export declare function createOpenClawBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const openClawBackendFactory: LlmBackendFactory;
