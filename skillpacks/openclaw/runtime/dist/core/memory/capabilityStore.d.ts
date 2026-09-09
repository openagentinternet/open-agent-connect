import type { MetabotPaths } from '../state/paths';
export interface CapabilityDraft {
    id: string;
    /** YYYY-MM-DD of the dream that distilled this candidate. */
    dreamDate: string;
    title: string;
    description: string;
    capabilityType: 'skill' | 'workflow' | 'tool_pattern';
    sourceSessionIds: string[];
    status: 'draft';
    createdAt: number;
}
export interface CapabilityStore {
    /** Append dream-distilled candidates for one date; returns rows inserted. */
    insertDrafts(date: string, learnings: Array<{
        title?: string | null;
        description?: string | null;
        capabilityType?: string | null;
        sourceSessionIds?: string[];
    }>): Promise<number>;
    /** Read drafts, newest first. */
    listDrafts(options?: {
        limit?: number;
    }): Promise<CapabilityDraft[]>;
}
export declare function createCapabilityStore(paths: MetabotPaths): CapabilityStore;
