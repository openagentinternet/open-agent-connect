import type { LlmBackendFactory } from './backends/backend';
import { type SessionManager } from './session-manager';
import type { LlmExecutionEvent, LlmExecutionRequest, LlmSessionRecord } from './types';
interface LlmExecutorOptions {
    sessionsRoot: string;
    transcriptsRoot: string;
    skillsRoot: string;
    backends: Record<string, LlmBackendFactory>;
    sessionManager?: SessionManager;
}
export declare class LlmExecutor {
    private readonly sessionsRoot;
    private readonly transcriptsRoot;
    private readonly skillsRoot;
    private readonly backends;
    private readonly sessionManager;
    private readonly streams;
    private readonly running;
    constructor(options: LlmExecutorOptions);
    execute(request: LlmExecutionRequest): Promise<string>;
    cancel(sessionId: string): Promise<void>;
    getSession(sessionId: string): Promise<LlmSessionRecord | null>;
    listSessions(limit?: number, options?: {
        metaBotSlug?: string;
    }): Promise<LlmSessionRecord[]>;
    streamEvents(sessionId: string): AsyncIterable<LlmExecutionEvent>;
    private runSession;
    private failSession;
    private pushEvent;
    private closeStream;
    private appendTranscript;
}
export {};
