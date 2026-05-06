import type { LlmSessionRecord } from './types';
export interface SessionManager {
    create(record: LlmSessionRecord): Promise<void>;
    update(sessionId: string, patch: Partial<LlmSessionRecord>): Promise<void>;
    get(sessionId: string): Promise<LlmSessionRecord | null>;
    list(limit?: number, options?: {
        metaBotSlug?: string;
    }): Promise<LlmSessionRecord[]>;
    delete(sessionId: string): Promise<void>;
}
export declare function isSafeLlmSessionId(sessionId: string): boolean;
export declare function createFileSessionManager(sessionsRoot: string): SessionManager;
