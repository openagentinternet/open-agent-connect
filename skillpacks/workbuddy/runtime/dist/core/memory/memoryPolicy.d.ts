import type { MetabotPaths } from '../state/paths';
import type { MemoryGuardLevel } from './memoryExtractor';
import { type MemoryHygieneConfig } from './memoryHygienePolicy';
import type { MemoryEffectivePolicy, MemoryPolicy, MemoryPolicyUpdates } from './memoryTypes';
export declare function clampMemoryUserMemoriesMaxItems(value: number): number;
export declare function normalizeMemoryGuardLevel(value: unknown): MemoryGuardLevel;
export interface MemoryPolicyStore {
    /** Raw per-profile override file content (empty object when absent). */
    readOverride(): Promise<(Partial<MemoryPolicyUpdates> & {
        updatedAt?: number;
    })>;
    setOverride(updates: MemoryPolicyUpdates): Promise<MemoryPolicy>;
    deleteOverride(): Promise<boolean>;
    effectivePolicy(): Promise<MemoryEffectivePolicy>;
    /** Effective hygiene thresholds with the master switch folded in from the
     * `hygieneEnabled` flag. */
    getHygieneConfig(): Promise<MemoryHygieneConfig>;
    /** Merge threshold updates into the `hygiene` object; `enabled` in the
     * update maps to the `hygieneEnabled` policy flag. */
    setHygieneConfig(update: Record<string, unknown>): Promise<MemoryHygieneConfig>;
}
export declare function createMemoryPolicyStore(paths: MetabotPaths): MemoryPolicyStore;
