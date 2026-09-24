/**
 * Daemon-side memory handler group: the /api/memory/* verbs a standalone
 * memory UI needs. Every verb is a port of the matching `metabot memory *`
 * CLI dependency handler against src/core/memory stores — same inputs, same
 * envelope payloads. Actor resolution mirrors the surf/dream groups (explicit
 * slug, else the machine Twin).
 *
 * Deliberately not exposed here (agent-side surfaces, still reachable via the
 * CLI): blocks/extract (per-turn injection hooks), transcript append/read,
 * chats, scopes, stats.
 */
import { commandFailed } from '../core/contracts/commandResult';
import type { LlmExecutor } from '../core/llm/executor';
import type { DreamBotRef } from './dreamHandlers';
import type { MetabotDaemonHttpHandlers } from './routes/types';
export interface MemoryDaemonHandlersInput {
    /** Resolve the acting bot (explicit slug, else the machine Twin). */
    resolveBot: (from?: string) => Promise<DreamBotRef | {
        failure: ReturnType<typeof commandFailed>;
    }>;
    /**
     * The daemon's shared LLM executor for the deep-consolidation call inside
     * hygiene runs. Absent/unbound → deep consolidation is skipped (null), never
     * a failure — exactly the pre-wiring CLI behavior.
     */
    llmExecutor?: Pick<LlmExecutor, 'execute' | 'getSession'> | null;
}
export declare function createMemoryDaemonHandlers(input: MemoryDaemonHandlersInput): NonNullable<MetabotDaemonHttpHandlers['memory']>;
