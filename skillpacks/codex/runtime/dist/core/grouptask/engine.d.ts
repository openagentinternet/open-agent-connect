/**
 * Group Task engine — the OAC port of the IDBots groupTaskDaemon (single-
 * commander contract): a 5-second tick loop that drives every non-terminal
 * task chaired by a local profile. Per task and per tick it (1) claims the kv
 * driver mutex, (2) stamps the stall heartbeat, (3) syncs the transcript from
 * the chain indexers, (4) runs the one-shot chair planning turn, and (5)
 * processes new messages after the cursor: idempotent tag side effects, then
 * turn-taking LLM replies under cooldowns/budgets. Chain history is the only
 * truth — the engine's own posts are processed when they round-trip through
 * the indexer sync.
 *
 * SINGLE COMMANDER: the host is the environment, never a speaker — it never
 * posts into the group under any identity (the chair is the only coordinator;
 * workers and the human owner are the other participants). Host observations
 * (missing ACKs, rung deadlines, joins, parser verdicts, chain health) are
 * recorded as HOST NOTES (store.recordHostNote) and delivered to the chair in
 * ONE dedicated turn; the chair decides what the group needs to hear in its
 * own voice. Extension rule: if a change would make the host post into the
 * group, it is wrong by construction — record a host note and let the chair
 * decide. The single remaining host-directed group post is the deterministic
 * owner-confirmed kick moderation notice (service.kickGroupTaskMember).
 *
 * All seams (profiles, signers, stores, indexer fetch, LLM runner, persona
 * loader, clock) are injected so tests run fully offline.
 */
import { type GroupTaskProfileRef, type GroupTaskServiceContext } from './service';
export declare const GROUP_TASK_DRIVER_KV_PREFIX = "group_task_driver:";
export declare const GROUP_TASK_PLANNED_KV_PREFIX = "group_task_chair_planned:";
export declare const GROUP_TASK_PLAN_ATTEMPTS_KV_PREFIX = "group_task_chair_plan_attempts:";
export declare const GROUP_TASK_MSG_RETRY_KV_PREFIX = "group_task_msg_retry:";
export declare const GROUP_TASK_PLANNING_DEFERRED_KV_PREFIX = "group_task_planning_deferred:";
export declare const GROUP_TASK_WORK_REQ_KV_PREFIX = "group_task_work_req:";
/** Deliverable re-verification cadence (indexer lag absorption). */
export declare const GROUP_TASK_DELIVERABLE_VERIFY_KV_PREFIX = "group_task_deliverable_verify:";
export declare const GROUP_TASK_ACK_PENDING_KV_PREFIX = "group_task_ack_pending:";
export declare const GROUP_TASK_ACK_REMINDED_KV_PREFIX = "group_task_ack_reminded:";
export declare const GROUP_TASK_ACK_SEEN_KV_PREFIX = "group_task_ack_seen:";
export declare const GROUP_TASK_TIMEOUT_OWNER_KV_PREFIX = "group_task_timeout_owner:";
/**
 * Chair-stated step deadlines (single clock — IDBots single-commander): the
 * chair's [DEADLINE: Nm] tag on a dispatch arms one entry per mentioned worker
 * when that worker ACKs; a passed deadline without a [DELIVERABLE] records ONE
 * `deadline` host note (chasing/extending/re-assigning is the chair's call).
 */
export declare const GROUP_TASK_DEADLINE_KV_PREFIX = "group_task_deadline:";
/** Consecutive-failure budget for the host-notes delivery chair turn. */
export declare const GROUP_TASK_HOST_NOTE_ATTEMPTS_KV_PREFIX = "group_task_host_note_attempts:";
export declare const GROUP_TASK_REVIEW_SUMMARY_KV_PREFIX = "group_task_review_summary:";
export declare const GROUP_TASK_GUEST_SELF_CHECK_KV_PREFIX = "openteam_self_check:";
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
    /**
     * Deliverable pin existence check (metaso pin read in production). When
     * absent, deliverables stay unconfirmed and the re-verify pass no-ops.
     */
    verifyPin?: (pinId: string) => Promise<'found' | 'not_found' | 'error'>;
    /**
     * Local-file → metafile upload seam (guest deliverables and inviter-side
     * row upgrades). Defaults to uploadLocalFileToChain with the seat signer.
     */
    uploadDeliverableFile?: (input: {
        slug: string;
        filePath: string;
    }) => Promise<{
        metafileUri: string;
        pinId: string;
    }>;
    now?: () => number;
    /**
     * Phase 3 worker-session handoff (default on): local worker turns become
     * work requests the DSH host executes as real sub-sessions. Disable to run
     * every worker turn through the bare-LLM responder directly.
     */
    workerSessions?: boolean;
}
export interface GroupTaskEngine {
    start(): void;
    stop(): void;
    /** Drive one full tick immediately (used by tests; serialized with timer ticks). */
    tick(): Promise<void>;
}
export declare function createGroupTaskEngine(options: GroupTaskEngineOptions): GroupTaskEngine;
