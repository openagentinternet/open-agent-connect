import { type LlmBackend, type LlmBackendFactory } from './backend';
export declare function createCursorBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const cursorBackendFactory: LlmBackendFactory;
