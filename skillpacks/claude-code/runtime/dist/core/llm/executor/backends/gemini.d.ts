import { type LlmBackend, type LlmBackendFactory } from './backend';
export declare function createGeminiBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const geminiBackendFactory: LlmBackendFactory;
