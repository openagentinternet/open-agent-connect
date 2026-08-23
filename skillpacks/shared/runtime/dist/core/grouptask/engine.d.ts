/**
 * Group Task engine — the OAC port of the IDBots groupTaskDaemon: a 5-second
 * tick loop that drives every non-terminal task chaired by a local profile.
 * Per task and per tick it (1) claims the kv driver mutex, (2) stamps the
 * stall heartbeat, (3) syncs the transcript from the chain indexers,
 * (4) runs the one-shot chair planning turn, and (5) processes new messages
 * after the cursor: idempotent tag side effects, then turn-taking LLM replies
 * under cooldowns/budgets. Chain history is the only truth — the engine's own
 * posts are processed when they round-trip through the indexer sync.
 *
 * All seams (profiles, signers, stores, indexer fetch, LLM runner, persona
 * loader, clock) are injected so tests run fully offline.
 */
import { type GroupTaskProfileRef, type GroupTaskServiceContext } from './service';
export declare const GROUP_TASK_DRIVER_KV_PREFIX = "group_task_driver:";
export declare const GROUP_TASK_PLANNED_KV_PREFIX = "group_task_chair_planned:";
export declare const GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX = "group_task_chair_plan_attempts:";
export declare const GROUP_TASK_MSG_RETRY_KV_PREFIX = "group_task_msg_retry:";
export declare const GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX = "group_task_review_summary:";
export interface GroupTaskLlmTurn {
    profile: GroupTaskProfileRef;
    role: 'chair' | 'worker';
    systemPrompt: string;
    prompt: string;
}
/** Run one LLM turn for a profile; return raw text; throw on runtime failure. */
export type GroupTaskEngineLlmRunner = (turn: GroupTaskLlmTurn) => Promise<string>;
export interface GroupTaskEnginePersona {
    role?: string | null;
    bio?: string | null;
    soul?: string | null;
    goal?: string | null;
}
export type GroupTaskPersonaLoader = (profile: GroupTaskProfileRef) => Promise<GroupTaskEnginePersona>;
/** Inbound private message shape the OpenTeam envelope scan consumes. */
export interface GroupTaskInboundPrivateMessage {
    messageId: string;
    senderGlobalMetaId: string;
    content: string;
    timestamp: number;
}
export interface GroupTaskEngineOptions {
    ctx: GroupTaskServiceContext;
    runLlmTurn: GroupTaskEngineLlmRunner;
    /** Defaults to reading BIO/SOUL/GOAL/ROLE markdown from the profile home. */
    loadPersona?: GroupTaskPersonaLoader;
    /**
     * Inbound private messages of a profile (OpenTeam envelope scan source).
     * Defaults to the profile's private-chat state store, which the daemon's
     * simplemsg listener/backfill keeps up to date.
     */
    readInboundPrivateMessages?: (profile: GroupTaskProfileRef) => Promise<GroupTaskInboundPrivateMessage[]>;
    intervalMs?: number;
    driverGraceMs?: number;
    maxWorkerRepliesPerTick?: number;
    workerCooldownMs?: number;
    chairCooldownMs?: number;
    /** Lifetime reply budget per (task, seat) for this engine instance. */
    replyBudget?: number;
    now?: () => number;
}
export interface GroupTaskEngine {
    start(): void;
    stop(): void;
    /** Drive one full tick immediately (used by tests; serialized with timer ticks). */
    tick(): Promise<void>;
}
export declare function createGroupTaskEngine(options: GroupTaskEngineOptions): GroupTaskEngine;
