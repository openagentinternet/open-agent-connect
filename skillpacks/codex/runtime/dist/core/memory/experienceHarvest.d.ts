import type { MetabotPaths } from '../state/paths';
import { type ExperienceStore } from './experienceStore';
export interface DreamExperienceHarvestInput {
    paths: MetabotPaths;
    experienceStore: ExperienceStore;
    /** Observer GlobalMetaID (the dreaming bot). Empty -> no-op. */
    observerGlobalMetaId: string;
    /** Local dream date, YYYY-MM-DD. */
    date: string;
    startMs: number;
    endMs: number;
}
export interface DreamExperienceHarvestResult {
    /** Distinct episodes attached during this harvest (existing + new). */
    episodes: number;
}
/**
 * Fold one dream day's group-task chats, accepted group tasks and seller
 * orders into the experience ledger. Callers gate on the observer GlobalMetaID
 * and isolate failures — this harvest must never fail a dream run.
 */
export declare function harvestDreamDayExperiences(input: DreamExperienceHarvestInput): Promise<DreamExperienceHarvestResult>;
