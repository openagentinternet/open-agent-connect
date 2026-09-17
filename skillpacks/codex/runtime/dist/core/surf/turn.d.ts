/**
 * The surf session turn — a bounded LLM tool loop with a HARD executor-side
 * allowlist, rebuilt from IDBots' cowork surf session for OAC's json-fence
 * tool loop (the same executor pattern as the study/qa-surf turn in
 * core/knowledgebase/studyJobs.ts): the model proposes one json tool call
 * per step, the executor runs it (or rejects it), and only allowlisted
 * operations ever execute. Chain writes go through the injected guarded
 * primitive (surf/guard.ts) so the interaction budget, duplicate guard and
 * self-interaction block are structural, not prompt guidance. KB adds are
 * capped by a counting wrapper. create_scheduled_task (the surf→work
 * handoff) creates real scheduled tasks with host ground-truth receipts.
 */
import type { SurfSessionWriteState } from './guard.js';
/** Study(12)/qa-surf(24) ceilings are far too low for a full surf: the wall
 *  clock watchdog is the real bound; this is the runaway safety net. */
export declare const SURF_TURN_MAX_TOOL_STEPS = 96;
/** Hard cap of scheduled tasks per surf run (IDBots parity). */
export declare const SURF_SCHEDULED_TASK_CAP = 2;
/** IDBots METAWEB_SURF_TOOL_ALLOWLIST parity (memory tools gated separately). */
export declare const SURF_TOOL_ALLOWLIST: Set<string>;
export interface SurfScheduledTaskSpec {
    name: string;
    prompt: string;
    scheduleType: 'at' | 'interval' | 'cron';
    /** Local wall-clock ISO datetime WITHOUT timezone suffix (at only). */
    at?: string;
    intervalValue?: number;
    intervalUnit?: 'minute' | 'hour' | 'day';
    cron?: string;
}
export interface SurfTurnTools {
    searchMetaweb(args: {
        query: string;
    }): Promise<string>;
    readMetawebPin(args: {
        pinId: string;
    }): Promise<string>;
    readMetawebPinsBatch(args: {
        pinIds: string[];
    }): Promise<string>;
    metawebPinVersions(args: {
        pinId: string;
    }): Promise<string>;
    metaprotocolRegistry(args: {
        size?: number;
        cursor?: string;
    }): Promise<string>;
    searchQa(args: {
        query: string;
        answered?: boolean;
        sort?: string;
        size?: number;
        cursor?: string;
    }): Promise<string>;
    listLatestQuestions(args: {
        maxAnswers?: number;
        sort?: string;
        size?: number;
        cursor?: string;
    }): Promise<string>;
    getQuestionAnswers(args: {
        questionPinId: string;
        size?: number;
        cursor?: string;
    }): Promise<string>;
    searchSocialPosts(args: {
        query: string;
        size?: number;
        cursor?: string;
    }): Promise<string>;
    socialPostDetail(args: {
        pinId: string;
    }): Promise<string>;
    socialPostComments(args: {
        pinId: string;
        size?: number;
        cursor?: string;
    }): Promise<string>;
    omniRead(args: Record<string, unknown>): Promise<string>;
    chainWrite(args: {
        path: string;
        payload: unknown;
        network?: string;
    }): Promise<string>;
    listKnowledgeBases(): Promise<string>;
    queryKnowledgeBases(args: {
        query: string;
        knowledgeBaseId?: string;
    }): Promise<string>;
    addDocument(args: {
        title: string;
        content: string;
        pinId?: string;
    }): Promise<string>;
    learnKnowledgeBase(): Promise<string>;
    saveProcedure(args: {
        title: string;
        steps: string[];
        pitfalls?: string[];
        triggerText?: string;
        sourcePinIds?: string[];
    }): Promise<string>;
    recallProcedures(args: {
        query: string;
    }): Promise<string>;
    upsertKnowledge(args: {
        topic: string;
        summary: string;
        kind?: string;
    }): Promise<string>;
    recallKnowledge(args: {
        query?: string;
        kind?: string;
    }): Promise<string>;
    createScheduledTask(spec: SurfScheduledTaskSpec): Promise<string>;
}
export interface SurfTurnDeps {
    runLlm(history: Array<{
        role: 'user' | 'assistant';
        content: string;
    }>): Promise<string>;
    tools: SurfTurnTools;
    /** Counters + receipts for the whole run (see surf/guard.ts). */
    writeState: SurfSessionWriteState;
    /** False = DEGRADED surf: KB/memory tools are refused by the executor. */
    memoryEnabled?: boolean;
    maxSteps?: number;
    maxResultChars?: number;
}
/**
 * Prepend the json-fence tool-loop contract (OAC's executor speaks fences,
 * not native tool calls) to the IDBots surf session prompt. The tool list
 * mirrors the allowlist 1:1; the DEGRADED variant drops the memory tools.
 */
export declare function withSurfToolLoopContract(prompt: string, options?: {
    memoryEnabled?: boolean;
}): string;
/**
 * Run the surf session. Returns the final report text (the last json fence
 * the model emitted as its report). The caller parses it with
 * parseSurfRunReport; receipts live on `writeState`.
 */
export declare function runSurfTurnWithTools(prompt: string, deps: SurfTurnDeps): Promise<string>;
