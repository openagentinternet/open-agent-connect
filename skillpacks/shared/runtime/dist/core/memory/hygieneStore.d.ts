import type { MetabotPaths } from '../state/paths';
import type { HygieneRunStats } from './memoryHygienePolicy';
export interface HygieneLedger {
    version: 1;
    lastRun: HygieneRunStats | null;
    /** ISO 8601 of the last clean deep-consolidation apply. */
    deepConsolidationLastRunAt: string | null;
}
export interface HygieneStore {
    getLedger(): Promise<HygieneLedger>;
    getLastRun(): Promise<HygieneRunStats | null>;
    setLastRun(stats: HygieneRunStats): Promise<void>;
    getDeepConsolidationLastRunAt(): Promise<number | null>;
    setDeepConsolidationLastRunAt(ranAtMs: number): Promise<void>;
}
export declare function createHygieneStore(paths: MetabotPaths): HygieneStore;
