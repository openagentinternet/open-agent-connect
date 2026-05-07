import { type LlmBackend, type LlmBackendFactory } from './backend';
export declare function createPiBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const piBackendFactory: LlmBackendFactory;
