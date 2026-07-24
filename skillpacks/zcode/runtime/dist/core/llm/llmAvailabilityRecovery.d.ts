import type { LlmRuntimeStore } from './llmRuntimeStore';
import { testLlmRuntimeReadiness } from './llmRuntimeDiscovery';
export declare const LLM_AVAILABILITY_RECOVERY_DISABLED_ENV = "METABOT_LLM_AVAILABILITY_RECOVERY_DISABLED";
export interface LlmAvailabilityRecovery {
    /** Start the periodic loop. No-op when disabled or already running. */
    start: () => void;
    stop: () => void;
    /** Run one full cycle over all target stores. Primarily for tests. */
    runCycleOnce: () => Promise<void>;
    /**
     * Ask for an expedited cycle on one store (spec R5.3), e.g. after a chat
     * turn found no selectable runtime. Coalesced per store, fire-and-forget.
     */
    requestSoon: (homeDir: string) => void;
}
export declare function createLlmAvailabilityRecovery(input: {
    listTargetHomes: () => Promise<string[]>;
    env?: NodeJS.ProcessEnv;
    storeForHome?: (homeDir: string) => LlmRuntimeStore;
    probe?: typeof testLlmRuntimeReadiness;
    /** Return true while a discovery sweep owns the store; the cycle skips it (spec R4.4). */
    isStoreBusy?: (homeDir: string) => boolean;
    now?: () => number;
    intervalMs?: number;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
    globalConcurrency?: number;
    logger?: (message: string, error?: unknown) => void;
}): LlmAvailabilityRecovery;
