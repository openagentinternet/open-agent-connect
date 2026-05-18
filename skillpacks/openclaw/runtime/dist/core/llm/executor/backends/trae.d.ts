import { type LlmBackend, type LlmBackendFactory } from './backend';
export declare function createTraeBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const traeBackendFactory: LlmBackendFactory;
