/**
 * Daemon-side dream handler group: the /api/dream/* verbs. The read verbs
 * (status/due/summaries/self-identity/capabilities) are pure core-store calls;
 * `run` ports the `metabot dream run` in-process loop (plan → LLM → commit)
 * with the unified passive-LLM chain (DSH pair first, then the local runtime
 * fallback through the injected daemon llmExecutor).
 *
 * Long-running contract mirrors /api/surf/run: `wait: true` holds the request
 * until the run settles; the default starts the run inside the daemon process
 * and returns `{ date, status: 'running' }` immediately. Run state lives in
 * the dream store, so `status`/`due` observe it (their stale-running sweep is
 * the crash-recovery path when the daemon dies mid-run).
 */
import { commandFailed } from '../core/contracts/commandResult';
import type { LlmExecutor } from '../core/llm/executor';
import type { MetabotDaemonHttpHandlers } from './routes/types';
export interface DreamBotRef {
    slug: string;
    name: string;
    homeDir: string;
}
export interface DreamDaemonHandlersInput {
    /** Resolve the acting bot (explicit slug, else the machine Twin). */
    resolveBot: (from?: string) => Promise<DreamBotRef | {
        failure: ReturnType<typeof commandFailed>;
    }>;
    /**
     * The daemon's shared LLM executor (local-runtime chain). Absent → dream
     * runs fail with a clear error whenever an LLM call is actually needed
     * (empty days still complete without one).
     */
    llmExecutor?: Pick<LlmExecutor, 'execute' | 'getSession'> | null;
    /** Structured log sink (daemon engine log). */
    log?: (message: string) => void;
}
export declare function createDreamDaemonHandlers(input: DreamDaemonHandlersInput): NonNullable<MetabotDaemonHttpHandlers['dream']>;
