import type { MetabotPaths } from '../state/paths';
import { type DreamStore } from './dreamStore';
import { type ExperienceStore } from './experienceStore';
import { type HygieneStore } from './hygieneStore';
import { type ImpressionStore } from './impressionStore';
import { type KnowledgeStore } from './knowledgeStore';
import { type HygieneRunStats } from './memoryHygienePolicy';
import { type MemoryPolicyStore } from './memoryPolicy';
import { type MemoryStore } from './memoryStore';
/** LLM transport for the deep-consolidation step. Returns the raw model text,
 * or null when no LLM runtime is available (skip, not fail). Throwing reports
 * a real LLM failure into the run's error list. */
export type MemoryHygieneLlmCompletion = (input: {
    system: string;
    user: string;
}) => Promise<string | null>;
export interface MemoryHygieneRunInput {
    trigger: 'scheduled' | 'manual';
    /** Injectable clock (tests); defaults to the current time. */
    now?: Date;
    /** Manual `--no-deep`: skip the LLM step entirely. */
    deep?: boolean;
    /** Deep-consolidation LLM transport; absent or null-returning = skipped. */
    complete?: MemoryHygieneLlmCompletion;
}
export interface MemoryHygieneDeps {
    memoryStore?: MemoryStore;
    policyStore?: MemoryPolicyStore;
    impressionStore?: ImpressionStore;
    experienceStore?: ExperienceStore;
    knowledgeStore?: KnowledgeStore;
    dreamStore?: DreamStore;
    hygieneStore?: HygieneStore;
}
/**
 * Full in-process hygiene pass. Steps run sequentially and are error-isolated:
 * a throwing step lands in `stats.errors` (as `<step>: <message>`) and the
 * rest continue; the ledger is stamped with the merged counters either way.
 */
export declare function runMemoryHygiene(paths: MetabotPaths, input: MemoryHygieneRunInput, deps?: MemoryHygieneDeps): Promise<HygieneRunStats>;
/** Scheduled-pass eligibility: ≥ 04:00 local, once per local date, all-day
 * catch-up. Manual `run` bypasses this entirely. */
export declare function memoryHygieneDue(paths: MetabotPaths, input?: {
    now?: Date;
}, deps?: MemoryHygieneDeps): Promise<{
    due: boolean;
    reason: string;
}>;
