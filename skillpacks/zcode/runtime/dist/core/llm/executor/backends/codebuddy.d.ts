import { type LlmBackend, type LlmBackendFactory } from './backend';
export declare function createCodeBuddyBackend(binaryPath: string, env?: Record<string, string>): LlmBackend;
export declare const codeBuddyBackendFactory: LlmBackendFactory;
