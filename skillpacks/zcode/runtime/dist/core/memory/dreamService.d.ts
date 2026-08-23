import type { MetabotPaths } from '../state/paths';
import { type DreamDueResult } from './dreamPrompt';
import { type DreamRun, type DreamStore } from './dreamStore';
import { type ExperienceStore } from './experienceStore';
import { type ImpressionStore } from './impressionStore';
import { type KnowledgeStore } from './knowledgeStore';
import { type MemoryStore } from './memoryStore';
/** Model limits used to size the dream prompts; injectable per LLM. */
export interface DreamModelLimits {
    contextWindow: number;
    maxOutputTokens: number;
}
export interface DreamBudgets {
    maxOutputTokens: number;
    fastPathInputTokens: number;
    fragmentInputTokens: number;
    fragmentOutputTokens: number;
}
export declare function resolveDreamBudgets(limits?: Partial<DreamModelLimits>): DreamBudgets;
export interface DreamChatCompletionInput {
    system: string;
    user: string;
    maxOutputTokens: number;
}
export type DreamChatCompletion = (input: DreamChatCompletionInput) => Promise<string>;
export interface DreamPersona {
    botName: string;
    role?: string | null;
    soul?: string | null;
    globalMetaId?: string | null;
}
export type DreamPlanResult = {
    kind: 'empty';
    date: string;
} | {
    kind: 'prompt';
    date: string;
    mode: 'fast';
    system: string;
    user: string;
    maxOutputTokens: number;
} | {
    kind: 'fragments';
    date: string;
    mode: 'fragments';
    /** Fragments still needing an LLM pass (cached ones are skipped). */
    fragments: Array<{
        fragmentKey: string;
        system: string;
        user: string;
        maxOutputTokens: number;
        contentHash: string;
        sourceMessageCount: number;
        sourceCharCount: number;
        estimatedInputTokens: number;
        sessionId: string;
        chunkIndex: number;
    }>;
    /** Fragments already cached from a previous (interrupted) run. */
    cachedFragmentKeys: string[];
};
export interface DreamCommitResult {
    ok: boolean;
    error?: string;
    date?: string;
    selfIdentityValid?: boolean;
    selfIdentityChars?: number;
    /** When set, the caller should re-run the LLM once with this hint appended
     * to the user prompt and commit again (commit is idempotent per date). */
    identityRetryHint?: string;
    written?: {
        summary: boolean;
        importantMemories: number;
        valueLessons: number;
        workReviews: number;
        identityUpdated: boolean;
        identitySkippedOlder: boolean;
    };
}
export interface DreamServiceDeps {
    dreamStore?: DreamStore;
    memoryStore?: MemoryStore;
    experienceStore?: ExperienceStore;
    impressionStore?: ImpressionStore;
    knowledgeStore?: KnowledgeStore;
}
/** Which past dates still need dream attention for this bot. */
export declare function dueDreamDates(paths: MetabotPaths, input?: {
    now?: Date;
}, deps?: DreamServiceDeps): Promise<DreamDueResult>;
/**
 * Gather the day, decide fast vs fragmented, begin the run, and return the
 * prompt(s) the caller must run through an LLM. Empty days record a completed
 * run without any LLM call.
 */
export declare function planDream(paths: MetabotPaths, input: {
    date: string;
    llm?: string | null;
    limits?: Partial<DreamModelLimits>;
}, deps?: DreamServiceDeps): Promise<DreamPlanResult>;
/**
 * Fold raw fragment LLM outputs into the synthesis prompt. Fragment outputs
 * are parsed tolerantly and cached by content hash; previously cached
 * fragments are reused so an interrupted run resumes cheaply.
 */
export declare function synthesizeDream(paths: MetabotPaths, input: {
    date: string;
    llm?: string | null;
    limits?: Partial<DreamModelLimits>;
    /** Raw LLM text keyed by fragmentKey for the fragments planDream returned. */
    fragmentOutputs: Record<string, string>;
}, deps?: DreamServiceDeps): Promise<Extract<DreamPlanResult, {
    kind: 'prompt';
}>>;
/** Parse + validate + write one dream output. Idempotent per date. */
export declare function commitDream(paths: MetabotPaths, input: {
    date: string;
    outputText: string;
    llm?: string | null;
    isRepair?: boolean;
}, deps?: DreamServiceDeps): Promise<DreamCommitResult>;
export interface DreamRunResult {
    date: string;
    kind: 'empty' | 'completed' | 'failed';
    error?: string;
    commit?: DreamCommitResult;
}
/**
 * Full in-process dream loop for one date: plan → LLM (fragments when the
 * day is long) → parse retry → self-identity expansion retry → commit.
 */
export declare function runDream(paths: MetabotPaths, input: {
    date: string;
    llm?: string | null;
    limits?: Partial<DreamModelLimits>;
    isRepair?: boolean;
}, complete: DreamChatCompletion, deps?: DreamServiceDeps): Promise<DreamRunResult>;
/** Status snapshot for the UI Dream tab. */
export declare function dreamStatus(paths: MetabotPaths, deps?: DreamServiceDeps): Promise<{
    runs: DreamRun[];
    summaryCount: number;
    latestSummaryDate: string | null;
    hasSelfIdentity: boolean;
}>;
