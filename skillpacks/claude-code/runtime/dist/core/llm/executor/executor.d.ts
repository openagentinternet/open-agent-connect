import type { LlmBackendFactory } from './backends/backend';
import { type SessionManager } from './session-manager';
import type { LlmExecutionEvent, LlmExecutionRequest, LlmSessionRecord } from './types';
interface LlmExecutorOptions {
    sessionsRoot: string;
    transcriptsRoot: string;
    skillsRoot: string;
    systemHomeDir?: string;
    env?: NodeJS.ProcessEnv;
    backends: Record<string, LlmBackendFactory>;
    sessionManager?: SessionManager;
    /**
     * Root for per-provider isolated execution homes (bot turns stay out of the
     * user's platform session history). Defaults to a `provider-homes` sibling
     * of `sessionsRoot`.
     */
    providerHomesRoot?: string;
}
export declare class LlmExecutor {
    private readonly sessionsRoot;
    private readonly transcriptsRoot;
    private readonly skillsRoot;
    private readonly providerHomesRoot;
    private readonly systemHomeDir?;
    private readonly env?;
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
    /**
     * Resolve the state home a resume target originally ran in. Sessions this
     * executor created ran in the isolated provider home (recorded as
     * providerStateHome); resuming one of them against the real home would both
     * miss the thread and leak the turn into the user's platform history.
     * Returns null for caller-owned sessions (no matching record) — those live
     * in the CLI's real home and must keep running against it.
     */
    private findResumeStateHome;
    private runSession;
    private failSession;
    private pushEvent;
    private closeStream;
    private appendTranscript;
}
export {};
