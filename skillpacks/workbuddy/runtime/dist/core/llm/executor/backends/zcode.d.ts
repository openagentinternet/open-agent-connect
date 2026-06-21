import { type LlmBackend, type LlmBackendFactory } from './backend';
export declare function createZCodeBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const zcodeBackendFactory: LlmBackendFactory;
