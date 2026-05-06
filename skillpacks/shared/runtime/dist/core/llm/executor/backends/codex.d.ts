import { type LlmBackend, type LlmBackendFactory } from './backend';
export declare function createCodexBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const codexBackendFactory: LlmBackendFactory;
